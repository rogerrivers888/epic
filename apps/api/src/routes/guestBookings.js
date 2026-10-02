/**
 * The guest side (hosting v4 handover §4, guest brief v2): booking, the
 * waiting list, Trips › Booked, the booking page, cancelling, after the event,
 * tips, Settings › Payments — and the host's answer to an Ask to book. The
 * screens arrive with the guest design; this is the logic and the API.
 *
 *   GET    /api/experiences/:id/booking/options   what the sheet needs: kinds, sessions, slots, prices, questions
 *   POST   /api/experiences/:id/booking/quote     the price for a party, before paying
 *   POST   /api/experiences/:id/booking           book (free: done; paid: a PaymentIntent to confirm; On request: a hold)
 *   POST   /api/experiences/:id/waitlist          join (when it is full and the host has it on); DELETE leaves
 *   GET    /api/booked                            Upcoming · Invites · Past
 *   GET    /api/booked/:id                        the booking page
 *   POST   /api/booked/:id/payment                Stripe said yes: read it back and confirm (the webhook's twin)
 *   GET    /api/booked/:id/cancel-quote           what comes back, before confirming
 *   POST   /api/booked/:id/cancel                 a session (Weekly) or all of it
 *   POST   /api/booked/:id/keep                   the host moved the date; Keep my place
 *   PATCH  /api/booked/:id/answers                until 24h before
 *   POST   /api/booked/:id/happened|rate|tip      after the event
 *   GET    /api/payments                          every payment, refund and tip
 *   POST   /api/invited/:token/book               an invitation answered by a household on Epic
 *   POST   /api/host/lanes/requests/:id/accept|decline   the host's answer to an Ask to book
 *
 * Money goes through the engine (domain/money.js) with the settings read at
 * run time; Stripe stays in test mode; the fee is worked out once, here, and
 * stored on the booking with its rate and reason.
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import * as repo from '../repositories/hosting.js';
import * as settingsRepo from '../repositories/hostingSettings.js';
import * as ledger from '../repositories/hostingLedger.js';
import * as notifications from '../repositories/notifications.js';
import * as stripe from '../sources/stripe.js';
import { logChange } from '../repositories/hostingSettings.js';
import { currentAccount } from '../context.js';
import { currentHousehold } from './household.js';
import { owe, shareOf, movedSinceBooking } from '../sources/bookingMoney.js';
import { feeFor, priceBooking, tipFee, numbersSettlement } from '../domain/money.js';
import { mainAction, placesLeft, sessionsForBooking, KINDS_BY_LANE, checkParty, childAge, cancelQuote, answersEditable, tipOpen, guestChip } from '../domain/booking.js';
import { localInstant, localDay, plusDays, slotsFor, bookableDay, dow, perPersonAt, refundWords, hostingConfig } from '../domain/lanes.js';
import { mediaRef } from './hosting.js';

export const router = Router();
export const publicRouter = Router();

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const tzOf = (o) => o?.time_zone ?? 'Europe/London';
const startOf = (s, o) => localInstant(ymd(s.on_date), hm(s.starts_at) ?? '00:00', tzOf(o));
const endOf = (s, o) => localInstant(ymd(s.ends_on ?? s.on_date), hm(s.ends_at) ?? hm(s.starts_at) ?? '23:59', tzOf(o));
const LIVE = `b.state in ('pending', 'confirmed', 'attended')`;
const guestLink = (id) => `/trips/booked/${id}`;
const hostLink = (offerId) => `/host/events/${offerId}`;

async function me() {
  const household = await currentHousehold();
  return { household, account: currentAccount() };
}

/** An event with its sessions (booked heads each) and its host. */
async function eventWithSessions(id, client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  if (!UUID.test(String(id))) return null;
  const { rows: [o] } = await q('select * from host_offers where id = $1', [id]);
  if (!o || !o.lane) return null;
  const { rows: sessions } = await q(
    `select s.*,
            coalesce((select sum(b.heads) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                       where bs.session_id = s.id and bs.state = 'booked' and ${LIVE}), 0)::int as booked,
            -- A place offered from the waiting list is held for that household: on this session, or on the whole event (One-off, Course).
            coalesce((select sum(w.party) from offer_waitlist w where (w.session_id = s.id or (w.session_id is null and w.offer_id = s.offer_id))
                       and w.state = 'offered' and w.offer_expires_at > now()), 0)::int as reserved
       from offer_sessions s where s.offer_id = $1 order by s.on_date, s.starts_at nulls first`,
    [o.id],
  );
  const { rows: [host] } = await q('select * from hosts where id = $1', [o.host_id]);
  return { offer: o, sessions, host };
}

const ahead = (sessions, o, now = new Date()) => sessions.filter((s) => s.state === 'scheduled' && startOf(s, o) > now);

/** What a booking costs: the lane's price for its kind, a child price, the group discount for that kind. */
function priceFor(o, kind, party, sessionCount) {
  if (o.price_mode === 'free' || !o.price_mode) return { lines: [], grossPence: 0, discountPence: 0, valuePence: 0 };
  if (o.price_mode === 'by_numbers') {
    const each = perPersonAt(o.total_pence ?? 0, o.min_count ?? 1) ?? 0;
    const heads = party.adults + party.children;
    return { lines: [{ label: 'Each, at the minimum numbers', each, count: heads, pence: each * heads }], grossPence: each * heads, discountPence: 0, valuePence: each * heads };
  }
  if (o.lane === 'weekly') {
    const each = kind === 'book_ahead' ? (o.book_ahead_pence ?? o.drop_in_pence ?? 0) : (o.drop_in_pence ?? 0);
    const one = priceBooking({ pricePence: each, childPence: o.child_pence, adults: party.adults, children: party.children,
      groupPct: kind === 'book_ahead' ? o.book_ahead_group_pct : o.drop_in_group_pct, groupMin: kind === 'book_ahead' ? o.book_ahead_group_min : o.drop_in_group_min });
    const n = Math.max(1, sessionCount);
    return {
      lines: one.lines.map((l) => ({ ...l, label: n > 1 ? `${l.label} × ${n} sessions` : l.label, count: l.count * n, pence: l.pence * n })),
      grossPence: one.grossPence * n, discountPence: one.discountPence * n, valuePence: one.valuePence * n,
    };
  }
  return priceBooking({ pricePence: o.price_pence ?? 0, childPence: o.child_pence, adults: party.adults, children: party.children, per: o.per === 'booking' ? 'booking' : 'person' });
}

const paidThroughEpic = (o) => o.price_mode && o.price_mode !== 'free' && (o.money ?? 'epic') === 'epic';

async function feeOn(o, host, valuePence, viaHostLink, s, client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const { rows: [r] } = await q(
    `select count(distinct (r.offer_id, coalesce(b.session_id::text, b.occurrence, '')))::int as rated, round(avg(r.stars)::numeric, 2)::float as avg
       from host_reviews r join experience_bookings b on b.id = r.booking_id
      where r.host_id = $1 and r.side = 'guest' and r.publish_on <= current_date and not coalesce(r.hidden, false)`, [host.id],
  );
  const { rows: [n] } = await q('select count(*)::int as n from experience_bookings where host_id = $1 and intro_ordinal is not null', [host.id]);
  return feeFor(
    { visibility: o.visibility === 'public' ? 'public' : 'private', valuePence, viaHostLink, throughEpic: paidThroughEpic(o) },
    { rating: { ratedEvents: r?.rated ?? 0, avg: r?.avg ?? null }, hostStartedAt: host.created_at, bookingsSoFar: n?.n ?? 0, feeOverridePct: host.fee_override_pct },
    s,
  );
}

/** The host's questions, answered: only keys the host asked, strings and short lists, never anything else. */
function cleanAnswers(raw, asked = {}) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const allowed = new Set(['dietary', 'needs', 'bring', 'note', 'plusOne', 'nights', 'stay', ...Object.keys(asked ?? {})]);
  for (const [k, v] of Object.entries(raw).slice(0, 20)) {
    if (!allowed.has(k)) continue;
    if (typeof v === 'string') out[k] = v.trim().slice(0, 500);
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 120)).slice(0, 20);
  }
  return out;
}

// ---------------------------------------------------------------------------
// the event page and the booking sheet
// ---------------------------------------------------------------------------

publicRouter.get('/experiences/:id/booking/options', async (req, res, next) => {
  try {
    const e = await eventWithSessions(req.params.id);
    if (!e || ['draft', 'in_review', 'approved'].includes(e.offer.state)) throw refuse(404, 'not_found', 'That event isn’t open.');
    const { offer: o, sessions, host } = e;
    const now = new Date();
    const s = await settingsRepo.current();
    const next = ahead(sessions, o, now);
    const left = next.length ? Math.min(...next.map((x) => (placesLeft(x, o) ?? Infinity) - x.reserved)) : null;
    const cfg = hostingConfig();
    const slots = [];
    if (o.lane === 'onrequest') {
      const notice = o.notice_hours ?? cfg.onRequest.noticeHours;
      for (let i = 0; i < 42 && slots.length < 28; i += 1) {
        const day = plusDays(localDay(now, tzOf(o)), i);
        if (!bookableDay(day, o.free_hours ?? {}, { now, noticeHours: notice })) continue;
        const lengths = o.session_lengths?.length ? o.session_lengths : [o.duration_min ?? 60];
        // A time already gone, or inside the notice, is not offered.
        const times = slotsFor(o.free_hours ?? {}, dow(day), Math.min(...lengths)).filter((t) => localInstant(day, t, tzOf(o)).getTime() - now.getTime() >= notice * 3_600_000);
        if (times.length) slots.push({ date: day, times, lengths });
      }
    }
    res.json({
      action: mainAction({ offer: o, sessionsAhead: next, hostPaused: Boolean(host?.paused || host?.stopped_at), placesLeft: Number.isFinite(left) ? left : null }),
      lane: o.lane, kinds: KINDS_BY_LANE[o.lane] ?? [],
      sessions: next.map((x) => ({ id: x.id, n: x.n, date: ymd(x.on_date), time: hm(x.starts_at), placesLeft: placesLeft(x, o) == null ? null : Math.max(0, placesLeft(x, o) - x.reserved), topic: x.topic })),
      slots,
      price: {
        mode: o.price_mode ?? 'free', pence: o.price_pence, childPence: o.child_pence, per: o.per, dropInPence: o.drop_in_pence, bookAheadPence: o.book_ahead_pence,
        totalPence: o.total_pence, nowEach: o.price_mode === 'by_numbers' ? perPersonAt(o.total_pence ?? 0, o.min_count ?? 1) : null,
        groups: { dropIn: o.drop_in_group_pct ? { pct: o.drop_in_group_pct, min: o.drop_in_group_min } : null, bookAhead: o.book_ahead_group_pct ? { pct: o.book_ahead_group_pct, min: o.book_ahead_group_min } : null },
        throughEpic: paidThroughEpic(o),
      },
      who: { ageMin: o.age_min, ageMax: o.age_max, partyMax: o.party_max, dropOff: o.parents === 'drop_off', adultsOnly: o.age_min != null && o.age_min >= cfg.adultAge },
      questions: o.guest_questions ?? {},
      refundWords: o.refund_policy && paidThroughEpic(o) ? refundWords(o.refund_policy, cfg) : null,
      waitlist: { on: o.waitlist_on === true, offerHours: typeof s.waitlist_offer === 'number' ? s.waitlist_offer : null },
      askWindowHours: o.lane === 'onrequest' ? (typeof s.ask_to_book_window === 'number' ? s.ask_to_book_window : null) : null,
    });
  } catch (err) { next(err); }
});

/** Parse the When part of a booking: its kind, sessions or slot. */
function parseWhen(o, sessionsAhead, body) {
  const kind = body?.kind;
  if (!(KINDS_BY_LANE[o.lane] ?? []).includes(kind)) throw refuse(400, 'bad_kind', 'Pick when.');
  if (kind === 'request') {
    const date = String(body?.date ?? '');
    const time = String(body?.time ?? '');
    const length = Number(body?.lengthMin ?? o.duration_min ?? 60);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw refuse(400, 'bad_slot', 'Pick a day and a time.');
    const lengths = o.session_lengths?.length ? o.session_lengths : [o.duration_min ?? 60];
    if (!lengths.includes(length)) throw refuse(400, 'bad_length', 'Pick one of the host’s session lengths.');
    const cfg = hostingConfig();
    if (!bookableDay(date, o.free_hours ?? {}, { noticeHours: o.notice_hours ?? cfg.onRequest.noticeHours })) throw refuse(409, 'day_closed', 'The host isn’t free that day.');
    if (!slotsFor(o.free_hours ?? {}, dow(date), length).includes(time)) throw refuse(409, 'time_closed', 'That time isn’t free.');
    if (localInstant(date, time, tzOf(o)).getTime() - Date.now() < (o.notice_hours ?? cfg.onRequest.noticeHours) * 3_600_000) throw refuse(409, 'too_soon', 'Pick a time further ahead.');
    return { kind, sessionIds: [], slot: { date, time, length } };
  }
  const ids = sessionsForBooking(kind, sessionsAhead, Array.isArray(body?.sessionIds) ? body.sessionIds : []);
  if (ids == null) throw refuse(409, 'session_gone', 'One of those sessions has gone.');
  if (!ids.length) throw refuse(409, 'nothing_ahead', 'There is nothing left to book.');
  return { kind, sessionIds: ids, slot: null };
}

function parseParty(body) {
  const kids = Array.isArray(body?.children) ? body.children.slice(0, 20) : [];
  return {
    adults: Math.max(0, Math.min(50, Math.floor(Number(body?.adults) || 0))),
    children: kids.map((k) => ({
      name: k?.name == null ? null : String(k.name).trim().slice(0, 60) || null,
      age: k?.age == null || k.age === '' ? null : Number(k.age),
      dob: /^\d{4}-\d{2}-\d{2}$/.test(String(k?.dob ?? '')) ? String(k.dob) : null,
      needs: Array.isArray(k?.needs) ? k.needs.filter((x) => typeof x === 'string').map((x) => x.slice(0, 60)).slice(0, 10) : [],
      emergencyContact: k?.emergencyContact == null ? null : String(k.emergencyContact).trim().slice(0, 20),
    })),
    adultConfirmed: body?.adultConfirmed === true,
  };
}

router.post('/experiences/:id/booking/quote', async (req, res, next) => {
  try {
    const e = await eventWithSessions(req.params.id);
    if (!e) throw refuse(404, 'not_found', 'That event isn’t open.');
    const when = parseWhen(e.offer, ahead(e.sessions, e.offer), req.body?.when);
    const party = parseParty(req.body?.party);
    const p = priceFor(e.offer, when.kind, { adults: party.adults, children: party.children.length }, when.sessionIds.length);
    const numbers = e.offer.price_mode === 'by_numbers' ? { nowEach: perPersonAt(e.offer.total_pence ?? 0, e.offer.min_count ?? 1), decidesOn: ymd(e.sessions.find((x) => x.decides_at)?.decides_at ?? null) } : null;
    res.json({ ...p, numbers, hold: when.kind === 'request' && p.valuePence > 0 });
  } catch (err) { next(err); }
});

/**
 * Book. One transaction under the event's lock: the places are counted and
 * held, the price and Epic's fee are worked out and written down, and then —
 * after the transaction — Stripe is asked for a PaymentIntent (a hold, for an
 * Ask to book). A free booking is confirmed at once.
 */
router.post('/experiences/:id/booking', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const r = await book({ offerId: req.params.id, body: req.body ?? {}, household, account });
    res.status(201).json(r);
  } catch (err) { next(err); }
});

/** Make a booking (the event page's Book, or an invitation's Coming). Returns `{ booking, pay }`. */
async function book({ offerId, body, household, account, invite = null }) {
    const s = await settingsRepo.current();
    const out = await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${offerId}`]);
      const e = await eventWithSessions(offerId, c);
      if (!e || e.offer.state !== 'live') throw refuse(404, 'not_open', 'That event isn’t open for booking.');
      const { offer: o, sessions, host } = e;
      if (host.paused || host.stopped_at) throw refuse(409, 'host_paused', 'This host isn’t taking new bookings just now.');
      if (host.household_id === household.id) throw refuse(409, 'own_event', 'You can’t book your own event.');
      const next = ahead(sessions, o);
      const when = parseWhen(o, next, body.when);
      const party = parseParty(body.party);
      const first = next.find((x) => when.sessionIds.includes(x.id));
      const check = checkParty(party, o, { onDate: when.slot?.date ?? (first ? ymd(first.on_date) : null), adultAge: hostingConfig().adultAge });
      if (check.error) throw refuse(400, check.error, check.message);
      // Places: each session's most, less who holds a place and any place offered to somebody else on the waiting list.
      const { rows: mine } = await c.query(`select * from offer_waitlist where offer_id = $1 and household_id = $2 and state = 'offered' and offer_expires_at > now()`, [o.id, household.id]);
      for (const id of when.sessionIds) {
        const x = sessions.find((y) => y.id === id);
        const left = placesLeft(x, o);
        const reservedForMe = mine.filter((w) => w.session_id == null || w.session_id === id).reduce((n, w) => n + w.party, 0);
        if (left != null && left - (x.reserved - reservedForMe) < check.heads) throw refuse(409, 'full', o.waitlist_on ? 'It’s full — join the waiting list.' : 'It’s full.');
      }
      if (when.kind === 'request') {
        const weekStart = plusDays(when.slot.date, -((dow(when.slot.date) + 6) % 7));
        const { rows: [wk] } = await c.query(
          `select count(*)::int as n from experience_bookings where offer_id = $1 and request_state in ('asked', 'accepted') and requested_date >= $2 and requested_date < $3`,
          [o.id, weekStart, plusDays(weekStart, 7)],
        );
        const cap = o.per_week_max ?? hostingConfig().onRequest.perWeek;
        if (wk.n >= cap) throw refuse(409, 'week_full', 'The host has no more room that week.');
      }
      const price = priceFor(o, when.kind, { adults: check.adults, children: check.children }, when.sessionIds.length);
      const paid = price.valuePence > 0 && paidThroughEpic(o);
      if (paid && !stripe.stripeStatus().ready) throw refuse(503, 'payments_not_open', 'Paying for events opens soon.');
      const viaHostLink = body.viaHostLink === true || body.source === 'link';
      const fee = paid ? await feeOn(o, host, price.valuePence, viaHostLink, s, c) : { ratePct: 0, reason: 'free', feePence: 0, hostPence: price.valuePence };
      if (fee.reason === 'not_set') throw refuse(503, 'fees_not_set', 'Booking opens once Epic has finished setting its fees.');
      const asked = when.kind === 'request';
      const askHours = typeof s.ask_to_book_window === 'number' ? s.ask_to_book_window : 24;
      const policy = paid ? o.refund_policy : null;
      const { rows: [b] } = await c.query(
        `insert into experience_bookings
           (offer_id, host_id, household_id, heads, party, state, amount_pence, booking_kind, request_state, respond_by,
            requested_date, requested_time, requested_length_min, payment_state, refund_policy, refund_terms, answers, adult_confirmed,
            source, via_host_link, price_lines, gross_pence, discount_pence, value_pence, fee_rate_pct, fee_reason, fee_pence, host_pence)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,'none',$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27)
         returning *`,
        [o.id, host.id, household.id, check.heads, JSON.stringify([...Array(check.adults)].map(() => ({ child: false })).concat(party.children.map((k) => ({ name: k.name, child: true })))),
          paid || asked ? 'pending' : 'confirmed', price.valuePence, when.kind, asked ? 'asked' : null, asked ? new Date(Date.now() + askHours * 3_600_000) : null,
          when.slot?.date ?? null, when.slot?.time ?? null, when.slot?.length ?? null,
          policy, JSON.stringify(policy ? s.refund_terms?.[policy] ?? null : null), JSON.stringify(cleanAnswers(body.answers, o.guest_questions)), party.adultConfirmed,
          ['search', 'link', 'invite', 'profile', 'collection', 'web'].includes(body.source) ? body.source : 'search', viaHostLink,
          JSON.stringify(price.lines), price.grossPence, price.discountPence, price.valuePence, fee.ratePct, fee.reason, fee.feePence, fee.hostPence],
      );
      for (const id of when.sessionIds) await c.query('insert into booking_sessions (booking_id, session_id) values ($1, $2)', [b.id, id]);
      for (const k of party.children) {
        await c.query('insert into booking_children (booking_id, name, age, date_of_birth, needs, emergency_contact) values ($1, $2, $3, $4, $5::jsonb, $6)',
          [b.id, k.name, k.dob ? null : childAge(k), k.dob, JSON.stringify(k.needs), k.emergencyContact]);
      }
      if (mine.length) await c.query(`update offer_waitlist set state = 'taken' where id = any($1::uuid[])`, [mine.map((w) => w.id)]);
      if (invite) {
        const { rowCount } = await c.query(`update offer_invites set rsvp = 'yes', rsvp_heads = $2, answered_at = now(), household_id = $3, booking_id = $4 where id = $1 and booking_id is null`, [invite.id, check.heads, household.id, b.id]);
        if (!rowCount) throw refuse(409, 'answered', 'This invitation is answered already.');
      }
      await logChange({ subjectKind: 'booking', subjectId: b.id, field: 'made', after: { kind: when.kind, heads: check.heads, value: price.valuePence, fee: fee.feePence, reason: fee.reason }, by: account?.id ?? null, byLabel: 'guest' }, c);
      return { b, o, host, paid, asked };
    });
    const { b, o, host, paid, asked } = out;
    if (!paid) {
      // Free, or paid to the host directly: done.
      if (!asked) await confirmed(b, o, host);
      else await notifications.notify({ householdId: host.household_id, kind: 'ask_to_book_request', title: `Ask to book: ${o.title ?? 'your offer'}`, link: hostLink(o.id), dedupeKey: `ask:${b.id}` }).catch(() => null);
      return { booking: { id: b.id, state: asked ? 'requested' : 'confirmed' }, pay: null };
    }
    let pi;
    try {
      pi = await stripe.paymentIntent({ amountPence: b.value_pence, bookingId: b.id, offerId: o.id, householdId: b.household_id, hold: asked, email: account?.email ?? null, idempotencyKey: `booking-${b.id}` });
    } catch (err) {
      // Stripe said no or couldn't be reached: the places go back at once rather than waiting on a payment that can't start (Codex, 2 Oct 2026).
      await query(`update experience_bookings set state = 'cancelled', cancelled_by = 'epic', cancel_cause = 'payment_setup_failed' where id = $1 and state = 'pending'`, [b.id]);
      await query(`update booking_sessions set state = 'cancelled' where booking_id = $1`, [b.id]);
      if (invite) await query(`update offer_invites set rsvp = null, rsvp_heads = null, booking_id = null where id = $1 and booking_id = $2`, [invite.id, b.id]);
      throw err;
    }
    await query('update experience_bookings set stripe_payment_intent = $2 where id = $1', [b.id, pi.id]);
    await ledger.record({ kind: asked ? 'hold' : 'charge', bookingId: b.id, offerId: o.id, hostId: host.id, householdId: b.household_id, amountPence: b.value_pence, epicPence: b.fee_pence, hostPence: b.host_pence, bookingValuePence: b.value_pence, ratePct: b.fee_rate_pct, state: 'pending', stripeRef: pi.id, mode: 'test', reason: b.fee_reason });
    return { booking: { id: b.id, state: 'pending_payment' }, pay: { clientSecret: pi.client_secret ?? null, paymentIntent: pi.id, amountPence: b.value_pence, hold: asked } };
}

/** A booking is on: the guest and the host are told. */
async function confirmed(b, o, host) {
  await notifications.notify({ householdId: b.household_id, kind: 'booking_confirmed', title: `You’re booked: ${o.title ?? 'your event'}`, body: 'It’s in your Trips.', link: guestLink(b.id), dedupeKey: `confirmed:${b.id}` }).catch(() => null);
  await notifications.notify({ householdId: host.household_id, kind: 'new_booking', title: `New booking: ${o.title ?? 'your event'}`, body: `${b.heads} ${b.heads === 1 ? 'person' : 'people'}`, link: hostLink(o.id), dedupeKey: `new_booking:${b.id}` }).catch(() => null);
}

/**
 * What Stripe says about a booking's PaymentIntent, applied once: charged →
 * confirmed and on the ledger; held (Ask to book) → the host is asked;
 * failed → the place is let go. The webhook and the return trip both land here.
 */
export async function applyPaymentIntent(pi) {
  const bookingId = pi?.metadata?.epic_booking_id;
  if (pi?.metadata?.epic_kind === 'tip') return applyTipIntent(pi);
  if (!bookingId || !UUID.test(bookingId)) return null;
  const { rows: [b] } = await query('select * from experience_bookings where id = $1 and stripe_payment_intent = $2', [bookingId, pi.id]);
  if (!b) return null;
  const o = await repo.offerById(b.offer_id);
  const host = await repo.hostById(b.host_id);
  if (pi.status === 'succeeded' && b.payment_state !== 'charged' && !['refunded', 'partially_refunded'].includes(b.payment_state)) {
    const { rowCount } = await query(
      `update experience_bookings set payment_state = 'charged', charged_pence = $2, state = case when state = 'pending' then 'confirmed' else state end,
              request_state = case when request_state = 'asked' then 'accepted' else request_state end
        where id = $1 and payment_state in ('none', 'held', 'failed')`,
      [b.id, pi.amount_received ?? b.value_pence],
    );
    if (rowCount) {
      await query(`update hosting_payments set state = 'succeeded', kind = 'charge', updated_at = now() where stripe_ref = $1 and kind in ('charge', 'hold')`, [pi.id]).catch(() => null);
      await confirmed(b, o, host);
    }
  } else if (pi.status === 'requires_capture' && b.payment_state === 'none') {
    await query(`update experience_bookings set payment_state = 'held', held_pence = $2 where id = $1 and payment_state = 'none'`, [b.id, pi.amount_capturable ?? b.value_pence]);
    await notifications.notify({ householdId: host.household_id, kind: 'ask_to_book_request', title: `Ask to book: ${o?.title ?? 'your offer'}`, body: `${b.requested_date ? ymd(b.requested_date) : ''} ${hm(b.requested_time) ?? ''}`.trim(), link: hostLink(b.offer_id), dedupeKey: `ask:${b.id}` }).catch(() => null);
  } else if (['canceled', 'requires_payment_method'].includes(pi.status) && ['none'].includes(b.payment_state) && pi.last_payment_error) {
    await query(`update experience_bookings set payment_state = 'failed', state = 'cancelled', cancelled_by = 'epic', cancel_cause = 'payment_failed' where id = $1 and payment_state = 'none'`, [b.id]);
    await query(`update booking_sessions set state = 'cancelled' where booking_id = $1`, [b.id]);
    await query(`update hosting_payments set state = 'failed', updated_at = now() where stripe_ref = $1`, [pi.id]).catch(() => null);
  }
  return b.id;
}

async function applyTipIntent(pi) {
  const tipId = pi?.metadata?.epic_tip_id;
  if (!tipId || !UUID.test(tipId) || pi.status !== 'succeeded') return null;
  const { rows: [t] } = await query(`update booking_tips set state = 'paid' where id = $1 and stripe_ref = $2 and state = 'pending' returning *`, [tipId, pi.id]);
  if (!t) return null;
  await ledger.record({ kind: 'tip', bookingId: t.booking_id, offerId: t.offer_id, hostId: t.host_id, householdId: t.household_id, amountPence: t.amount_pence + t.admin_fee_pence, epicPence: t.admin_fee_pence, hostPence: t.amount_pence, state: 'succeeded', stripeRef: pi.id, mode: 'test', reason: 'tip' });
  const h = await repo.hostById(t.host_id);
  await notifications.notify({ householdId: h.household_id, kind: 'new_tip', title: `A £${(t.amount_pence / 100).toFixed(2)} tip`, link: '/host/reviews?tab=tips', dedupeKey: `tip:${t.id}` }).catch(() => null);
  return t.id;
}

router.post('/booked/:id/payment', async (req, res, next) => {
  try {
    const { household } = await me();
    const b = await ownBooking(req.params.id, household.id);
    if (!b.stripe_payment_intent) throw refuse(409, 'nothing_to_pay', 'There’s nothing to pay on this one.');
    const pi = await stripe.retrievePaymentIntent(b.stripe_payment_intent, { householdId: household.id });
    await applyPaymentIntent(pi);
    const { rows: [now] } = await query('select state, payment_state, request_state from experience_bookings where id = $1', [b.id]);
    res.json({ state: now.state, paymentState: now.payment_state, requestState: now.request_state });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the waiting list
// ---------------------------------------------------------------------------

router.post('/experiences/:id/waitlist', async (req, res, next) => {
  try {
    const { household } = await me();
    const e = await eventWithSessions(req.params.id);
    if (!e || e.offer.state !== 'live') throw refuse(404, 'not_open', 'That event isn’t open.');
    const { offer: o, sessions } = e;
    if (!o.waitlist_on) throw refuse(409, 'no_waitlist', 'This one has no waiting list.');
    const party = Math.max(1, Math.min(o.party_max ?? 20, Math.floor(Number(req.body?.party) || 1)));
    let sessionId = null;
    if (o.lane === 'weekly') {
      sessionId = req.body?.sessionId;
      if (!ahead(sessions, o).some((x) => x.id === sessionId)) throw refuse(400, 'bad_session', 'Pick the session.');
    }
    // Only when it is full, counted under the event's lock (Codex, 2 Oct 2026): a free place is booked, not queued for.
    const w = await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${o.id}`]);
      const now = await eventWithSessions(o.id, c);
      const targets = sessionId ? now.sessions.filter((x) => x.id === sessionId) : ahead(now.sessions, now.offer);
      const left = Math.min(...targets.map((x) => (placesLeft(x, now.offer) ?? Infinity) - x.reserved));
      if (left >= party) throw refuse(409, 'not_full', 'There’s room — book it instead.');
      const { rows: [row] } = await c.query(
        `insert into offer_waitlist (offer_id, session_id, household_id, party) values ($1, $2, $3, $4)
         on conflict do nothing returning *`,
        [o.id, sessionId, household.id, party],
      );
      return row;
    });
    if (!w) throw refuse(409, 'already_waiting', 'You’re on the waiting list already.');
    const { rows: [pos] } = await query(
      `select count(*)::int as n from offer_waitlist where offer_id = $1 and session_id is not distinct from $2 and state in ('waiting', 'offered')
          and created_at <= (select created_at from offer_waitlist where id = $3)`,
      [o.id, sessionId, w.id],
    );
    res.status(201).json({ position: pos.n });
  } catch (err) { next(err); }
});

router.delete('/experiences/:id/waitlist', async (req, res, next) => {
  try {
    const { household } = await me();
    const { rowCount } = await query(`update offer_waitlist set state = 'left' where offer_id = $1 and household_id = $2 and state in ('waiting', 'offered')`, [req.params.id, household.id]);
    res.json({ left: rowCount > 0 });
  } catch (err) { next(err); }
});

/**
 * Offer freed places to the first in line, for `waitlist_offer` hours; an
 * offer not taken in time passes to the next. Returns how many were offered.
 */
export async function offerFreedPlaces({ now = new Date() } = {}) {
  const s = await settingsRepo.current();
  const hours = typeof s.waitlist_offer === 'number' ? s.waitlist_offer : null;
  if (hours == null) return 0;
  await query(`update offer_waitlist set state = 'expired' where state = 'offered' and offer_expires_at <= $1`, [now]);
  const { rows: lines } = await query(
    `select distinct w.offer_id, w.session_id from offer_waitlist w join host_offers o on o.id = w.offer_id
      where w.state = 'waiting' and o.waitlist_on and o.state = 'live'`,
  );
  let offered = 0;
  for (const l of lines) {
    const e = await eventWithSessions(l.offer_id);
    if (!e) continue;
    const targets = l.session_id ? e.sessions.filter((x) => x.id === l.session_id) : ahead(e.sessions, e.offer, now);
    if (!targets.length || targets.some((x) => startOf(x, e.offer) <= now)) continue;
    const left = Math.min(...targets.map((x) => (placesLeft(x, e.offer) ?? Infinity) - x.reserved));
    if (!(left > 0)) continue;
    const { rows: [first] } = await query(
      `select * from offer_waitlist where offer_id = $1 and session_id is not distinct from $2 and state = 'waiting' order by created_at limit 1`,
      [l.offer_id, l.session_id],
    );
    if (!first || first.party > left) continue;
    const { rowCount } = await query(
      `update offer_waitlist set state = 'offered', offered_at = $2, offer_expires_at = $3 where id = $1 and state = 'waiting'`,
      [first.id, now, new Date(now.getTime() + hours * 3_600_000)],
    );
    if (!rowCount) continue;
    offered += 1;
    await notifications.notify({ householdId: first.household_id, kind: 'waitlist_offered', title: `Your place is ready: ${e.offer.title ?? 'an event'}`, body: `Book within ${hours} hours`, link: `/experiences/${e.offer.id}`, dedupeKey: `waitlist_offered:${first.id}` }).catch(() => null);
  }
  return offered;
}

// ---------------------------------------------------------------------------
// Trips › Booked, and the booking page
// ---------------------------------------------------------------------------

async function bookingsOfHousehold(householdId) {
  const { rows } = await query(
    `select b.*, o.title, o.lane, o.photo_ids, o.min_count, o.time_zone, o.price_mode, o.total_pence, o.state as offer_state, o.host_id as offer_host,
            o.venue_label, o.venue, o.address_hidden, o.parents
       from experience_bookings b join host_offers o on o.id = b.offer_id
      where b.household_id = $1 and o.lane is not null
      order by b.created_at desc limit 300`,
    [householdId],
  );
  const ids = rows.map((r) => r.id);
  const { rows: bs } = ids.length ? await query(
    `select bs.booking_id, bs.state as held, s.*,
            coalesce((select sum(b2.heads) from booking_sessions x join experience_bookings b2 on b2.id = x.booking_id where x.session_id = s.id and x.state = 'booked' and b2.state in ('pending', 'confirmed', 'attended')), 0)::int as booked
       from booking_sessions bs join offer_sessions s on s.id = bs.session_id where bs.booking_id = any($1::uuid[]) order by s.on_date, s.starts_at`,
    [ids],
  ) : { rows: [] };
  return rows.map((b) => ({ ...b, sessionsList: bs.filter((x) => x.booking_id === b.id) }));
}

function card(b, now) {
  const o = { time_zone: b.time_zone };
  const live = b.sessionsList.filter((x) => x.held === 'booked' && x.state === 'scheduled');
  const nextS = live.find((x) => endOf(x, o) > now) ?? null;
  const all = b.sessionsList.length;
  const idx = nextS ? b.sessionsList.indexOf(nextS) + 1 : null;
  const chip = guestChip({ booking: b, sessions: b.sessionsList.map((x) => ({ changed: Boolean(x.changed_from && new Date(x.changed_from.at) > new Date(b.created_at)), decided: x.decided_outcome })), min: b.min_count, booked: nextS?.booked ?? 0 });
  const lastEnd = b.sessionsList.length ? Math.max(...b.sessionsList.map((x) => endOf(x, o).getTime())) : null;
  return {
    id: b.id, offerId: b.offer_id, title: b.title, lane: b.lane, photo: mediaRef(b.photo_ids?.[0]),
    date: nextS ? ymd(nextS.on_date) : b.requested_date ? ymd(b.requested_date) : b.sessionsList[0] ? ymd(b.sessionsList[0].on_date) : null,
    time: nextS ? hm(nextS.starts_at) : hm(b.requested_time),
    session: (b.lane === 'course' || b.lane === 'weekly') && idx && all > 1 ? { n: idx, of: all } : null,
    chip: chip.chip, chipWords: chip.words,
    numbers: b.min_count && chip.chip === 'waiting' ? { booked: nextS?.booked ?? 0, min: b.min_count } : null,
    rateIt: Boolean(lastEnd && lastEnd <= now.getTime() && !b.rated_at && b.state !== 'cancelled'),
    upcoming: Boolean(nextS) || b.request_state === 'asked',
  };
}

router.get('/booked', async (_req, res, next) => {
  try {
    const { household, account } = await me();
    const now = new Date();
    const rows = await bookingsOfHousehold(household.id);
    const cards = rows.map((b) => card(b, now));
    const upcoming = cards.filter((c) => c.upcoming && !['cancelled', 'called_off'].includes(c.chip)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
    const past = cards.filter((c) => !c.upcoming || ['cancelled', 'called_off'].includes(c.chip));
    const { rows: waits } = await query(
      `select w.*, o.title, o.lane, o.photo_ids,
              (select count(*) from offer_waitlist w2 where w2.offer_id = w.offer_id and w2.session_id is not distinct from w.session_id and w2.state in ('waiting', 'offered') and w2.created_at <= w.created_at)::int as position
         from offer_waitlist w join host_offers o on o.id = w.offer_id where w.household_id = $1 and w.state in ('waiting', 'offered')`,
      [household.id],
    );
    for (const w of waits) upcoming.push({ id: null, waitlistId: w.id, offerId: w.offer_id, title: w.title, lane: w.lane, photo: mediaRef(w.photo_ids?.[0]), date: null, time: null, session: null, chip: 'waitlist', chipWords: w.state === 'offered' ? 'Your place is ready' : `Waiting list #${w.position}`, offered: w.state === 'offered' ? { expiresAt: w.offer_expires_at } : null, numbers: null, rateIt: false, upcoming: true });
    const contacts = [account?.email, account?.mobile].filter(Boolean);
    const { rows: invites } = await query(
      `select i.id, i.token, i.heads, o.id as offer_id, o.title, o.lane, o.photo_ids, o.starts_on, h.name as host_name
         from offer_invites i join host_offers o on o.id = i.offer_id join hosts h on h.id = o.host_id
        where i.rsvp is null and o.state = 'live' and (i.household_id = $1 or (i.household_id is null and lower(i.contact) = any($2::text[])))`,
      [household.id, contacts.map((x) => String(x).toLowerCase())],
    );
    res.json({
      upcoming, past,
      invites: invites.map((i) => ({ id: i.id, token: i.token, offerId: i.offer_id, title: i.title, lane: i.lane, photo: mediaRef(i.photo_ids?.[0]), date: ymd(i.starts_on), host: i.host_name, heads: i.heads })),
    });
  } catch (err) { next(err); }
});

async function ownBooking(id, householdId) {
  if (!UUID.test(String(id))) throw refuse(404, 'not_found', 'That booking isn’t yours.');
  const { rows: [b] } = await query('select * from experience_bookings where id = $1 and household_id = $2', [id, householdId]);
  if (!b) throw refuse(404, 'not_found', 'That booking isn’t yours.');
  return b;
}

router.get('/booked/:id', async (req, res, next) => {
  try {
    const { household } = await me();
    await ownBooking(req.params.id, household.id);
    const [b] = (await bookingsOfHousehold(household.id)).filter((x) => x.id === req.params.id);
    if (!b) throw refuse(404, 'not_found', 'That booking isn’t yours.');
    const now = new Date();
    const o = await repo.offerById(b.offer_id);
    const host = await repo.hostById(b.host_id);
    const { rows: kids } = await query('select name, age, date_of_birth, needs, emergency_contact from booking_children where booking_id = $1 order by created_at', [b.id]);
    const { rows: refunds } = await query(`select amount_pence, cause, state, created_at from hosting_payments where booking_id = $1 and kind in ('refund', 'release') order by created_at`, [b.id]);
    const live = b.sessionsList.filter((x) => x.held === 'booked' && x.state === 'scheduled');
    const firstAhead = live.map((x) => startOf(x, o)).filter((t) => t > now).sort((x, y) => x - y)[0] ?? null;
    const lastEnd = b.sessionsList.length ? new Date(Math.max(...b.sessionsList.map((x) => endOf(x, o).getTime()))) : null;
    const settlement = o.price_mode === 'by_numbers' && o.total_pence && o.min_count
      ? (() => { const n = numbersSettlement({ totalPence: o.total_pence, minCount: o.min_count, heads: live[0]?.booked ?? o.min_count }); return { paidEach: n.paidEach, nowEach: n.finalEach, dueBackPence: n.backEach * b.heads, settled: Boolean(b.settled_at) }; })()
      : null;
    const decides = b.sessionsList.find((x) => x.decides_at);
    const changed = b.sessionsList.filter((x) => x.changed_from && new Date(x.changed_from.at) > new Date(b.created_at));
    const c = card(b, now);
    res.json({
      booking: {
        id: b.id, state: b.state, chip: c.chip, chipWords: c.chipWords, kind: b.booking_kind, heads: b.heads,
        event: { id: o.id, title: o.title, lane: o.lane, photo: mediaRef(o.photo_ids?.[0]), host: { id: host.id, name: host.name } },
        sessions: b.sessionsList.map((x) => ({ id: x.id, n: x.n, date: ymd(x.on_date), time: hm(x.starts_at), endsAt: hm(x.ends_at), booked: x.held === 'booked', state: x.state, finished: endOf(x, o) <= now, changedFrom: x.changed_from ? { date: x.changed_from.onDate, time: x.changed_from.startsAt } : null })),
        request: b.request_state ? { state: b.request_state, date: ymd(b.requested_date), time: hm(b.requested_time), lengthMin: b.requested_length_min, respondBy: b.respond_by } : null,
        where: { label: o.address_hidden === false || ['confirmed', 'attended'].includes(b.state) ? o.venue_label : o.venue_area ?? null, venue: o.venue, lat: ['confirmed', 'attended'].includes(b.state) ? o.venue_lat : null, lng: ['confirmed', 'attended'].includes(b.state) ? o.venue_lng : null },
        who: { heads: b.heads, children: kids.map((k) => ({ name: k.name, age: k.age, dob: ymd(k.date_of_birth), needs: k.needs ?? [], emergencyContact: k.emergency_contact })) },
        answers: b.answers ?? {}, answersEditable: answersEditable(firstAhead, now) && b.state !== 'cancelled',
        goingAhead: o.min_count ? { min: o.min_count, booked: live[0]?.booked ?? 0, decidesOn: decides ? localDay(new Date(decides.decides_at), tzOf(o)) : null, outcome: decides?.decided_outcome ?? null } : null,
        numbers: settlement,
        dateChange: changed.length && !b.change_seen_at ? { sessions: changed.map((x) => ({ id: x.id, from: { date: x.changed_from.onDate, time: x.changed_from.startsAt }, to: { date: ymd(x.on_date), time: hm(x.starts_at) } })) } : null,
        money: { lines: b.price_lines ?? [], grossPence: b.gross_pence, discountPence: b.discount_pence, valuePence: b.value_pence, paidPence: b.charged_pence, heldPence: b.held_pence, refundedPence: b.refunded_pence, paymentState: b.payment_state, refundPolicy: b.refund_policy, refunds: refunds.map((r) => ({ pence: r.amount_pence, cause: r.cause, state: r.state, at: r.created_at })) },
        after: lastEnd && lastEnd <= now ? { happened: b.confirmed_happened ?? null, rated: Boolean(b.rated_at), tipOpen: tipOpen(lastEnd, now) } : null,
        dropOff: o.parents === 'drop_off',
      },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// changes and cancelling
// ---------------------------------------------------------------------------

async function quoteFor(b, o, sessionIds, now = new Date()) {
  const { rows: held } = await query(
    `select s.*, bs.state as held from booking_sessions bs join offer_sessions s on s.id = bs.session_id where bs.booking_id = $1`, [b.id],
  );
  const live = held.filter((x) => x.held === 'booked' && x.state === 'scheduled');
  const losing = sessionIds ?? live.map((x) => x.id);
  if (o.lane !== 'weekly' && sessionIds && losing.length !== live.length) throw refuse(400, 'whole_only', 'This one is cancelled as a whole.');
  if (losing.some((id) => !live.some((x) => x.id === id))) throw refuse(409, 'session_gone', 'That session isn’t yours to cancel.');
  if (live.filter((x) => losing.includes(x.id)).some((x) => startOf(x, o) <= now)) throw refuse(409, 'started', 'A session that has started can’t be cancelled.');
  const s = await settingsRepo.current();
  const terms = b.refund_policy ? { ...(s.refund_terms ?? {}), [b.refund_policy]: b.refund_terms ?? s.refund_terms?.[b.refund_policy] } : s.refund_terms;
  const sessions = live.map((x) => ({ id: x.id, startsAt: startOf(x, o), movedAfterBooking: movedSinceBooking(b, [x]) }));
  const q = cancelQuote({ booking: { ...b, all_sessions_count: held.length }, lane: o.lane, sessions, losing, now, terms });
  return { ...q, losing, liveCount: live.length };
}

router.get('/booked/:id/cancel-quote', async (req, res, next) => {
  try {
    const { household } = await me();
    const b = await ownBooking(req.params.id, household.id);
    if (b.state === 'cancelled') throw refuse(409, 'already_cancelled', 'This one is cancelled already.');
    const o = await repo.offerById(b.offer_id);
    const ids = typeof req.query.sessions === 'string' && req.query.sessions ? req.query.sessions.split(',').filter((x) => UUID.test(x)) : null;
    const q = await quoteFor(b, o, ids);
    res.json({ pence: q.pence, cause: q.cause, words: q.words, release: Boolean(q.release), policy: b.refund_policy });
  } catch (err) { next(err); }
});

router.post('/booked/:id/cancel', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const ids = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds.filter((x) => UUID.test(String(x))) : null;
    const out = await withTransaction(async (c) => {
      const { rows: [b0] } = await c.query('select offer_id from experience_bookings where id = $1 and household_id = $2', [req.params.id, household.id]);
      if (!b0) throw refuse(404, 'not_found', 'That booking isn’t yours.');
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${b0.offer_id}`]);
      const { rows: [b] } = await c.query('select * from experience_bookings where id = $1 for update', [req.params.id]);
      if (b.state === 'cancelled') throw refuse(409, 'already_cancelled', 'This one is cancelled already.');
      const o = await repo.offerById(b.offer_id);
      const q = await quoteFor(b, o, ids);
      const whole = q.losing.length === q.liveCount;
      if (q.release) {
        await owe(c, b, { amountPence: 0, cause: 'declined', key: `guest_cancel:${b.id}`, wholeBooking: true });
        await c.query(`update experience_bookings set request_state = 'declined', state = 'cancelled', cancelled_by = 'guest', cancel_cause = 'guest_cancelled' where id = $1`, [b.id]);
      } else {
        if (q.pence == null) throw refuse(409, 'needs_a_person', q.words);
        if (q.pence > 0) await owe(c, b, { amountPence: q.pence, cause: q.cause, key: `guest_cancel:${b.id}:${[...q.losing].sort().join(',')}`, wholeBooking: whole });
        await c.query(`update booking_sessions set state = 'cancelled' where booking_id = $1 and session_id = any($2::uuid[])`, [b.id, q.losing]);
        if (whole) await c.query(`update experience_bookings set state = 'cancelled', cancelled_by = 'guest', cancel_cause = $2 where id = $1`, [b.id, q.cause]);
      }
      await logChange({ subjectKind: 'booking', subjectId: b.id, field: 'cancelled', after: { sessions: q.losing.length, refund: q.pence, cause: q.cause }, by: account?.id ?? null, byLabel: 'guest' }, c);
      return { refundPence: q.pence ?? 0, whole };
    });
    // A freed place goes to the waiting list straight away.
    void offerFreedPlaces().catch(() => null);
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/booked/:id/keep', async (req, res, next) => {
  try {
    const { household } = await me();
    const b = await ownBooking(req.params.id, household.id);
    await query('update experience_bookings set change_seen_at = now() where id = $1', [b.id]);
    res.json({ kept: true });
  } catch (err) { next(err); }
});

router.patch('/booked/:id/answers', async (req, res, next) => {
  try {
    const { household } = await me();
    const b = await ownBooking(req.params.id, household.id);
    const o = await repo.offerById(b.offer_id);
    const { rows: held } = await query(`select s.* from booking_sessions bs join offer_sessions s on s.id = bs.session_id where bs.booking_id = $1 and bs.state = 'booked' and s.state = 'scheduled'`, [b.id]);
    const first = held.map((x) => startOf(x, o)).filter((t) => t > new Date()).sort((x, y) => x - y)[0] ?? null;
    if (!answersEditable(first) || b.state === 'cancelled') throw refuse(409, 'too_late', 'Answers can be changed until 24 hours before.');
    const answers = cleanAnswers(req.body?.answers, o.guest_questions);
    await query('update experience_bookings set answers = $2::jsonb, answers_changed_at = now() where id = $1', [b.id, JSON.stringify(answers)]);
    res.json({ answers });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// after the event
// ---------------------------------------------------------------------------

async function finishedBooking(id, householdId) {
  const b = await ownBooking(id, householdId);
  const o = await repo.offerById(b.offer_id);
  const { rows: held } = await query(`select s.* from booking_sessions bs join offer_sessions s on s.id = bs.session_id where bs.booking_id = $1 and bs.state = 'booked'`, [b.id]);
  const ends = held.map((x) => endOf(x, o));
  const lastEnd = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
  const firstEnd = ends.length ? new Date(Math.min(...ends.map((d) => d.getTime()))) : null;
  if (!firstEnd || firstEnd > new Date() || b.state === 'cancelled') throw refuse(409, 'not_yet', 'This is for after the event.');
  return { b, o, held, lastEnd };
}

router.post('/booked/:id/happened', async (req, res, next) => {
  try {
    const { household } = await me();
    const { b, held } = await finishedBooking(req.params.id, household.id);
    const answer = ['yes', 'no', 'wrong'].includes(req.body?.answer) ? req.body.answer : null;
    if (!answer) throw refuse(400, 'answer', 'Yes, no, or something went wrong.');
    const { rowCount } = await query(`update experience_bookings set confirmed_happened = $2, confirmed_at = now() where id = $1 and confirmed_happened is null`, [b.id, answer]);
    if (!rowCount) throw refuse(409, 'answered', 'You’ve answered this one.');
    if (answer !== 'yes') {
      // "No" or "something went wrong" opens a complaint on the session; it holds the payout until it is sorted.
      const last = held.at(-1);
      await query(
        `insert into hosting_complaints (booking_id, session_id, offer_id, host_id, household_id, kind, reason) values ($1, $2, $3, $4, $5, $6, $7)`,
        [b.id, last?.id ?? null, b.offer_id, b.host_id, household.id, answer === 'no' ? 'host_no_show' : 'complaint', String(req.body?.reason ?? '').trim().slice(0, 2000) || null],
      );
    }
    res.json({ recorded: answer });
  } catch (err) { next(err); }
});

router.post('/booked/:id/rate', async (req, res, next) => {
  try {
    const { household } = await me();
    const { b } = await finishedBooking(req.params.id, household.id);
    const stars = Number(req.body?.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw refuse(400, 'stars', 'One to five stars.');
    const hostStars = req.body?.hostStars == null ? null : Number(req.body.hostStars);
    if (hostStars != null && (!Number.isInteger(hostStars) || hostStars < 1 || hostStars > 5)) throw refuse(400, 'stars', 'One to five stars for the host.');
    const s = await settingsRepo.current();
    const days = Math.ceil((typeof s.review_window === 'number' ? s.review_window : 48) / 24);
    const chips = Array.isArray(req.body?.chips) ? req.body.chips.filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 8) : [];
    const { rows: [r] } = await query(
      `insert into host_reviews (booking_id, offer_id, host_id, household_id, side, stars, host_stars, text, chips, publish_on, by_proxy)
       values ($1, $2, $3, $4, 'guest', $5, $6, $7, $8::jsonb, current_date + $9::int, $10)
       on conflict (booking_id, side) do nothing returning id`,
      [b.id, b.offer_id, b.host_id, household.id, stars, hostStars, String(req.body?.text ?? '').trim().slice(0, 2000) || null, JSON.stringify(chips), days, req.body?.byProxy === true],
    );
    if (!r) throw refuse(409, 'rated', 'You’ve rated this one.');
    await query('update experience_bookings set rated_at = now() where id = $1', [b.id]);
    const h = await repo.hostById(b.host_id);
    await notifications.notify({ householdId: h.household_id, kind: 'new_review', title: `A ${stars}-star review`, link: '/host/reviews', dedupeKey: `review:${r.id}` }).catch(() => null);
    res.status(201).json({ id: r.id });
  } catch (err) { next(err); }
});

/**
 * A tip, on any event, up to seven days after (README "Rules"): the host keeps
 * all of it; the guest pays Epic's admin fee on top. Tips never touch the
 * rating, the fee step or ranking.
 */
router.post('/booked/:id/tip', async (req, res, next) => {
  try {
    const { household } = await me();
    const { b, lastEnd } = await finishedBooking(req.params.id, household.id);
    if (!tipOpen(lastEnd)) throw refuse(409, 'tip_closed', 'Tips close seven days after the event.');
    const amount = Number(req.body?.amountPence);
    if (!Number.isInteger(amount) || amount < 100 || amount > 50_000) throw refuse(400, 'amount', 'A tip is £1 to £500.');
    const s = await settingsRepo.current();
    const fee = tipFee(amount, s);
    if (fee == null) throw refuse(503, 'fees_not_set', 'Tips open once Epic has finished setting its fees.');
    if (!stripe.stripeStatus().ready) throw refuse(503, 'payments_not_open', 'Paying for events opens soon.');
    const { rows: [already] } = await query(`select id from booking_tips where booking_id = $1 and state in ('pending', 'paid')`, [b.id]);
    if (already) throw refuse(409, 'tipped', 'You’ve tipped on this one.');
    const { rows: [t] } = await query(
      `insert into booking_tips (booking_id, offer_id, host_id, household_id, amount_pence, admin_fee_pence) values ($1, $2, $3, $4, $5, $6) returning *`,
      [b.id, b.offer_id, b.host_id, household.id, amount, fee],
    );
    let pi;
    try { pi = await stripe.paymentIntent({ amountPence: amount + fee, bookingId: b.id, offerId: b.offer_id, householdId: household.id, idempotencyKey: `tip-${t.id}`, kind: 'tip', tipId: t.id }); }
    catch (err) {
      // A tip that never reached Stripe is not a tip: the guest may try again (Codex, 2 Oct 2026).
      await query(`update booking_tips set state = 'failed' where id = $1 and stripe_ref is null`, [t.id]);
      throw err;
    }
    await query('update booking_tips set stripe_ref = $2 where id = $1', [t.id, pi.id]);
    res.status(201).json({ tip: { id: t.id, amountPence: amount, feePence: fee, totalPence: amount + fee }, pay: { clientSecret: pi.client_secret ?? null, paymentIntent: pi.id } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Settings › Payments
// ---------------------------------------------------------------------------

router.get('/payments', async (_req, res, next) => {
  try {
    const { household } = await me();
    const { rows } = await query(
      `select p.id, p.kind, p.amount_pence, p.state, p.cause, p.created_at, o.title, p.booking_id
         from hosting_payments p left join host_offers o on o.id = p.offer_id
        where p.household_id = $1 and p.kind in ('charge', 'hold', 'refund', 'release', 'tip', 'private_fee', 'pro')
        order by p.created_at desc limit 300`,
      [household.id],
    );
    res.json({ payments: rows.map((r) => ({ id: r.id, kind: r.kind, pence: r.amount_pence, state: r.state, cause: r.cause, at: r.created_at, title: r.title, bookingId: r.booking_id })), capped: rows.length === 300 });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// an invitation, answered by a household on Epic
// ---------------------------------------------------------------------------

router.post('/invited/:token/book', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const inv = await repo.inviteByToken(req.params.token);
    if (!inv) throw refuse(404, 'not_found', 'That invitation does not open anything.');
    const o = await repo.offerById(inv.offer_id);
    if (!o || !o.lane || o.state !== 'live') throw refuse(404, 'not_yet', 'This invitation is not ready yet.');
    if (inv.booking_id) throw refuse(409, 'answered', 'This invitation is answered already.');
    const rsvp = req.body?.rsvp === 'no' ? 'no' : req.body?.rsvp === 'yes' ? 'yes' : null;
    if (!rsvp) throw refuse(400, 'rsvp_required', 'Coming, or can’t come.');
    if (rsvp === 'no') {
      await query(`update offer_invites set rsvp = 'no', rsvp_heads = 0, answered_at = now(), household_id = $2 where id = $1 and booking_id is null`, [inv.id, household.id]);
      return res.json({ rsvp: 'no' });
    }
    // Coming: the same booking as anyone else's — the host's questions, and payment on a paid private event.
    const r = await book({ offerId: o.id, body: { ...(req.body ?? {}), source: 'invite' }, household, account, invite: inv });
    res.status(201).json({ rsvp: 'yes', ...r });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the host's answer to an Ask to book
// ---------------------------------------------------------------------------

async function myRequest(id, { retryCapture = false } = {}) {
  const household = await currentHousehold();
  const host = await repo.hostByHousehold(household.id);
  if (!host || !UUID.test(String(id))) throw refuse(404, 'not_found', 'That request isn’t yours.');
  const { rows: [b] } = await query(`select * from experience_bookings where id = $1 and host_id = $2`, [id, host.id]);
  if (!b) throw refuse(404, 'not_found', 'That request isn’t yours.');
  // Accepted with the card still only held: the capture failed last time, so it may be tried again (Codex, 2 Oct 2026).
  const retry = retryCapture && b.request_state === 'accepted' && b.payment_state === 'held';
  if (b.request_state !== 'asked' && !retry) throw refuse(409, 'answered', 'This request has been answered.');
  return { host, b, o: await repo.offerById(b.offer_id), retry };
}

router.post('/host/lanes/requests/:id/accept', async (req, res, next) => {
  try {
    const { host, b, o, retry } = await myRequest(req.params.id, { retryCapture: true });
    if (!retry && b.respond_by && new Date(b.respond_by) < new Date()) throw refuse(409, 'lapsed', 'This request has lapsed.');
    // The session is made now, from the slot the guest asked for.
    const sessionId = retry ? b.session_id : await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${o.id}`]);
      const { rows: [again] } = await c.query('select request_state from experience_bookings where id = $1 for update', [b.id]);
      if (again.request_state !== 'asked') throw refuse(409, 'answered', 'This request has been answered.');
      const end = b.requested_time && b.requested_length_min ? (() => { const [h, m] = hm(b.requested_time).split(':').map(Number); const t = h * 60 + m + b.requested_length_min; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; })() : null;
      const { rows: [s] } = await c.query(
        `insert into offer_sessions (offer_id, on_date, starts_at, ends_at, max_count) values ($1, $2, $3, $4, $5) returning id`,
        [o.id, ymd(b.requested_date), hm(b.requested_time), end, b.heads],
      );
      await c.query('insert into booking_sessions (booking_id, session_id) values ($1, $2)', [b.id, s.id]);
      await c.query(`update experience_bookings set request_state = 'accepted', session_id = $2 where id = $1`, [b.id, s.id]);
      await logChange({ subjectKind: 'booking', subjectId: b.id, field: 'request', after: { state: 'accepted' }, byLabel: 'host' }, c);
      return s.id;
    });
    if (b.payment_state === 'held' && b.stripe_payment_intent) {
      // The same idempotency key every time: a retry after a failed or lost answer is the same capture.
      let pi;
      try { pi = await stripe.capturePayment(b.stripe_payment_intent, { householdId: b.household_id, idempotencyKey: `capture-${b.id}` }); }
      catch (err) { throw refuse(502, 'capture_failed', 'Accepted, but the card couldn’t be charged just now. Try Accept again in a moment.'); }
      await applyPaymentIntent(pi);
    } else {
      await query(`update experience_bookings set state = 'confirmed' where id = $1 and state = 'pending'`, [b.id]);
      await confirmed(b, o, host);
    }
    await notifications.notify({ householdId: b.household_id, kind: 'ask_to_book_accepted', title: `${host.name} said yes: ${o.title ?? 'your request'}`, link: guestLink(b.id), dedupeKey: `ask_accepted:${b.id}` }).catch(() => null);
    res.json({ accepted: true, sessionId });
  } catch (err) { next(err); }
});

router.post('/host/lanes/requests/:id/decline', async (req, res, next) => {
  try {
    const { b, o } = await myRequest(req.params.id);
    await declineRequest(b, o, 'declined');
    res.json({ declined: true });
  } catch (err) { next(err); }
});

async function declineRequest(b, o, why) {
  await withTransaction(async (c) => {
    const { rows: [again] } = await c.query('select * from experience_bookings where id = $1 for update', [b.id]);
    if (again.request_state !== 'asked') return;
    await owe(c, again, { amountPence: 0, cause: why, key: `request_${why}:${b.id}`, wholeBooking: true });
    await c.query(`update experience_bookings set request_state = $2, state = 'cancelled', cancelled_by = $3, cancel_cause = $2 where id = $1`, [b.id, why, why === 'lapsed' ? 'epic' : 'host']);
  });
  await notifications.notify({ householdId: b.household_id, kind: 'ask_to_book_declined', title: why === 'lapsed' ? `No answer in time: ${o?.title ?? 'your request'}` : `Not this time: ${o?.title ?? 'your request'}`, body: 'Your card hold is released.', link: o ? `/experiences/${o.id}` : '/trips', dedupeKey: `ask_${why}:${b.id}` }).catch(() => null);
}

/** Requests nobody answered in time lapse: the hold is let go and the guest is told. */
export async function lapseRequests({ now = new Date() } = {}) {
  const { rows } = await query(`select * from experience_bookings where request_state = 'asked' and respond_by is not null and respond_by <= $1 limit 100`, [now]);
  for (const b of rows) await declineRequest(b, await repo.offerById(b.offer_id), 'lapsed');
  return rows.length;
}

/** Paid bookings left unpaid for 30 minutes let their places go. */
export async function dropUnpaid({ now = new Date() } = {}) {
  const { rows } = await query(
    `update experience_bookings set state = 'cancelled', cancelled_by = 'epic', cancel_cause = 'unpaid'
      where state = 'pending' and payment_state = 'none' and request_state is null and value_pence > 0 and created_at < $1 - interval '30 minutes'
      returning id`,
    [now],
  );
  if (rows.length) await query(`update booking_sessions set state = 'cancelled' where booking_id = any($1::uuid[])`, [rows.map((r) => r.id)]);
  return rows.length;
}

/** The day before: a reminder. The morning after: did it happen, rate it, tip. Once each. */
export async function guestPrompts({ now = new Date() } = {}) {
  const { rows } = await query(
    `select b.id, b.household_id, o.title, o.time_zone, s.id as session_id, s.on_date, s.starts_at, s.ends_at, s.ends_on
       from booking_sessions bs join experience_bookings b on b.id = bs.booking_id join offer_sessions s on s.id = bs.session_id join host_offers o on o.id = b.offer_id
      where bs.state = 'booked' and b.state in ('confirmed', 'attended') and s.state in ('scheduled', 'done')
        and s.on_date between current_date - 2 and current_date + 2`,
  );
  let sent = 0;
  for (const r of rows) {
    const o = { time_zone: r.time_zone };
    const start = startOf(r, o);
    const end = endOf(r, o);
    const hours = (start - now) / 3_600_000;
    if (hours > 0 && hours <= 24) {
      const n = await notifications.notify({ householdId: r.household_id, kind: 'reminder_24h', title: `Tomorrow: ${r.title ?? 'your event'}`, link: guestLink(r.id), dedupeKey: `reminder:${r.id}:${r.session_id}` }).catch(() => null);
      if (n) sent += 1;
    }
    // "The next morning": from 08:00 UK time on the day after it ended.
    const morning = localInstant(plusDays(localDay(end, r.time_zone ?? 'Europe/London'), 1), '08:00', r.time_zone ?? 'Europe/London');
    if (now >= morning && now - morning < 2 * 86_400_000) {
      const n = await notifications.notify({ householdId: r.household_id, kind: 'after_event', title: `How was ${r.title ?? 'it'}?`, body: 'Did it happen, a rating, and a tip if you like.', link: guestLink(r.id), dedupeKey: `after:${r.id}` }).catch(() => null);
      if (n) sent += 1;
    }
  }
  return sent;
}

export default router;
