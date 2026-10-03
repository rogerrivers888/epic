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
import * as problems from '../repositories/paymentProblems.js';
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
  return rows.map(chargeBasis);
}

/**
 * A booking far ahead whose card is saved but not yet charged (L4) is worked out on what WILL be charged — its value
 * less any part already cancelled — so a part cancelled before the charge comes off it in the same shares a refund
 * would. Every other booking is returned as it is.
 */
export function chargeBasis(b) {
  if (!b || !['card_saved', 'charge_failed'].includes(b.payment_state)) return b;
  // The whole value stays the basis and what is already taken off counts as given back, so a second part cancelled
  // is shared out of the same whole as the first (Codex, 3 Oct 2026: two of three sessions are two thirds, not 1/3 + 2/9).
  return { ...b, charged_pence: Number(b.value_pence ?? 0), refunded_pence: Math.min(Number(b.value_pence ?? 0), Number(b.later_off_pence ?? 0)), cancellation_fee_pence: 0 };
}

/**
 * Write what a booking is owed back, pending, and count it against the booking
 * at once so a payout made before Stripe answers never pays the host for it.
 * A held card that loses all its sessions is released rather than refunded.
 * Returns the ledger row, or null when nothing is owed.
 */
export async function owe(c, booking, { amountPence, cause, key, sessionId = null, wholeBooking = false, feeKeptPence = 0, triggeredBy = null }) {
  // A booking far ahead whose card is saved and not yet charged (L4): nothing to refund. Part of it cancelled comes
  // off what will be charged; all of it, and the booking is never charged (the later charge skips a cancelled one).
  // No cancellation fee on money never taken.
  if (booking.payment_state === 'card_saved' || booking.payment_state === 'charge_failed') {
    if (!wholeBooking && amountPence > 0) {
      await c.query('update experience_bookings set later_off_pence = least(value_pence, later_off_pence + $2) where id = $1', [booking.id, Math.round(amountPence + (Number(feeKeptPence) || 0))]);
    }
    return null;
  }
  if (booking.payment_state === 'held') {
    if (!wholeBooking) return null;
    const { rows: [row] } = await c.query(
      `insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, session_id, amount_pence, state, mode, cause, idem_key, triggered_by)
       values ('release', $1, $2, $3, $4, $5, $6, 'pending', 'test', $7, $8, $9)
       on conflict (idem_key) where idem_key is not null do nothing returning *`,
      [booking.id, booking.offer_id, booking.host_id, booking.household_id, sessionId, booking.held_pence ?? 0, cause, key, triggeredBy],
    );
    return row ?? null;
  }
  if (!['charged', 'partially_refunded'].includes(booking.payment_state)) return null;
  // What is left: neither refunded nor kept as a cancellation fee (L5).
  const left = Math.max(0, Number(booking.charged_pence ?? 0) - Number(booking.refunded_pence ?? 0) - Number(booking.cancellation_fee_pence ?? 0));
  // The cancellation fee (L5) comes out of the cancelled amount; the guest gets the rest.
  const kept = Math.max(0, Math.min(left, Math.round(Number(feeKeptPence) || 0)));
  const amount = Math.min(left - kept, Math.max(0, Math.round(amountPence)));
  if (amount <= 0 && kept <= 0) return null;
  const charged = Number(booking.charged_pence ?? 0) || 1;
  let epicBack; let hostBack; let mode;
  if (kept > 0) {
    // Keep the fee: the host's whole share of the cancelled amount comes back to Epic and the guest gets the cancelled
    // amount less the fee, so Epic is left holding exactly the fee and the host nothing of it (sandbox, 3 Oct 2026).
    const cancelled = amount + kept;
    const feeOnIt = Math.round((cancelled * Number(booking.fee_pence ?? 0)) / charged);
    hostBack = cancelled - feeOnIt;
    epicBack = amount - hostBack; // Epic's fee on it, less what it keeps — negative when the fee kept is more than Epic's fee was
    mode = 'keep_fee';
  } else {
    // What of the refund was Epic's fee and what was the host's, in the booking's own proportions, so DAC7 and
    // the streams net it out (Codex, 2 Oct 2026).
    epicBack = Math.round((amount * Number(booking.fee_pence ?? 0)) / charged);
    hostBack = amount - epicBack;
    mode = 'proportional';
  }
  const { rows: [row] } = await c.query(
    `insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, session_id, amount_pence, epic_pence, host_pence, state, mode, cause, idem_key,
                                   fee_kept_pence, triggered_by, refund_mode)
     values ('refund', $1, $2, $3, $4, $5, $6, $9, $10, 'pending', 'test', $7, $8, $11, $12, $13)
     on conflict (idem_key) where idem_key is not null do nothing returning *`,
    [booking.id, booking.offer_id, booking.host_id, booking.household_id, sessionId, amount, cause, key, epicBack, hostBack, kept, triggeredBy, mode],
  );
  if (row) {
    await c.query('update experience_bookings set refunded_pence = refunded_pence + $2, cancellation_fee_pence = cancellation_fee_pence + $3 where id = $1', [booking.id, amount, kept]);
    booking.refunded_pence = Number(booking.refunded_pence ?? 0) + amount;
    booking.cancellation_fee_pence = Number(booking.cancellation_fee_pence ?? 0) + kept;
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
  const left = Math.max(0, Number(booking.charged_pence ?? 0) - Number(booking.refunded_pence ?? 0) - Number(booking.cancellation_fee_pence ?? 0));
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
      const row = await owe(c, b, { amountPence: amount, cause: 'host_cancelled', key: `cancel:${b.id}:${[...losing].sort().join(',')}`, wholeBooking: whole, triggeredBy: 'host' });
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
  await refreshChargeDue({ offerId }).catch(() => null);
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
  await refreshChargeDue({ offerId }).catch(() => null);
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
        const row = await owe(c, b, { amountPence: amount, cause: 'called_off', key: `called_off:${b.id}:${[...losing].sort().join(',')}`, wholeBooking: whole, triggeredBy: 'epic' });
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
        if (back > 0) await owe(c, b, { amountPence: back, cause: 'numbers_settled', key: `numbers:${b.id}`, triggeredBy: 'epic' });
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
export async function processRefunds({ status = stripe.stripeStatus, refund = stripe.refund, release = stripe.cancelPayment, reverseHostShare = stripe.reverseHostShare, limit = 50 } = {}) {
  const out = { sent: 0, failed: 0, waiting: 0 };
  if (!status().ready) return { ...out, skipped: 'stripe_not_ready' };
  const s = await settings.current();
  const { rows } = await query(
    // A refund names its own PaymentIntent when it is not the booking's (a tip charged twice); otherwise the booking's.
    `select p.*, coalesce(p.refund_of, b.stripe_payment_intent) as stripe_payment_intent, b.charged_pence, b.refunded_pence, b.cancellation_fee_pct,
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
      await problems.record({ kind: 'refund_failed', dedupeKey: `refund_failed:${p.id}`, amountPence: p.amount_pence, bookingId: p.booking_id, householdId: p.household_id, hostId: p.host_id, offerId: p.offer_id, detail: { line: p.id, cause: p.cause, why: 'no payment to refund' } });
      out.failed += 1;
      continue;
    }
    try {
      const keepFee = p.refund_mode === 'keep_fee' && p.charge_model === 'destination';
      let r = null;
      if (p.kind === 'release') r = await release(p.stripe_payment_intent, { householdId: p.household_id, idempotencyKey: p.idem_key });
      else if (p.amount_pence > 0) r = await refund({ paymentIntentId: p.stripe_payment_intent, amountPence: p.amount_pence, cause: p.cause, bookingId: p.booking_id, householdId: p.household_id, idempotencyKey: p.idem_key, destination: p.charge_model === 'destination', keepFee });
      // Keeping the cancellation fee: the host's whole share of the cancelled amount comes back as well (L5). Its own
      // key, so a retry after a crash between the two is the same reversal, never a second.
      if (keepFee && Number(p.host_pence) > 0) {
        await reverseHostShare({ paymentIntentId: p.stripe_payment_intent, amountPence: Number(p.host_pence), householdId: p.household_id, idempotencyKey: `${p.idem_key}:host_share`, refundId: r?.id ?? null });
      }
      await withTransaction(async (c) => {
        const { rowCount } = await c.query(`update hosting_payments set state = 'succeeded', stripe_ref = $2, updated_at = now() where id = $1 and state = 'pending'`, [p.id, r?.id ?? null]);
        if (!rowCount) return;
        if (p.kind === 'release') await c.query(`update experience_bookings set payment_state = 'released' where id = $1`, [p.booking_id]);
        // A tip given back is the tip's own business: the booking's money is untouched.
        else if (p.tip_id) await c.query(`update booking_tips set state = 'refunded' where id = $1`, [p.tip_id]);
        else {
          await c.query(
            // Refunded only once nothing else owed on it is still waiting or failed: a cancellation split into two lines
            // (a moved session and the guest's own) isn't done until both are (Codex, 3 Oct 2026).
            `update experience_bookings set payment_state = case
                 when refunded_pence + cancellation_fee_pence >= charged_pence
                  and not exists (select 1 from hosting_payments o where o.booking_id = $1 and o.id <> $2 and o.kind = 'refund' and o.state in ('pending', 'failed') and o.voided_at is null)
                 then 'refunded' else 'partially_refunded' end
              where id = $1 and payment_state in ('charged', 'partially_refunded')`,
            [p.booking_id, p.id],
          );
          // The host caused it — cancelled, or moved a date the guest then left (owner, 3 Oct 2026) — so Epic recovers
          // the cancellation fee from the host's own balance. Not for a missed minimum unless the owner switches it on.
          const recover = p.kind === 'refund' && p.charge_model === 'destination' && (['host_cancelled', 'date_changed'].includes(p.cause) || (p.cause === 'called_off' && s.recovery_on_minimum === true));
          // The rate the booking agreed to; none for a booking made before the fee.
          const pct = p.cancellation_fee_pct == null ? 0 : Number(p.cancellation_fee_pct);
          const owed = recover ? Math.round((Number(p.amount_pence) * pct) / 100) : 0;
          if (owed > 0) {
            await c.query(
              `insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, amount_pence, epic_pence, host_pence, state, mode, cause, idem_key, recovers, triggered_by)
               values ('host_recovery', $1, $2, $3, (select household_id from hosts where id = $3), $4, $4, $5, 'pending', 'test', $6, $7, $8, $9)
               on conflict (recovers) where recovers is not null do nothing`,
              [p.booking_id, p.offer_id, p.host_id, owed, -owed, p.cause, `recovery:${p.id}`, p.id, p.cause === 'called_off' ? 'epic' : 'host'],
            );
          }
        }
      });
      // Tried again after failing (a person's Retry): the problem it was is put right.
      await problems.resolve({ dedupeKey: `refund_failed:${p.id}`, resolution: 'Sent on a later try', by: 'epic' });
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
      await problems.record({ kind: 'refund_failed', dedupeKey: `refund_failed:${p.id}`, amountPence: p.amount_pence, bookingId: p.booking_id, householdId: p.household_id, hostId: p.host_id, offerId: p.offer_id, stripeRef: p.stripe_payment_intent, detail: { line: p.id, kind: p.kind, cause: p.cause, code: err.detail ?? err.code ?? null }, reopen: true });
      out.failed += 1;
    }
  }
  return out;
}

/**
 * When a booking far ahead is charged follows its sessions (Codex, 3 Oct 2026): 80 days before the earliest one still
 * booked and to come, or its decides-by if earlier — recomputed whenever sessions are cancelled or moved, and before
 * each run of the later charges, so a session cancelled never charges too early and one moved earlier never leaves the
 * booking uncharged until after the event. Due already: due now.
 */
export async function refreshChargeDue({ offerId = null, bookingId = null } = {}) {
  const { rows } = await query(
    `select b.id, o.time_zone, s.on_date, s.starts_at, s.decides_at
       from experience_bookings b join host_offers o on o.id = b.offer_id
       join booking_sessions bs on bs.booking_id = b.id and bs.state = 'booked'
       join offer_sessions s on s.id = bs.session_id and s.state = 'scheduled'
      where b.payment_state = 'card_saved' and b.state <> 'cancelled'
        and ($1::uuid is null or b.offer_id = $1) and ($2::uuid is null or b.id = $2)`, [offerId, bookingId]);
  const by = new Map();
  for (const r of rows) {
    const start = sessionStart(r, { time_zone: r.time_zone });
    if (start <= new Date()) continue;
    const eighty = new Date(start.getTime() - 80 * 86_400_000);
    const due = r.decides_at && new Date(r.decides_at) < eighty ? new Date(r.decides_at) : eighty;
    const was = by.get(r.id);
    if (!was || due < was) by.set(r.id, due);
  }
  for (const [id, due] of by) await query('update experience_bookings set charge_due_at = $2 where id = $1 and payment_state = $3 and charge_due_at is distinct from $2', [id, due, 'card_saved']);
  return by.size;
}

/**
 * The later charges (register L4): every booking far ahead whose day has come is charged, off-session, on the card
 * saved for it — the same destination charge as any other (L1, L2), keyed on the booking so a retry after a crash is
 * the same PaymentIntent. Claimed first, so two runs never ask twice at once.
 *
 * The card refusing (declined, or the bank wanting the guest there) is not a cancellation (L4 is open: "notify Roger
 * and the guest, do not cancel automatically, until Roger decides"): the booking keeps its place, the guest is asked
 * to pay (POST /booked/:id/pay-now), and the payment problems log holds it open for a person.
 */
export async function chargeLaterDue({ now = new Date(), status = stripe.stripeStatus, charge = stripe.laterCharge, limit = 25 } = {}) {
  const out = { charged: 0, failed: 0, waiting: 0 };
  if (!status().ready) return { ...out, skipped: 'stripe_not_ready' };
  await refreshChargeDue();
  const { rows } = await query(
    `update experience_bookings b set later_charge_claimed_at = now()
      where b.id in (select id from experience_bookings
                      where payment_state = 'card_saved' and state in ('confirmed', 'pending') and coalesce(request_state, 'accepted') = 'accepted'
                        and charge_due_at <= $1 and (later_charge_claimed_at is null or later_charge_claimed_at < now() - interval '10 minutes')
                      order by charge_due_at limit $2 for update skip locked)
      returning b.*`,
    [now, limit],
  );
  for (const b of rows) {
    const { rows: [h] } = await query('select * from hosts where id = $1', [b.host_id]);
    const { rows: [hh] } = await query('select stripe_customer_id from households where id = $1', [b.household_id]);
    // From the booking's own fee, never one already prorated: a retry works it out the same way (Codex, 3 Oct 2026).
    const value = Number(b.value_pence ?? 0);
    const amountPence = Math.max(0, value - Number(b.later_off_pence ?? 0));
    const feePence = value > 0 ? Math.round((Number(b.fee_pence ?? 0) * amountPence) / value) : 0;
    if (amountPence <= 0) { await query(`update experience_bookings set payment_state = 'released' where id = $1 and payment_state = 'card_saved'`, [b.id]); continue; }
    let pi;
    try {
      pi = await charge({ amountPence, destination: h?.stripe_account_id, applicationFeePence: feePence, hostName: h?.name, bookingId: b.id, offerId: b.offer_id, householdId: b.household_id,
        customerId: hh?.stripe_customer_id, paymentMethod: b.saved_payment_method });
    } catch (err) {
      if (err.code === 'stripe_unreachable') { await query('update experience_bookings set later_charge_claimed_at = null where id = $1', [b.id]); out.waiting += 1; continue; }
      await laterChargeRefused(b, { amountPence, code: err.detail ?? err.code ?? null });
      out.failed += 1;
      continue;
    }
    await query('update experience_bookings set stripe_payment_intent = $2 where id = $1', [b.id, pi.id]);
    await ledger.record({ kind: 'charge', bookingId: b.id, offerId: b.offer_id, hostId: b.host_id, householdId: b.household_id, amountPence, epicPence: feePence, hostPence: amountPence - feePence, bookingValuePence: b.value_pence, ratePct: b.fee_rate_pct, state: 'pending', stripeRef: pi.id, mode: 'test', reason: b.fee_reason });
    if (pi.status === 'succeeded') {
      const { applyPaymentIntent } = await import('../routes/guestBookings.js');
      await applyPaymentIntent(pi);
      out.charged += 1;
    } else if (pi.status === 'processing') {
      out.waiting += 1;
    } else {
      // Stripe made it but it needs the guest (their bank's own check): the same as a refusal — they pay in the browser,
      // on this same PaymentIntent (pay-now hands its secret back). Its ledger row says it did not go through.
      await query(`update hosting_payments set state = 'failed', updated_at = now() where stripe_ref = $1 and state = 'pending'`, [pi.id]);
      await laterChargeRefused(b, { amountPence, code: pi.last_payment_error?.code ?? pi.status });
      out.failed += 1;
    }
  }
  return out;
}

/** The later charge refused: the place kept, the guest asked to pay, the problem open for a person. */
async function laterChargeRefused(b, { amountPence, code }) {
  const { rowCount } = await query(
    `update experience_bookings set payment_state = 'charge_failed', later_charge_failed_at = now(), later_charge_claimed_at = null where id = $1 and payment_state = 'card_saved'`, [b.id]);
  if (!rowCount) return;
  await problems.record({ kind: 'later_charge_failed', dedupeKey: `later_charge_failed:${b.id}`, amountPence, bookingId: b.id, householdId: b.household_id, hostId: b.host_id, offerId: b.offer_id, detail: { code, dueAt: b.charge_due_at } });
  await logChange({ subjectKind: 'booking', subjectId: b.id, field: 'later_charge', after: { failed: true, code }, byLabel: 'stripe' });
  const { rows: [o] } = await query('select title from host_offers where id = $1', [b.offer_id]);
  await tell([{ householdId: b.household_id, kind: 'payment_needed', title: `Your card was declined for ${o?.title ?? 'your booking'}`, body: `£${(amountPence / 100).toFixed(2)} is due now. Your place is kept — pay from the booking to keep it.`, link: guestLink(b.id), dedupeKey: `payment_needed:${b.id}` }]);
}

// ---------------------------------------------------------------------------
// Complaints that end in money (back-office hooks, 3 Oct 2026)
// ---------------------------------------------------------------------------

/** The auto-refund limit: the claim_auto_pay_limit setting, or £50 until it is set (owner, 3 Oct 2026). */
export const DEFAULT_AUTO_REFUND_PENCE = 5000;
export const HOST_ANSWER_HOURS = 48;

/** What a complaint stands for: its session's even share of what is left on the booking, or all of it. */
async function complaintShare(c, k) {
  const { rows: [b] } = await c.query('select * from experience_bookings where id = $1 for update', [k.booking_id]);
  if (!b) return { b: null, pence: 0 };
  const left = Math.max(0, Number(b.charged_pence ?? 0) - Number(b.refunded_pence ?? 0) - Number(b.cancellation_fee_pence ?? 0));
  if (!k.session_id) return { b, pence: left };
  // An even share of what is still left across the sessions still held — never of the original charge, which an
  // earlier refund has already been taken from (Codex, 3 Oct 2026).
  const { rows: [{ n }] } = await c.query(`select count(*)::int as n from booking_sessions where booking_id = $1 and state <> 'cancelled'`, [b.id]);
  return { b, pence: Math.min(left, Math.floor(left / Math.max(1, n))) };
}

/**
 * Refund a complaint (the hook the back office and the host's answer call): `amountPence` (capped at what is left on
 * the booking) or, given none, the complaint's session's share. Through the refund queue like any refund (cause
 * 'complaint'), the complaint marked paid with the amount, which lifts its hold on the payout.
 *   refundComplaint({ complaintId, amountPence?, by: 'host' | 'staff' | 'epic', why? })
 * Answers { complaintId, refundPence } — or null when there is nothing to refund (an unpaid booking, already paid).
 */
export async function refundComplaint({ complaintId, amountPence = null, by = 'staff', why = null }) {
  return withTransaction(async (c) => {
    const { rows: [k] } = await c.query('select * from hosting_complaints where id = $1 for update', [complaintId]);
    if (!k) throw refuse(404, 'not_found', 'No such complaint.');
    if (k.state !== 'open') throw refuse(409, 'not_open', 'That complaint is settled already.');
    if (!k.booking_id) throw refuse(409, 'no_booking', 'That complaint has no booking to refund.');
    const { b, pence: share } = await complaintShare(c, k);
    if (!b) throw refuse(409, 'no_booking', 'That complaint has no booking to refund.');
    const want = amountPence == null ? share : Math.max(0, Math.round(Number(amountPence)));
    const line = await owe(c, b, { amountPence: want, cause: 'complaint', key: `complaint:${k.id}`, sessionId: k.session_id, wholeBooking: false, triggeredBy: by === 'host' ? 'host' : by === 'epic' ? 'epic' : 'staff' });
    const refunded = line ? Number(line.amount_pence) : 0;
    await c.query(`update hosting_complaints set state = 'paid', amount_pence = $2, refund_line = $3, refunded_by = $4, resolved_at = now() where id = $1`, [k.id, refunded, line?.id ?? null, by]);
    await logChange({ subjectKind: 'complaint', subjectId: k.id, field: 'state', after: { state: 'paid', refundPence: refunded }, why, byLabel: by === 'epic' ? 'epic' : by }, c);
    return { complaintId: k.id, refundPence: refunded };
  });
}

/**
 * The host's answer to a complaint, within 48 hours: a refund offered is paid at once and closes it; disputed, it
 * waits for a person. `hostAnswerComplaint({ complaintId, hostId, offerPence? , dispute? })`.
 */
export async function hostAnswerComplaint({ complaintId, hostId, offerPence = null, dispute = false }) {
  const { rows: [k] } = await query(`update hosting_complaints set host_replied_at = now(), host_offer_pence = $3, host_disputes = $4
    where id = $1 and host_id = $2 and state = 'open' returning *`, [complaintId, hostId, offerPence, Boolean(dispute)]);
  if (!k) throw refuse(404, 'not_found', 'That complaint isn’t open.');
  if (!dispute && offerPence != null && Number(offerPence) > 0) return refundComplaint({ complaintId, amountPence: Number(offerPence), by: 'host', why: 'The host offered a refund' });
  return { complaintId: k.id, refundPence: 0 };
}

/**
 * The job: complaints the host has not answered in 48 hours, worth no more than the auto-refund limit, are refunded
 * automatically (design handover §6). Above the limit, or disputed, they wait for a person (Actions).
 */
export async function autoRefundComplaints({ now = new Date() } = {}) {
  const s = await settings.current();
  const limit = typeof s.claim_auto_pay_limit === 'number' ? s.claim_auto_pay_limit : DEFAULT_AUTO_REFUND_PENCE;
  const { rows } = await query(
    `select k.* from hosting_complaints k join experience_bookings b on b.id = k.booking_id
      where k.state = 'open' and k.host_replied_at is null and not k.host_disputes and k.kind in ('complaint', 'host_no_show')
        and k.created_at <= $1::timestamptz - make_interval(hours => $2) and b.payment_state in ('charged', 'partially_refunded')
      order by k.created_at limit 50`, [now, HOST_ANSWER_HOURS]);
  const out = { refunded: 0, overLimit: 0 };
  for (const k of rows) {
    const share = await withTransaction(async (c) => (await complaintShare(c, k)).pence);
    if (share > limit) { out.overLimit += 1; continue; }
    try {
      const r = await refundComplaint({ complaintId: k.id, by: 'epic', why: `No answer from the host in ${HOST_ANSWER_HOURS} hours, within the auto-refund limit` });
      out.refunded += 1;
      const { logAutomation } = await import('./automationLog.js');
      await logAutomation({ automation: 'complaint_auto_refund', subjectKind: 'complaint', subjectId: k.id, rule: `The host didn't answer in ${HOST_ANSWER_HOURS} hours and ${(share / 100).toFixed(2)} is within the £${(limit / 100).toFixed(2)} limit`, evidence: { bookingId: k.booking_id, sharePence: share, limitPence: limit, openedAt: k.created_at }, did: `Refunded £${(r.refundPence / 100).toFixed(2)} and closed the complaint`, undo: null });
    } catch (err) {
      if (err.code !== 'not_open') console.error(`epic-api: complaint ${k.id} auto-refund — ${err.code ?? err.message}`);
    }
  }
  return out;
}

export { ledger };
