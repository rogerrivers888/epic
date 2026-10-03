/**
 * What happens to booked guests when an event changes (hosting v4 handover §5):
 * a host cancels a session or the whole event, a date moves, the decides-by
 * day comes and the numbers are counted.
 *
 * Each action is one transaction under the event's lock (the same advisory
 * lock publishing and every set-up write take), and it writes what is owed as
 * *pending* refund rows in the ledger, each with its own idempotency key. A
 * job (`processRefunds`) then asks Stripe — after the transaction, so a slow
 * Stripe never holds the event locked, and with the same key every time, so a
 * retry is the same refund and never a second one. Nothing here talks to
 * Stripe inside a transaction.
 *
 *   cancel        a session or the whole event, a reason required, everyone
 *                 booked gets their money back in full and is told; inside the
 *                 late window it counts against the host
 *   change date   this session only, or this and all after it (shifted by the
 *                 same amount); decides-by follows; guests are moved and told,
 *                 and may then cancel for a full refund
 *   decides-by    under the minimum: called off, full refunds, everyone told.
 *                 Otherwise on — and a Depends-on-numbers event gives back the
 *                 difference between the minimum-numbers price and the final one
 */

import { query, withTransaction } from '../db.js';
import * as ledger from '../repositories/hostingLedger.js';
import * as settings from '../repositories/hostingSettings.js';
import * as notifications from '../repositories/notifications.js';
import * as stripe from './stripe.js';
import { logChange } from '../repositories/hostingSettings.js';
import { isLate } from '../domain/money.js';
import { localInstant, localDay, plusDays, perPersonAt } from '../domain/lanes.js';

export const CANCEL_REASONS = Object.freeze(['illness', 'weather', 'venue', 'numbers', 'other']);
// Attended counts too: a guest who came to the first session still holds the later ones (Codex, 2 Oct 2026).
const LIVE_BOOKING = `b.state in ('pending', 'confirmed', 'attended')`;

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });
const tzOf = (o) => o?.time_zone ?? 'Europe/London';
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

/** When a session starts, as an instant, in the event's own time zone. */
export const sessionStart = (s, offer) => localInstant(ymd(s.on_date), hm(s.starts_at) ?? '00:00', tzOf(offer));

/** Take the event's lock for this transaction and read it. */
async function lockEvent(c, offerId) {
  await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${offerId}`]);
  const { rows: [o] } = await c.query('select * from host_offers where id = $1 for update', [offerId]);
  return o ?? null;
}

/** Every live booking touching these sessions, with the sessions each one covers. */
async function bookingsOn(c, sessionIds) {
  const { rows } = await c.query(
    `select b.*, array(select bs2.session_id::text from booking_sessions bs2 where bs2.booking_id = b.id) as all_sessions,
            array(select bs3.session_id::text from booking_sessions bs3 where bs3.booking_id = b.id and bs3.state = 'booked') as booked_sessions,
            (select count(*) from booking_sessions bs4 where bs4.booking_id = b.id and bs4.state = 'forfeited')::int as forfeited
       from experience_bookings b
      where ${LIVE_BOOKING}
        and exists (select 1 from booking_sessions bs where bs.booking_id = b.id and bs.session_id = any($1::uuid[]) and bs.state = 'booked')`,
    [sessionIds],
  );
  return rows;
}

/**
 * Write what a booking is owed back, pending, and count it against the booking
 * at once so a payout made before Stripe answers never pays the host for it.
 * A held card that loses all its sessions is released rather than refunded.
 * Returns the ledger row, or null when nothing is owed.
 */
export async function owe(c, booking, { amountPence, cause, key, sessionId = null, wholeBooking = false }) {
  if (booking.payment_state === 'held') {
    if (!wholeBooking) return null;
    const { rows: [row] } = await c.query(
      `insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, session_id, amount_pence, state, mode, cause, idem_key)
       values ('release', $1, $2, $3, $4, $5, $6, 'pending', 'test', $7, $8)
       on conflict (idem_key) where idem_key is not null do nothing returning *`,
      [booking.id, booking.offer_id, booking.host_id, booking.household_id, sessionId, booking.held_pence ?? 0, cause, key],
    );
    return row ?? null;
  }
  if (!['charged', 'partially_refunded'].includes(booking.payment_state)) return null;
  const left = Math.max(0, Number(booking.charged_pence ?? 0) - Number(booking.refunded_pence ?? 0));
  const amount = Math.min(left, Math.max(0, Math.round(amountPence)));
  if (amount <= 0) return null;
  // What of the refund was Epic's fee and what was the host's, in the booking's own proportions, so DAC7 and
  // the streams net it out (Codex, 2 Oct 2026).
  const charged = Number(booking.charged_pence ?? 0) || 1;
  const epicBack = Math.round((amount * Number(booking.fee_pence ?? 0)) / charged);
  const { rows: [row] } = await c.query(
    `insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, session_id, amount_pence, epic_pence, host_pence, state, mode, cause, idem_key)
     values ('refund', $1, $2, $3, $4, $5, $6, $9, $10, 'pending', 'test', $7, $8)
     on conflict (idem_key) where idem_key is not null do nothing returning *`,
    [booking.id, booking.offer_id, booking.host_id, booking.household_id, sessionId, amount, cause, key, epicBack, amount - epicBack],
  );
  if (row) {
    await c.query('update experience_bookings set refunded_pence = refunded_pence + $2 where id = $1', [booking.id, amount]);
    booking.refunded_pence = Number(booking.refunded_pence ?? 0) + amount;
  }
  return row ?? null;
}

/**
 * A booking's money for some of its sessions: an even share of what it paid
 * per session it covers, or everything left when it loses every session it
 * still had.
 */
export function shareOf(booking, losing) {
  const all = booking.all_sessions?.length || 1;
  const left = Math.max(0, Number(booking.charged_pence ?? 0) - Number(booking.refunded_pence ?? 0));
  const stillBooked = (booking.booked_sessions ?? []).filter((id) => !losing.includes(id));
  // Money kept for a session the guest gave up stays kept (Codex, 2 Oct 2026).
  if (!stillBooked.length && !Number(booking.forfeited ?? 0)) return { amount: left, whole: true };
  if (!stillBooked.length) return { amount: Math.min(left, Math.floor((Number(booking.charged_pence ?? 0) * losing.length) / all)), whole: true };
  const n = (booking.booked_sessions ?? []).filter((id) => losing.includes(id)).length;
  return { amount: Math.min(left, Math.floor((Number(booking.charged_pence ?? 0) * n) / all)), whole: false };
}

// A guest's money news opens the booking itself (routes.ts › booking), not the Plans list. A host's opens the
// event's own page (routes.ts › hostEvent) — the lane event page, whose cancel sheet runs the lane refund path —
// never the old per-offer screen, whose "Call it off" is not for a lane event (Hosting v7 handover, 3 Oct 2026).
const guestLink = (bookingId) => `/bookings/${encodeURIComponent(bookingId)}`;
const hostLink = (offerId, { sheet = null } = {}) => `/host/events/${encodeURIComponent(offerId)}${sheet ? `?sheet=${sheet}` : ''}`;

async function tell(list) {
  for (const n of list) await notifications.notify(n).catch((err) => console.error(`epic-api: notification ${n.kind} — ${err.message}`));
}

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

/**
 * The host cancels one or more sessions, or the whole event (`sessionIds`
 * null). Everyone booked on what is cancelled gets a full refund and is told.
 * Returns `{ cancelled, refunds, late }`.
 */
export async function cancelSessions({ offerId, hostId, sessionIds = null, reason, note = null, by = null, now = new Date() }) {
  if (!CANCEL_REASONS.includes(reason)) throw refuse(400, 'reason_required', 'Choose why first.');
  const s = await settings.current();
  const out = await withTransaction(async (c) => {
    const offer = await lockEvent(c, offerId);
    if (!offer || offer.host_id !== hostId) throw refuse(404, 'offer_not_found', 'That is not one of your events.');
    const { rows: all } = await c.query(`select * from offer_sessions where offer_id = $1 and state = 'scheduled' order by on_date, starts_at`, [offerId]);
    const target = sessionIds ? all.filter((x) => sessionIds.includes(x.id)) : all.filter((x) => sessionStart(x, offer) > now);
    if (sessionIds && target.length !== new Set(sessionIds).size) throw refuse(409, 'session_gone', 'One of those sessions has already finished or been cancelled.');
    if (target.some((x) => sessionStart(x, offer) <= now)) throw refuse(409, 'session_started', 'A session that has started can’t be cancelled.');
    if (!target.length) throw refuse(409, 'nothing_to_cancel', 'There is nothing left to cancel.');
    const ids = target.map((x) => x.id);
    const late = target.some((x) => isLate(sessionStart(x, offer), s, now) === true);
    const why = [reason, note].filter(Boolean).join(' · ').slice(0, 500);
    for (const x of target) {
      await c.query(`update offer_sessions set state = 'cancelled', cancel_reason = $2, late = $3 where id = $1`, [x.id, why, isLate(sessionStart(x, offer), s, now) === true]);
    }
    const bookings = await bookingsOn(c, ids);
    const refunds = [];
    const told = [];
    for (const b of bookings) {
      const losing = b.booked_sessions.filter((id) => ids.includes(id));
      const { amount, whole } = shareOf(b, losing);
      const row = await owe(c, b, { amountPence: amount, cause: 'host_cancelled', key: `cancel:${b.id}:${[...losing].sort().join(',')}`, wholeBooking: whole });
      if (row) refunds.push(row);
      await c.query(`update booking_sessions set state = 'cancelled' where booking_id = $1 and session_id = any($2::uuid[])`, [b.id, losing]);
      if (whole) await c.query(`update experience_bookings set state = 'cancelled', cancelled_by = 'host', cancel_cause = 'host_cancelled' where id = $1`, [b.id]);
      told.push({ householdId: b.household_id, kind: 'cancelled', title: `${offer.title ?? 'Your booking'}: cancelled by the host`, body: row ? 'You get a full refund.' : null, link: guestLink(b.id), dedupeKey: `cancelled:${b.id}:${[...losing].sort().join(',')}` });
    }
    // The whole event is over when nothing is left still to come — past rows never kept it live (Codex, 2 Oct 2026).
    const whole = all.filter((x) => !ids.includes(x.id) && sessionStart(x, offer) > now).length === 0;
    if (whole) await c.query(`update host_offers set cancelled_at = now(), cancel_reason = $2, state = 'ended' where id = $1`, [offerId, why]);
    await logChange({ subjectKind: whole ? 'event' : 'session', subjectId: whole ? offerId : ids.join(','), field: 'state', before: { state: 'scheduled' }, after: { state: 'cancelled', late }, why, by, byLabel: 'host' }, c);
    return { cancelled: ids.length, refunds: refunds.length, late, told };
  });
  await tell(out.told);
  return { cancelled: out.cancelled, refunds: out.refunds, late: out.late };
}

// ---------------------------------------------------------------------------
// change date
// ---------------------------------------------------------------------------

const daysBetween = (a, b) => Math.round((Date.parse(`${ymd(b)}T12:00:00Z`) - Date.parse(`${ymd(a)}T12:00:00Z`)) / 86_400_000);
const minutesOf = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const timeOf = (mins) => `${String(Math.floor(((mins % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((mins % 60) + 60) % 60).padStart(2, '0')}`;

/**
 * Move a session — `scope` 'this' moves it alone, 'after' moves it and every
 * scheduled session after it by the same number of days (and to the same new
 * start time, when one is given). Returns what moved, old → new.
 */
export async function changeDate({ offerId, hostId, sessionId, toDate, toTime = null, scope = 'this', by = null, now = new Date(), dryRun = false }) {
  if (!['this', 'after'].includes(scope)) throw refuse(400, 'bad_scope', 'This session only, or this and all after it.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(toDate ?? '')) || Number.isNaN(Date.parse(`${toDate}T12:00:00Z`)) || ymd(new Date(`${toDate}T12:00:00Z`)) !== toDate) throw refuse(400, 'bad_date', 'Pick a date.');
  // A whole HH:MM inside the day, or nothing (Codex, 2 Oct 2026).
  if (toTime != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(toTime))) throw refuse(400, 'bad_time', 'Pick a time.');
  const s = await settings.current();
  const out = await withTransaction(async (c) => {
    const offer = await lockEvent(c, offerId);
    if (!offer || offer.host_id !== hostId) throw refuse(404, 'offer_not_found', 'That is not one of your events.');
    if (offer.lane === 'onrequest') throw refuse(409, 'on_request', 'An On request booking is moved with the guest, not here.');
    const { rows: all } = await c.query(`select * from offer_sessions where offer_id = $1 order by on_date, starts_at nulls first`, [offerId]);
    const from = all.find((x) => x.id === sessionId);
    if (!from || from.state !== 'scheduled') throw refuse(409, 'session_gone', 'That session has finished or been cancelled.');
    if (sessionStart(from, offer) <= now) throw refuse(409, 'session_started', 'A session that has started can’t be moved.');
    const delta = daysBetween(from.on_date, toDate);
    const shiftMin = toTime != null && from.starts_at ? minutesOf(toTime) - minutesOf(from.starts_at) : 0;
    if (!delta && !shiftMin) throw refuse(409, 'same_date', 'That is when it is already.');
    const moving = scope === 'this' ? [from]
      : all.filter((x) => x.state === 'scheduled' && (ymd(x.on_date) > ymd(from.on_date) || (ymd(x.on_date) === ymd(from.on_date) && (x.n ?? 0) >= (from.n ?? 0))));
    const today = localDay(now, tzOf(offer));
    const plan = moving.map((x) => {
      const onDate = plusDays(ymd(x.on_date), delta);
      const startsAt = x.starts_at && shiftMin ? timeOf(minutesOf(x.starts_at) + shiftMin) : hm(x.starts_at);
      // The end keeps the session's own length, so a move across midnight lands its end on the right day (Codex, 2 Oct 2026).
      let endsAt = hm(x.ends_at);
      let endsOn = x.ends_on ? plusDays(ymd(x.ends_on), delta) : null;
      if (x.starts_at && x.ends_at) {
        const len = daysBetween(x.on_date, x.ends_on ?? x.on_date) * 1440 + minutesOf(x.ends_at) - minutesOf(x.starts_at);
        const end = minutesOf(startsAt) + Math.max(0, len);
        endsAt = timeOf(end);
        endsOn = end >= 1440 ? plusDays(onDate, Math.floor(end / 1440)) : null;
      }
      if (onDate < today || localInstant(onDate, startsAt ?? '00:00', tzOf(offer)) <= now) throw refuse(400, 'in_the_past', 'The new date has to be in the future.');
      return { x, onDate, startsAt, endsAt, endsOn, late: isLate(sessionStart(x, offer), s, now) === true };
    });
    const moved = plan.map(({ x, onDate, startsAt, late }) => ({ id: x.id, from: { date: ymd(x.on_date), time: hm(x.starts_at) }, to: { date: onDate, time: startsAt }, late }));
    if (dryRun) {
      const guests = (await bookingsOn(c, moving.map((x) => x.id))).length;
      return { moved, late: moved.some((m) => m.late), guests, told: [] };
    }
    for (const { x, onDate, startsAt, endsAt, endsOn, late } of plan) {
      // Worked out again in local time, so a daylight-saving change can't move it an hour (Codex, 2 Oct 2026): a weekly
      // session decides a set number of hours before its new start; an event decides at the same local time, days on.
      const tz = tzOf(offer);
      const decidesAt = !x.decides_at ? null
        : offer.lane === 'weekly'
          ? new Date(localInstant(onDate, startsAt ?? '00:00', tz).getTime() - (localInstant(ymd(x.on_date), hm(x.starts_at) ?? '00:00', tz).getTime() - new Date(x.decides_at).getTime()))
          : (() => { const d = new Date(x.decides_at); const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); return localInstant(plusDays(localDay(d, tz), delta), t, tz); })();
      await c.query(
        `update offer_sessions
            set on_date = $2, starts_at = $3, ends_at = $4, ends_on = $5::date,
                decides_at = $6, changed_from = $7::jsonb, late = late or $8
          where id = $1`,
        [x.id, onDate, startsAt, endsAt, endsOn, decidesAt, JSON.stringify({ onDate: ymd(x.on_date), startsAt: hm(x.starts_at), at: now.toISOString() }), late],
      );
    }
    // The event's own dates follow its sessions; decides-by follows the first one.
    const { rows: [span] } = await c.query(`select min(on_date) as first, max(coalesce(ends_on, on_date)) as last from offer_sessions where offer_id = $1 and state = 'scheduled'`, [offerId]);
    const firstMoved = moving.some((x) => x.id === all.find((y) => y.state === 'scheduled')?.id);
    await c.query(
      `update host_offers
          set starts_on = coalesce($2, starts_on),
              ends_on = case when lane = 'oneoff' and multi_day then $3 else ends_on end,
              decides_on = case when $4 and decides_on is not null then decides_on + $5::int else decides_on end,
              starts_at = case when lane in ('oneoff', 'course') and $4 and $6::time is not null then $6::time else starts_at end
        where id = $1`,
      [offerId, ymd(span.first), ymd(span.last), firstMoved, delta, toTime],
    );
    const bookings = await bookingsOn(c, moving.map((x) => x.id));
    const ownMoved = await notifications.hostWords(offer.host_id, 'date_changed');
    const told = bookings.map((b) => {
      // The guest's own session that moved, not the first one in the run (Codex, 2 Oct 2026).
      const mine = moved.find((m) => (b.booked_sessions ?? []).includes(String(m.id))) ?? moved[0];
      return {
      householdId: b.household_id, kind: 'date_changed', title: `${offer.title ?? 'Your booking'} has moved`,
      body: [`New date: ${mine.to.date}${mine.to.time ? ` at ${mine.to.time}` : ''}. If it no longer works, cancel for a full refund.`, ownMoved].filter(Boolean).join('\n\n'),
      link: guestLink(b.id), dedupeKey: `date_changed:${b.id}:${moved.map((m) => `${m.id}@${m.to.date}T${m.to.time ?? ''}`).join(',')}`,
      };
    });
    await logChange({ subjectKind: 'session', subjectId: moved.map((m) => m.id).join(','), field: 'date', before: moved.map((m) => m.from), after: moved.map((m) => m.to), why: scope === 'this' ? 'This session only' : 'This and all after it', by, byLabel: 'host' }, c);
    return { moved, late: moved.some((m) => m.late), guests: bookings.length, told };
  });
  await tell(out.told);
  return { moved: out.moved, late: out.late, guests: out.guests };
}

/**
 * Whether a guest leaving now is owed everything because the host moved a
 * session they hold after they booked (handover §5: "may cancel for a full
 * refund").
 */
export function movedSinceBooking(booking, sessions) {
  // Since they booked — or since they last said Keep my place, which accepts the move (Codex, 2 Oct 2026).
  const at = Math.max(new Date(booking.created_at).getTime(), booking.change_seen_at ? new Date(booking.change_seen_at).getTime() : 0);
  return sessions.some((x) => x.changed_from?.at && new Date(x.changed_from.at).getTime() > at);
}

// ---------------------------------------------------------------------------
// decides-by
// ---------------------------------------------------------------------------

/**
 * Count the numbers for every session whose decides-by has come. One-off and
 * Course decide as one event (every session shares the day); Weekly decides
 * each session on its own. Returns what was decided.
 */
export async function decideDue({ now = new Date() } = {}) {
  const { rows: due } = await query(
    `select s.id, s.offer_id from offer_sessions s join host_offers o on o.id = s.offer_id
      where s.state = 'scheduled' and s.decided_outcome is null and s.decides_at is not null and s.decides_at <= $1
      order by s.decides_at limit 200`,
    [now],
  );
  const seen = new Set();
  const results = [];
  for (const d of due) {
    if (seen.has(d.id)) continue;
    const r = await decideOne(d.offer_id, d.id, now);
    for (const id of r.sessionIds) seen.add(id);
    results.push(r);
  }
  return results;
}

async function decideOne(offerId, sessionId, now) {
  const out = await withTransaction(async (c) => {
    const offer = await lockEvent(c, offerId);
    const { rows: [first] } = await c.query('select * from offer_sessions where id = $1', [sessionId]);
    if (!offer || !first || first.state !== 'scheduled' || first.decided_outcome) return { sessionIds: [sessionId], outcome: 'skipped', told: [] };
    const group = offer.lane === 'weekly'
      ? [first]
      : (await c.query(`select * from offer_sessions where offer_id = $1 and state = 'scheduled' and decided_outcome is null`, [offerId])).rows;
    const ids = group.map((x) => x.id);
    const min = Number(first.min_count ?? offer.min_count ?? 0);
    // Only places that are really held count toward the minimum: paid, card held, or a free booking confirmed — never a
    // checkout still open, which may never pay (Codex, 2 Oct 2026).
    const bookings = (await bookingsOn(c, [first.id])).filter((b) => ['confirmed', 'attended'].includes(b.state) || ['charged', 'held', 'partially_refunded'].includes(b.payment_state));
    const heads = bookings.reduce((n, b) => n + Number(b.heads ?? 1), 0);
    const told = [];
    const ownOff = min && heads < min ? await notifications.hostWords(offer.host_id, 'called_off') : null;
    if (min && heads < min) {
      for (const x of group) await c.query(`update offer_sessions set state = 'called_off', called_off_at = now(), decided_outcome = 'called_off', decided_at = now() where id = $1`, [x.id]);
      for (const b of await bookingsOn(c, ids)) {
        const losing = b.booked_sessions.filter((id) => ids.includes(id));
        const { amount, whole } = shareOf(b, losing);
        const row = await owe(c, b, { amountPence: amount, cause: 'called_off', key: `called_off:${b.id}:${[...losing].sort().join(',')}`, wholeBooking: whole });
        await c.query(`update booking_sessions set state = 'cancelled' where booking_id = $1 and session_id = any($2::uuid[])`, [b.id, losing]);
        if (whole) await c.query(`update experience_bookings set state = 'cancelled', cancelled_by = 'epic', cancel_cause = 'called_off' where id = $1`, [b.id]);
        told.push({ householdId: b.household_id, kind: 'called_off', title: `${offer.title ?? 'Your booking'} isn’t going ahead`, body: [`It needed ${min} and had ${heads}.${row ? ' You get a full refund.' : ''}`, ownOff].filter(Boolean).join('\n\n'), link: guestLink(b.id), dedupeKey: `called_off:${b.id}:${ids.join(',')}` });
      }
      // Off the catalogue too: a called-off One-off or Course ends, and keeps saying why (Codex, 2 Oct 2026).
      if (offer.lane !== 'weekly') await c.query(`update host_offers set called_off_at = now(), state = 'ended' where id = $1`, [offerId]);
      const { rows: [h] } = await c.query('select household_id from hosts where id = $1', [offer.host_id]);
      if (h) told.push({ householdId: h.household_id, kind: 'event_called_off', title: `${offer.title ?? 'Your event'} was called off`, body: `${heads} of ${min} booked by the decides-by day. Everyone booked gets a full refund.`, link: hostLink(offerId), dedupeKey: `event_called_off:${ids.join(',')}` });
      await logChange({ subjectKind: offer.lane === 'weekly' ? 'session' : 'event', subjectId: offer.lane === 'weekly' ? first.id : offerId, field: 'decided', after: { outcome: 'called_off', heads, min }, why: 'Under the minimum at decides-by', byLabel: 'epic' }, c);
      return { sessionIds: ids, outcome: 'called_off', heads, min, told };
    }
    for (const x of group) await c.query(`update offer_sessions set decided_outcome = 'on', decided_at = now() where id = $1`, [x.id]);
    // Depends on numbers: everyone paid the minimum-numbers price; give back the difference.
    if (offer.price_mode === 'by_numbers' && offer.total_pence && min) {
      const paidEach = perPersonAt(offer.total_pence, min);
      const finalEach = perPersonAt(offer.total_pence, Math.max(heads, min));
      for (const b of bookings) {
        const back = Math.max(0, (paidEach - finalEach) * Number(b.heads ?? 1));
        if (back > 0) await owe(c, b, { amountPence: back, cause: 'numbers_settled', key: `numbers:${b.id}` });
        await c.query('update experience_bookings set final_price_pence = $2, settled_at = now() where id = $1', [b.id, finalEach * Number(b.heads ?? 1)]);
      }
    }
    for (const b of bookings) told.push({ householdId: b.household_id, kind: 'decides_by_result', title: `${offer.title ?? 'Your booking'} is going ahead`, link: guestLink(b.id), dedupeKey: `going_ahead:${b.id}:${first.id}` });
    return { sessionIds: ids, outcome: 'on', heads, min, told };
  });
  await tell(out.told);
  return { sessionIds: out.sessionIds, outcome: out.outcome, heads: out.heads, min: out.min };
}

/**
 * A day or two before decides-by, tell the host an event is still under its
 * minimum — once per session.
 */
export async function warnUnderMinimum({ now = new Date(), withinHours = 48 } = {}) {
  const { rows } = await query(
    `select s.id, s.offer_id, s.decides_at, coalesce(s.min_count, o.min_count) as min, o.title, h.household_id,
            coalesce((select sum(b.heads) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                       where bs.session_id = s.id and bs.state = 'booked' and (b.state in ('confirmed', 'attended') or b.payment_state in ('charged', 'held', 'partially_refunded'))), 0)::int as heads
       from offer_sessions s join host_offers o on o.id = s.offer_id join hosts h on h.id = o.host_id
      where s.state = 'scheduled' and s.decided_outcome is null and s.decides_at > $1 and s.decides_at <= $1 + make_interval(hours => $2)
        and coalesce(s.min_count, o.min_count) is not null`,
    [now, withinHours],
  );
  let told = 0;
  for (const r of rows) {
    if (r.heads >= r.min) continue;
    const n = await notifications.notify({ householdId: r.household_id, kind: 'under_minimum', title: `${r.title ?? 'An event'} is under its minimum`, body: `${r.heads} of ${r.min} booked. It decides on ${ymd(r.decides_at)}.`, link: hostLink(r.offer_id, { sheet: 'cancel' }), dedupeKey: `under_min:${r.id}` }).catch(() => null);
    if (n) told += 1;
  }
  return told;
}

// ---------------------------------------------------------------------------
// refunds: the queue
// ---------------------------------------------------------------------------

/**
 * Send what is owed to Stripe, oldest first. Each row carries its own
 * idempotency key. Stripe refusing it (a 4xx) marks it failed for a person to
 * look at; Stripe unreachable leaves it pending for the next run; Stripe not
 * ready (no key, or a live one) sends nothing.
 */
export async function processRefunds({ status = stripe.stripeStatus, refund = stripe.refund, release = stripe.cancelPayment, limit = 50 } = {}) {
  const out = { sent: 0, failed: 0, waiting: 0 };
  if (!status().ready) return { ...out, skipped: 'stripe_not_ready' };
  const { rows } = await query(
    // A refund names its own PaymentIntent when it is not the booking's (a tip charged twice); otherwise the booking's.
    `select p.*, coalesce(p.refund_of, b.stripe_payment_intent) as stripe_payment_intent, b.charged_pence, b.refunded_pence,
            case when p.tip_id is not null then t.charge_model else b.charge_model end as charge_model, o.title
       from hosting_payments p join experience_bookings b on b.id = p.booking_id left join host_offers o on o.id = p.offer_id
       left join booking_tips t on t.id = p.tip_id
      where p.state = 'pending' and p.kind in ('refund', 'release', 'tip_refund') and p.idem_key is not null and p.voided_at is null
      order by p.created_at limit $1`,
    [limit],
  );
  for (const p of rows) {
    if (!p.stripe_payment_intent) {
      await query(`update hosting_payments set state = 'failed', reason = 'no payment to refund', updated_at = now() where id = $1 and state = 'pending'`, [p.id]);
      out.failed += 1;
      continue;
    }
    try {
      const r = p.kind === 'release'
        ? await release(p.stripe_payment_intent, { householdId: p.household_id, idempotencyKey: p.idem_key })
        : await refund({ paymentIntentId: p.stripe_payment_intent, amountPence: p.amount_pence, cause: p.cause, bookingId: p.booking_id, householdId: p.household_id, idempotencyKey: p.idem_key, destination: p.charge_model === 'destination' });
      await withTransaction(async (c) => {
        const { rowCount } = await c.query(`update hosting_payments set state = 'succeeded', stripe_ref = $2, updated_at = now() where id = $1 and state = 'pending'`, [p.id, r?.id ?? null]);
        if (!rowCount) return;
        if (p.kind === 'release') await c.query(`update experience_bookings set payment_state = 'released' where id = $1`, [p.booking_id]);
        // A tip given back is the tip's own business: the booking's money is untouched.
        else if (p.tip_id) await c.query(`update booking_tips set state = 'refunded' where id = $1`, [p.tip_id]);
        else {
          await c.query(
            `update experience_bookings set payment_state = case when refunded_pence >= charged_pence then 'refunded' else 'partially_refunded' end
              where id = $1 and payment_state in ('charged', 'partially_refunded')`,
            [p.booking_id],
          );
        }
      });
      if (p.kind === 'refund' || p.kind === 'tip_refund') {
        await tell([{ householdId: p.household_id, kind: 'refund_issued', title: `£${(p.amount_pence / 100).toFixed(2)} is on its way back to you`, body: p.title ?? null, link: guestLink(p.booking_id), dedupeKey: `refund:${p.id}` }]);
      }
      out.sent += 1;
    } catch (err) {
      if (err.code === 'stripe_unreachable') { out.waiting += 1; continue; }
      // Stripe refused it outright: still owed, so the amount stays reserved against the booking and the row waits in the
      // back office (Money › Payouts, refunds) for a person to retry or settle it — never quietly given back to the host (Codex, 2 Oct 2026).
      await query(`update hosting_payments set state = 'failed', reason = $2, updated_at = now() where id = $1 and state = 'pending'`, [p.id, String(err.detail ?? err.code ?? 'failed').slice(0, 80)]);
      console.error(`epic-api: refund ${p.id} failed — ${err.detail ?? err.code ?? err.message}`);
      out.failed += 1;
    }
  }
  return out;
}

export { ledger };
