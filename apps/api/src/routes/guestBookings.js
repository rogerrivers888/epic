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
 *   POST   /api/booked/:id/tip/payment            Stripe said yes to the tip: read it back
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
import * as problems from '../repositories/paymentProblems.js';
import * as settingsRepo from '../repositories/hostingSettings.js';
import * as ledger from '../repositories/hostingLedger.js';
import * as notifications from '../repositories/notifications.js';
import * as stripe from '../sources/stripe.js';
import { logChange } from '../repositories/hostingSettings.js';
import { currentAccount } from '../context.js';
import { householdOnPublicPath } from '../auth.js';
import { currentHousehold } from './household.js';
import { owe, shareOf, movedSinceBooking, chargeBasis, refreshChargeDue } from '../sources/bookingMoney.js';
import { feeFor, priceBooking, tipFee, numbersSettlement } from '../domain/money.js';
import { mainAction, placesLeft, sessionsForBooking, KINDS_BY_LANE, checkParty, childAge, cancelQuote, answersEditable, tipOpen, guestChip } from '../domain/booking.js';
import { localInstant, localDay, plusDays, slotsFor, bookableDay, dow, perPersonAt, refundWords, hostingConfig } from '../domain/lanes.js';
import { mediaRef } from './hosting.js';
import { opensPrivately } from '../domain/hosting.js';

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
// The app's booking page (routes.ts `paths.booking`) (Codex, 2 Oct 2026).
const guestLink = (id) => `/bookings/${id}`;
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
/**
 * The ways a weekly event can be booked, from what the host priced (Codex, 3 Oct 2026): free, both; paid, only
 * the kinds with a price — a book-ahead-only class never offers a drop in, which would otherwise price at nothing.
 * An older offer with only its one price takes it for both. Every other lane: KINDS_BY_LANE.
 */
export function kindsFor(o) {
  if (o.lane !== 'weekly') return KINDS_BY_LANE[o.lane] ?? [];
  if (o.price_mode === 'free' || !o.price_mode || o.price_mode === 'by_numbers') return KINDS_BY_LANE.weekly;
  if (o.drop_in_pence == null && o.book_ahead_pence == null) return o.price_pence != null ? KINDS_BY_LANE.weekly : [];
  return KINDS_BY_LANE.weekly.filter((k) => (k === 'drop_in' ? o.drop_in_pence != null : o.book_ahead_pence != null));
}

/** A weekly session's price by kind: its own price, or the offer's one price on an older offer; never nought by default. */
const weeklyEach = (o, kind) => (kind === 'book_ahead' ? o.book_ahead_pence : o.drop_in_pence) ?? (o.drop_in_pence == null && o.book_ahead_pence == null ? o.price_pence : null);

function priceFor(o, kind, party, sessionCount) {
  if (o.price_mode === 'free' || !o.price_mode) return { lines: [], grossPence: 0, discountPence: 0, valuePence: 0 };
  if (o.price_mode === 'by_numbers') {
    const each = perPersonAt(o.total_pence ?? 0, o.min_count ?? 1) ?? 0;
    const heads = party.adults + party.children;
    return { lines: [{ label: 'Each, at the minimum numbers', each, count: heads, pence: each * heads }], grossPence: each * heads, discountPence: 0, valuePence: each * heads };
  }
  if (o.lane === 'weekly') {
    const each = weeklyEach(o, kind);
    if (each == null) throw refuse(409, 'kind_closed', 'That way of booking isn’t open on this one.');
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
  // The intro's places are counted as they are promised, not only once confirmed: a booking still paying already holds one (Codex, 2 Oct 2026).
  // …and a place used stays used, cancelled or not; only a booking that never got as far as paying gives it back (Codex, 2 Oct 2026).
  const { rows: [n] } = await q(
    `select count(*)::int as n from experience_bookings
      where host_id = $1 and (intro_ordinal is not null or (fee_reason = 'intro' and coalesce(cancel_cause, '') not in ('unpaid', 'payment_setup_failed', 'payment_failed')))`,
    [host.id],
  );
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

/** GET /api/payments/config — what a guest's browser needs to pay: Stripe's publishable key, or why it can't yet. */
publicRouter.get('/payments/config', (_req, res) => {
  const s = stripe.stripeStatus();
  // Card payment is switched on by the Stripe integration work, not here: off until EPIC_GUEST_CARD_PAYMENTS=on,
  // whatever keys are in Doppler (owner, 3 Oct 2026). The publishable key is read here; sources/stripe.js is theirs.
  const on = String(process.env.EPIC_GUEST_CARD_PAYMENTS ?? '').trim().toLowerCase() === 'on';
  const k = String(process.env.STRIPE_PUBLISHABLE_KEY ?? '').trim();
  const key = on && s.mode === 'test' && /^pk_test_/.test(k) ? k : null;
  res.json({ ready: Boolean(s.ready && key), mode: s.mode, publishableKey: key, note: s.ready && !key ? 'Card payments are not switched on yet.' : s.note });
});

publicRouter.get('/experiences/:id/booking/options', async (req, res, next) => {
  try {
    const e = await eventWithSessions(req.params.id);
    if (!e || ['draft', 'in_review', 'approved'].includes(e.offer.state)) throw refuse(404, 'not_found', 'That event isn’t open.');
    // A private event opens only with its link or an invitation, as its page does (Codex, 2 Oct 2026).
    if (e.offer.visibility !== 'public') {
      const invite = typeof req.query.i === 'string' ? await repo.inviteByToken(req.query.i.slice(0, 64)) : null;
      if (!opensPrivately(e.offer, { linkToken: typeof req.query.l === 'string' ? req.query.l.slice(0, 64) : null, invite, hasBooking: await repo.holdsBooking(e.offer.id, await householdOnPublicPath(req)) })) throw refuse(404, 'not_found', 'This one is invitation only.');
    }
    const { offer: o, host } = e;
    const now = new Date();
    const s = await settingsRepo.current();
    // A place offered to this household from the waiting list is theirs to take: not counted against them, and Book
    // is the action until it lapses (Codex, 3 Oct 2026).
    const asker = await householdOnPublicPath(req);
    const { rows: mineOffered } = asker ? await query(
      `select session_id, party, offer_expires_at from offer_waitlist where offer_id = $1 and household_id = $2 and state = 'offered' and offer_expires_at > now()
        order by offer_expires_at, session_id`,
      [o.id, asker],
    ) : { rows: [] };
    const sessions = e.sessions.map((x) => ({ ...x, reserved: Math.max(0, x.reserved - mineOffered.filter((w) => w.session_id == null || w.session_id === x.id).reduce((n, w) => n + w.party, 0)) }));
    const next = ahead(sessions, o, now);
    // Weekly sessions are booked one by one: it is full only when every session is (Codex, 2 Oct 2026).
    const lefts = next.map((x) => (placesLeft(x, o) ?? Infinity) - x.reserved);
    // Weekly: open while any session the guest can book has room — only this week's when drop in is the only way (Codex, 3 Oct 2026).
    const weeklyKinds = o.lane === 'weekly' ? kindsFor(o) : [];
    const left = !next.length ? null : o.lane !== 'weekly' ? Math.min(...lefts) : weeklyKinds.includes('book_ahead') ? Math.max(...lefts) : lefts[0];
    const cfg = hostingConfig();
    const slots = [];
    if (o.lane === 'onrequest') {
      const notice = o.notice_hours ?? cfg.onRequest.noticeHours;
      for (let i = 0; i < 42 && slots.length < 28; i += 1) {
        const day = plusDays(localDay(now, tzOf(o)), i);
        if (!bookableDay(day, o.free_hours ?? {}, { now, noticeHours: notice })) continue;
        const lengths = o.session_lengths?.length ? o.session_lengths : [o.duration_min ?? 60];
        // A time already gone, or inside the notice, is not offered.
        const open = (len) => slotsFor(o.free_hours ?? {}, dow(day), len).filter((t) => localInstant(day, t, tzOf(o)).getTime() - now.getTime() >= notice * 3_600_000);
        const times = open(Math.min(...lengths));
        // The start times each length fits, so a longer session never offers a start it would overrun (Codex, 3 Oct 2026).
        if (times.length) slots.push({ date: day, times, lengths, timesBy: Object.fromEntries(lengths.map((l) => [l, open(l)])) });
      }
    }
    res.json({
      action: mainAction({ offer: o, sessionsAhead: next, hostPaused: Boolean(host?.paused || host?.stopped_at), placesLeft: Number.isFinite(left) ? left : null }),
      lane: o.lane, kinds: kindsFor(o),
      sessions: next.map((x) => ({ id: x.id, n: x.n, date: ymd(x.on_date), time: hm(x.starts_at), placesLeft: placesLeft(x, o) == null ? null : Math.max(0, placesLeft(x, o) - x.reserved), topic: x.topic })),
      slots,
      price: {
        mode: o.price_mode ?? 'free', pence: o.price_pence, childPence: o.child_pence, per: o.per, dropInPence: o.drop_in_pence, bookAheadPence: o.book_ahead_pence,
        totalPence: o.total_pence, nowEach: o.price_mode === 'by_numbers' ? perPersonAt(o.total_pence ?? 0, o.min_count ?? 1) : null,
        groups: { dropIn: o.drop_in_group_pct ? { pct: o.drop_in_group_pct, min: o.drop_in_group_min } : null, bookAhead: o.book_ahead_group_pct ? { pct: o.book_ahead_group_pct, min: o.book_ahead_group_min } : null },
        throughEpic: paidThroughEpic(o),
        // Paid on the day (L10): said before they say they're coming — the organiser is paid, not Epic, and Epic's
        // refund policy and guarantee don't cover it.
        payOnTheDay: o.money === 'direct' && o.price_mode && o.price_mode !== 'free'
          ? { words: 'You pay the organiser on the day. This isn’t covered by Epic’s refund policy or satisfaction guarantee.' } : null,
      },
      who: { ageMin: o.age_min, ageMax: o.age_max, partyMax: o.party_max, dropOff: o.parents === 'drop_off', adultsOnly: o.age_min != null && o.age_min >= cfg.adultAge },
      questions: o.guest_questions ?? {},
      refundWords: o.refund_policy && paidThroughEpic(o) ? refundWords(o.refund_policy, cfg) : null,
      waitlist: { on: o.waitlist_on === true, offerHours: typeof s.waitlist_offer === 'number' ? s.waitlist_offer : null, offeredUntil: mineOffered[0]?.offer_expires_at ?? null, offeredParty: mineOffered[0]?.party ?? null, offeredSession: mineOffered[0]?.session_id ?? null },
      askWindowHours: o.lane === 'onrequest' ? (typeof s.ask_to_book_window === 'number' ? s.ask_to_book_window : null) : null,
    });
  } catch (err) { next(err); }
});

/** Parse the When part of a booking: its kind, sessions or slot. */
function parseWhen(o, sessionsAhead, body) {
  const kind = body?.kind;
  if (!kindsFor(o).includes(kind)) throw refuse(400, 'bad_kind', 'Pick when.');
  if (kind === 'request') {
    const date = String(body?.date ?? '');
    const time = String(body?.time ?? '');
    const length = Number(body?.lengthMin ?? o.duration_min ?? 60);
    // A real day and a real time, or no slot (Codex, 2 Oct 2026).
    const realDay = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
    if (!realDay || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw refuse(400, 'bad_slot', 'Pick a day and a time.');
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

const realPastDate = (v) => {
  const t = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t && d <= new Date() ? t : null;
};

function parseParty(body) {
  const kids = Array.isArray(body?.children) ? body.children.slice(0, 20) : [];
  return {
    adults: Math.max(0, Math.min(50, Math.floor(Number(body?.adults) || 0))),
    children: kids.map((k) => ({
      name: k?.name == null ? null : String(k.name).trim().slice(0, 60) || null,
      age: k?.age == null || k.age === '' ? null : Number(k.age),
      // A real calendar day, not in the future; anything else is no date (Codex, 2 Oct 2026).
      dob: realPastDate(k?.dob),
      needs: Array.isArray(k?.needs) ? k.needs.filter((x) => typeof x === 'string').map((x) => x.slice(0, 60)).slice(0, 10) : [],
      emergencyContact: k?.emergencyContact == null ? null : String(k.emergencyContact).trim().slice(0, 20),
    })),
    adultConfirmed: body?.adultConfirmed === true,
  };
}

router.post('/experiences/:id/booking/quote', async (req, res, next) => {
  try {
    const e = await eventWithSessions(req.params.id);
    // Priced only for an event that is open to this caller — live, and for a private one its link or invitation (Codex, 2 Oct 2026).
    if (!e || e.offer.state !== 'live') throw refuse(404, 'not_found', 'That event isn’t open.');
    if (e.offer.visibility !== 'public') {
      const invite = typeof req.body?.inviteToken === 'string' ? await repo.inviteByToken(req.body.inviteToken.slice(0, 64)) : null;
      if (!opensPrivately(e.offer, { linkToken: typeof req.body?.linkToken === 'string' ? req.body.linkToken.slice(0, 64) : null, invite, hasBooking: await repo.holdsBooking(e.offer.id, currentAccount()?.household_id) })) throw refuse(404, 'not_found', 'This one is invitation only.');
    }
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
      // One booking at a time per host too, so two of their events can't both take the last intro place (Codex, 2 Oct 2026).
      if (e) {
        await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-intro:${e.offer.host_id}`]);
        // Read again under the lock a stop takes: a host who stopped a moment ago takes no booking (Codex, 2 Oct 2026).
        const { rows: [fresh] } = await c.query('select paused, stopped_at from hosts where id = $1', [e.offer.host_id]);
        if (fresh?.paused || fresh?.stopped_at) throw refuse(409, 'host_paused', 'This host isn’t taking new bookings just now.');
        const { rows: [st] } = await c.query('select state from host_offers where id = $1', [offerId]);
        if (st?.state !== 'live') throw refuse(404, 'not_open', 'That event isn’t open for booking.');
      }
      if (!e || e.offer.state !== 'live') throw refuse(404, 'not_open', 'That event isn’t open for booking.');
      const { offer: o, sessions, host } = e;
      if (host.paused || host.stopped_at) throw refuse(409, 'host_paused', 'This host isn’t taking new bookings just now.');
      // A private event is booked only with its link, an invitation, or a booking already held (Codex, 2 Oct 2026).
      const linkToken = typeof body.linkToken === 'string' ? body.linkToken.slice(0, 64) : null;
      if (o.visibility !== 'public') {
        const inv = invite ?? (typeof body.inviteToken === 'string' ? await repo.inviteByToken(body.inviteToken.slice(0, 64), c) : null);
        // A place offered from the waiting list is its own way in (Codex, 2 Oct 2026).
        const { rows: [held] } = await c.query(
          `select 1 from experience_bookings where offer_id = $1 and household_id = $2 and state <> 'cancelled'
           union all select 1 from offer_waitlist where offer_id = $1 and household_id = $2 and state = 'offered' and offer_expires_at > now() limit 1`,
          [o.id, household.id],
        );
        if (!opensPrivately(o, { linkToken, invite: inv, hasBooking: Boolean(held) })) throw refuse(404, 'not_found', 'This one is invitation only.');
      }
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
          `select count(*)::int as n from experience_bookings where offer_id = $1 and request_state in ('asked', 'accepted') and state in ('pending', 'confirmed', 'attended') and requested_date >= $2 and requested_date < $3`,
          [o.id, weekStart, plusDays(weekStart, 7)],
        );
        const cap = o.per_week_max ?? hostingConfig().onRequest.perWeek;
        if (wk.n >= cap) throw refuse(409, 'week_full', 'The host has no more room that week.');
      }
      const price = priceFor(o, when.kind, { adults: check.adults, children: check.children }, when.sessionIds.length);
      const paid = price.valuePence > 0 && paidThroughEpic(o);
      if (paid && !stripe.stripeStatus().ready) throw refuse(503, 'payments_not_open', 'Paying for events opens soon.');
      // L1: the guest's money goes into the host's own Stripe account, so a paid booking needs one that can take it.
      if (paid && !hostCanBeCharged(host)) throw refuse(409, 'host_not_ready', 'This host can’t take payments just now.');
      // The host-link rate only with the host's own token, or the event's own link — never because the request says so (Codex, 2 Oct 2026).
      const hostLink = typeof body.hostLink === 'string' ? body.hostLink.slice(0, 64) : null;
      const viaHostLink = Boolean((hostLink && host.link_token && hostLink === host.link_token) || (linkToken && o.link_token && linkToken === o.link_token));
      const fee = paid ? await feeOn(o, host, price.valuePence, viaHostLink, s, c) : { ratePct: 0, reason: 'free', feePence: 0, hostPence: price.valuePence };
      if (fee.reason === 'not_set') throw refuse(503, 'fees_not_set', 'Booking opens once Epic has finished setting its fees.');
      const asked = when.kind === 'request';
      const askHours = typeof s.ask_to_book_window === 'number' ? s.ask_to_book_window : 24;
      const policy = paid ? o.refund_policy : null;
      const { rows: [b] } = await c.query(
        `insert into experience_bookings
           (offer_id, host_id, household_id, heads, party, state, amount_pence, booking_kind, request_state, respond_by,
            requested_date, requested_time, requested_length_min, payment_state, refund_policy, refund_terms, answers, adult_confirmed,
            source, via_host_link, price_lines, gross_pence, discount_pence, value_pence, fee_rate_pct, fee_reason, fee_pence, host_pence, charge_model, cancellation_fee_pct)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,'none',$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28,$29)
         returning *`,
        [o.id, host.id, household.id, check.heads, JSON.stringify([...Array(check.adults)].map(() => ({ child: false })).concat(party.children.map((k) => ({ name: k.name, child: true })))),
          paid || asked ? 'pending' : 'confirmed', price.valuePence, when.kind, asked ? 'asked' : null, asked ? new Date(Date.now() + askHours * 3_600_000) : null,
          when.slot?.date ?? null, when.slot?.time ?? null, when.slot?.length ?? null,
          policy, JSON.stringify(policy ? s.refund_terms?.[policy] ?? null : null), JSON.stringify(cleanAnswers(body.answers, o.guest_questions)), party.adultConfirmed,
          invite ? 'invite' : viaHostLink ? 'link' : ['search', 'profile', 'collection', 'web'].includes(body.source) ? body.source : 'search', viaHostLink,
          JSON.stringify(price.lines), price.grossPence, price.discountPence, price.valuePence, fee.ratePct, fee.reason, fee.feePence, fee.hostPence,
          paid ? 'destination' : null,
          // The cancellation fee agreed now, with the refund terms (L5): later changes never reach this booking.
          paid && typeof s.cancellation_fee_pct === 'number' ? s.cancellation_fee_pct : null],
      );
      for (const id of when.sessionIds) await c.query('insert into booking_sessions (booking_id, session_id) values ($1, $2)', [b.id, id]);
      // Far ahead (L4): the card is saved now and charged later, so no charge waits more than 90 days for its payout.
      const dueAt = paid ? laterChargeDue({ start: first ? startOf(first, o) : when.slot ? localInstant(when.slot.date, when.slot.time ?? '00:00', tzOf(o)) : null, decidesAt: first?.decides_at ?? null }) : null;
      if (dueAt) { await c.query('update experience_bookings set charge_due_at = $2 where id = $1', [b.id, dueAt]); b.charge_due_at = dueAt; }
      // A one-session booking names its session too, so each weekly session is its own rated event on the fee ladder (Codex, 2 Oct 2026).
      if (when.sessionIds.length === 1) await c.query('update experience_bookings set session_id = $2 where id = $1', [b.id, when.sessionIds[0]]);
      for (const k of party.children) {
        await c.query('insert into booking_children (booking_id, name, age, date_of_birth, needs, emergency_contact) values ($1, $2, $3, $4, $5::jsonb, $6)',
          [b.id, k.name, k.dob ? null : childAge(k), k.dob, JSON.stringify(k.needs), k.emergencyContact]);
      }
      // Only the offers this booking uses: a household's offer on another session stays theirs (Codex, 2 Oct 2026).
      const used = mine.filter((w) => w.session_id == null || when.sessionIds.includes(w.session_id));
      if (used.length) await c.query(`update offer_waitlist set state = 'taken' where id = any($1::uuid[])`, [used.map((w) => w.id)]);
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
    if (b.charge_due_at) return saveCardForLater({ b, o, host, asked, account, invite });
    let pi;
    try {
      pi = await stripe.paymentIntent({
        amountPence: b.value_pence, destination: host.stripe_account_id, applicationFeePence: b.fee_pence ?? 0, hostName: host.name,
        bookingId: b.id, offerId: o.id, householdId: b.household_id, hold: asked, email: account?.email ?? null, idempotencyKey: `booking-${b.id}`,
      });
    } catch (err) {
      // Stripe said no or couldn't be reached: the places go back at once rather than waiting on a payment that can't start (Codex, 2 Oct 2026).
      await query(`update experience_bookings set state = 'cancelled', cancelled_by = 'epic', cancel_cause = 'payment_setup_failed' where id = $1 and state = 'pending'`, [b.id]);
      await query(`update booking_sessions set state = 'cancelled' where booking_id = $1`, [b.id]);
      if (invite) await query(`update offer_invites set rsvp = null, rsvp_heads = null, booking_id = null where id = $1 and booking_id = $2`, [invite.id, b.id]);
      // The waiting-list place this booking took is theirs again while its offer lasts — that one, not another (Codex, 2 Oct 2026).
      await restoreWaitlist(b.id);
      throw err;
    }
    await query('update experience_bookings set stripe_payment_intent = $2 where id = $1 and stripe_payment_intent is null', [b.id, pi.id]);
    await ledger.record({ kind: asked ? 'hold' : 'charge', bookingId: b.id, offerId: o.id, hostId: host.id, householdId: b.household_id, amountPence: b.value_pence, epicPence: b.fee_pence, hostPence: b.host_pence, bookingValuePence: b.value_pence, ratePct: b.fee_rate_pct, state: 'pending', stripeRef: pi.id, mode: 'test', reason: b.fee_reason });
    return { booking: { id: b.id, state: 'pending_payment' }, pay: { clientSecret: pi.client_secret ?? null, paymentIntent: pi.id, amountPence: b.value_pence, hold: asked } };
}

/**
 * Give back the waiting-list offer a booking used, and only that one: the row for one of the booking's own
 * sessions, or the whole-event row (Codex, 2 Oct 2026). Only while the offer still runs.
 */
async function restoreWaitlist(bookingId) {
  await query(
    `update offer_waitlist w set state = 'offered'
       from experience_bookings b
      where b.id = $1 and w.offer_id = b.offer_id and w.household_id = b.household_id and w.state = 'taken' and w.offer_expires_at > now()
        and (w.session_id is null or w.session_id in (select session_id from booking_sessions where booking_id = b.id))`,
    [bookingId],
  );
}

/**
 * Can a guest's card be charged to this host's account (L1)? An account made
 * the L1 way, that Stripe says can take card payments and pay out, on manual
 * payouts. An account from before
 * this build took money on Epic's balance and is never charged to again.
 */
// Payouts on, and manual: on any other schedule Stripe could pay the balance out before Epic's release checks ran
// (L3), and with payouts off the money could not reach the host at all (Codex, 3 Oct 2026).
export const hostCanBeCharged = (h) => Boolean(h?.stripe_account_id && h.stripe_account_model === 'v2' && h.stripe_charges_enabled
  && h.stripe_payouts_enabled && h.stripe_payouts_manual);

/** A booking is on: the guest and the host are told. */
async function confirmed(b, o, host) {
  const own = await notifications.hostWords(host.id, 'confirmed');
  await notifications.notify({ householdId: b.household_id, kind: 'booking_confirmed', title: `You’re booked: ${o.title ?? 'your event'}`, body: ['It’s in your Plans.', own].filter(Boolean).join('\n\n'), link: guestLink(b.id), dedupeKey: `confirmed:${b.id}` }).catch(() => null);
  await notifications.notify({ householdId: host.household_id, kind: 'new_booking', title: `New booking: ${o.title ?? 'your event'}`, body: `${b.heads} ${b.heads === 1 ? 'person' : 'people'}`, link: hostLink(o.id), dedupeKey: `new_booking:${b.id}` }).catch(() => null);
}

/**
 * What Stripe says about a booking's PaymentIntent, applied once: charged →
 * confirmed and on the ledger; held (Ask to book) → the host is asked;
 * failed → the place is let go. The webhook and the return trip both land here.
 */
/**
 * When a booking's money is taken, if not now (register L4): 80 days before it starts, or at the decides-by date if
 * that is earlier — but only when that is more than two days off; nearer than that it is simply charged now. Null:
 * charge now.
 */
export const LATER_DAYS = 80;
export function laterChargeDue({ start, decidesAt = null, now = new Date() }) {
  if (!start) return null;
  const eighty = new Date(new Date(start).getTime() - LATER_DAYS * 86_400_000);
  const due = decidesAt && new Date(decidesAt) < eighty ? new Date(decidesAt) : eighty;
  return due.getTime() - now.getTime() > 2 * 86_400_000 ? due : null;
}

/**
 * The booking far ahead: the household's card saved through a SetupIntent (on Epic's own account, for the host as
 * merchant), nothing charged. The guest's browser confirms it as it would a payment; Stripe's event (or the
 * read-back) then confirms the booking with the card saved.
 */
async function saveCardForLater({ b, o, host, asked, account, invite }) {
  let si;
  try {
    const { ensureCustomer } = await import('../sources/membership.js');
    const customerId = await ensureCustomer({ householdId: b.household_id, email: account?.email ?? null, name: account?.name ?? null });
    si = await stripe.setupIntent({ customerId, destination: host.stripe_account_id, bookingId: b.id, offerId: o.id, householdId: b.household_id });
  } catch (err) {
    // As for a payment that can't start: the places go back at once.
    await query(`update experience_bookings set state = 'cancelled', cancelled_by = 'epic', cancel_cause = 'payment_setup_failed' where id = $1 and state = 'pending'`, [b.id]);
    await query(`update booking_sessions set state = 'cancelled' where booking_id = $1`, [b.id]);
    if (invite) await query(`update offer_invites set rsvp = null, rsvp_heads = null, booking_id = null where id = $1 and booking_id = $2`, [invite.id, b.id]);
    await restoreWaitlist(b.id);
    throw err;
  }
  await query('update experience_bookings set stripe_setup_intent = $2 where id = $1 and stripe_setup_intent is null', [b.id, si.id]);
  return { booking: { id: b.id, state: 'pending_payment' }, pay: { clientSecret: si.client_secret ?? null, setupIntent: si.id, amountPence: b.value_pence, hold: asked, later: { chargeOn: b.charge_due_at } } };
}

/**
 * The card saved, or not (Stripe's event or the read-back; never the browser's word). Saved: the place is the
 * guest's, nothing charged — or, asked to book, the host is asked. Refused: the places go back, as a payment's do.
 */
export async function applySetupIntent(si) {
  const bookingId = si?.metadata?.epic_booking_id;
  if (si?.metadata?.epic_kind !== 'booking_later' || !bookingId || !UUID.test(bookingId)) return null;
  await query('update experience_bookings set stripe_setup_intent = $2 where id = $1 and stripe_setup_intent is null', [bookingId, si.id]);
  const { rows: [b] } = await query('select * from experience_bookings where id = $1 and stripe_setup_intent = $2', [bookingId, si.id]);
  if (!b) return null;
  if (si.status === 'succeeded') {
    const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id ?? null;
    const outcome = await withTransaction(async (c) => {
      const { rows: [now] } = await c.query('select * from experience_bookings where id = $1 for update', [b.id]);
      if (!now || now.payment_state !== 'none' || !pm) return null;
      const { rows: [saved] } = await c.query(
        `update experience_bookings set payment_state = 'card_saved', saved_payment_method = $2,
                state = case when state = 'pending' and request_state is null then 'confirmed' else state end
          where id = $1 returning *`, [b.id, pm]);
      await logChange({ subjectKind: 'booking', subjectId: b.id, field: 'card_saved', after: { chargeOn: saved.charge_due_at }, byLabel: 'stripe' }, c);
      return saved.state === 'cancelled' ? null : saved.request_state === 'asked' ? 'asked' : 'confirmed';
    });
    const o = await repo.offerById(b.offer_id);
    const host = await repo.hostById(b.host_id);
    if (outcome === 'confirmed') await confirmed(b, o, host);
    if (outcome === 'asked') await notifications.notify({ householdId: host.household_id, kind: 'ask_to_book_request', title: `Ask to book: ${o?.title ?? 'your offer'}`, link: hostLink(b.offer_id), dedupeKey: `ask:${b.id}` }).catch(() => null);
    return b.id;
  }
  if (b.payment_state === 'none' && (si.status === 'canceled' || (si.status === 'requires_payment_method' && si.last_setup_error))) {
    const e = si.last_setup_error ?? {};
    if (si.last_setup_error) {
      await problems.record({ kind: e.decline_code === 'fraudulent' ? 'blocked_fraud' : 'payment_failed', dedupeKey: `setup_failed:${si.id}`, amountPence: b.value_pence, bookingId: b.id, householdId: b.household_id, hostId: b.host_id, offerId: b.offer_id, stripeRef: si.id, detail: { for: 'card_saved', code: e.code ?? null, declineCode: e.decline_code ?? null } });
    }
    await query(`update experience_bookings set payment_state = 'failed', state = 'cancelled', cancelled_by = 'epic', cancel_cause = 'payment_failed' where id = $1 and payment_state = 'none'`, [b.id]);
    await query(`update booking_sessions set state = 'cancelled' where booking_id = $1`, [b.id]);
    await query(`update offer_invites set rsvp = null, rsvp_heads = null, booking_id = null where booking_id = $1`, [b.id]);
    await restoreWaitlist(b.id);
  }
  return b.id;
}

/**
 * A payment that went wrong, in the payment problems log: blocked as fraud when Stripe's screening (Radar) or the
 * bank called it fraudulent, otherwise failed — with the bank's own code, never its message to the guest.
 */
export async function recordFailedPayment(pi, { bookingId = null, householdId = null, hostId = null, offerId = null, kind = 'booking' } = {}) {
  const e = pi?.last_payment_error ?? {};
  const charge = typeof pi?.latest_charge === 'object' ? pi.latest_charge : null;
  const fraud = e.decline_code === 'fraudulent' || charge?.outcome?.type === 'blocked';
  await problems.record({
    kind: fraud ? 'blocked_fraud' : 'payment_failed', dedupeKey: `${fraud ? 'blocked_fraud' : 'payment_failed'}:${pi.id}`,
    amountPence: pi.amount ?? null, bookingId, householdId, hostId, offerId, stripeRef: pi.id,
    detail: { for: kind, code: e.code ?? null, declineCode: e.decline_code ?? null, outcome: charge?.outcome?.type ?? null, reason: charge?.outcome?.reason ?? null },
  });
}

export async function applyPaymentIntent(pi) {
  const bookingId = pi?.metadata?.epic_booking_id;
  if (pi?.metadata?.epic_kind === 'tip') return applyTipIntent(pi);
  if (pi?.metadata?.epic_kind === 'party_change') return applyPartyIntent(pi);
  if (!bookingId || !UUID.test(bookingId)) return null;
  // The PaymentIntent was read back from Stripe, so its metadata is Stripe's word. Stripe can answer before our own
  // write of the intent's id has landed: a booking with no intent yet takes this one (Codex, 2 Oct 2026).
  await query('update experience_bookings set stripe_payment_intent = $2 where id = $1 and stripe_payment_intent is null', [bookingId, pi.id]);
  const { rows: [b] } = await query('select * from experience_bookings where id = $1 and stripe_payment_intent = $2', [bookingId, pi.id]);
  if (!b) return null;
  const o = await repo.offerById(b.offer_id);
  const host = await repo.hostById(b.host_id);
  // Paid: decided under the booking's own row lock, so a cancellation at the same moment can't slip between the
  // read and the write (Codex, 2 Oct 2026). Paid after the booking had been let go (unpaid too long, cancelled,
  // set-up failed): the money goes straight back, and nobody is told it is on.
  if (pi.status === 'succeeded') {
    const outcome = await withTransaction(async (c) => {
      const { rows: [now] } = await c.query('select * from experience_bookings where id = $1 for update', [b.id]);
      if (!now || !['none', 'held', 'failed', 'card_saved', 'charge_failed'].includes(now.payment_state)) return null;
      const later = ['card_saved', 'charge_failed'].includes(now.payment_state);
      // A later charge (L4) of less than the booking's value (a part cancelled before it): the fee and the host's part
      // follow what was charged, once it is — so a refund later splits it in the right proportions.
      const { rows: [charged] } = await c.query(
        `update experience_bookings set payment_state = 'charged', charged_pence = $2::int,
                fee_pence = case when $3::boolean and value_pence > 0 then round(fee_pence::numeric * $2::int / value_pence)::int else fee_pence end,
                host_pence = case when $3::boolean and value_pence > 0 then $2::int - round(fee_pence::numeric * $2::int / value_pence)::int else host_pence end,
                state = case when state = 'pending' then 'confirmed' else state end,
                request_state = case when request_state = 'asked' and state <> 'cancelled' then 'accepted' else request_state end
          where id = $1 returning *`,
        [b.id, pi.amount_received ?? b.value_pence, later],
      );
      const { rowCount: ledgered } = await c.query(`update hosting_payments set state = 'succeeded', kind = 'charge', updated_at = now() where stripe_ref = $1 and kind in ('charge', 'hold')`, [pi.id]);
      // Stripe answered before our own ledger row was written: write it now, already succeeded; the later write is then a no-op (Codex, 2 Oct 2026).
      if (!ledgered) await ledger.record({ kind: 'charge', bookingId: charged.id, offerId: charged.offer_id, hostId: charged.host_id, householdId: charged.household_id, amountPence: charged.charged_pence, epicPence: charged.fee_pence, hostPence: charged.host_pence, bookingValuePence: charged.value_pence, ratePct: charged.fee_rate_pct, state: 'succeeded', stripeRef: pi.id, mode: 'test', reason: charged.fee_reason }, c);
      if (charged.state === 'cancelled') {
        await owe(c, charged, { amountPence: charged.charged_pence, cause: 'paid_after_cancel', key: `paid_after_cancel:${b.id}`, wholeBooking: true, triggeredBy: 'epic' });
        return 'refunded';
      }
      // A part cancelled while the later charge was on its way (Codex, 3 Oct 2026): it was charged for, so it comes
      // back now — what is due is the value less everything taken off, never what the charge carried.
      if (later) {
        const due = Math.max(0, Number(charged.value_pence ?? 0) - Number(charged.later_off_pence ?? 0));
        const over = Number(charged.charged_pence) - due;
        if (over > 0) await owe(c, charged, { amountPence: over, cause: 'guest_cancelled', key: `later_adjust:${b.id}:${pi.id}`, triggeredBy: 'guest' });
      }
      // The later charge of a booking already confirmed when its card was saved: nobody is told it is on again.
      return later ? 'later' : 'confirmed';
    });
    if (outcome === 'confirmed') await confirmed(b, o, host);
    // Paid after the card had been refused: that problem is put right.
    if (outcome === 'later') await problems.resolve({ dedupeKey: `later_charge_failed:${b.id}`, resolution: 'Paid', by: 'guest' });
    return b.id;
  }
  if (pi.status === 'requires_capture') {
    // Held: under the row lock too. A request cancelled before the hold landed lets the card go through the refund
    // queue, which retries until Stripe has; otherwise the host is asked (Codex, 2 Oct 2026).
    const outcome = await withTransaction(async (c) => {
      const { rows: [now] } = await c.query('select * from experience_bookings where id = $1 for update', [b.id]);
      if (!now || now.payment_state !== 'none') return null;
      const { rows: [held] } = await c.query(`update experience_bookings set payment_state = 'held', held_pence = $2 where id = $1 returning *`, [b.id, pi.amount_capturable ?? b.value_pence]);
      if (held.state === 'cancelled') { await owe(c, held, { amountPence: 0, cause: 'cancelled_before_hold', key: `release-late:${b.id}`, wholeBooking: true, triggeredBy: ['guest', 'host', 'epic', 'staff'].includes(held.cancelled_by) ? held.cancelled_by : 'epic' }); return 'released'; }
      return 'held';
    });
    if (outcome === 'held') await notifications.notify({ householdId: host.household_id, kind: 'ask_to_book_request', title: `Ask to book: ${o?.title ?? 'your offer'}`, body: `${b.requested_date ? ymd(b.requested_date) : ''} ${hm(b.requested_time) ?? ''}`.trim(), link: hostLink(b.offer_id), dedupeKey: `ask:${b.id}` }).catch(() => null);
    return b.id;
  }
  // A card hold Stripe let go by itself (seven days, never captured): the money was never taken, and the booking has
  // nothing behind it — for a person to look at.
  if (b.payment_state === 'held' && pi.status === 'canceled' && pi.cancellation_reason === 'automatic') {
    await problems.record({ kind: 'hold_expired', dedupeKey: `hold_expired:${pi.id}`, amountPence: pi.amount ?? b.value_pence, bookingId: b.id, householdId: b.household_id, hostId: b.host_id, offerId: b.offer_id, stripeRef: pi.id, detail: { by: 'stripe' } });
  }
  if (pi.last_payment_error && ['requires_payment_method', 'canceled'].includes(pi.status)) {
    await recordFailedPayment(pi, { bookingId: b.id, householdId: b.household_id, hostId: b.host_id, offerId: b.offer_id });
  }
  if (b.payment_state === 'none' && (pi.status === 'canceled' || (pi.status === 'requires_payment_method' && pi.last_payment_error))) {
    // Cancelled by the guest, or failed: the places go back now rather than at the cleanup (Codex, 2 Oct 2026).
    await query(`update experience_bookings set payment_state = 'failed', state = 'cancelled', cancelled_by = 'epic', cancel_cause = 'payment_failed' where id = $1 and payment_state = 'none'`, [b.id]);
    await query(`update booking_sessions set state = 'cancelled' where booking_id = $1`, [b.id]);
    await query(`update hosting_payments set state = 'failed', updated_at = now() where stripe_ref = $1`, [pi.id]).catch(() => null);
    // An invitation answered with a card that then failed is open again, so they can answer once more (Codex, 2 Oct 2026).
    await query(`update offer_invites set rsvp = null, rsvp_heads = null, booking_id = null where booking_id = $1`, [b.id]);
    // …and so is the waiting-list place it took, while the offer lasts.
    await restoreWaitlist(b.id);
  }
  return b.id;
}

async function applyTipIntent(pi) {
  const tipId = pi?.metadata?.epic_tip_id;
  if (!tipId || !UUID.test(tipId)) return null;
  // As for a booking: Stripe may answer before our write of the tip's reference (Codex, 2 Oct 2026).
  await query('update booking_tips set stripe_ref = $2 where id = $1 and stripe_ref is null', [tipId, pi.id]);
  // A tip whose payment failed or was abandoned frees the booking for another try (Codex, 2 Oct 2026).
  if (pi.status === 'canceled' || (pi.status === 'requires_payment_method' && pi.last_payment_error)) {
    if (pi.last_payment_error) {
      // The tip's own host, so the host's view of the log shows it (Codex, 3 Oct 2026).
      const { rows: [tb] } = await query('select b.id, b.host_id, b.offer_id, b.household_id from booking_tips t join experience_bookings b on b.id = t.booking_id where t.id = $1', [tipId]);
      await recordFailedPayment(pi, { bookingId: tb?.id ?? pi.metadata?.epic_booking_id ?? null, householdId: tb?.household_id ?? pi.metadata?.epic_household_id ?? null, hostId: tb?.host_id ?? null, offerId: tb?.offer_id ?? pi.metadata?.epic_offer_id ?? null, kind: 'tip' });
    }
    await query(`update booking_tips set state = 'failed' where id = $1 and stripe_ref = $2 and state = 'pending'`, [tipId, pi.id]);
    return null;
  }
  if (pi.status !== 'succeeded') return null;
  const { rows: [t] } = await query(`update booking_tips set state = 'paid' where id = $1 and stripe_ref = $2 and state = 'pending' returning *`, [tipId, pi.id]);
  if (!t) return refundLateTip(tipId, pi);
  return creditTip(t, pi);
}

/** A tip that is paid: on the ledger, and the host told. */
async function creditTip(t, pi) {
  await ledger.record({ kind: 'tip', bookingId: t.booking_id, offerId: t.offer_id, hostId: t.host_id, householdId: t.household_id, amountPence: t.amount_pence + t.admin_fee_pence, epicPence: t.admin_fee_pence, hostPence: t.amount_pence, state: 'succeeded', stripeRef: pi.id, mode: 'test', reason: 'tip' });
  const h = await repo.hostById(t.host_id);
  await notifications.notify({ householdId: h.household_id, kind: 'new_tip', title: `A £${(t.amount_pence / 100).toFixed(2)} tip`, link: '/host/reviews?tab=tips', dedupeKey: `tip:${t.id}` }).catch(() => null);
  return t.id;
}

async function tipFeeRule() {
  const t = (await settingsRepo.current()).tip_admin_fee;
  return t && Number.isFinite(Number(t.pct)) && Number.isFinite(Number(t.minPence)) ? { pct: Number(t.pct), minPence: Number(t.minPence) } : null;
}

/**
 * A tip charged after it had been given up on: its card failed, or it was left,
 * and the guest may have tipped again since. Money taken on a tip that is no
 * longer the booking's tip is neither the host's nor Epic's, so it goes back
 * in full, on a refund line that says why (Hosting v7 handover, owner's
 * decision, 3 Oct 2026: "refund it automatically … reason 'duplicate tip'").
 * Queued like every refund, once — the idempotency key is the tip's own.
 */
async function refundLateTip(tipId, pi) {
  // No other tip on the booking (the guest only tried this card again): it is the tip after all, and counts.
  // The unique index on one live tip a booking makes this lose cleanly to a second tip made at the same moment.
  const { rows: [revived] } = await query(
    `update booking_tips t set state = 'paid' where t.id = $1 and t.stripe_ref = $2 and t.state = 'failed'
       and not exists (select 1 from booking_tips o where o.booking_id = t.booking_id and o.id <> t.id and o.state in ('pending', 'paid'))
     returning *`,
    [tipId, pi.id],
  ).catch((err) => { if (err.code === '23505') return { rows: [] }; throw err; });
  if (revived) return creditTip(revived, pi);
  const { rows: [t] } = await query(`select * from booking_tips where id = $1 and stripe_ref = $2 and state = 'failed'`, [tipId, pi.id]);
  if (!t || !t.booking_id) return null;
  const amount = Number(pi.amount_received ?? 0);
  if (amount <= 0) return null;
  await query(
    `insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, amount_pence, epic_pence, host_pence,
                                   state, mode, reason, cause, idem_key, refund_of, tip_id)
     select 'tip_refund', $1, $2, $3, $4, $5, 0, 0, 'pending', 'test', 'duplicate tip', 'duplicate_tip', $6, $7, $8
      where not exists (select 1 from hosting_payments where idem_key = $6)`,
    [t.booking_id, t.offer_id, t.host_id, t.household_id, amount, `duplicate_tip:${t.id}`, pi.id, t.id],
  );
  return t.id;
}

router.post('/booked/:id/payment', async (req, res, next) => {
  try {
    const { household } = await me();
    const b = await ownBooking(req.params.id, household.id);
    // A payment for more places (change how many are going): read that one back.
    const { rows: [pc] } = typeof req.body?.paymentIntent === 'string'
      ? await query(`select stripe_payment_intent from booking_party_changes where booking_id = $1 and stripe_payment_intent = $2`, [b.id, req.body.paymentIntent]) : { rows: [] };
    if (pc) await applyPartyIntent(await stripe.retrievePaymentIntent(pc.stripe_payment_intent, { householdId: household.id }));
    // A booking far ahead whose card was being saved: read the SetupIntent back instead (L4).
    else
    if (!b.stripe_payment_intent && b.stripe_setup_intent) await applySetupIntent(await stripe.retrieveSetupIntent(b.stripe_setup_intent, { householdId: household.id }));
    else if (!b.stripe_payment_intent) throw refuse(409, 'nothing_to_pay', 'There’s nothing to pay on this one.');
    else await applyPaymentIntent(await stripe.retrievePaymentIntent(b.stripe_payment_intent, { householdId: household.id }));
    const { rows: [now] } = await query('select state, payment_state, request_state from experience_bookings where id = $1', [b.id]);
    res.json({ state: now.state, paymentState: now.payment_state, requestState: now.request_state });
  } catch (err) { next(err); }
});

/**
 * POST /booked/:id/pay-now — a booking far ahead whose later charge the card refused (L4): the guest pays it now,
 * in the browser like any payment, and keeps the place. The same amount and fee the job would have charged; a new
 * PaymentIntent each try (a refused one cannot be confirmed again), each with its own key.
 */
router.post('/booked/:id/pay-now', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const b = await ownBooking(req.params.id, household.id);
    if (b.payment_state !== 'charge_failed' || b.state === 'cancelled') throw refuse(409, 'nothing_to_pay', 'There’s nothing to pay on this one.');
    const host = await repo.hostById(b.host_id);
    if (!hostCanBeCharged(host)) throw refuse(409, 'host_not_ready', 'This host can’t take payments just now.');
    const { amountPence, feePence } = laterAmounts(b);
    // One payment at a time (Codex, 3 Oct 2026): one still open — the later charge waiting on the bank, or an earlier
    // press — is handed back rather than a second made beside it.
    if (b.stripe_payment_intent) {
      const open = await stripe.retrievePaymentIntent(b.stripe_payment_intent, { householdId: household.id });
      if (open.status === 'succeeded') { await applyPaymentIntent(open); throw refuse(409, 'nothing_to_pay', 'That’s paid already.'); }
      if (open.status === 'processing') throw refuse(409, 'processing', 'Your bank is still processing it.');
      if (['requires_payment_method', 'requires_action', 'requires_confirmation'].includes(open.status)) {
        return res.json({ booking: { id: b.id }, pay: { clientSecret: open.client_secret ?? null, paymentIntent: open.id, amountPence: open.amount } });
      }
    }
    // Claimed, so two presses at once make one PaymentIntent between them.
    const { rowCount: claimed } = await query(`update experience_bookings set later_charge_claimed_at = now() where id = $1 and payment_state = 'charge_failed'
      and (later_charge_claimed_at is null or later_charge_claimed_at < now() - interval '1 minute')`, [b.id]);
    if (!claimed) throw refuse(409, 'try_again', 'Opening the payment already — give it a moment.');
    const { rows: [n] } = await query('select count(*)::int as n from hosting_payments where booking_id = $1 and kind = $2', [b.id, 'charge']);
    const pi = await stripe.paymentIntent({ amountPence, destination: host.stripe_account_id, applicationFeePence: feePence, hostName: host.name, bookingId: b.id, offerId: b.offer_id, householdId: b.household_id, email: account?.email ?? null, idempotencyKey: `booking-later-pay-${b.id}-${n.n}` });
    await query('update experience_bookings set stripe_payment_intent = $2 where id = $1', [b.id, pi.id]);
    await ledger.record({ kind: 'charge', bookingId: b.id, offerId: b.offer_id, hostId: b.host_id, householdId: b.household_id, amountPence, epicPence: feePence, hostPence: amountPence - feePence, bookingValuePence: b.value_pence, ratePct: b.fee_rate_pct, state: 'pending', stripeRef: pi.id, mode: 'test', reason: b.fee_reason });
    res.json({ booking: { id: b.id }, pay: { clientSecret: pi.client_secret ?? null, paymentIntent: pi.id, amountPence } });
  } catch (err) { next(err); }
});

/** What a later charge takes: the booking's value less any part cancelled before it, and Epic's fee in proportion. */
export function laterAmounts(b) {
  const value = Number(b.value_pence ?? 0);
  const amountPence = Math.max(0, value - Number(b.later_off_pence ?? 0));
  const feePence = value > 0 ? Math.round((Number(b.fee_pence ?? 0) * amountPence) / value) : 0;
  return { amountPence, feePence };
}

// ---------------------------------------------------------------------------
// Change how many are going (attendee README; Stripe build, 3 Oct 2026)
//
// A booking grows or shrinks in place. More: only with room, the places held at
// once while the guest pays the difference (or, on a card saved for later, the
// later charge grows). Fewer: the removed people's share comes back under the
// booking's own refund policy, through the same refund queue as a cancellation.
// ---------------------------------------------------------------------------

/** What a booking's party is today, in priceFor's terms. */
const partyOf = (b) => {
  const list = Array.isArray(b.party) ? b.party : [];
  const children = list.filter((p) => p?.child).length;
  return { adults: Math.max(0, list.length - children), children };
};

/**
 * What changing a booking to `party` would do: who comes, what it costs or gives back, whether there is room.
 * Pure on what is read; writes nothing. `by` is who asks — a host removing people refunds them in full (host-caused).
 */
async function quoteParty(c, b, o, body, { by = 'guest', now = new Date() } = {}) {
  if (b.state !== 'confirmed') throw refuse(409, 'not_confirmed', 'Only a confirmed booking can change.');
  if (b.request_state === 'asked') throw refuse(409, 'not_confirmed', 'Wait for the host’s answer first.');
  const paidStates = ['charged', 'partially_refunded', 'card_saved', 'charge_failed'];
  const paid = Number(b.value_pence ?? 0) > 0 && paidThroughEpic(o);
  if (paid && !paidStates.includes(b.payment_state)) throw refuse(409, 'not_paid', 'This booking isn’t paid for yet.');
  const e = await eventWithSessions(o.id, c);
  const { rows: mine } = await c.query(`select session_id from booking_sessions where booking_id = $1 and state = 'booked'`, [b.id]);
  const live = e.sessions.filter((s) => mine.some((m) => m.session_id === s.id) && s.state === 'scheduled' && startOf(s, o) > now);
  if (!live.length) throw refuse(409, 'nothing_left', 'There’s nothing left to change on this one.');
  const party = parseParty(body);
  const check = checkParty(party, o, { onDate: ymd(live[0].on_date), adultAge: hostingConfig().adultAge });
  if (check.error) throw refuse(400, check.error, check.message);
  const fromHeads = Number(b.heads);
  const toHeads = check.heads;
  if (toHeads === fromHeads && check.children === partyOf(b).children) throw refuse(409, 'no_change', 'That’s who’s going already.');
  const kind = b.booking_kind ?? 'whole';
  const priceNow = (p) => (paid ? priceFor(o, kind, p, live.length).valuePence : 0);
  const was = priceNow(partyOf(b));
  const will = priceNow({ adults: check.adults, children: check.children });
  const out = { party, check, fromHeads, toHeads, live, paid, chargePence: 0, feePence: 0, refundPence: 0, feeKeptPence: 0, deltaPence: will - was, cause: null };
  if (toHeads > fromHeads) {
    for (const s of live) {
      const left = placesLeft(s, o);
      if (left != null && left - s.reserved < toHeads - fromHeads) throw refuse(409, 'full', 'There isn’t room for that many.');
    }
  }
  if (!paid) return out;
  if (will >= was) {
    // More: the guest pays what the extra people cost at today's prices, and Epic's fee on it at the booking's rate.
    out.chargePence = will - was;
    out.feePence = Math.round((out.chargePence * Number(b.fee_rate_pct ?? 0)) / 100);
    return out;
  }
  // Fewer: the share of what is still paid for the remaining sessions that the removed people stand for.
  const basis = chargeBasis(b);
  const left = Math.max(0, Number(basis.charged_pence ?? 0) - Number(basis.refunded_pence ?? 0) - Number(basis.cancellation_fee_pence ?? 0));
  const { rows: [{ n: allN }] } = await c.query(`select count(*)::int as n from booking_sessions where booking_id = $1 and state in ('booked', 'attended')`, [b.id]);
  const liveShare = Math.floor((left * live.length) / Math.max(1, allN));
  const share = was > 0 ? Math.round((liveShare * (was - will)) / was) : 0;
  if (by === 'host' || ['card_saved', 'charge_failed'].includes(b.payment_state)) {
    // Host-caused, or nothing taken yet: all of the share, no fee.
    out.refundPence = share;
    out.cause = by === 'host' ? 'host_cancelled' : 'party_reduced';
    return out;
  }
  const s = await settingsRepo.current();
  const terms = b.refund_policy ? { ...(s.refund_terms ?? {}), [b.refund_policy]: b.refund_terms ?? s.refund_terms?.[b.refund_policy] } : s.refund_terms;
  const q = cancelQuote({
    booking: { ...b, charged_pence: share, refunded_pence: 0, cancellation_fee_pence: 0, all_sessions_count: live.length, forfeited_count: 0 },
    lane: o.lane, sessions: live.map((x) => ({ id: x.id, startsAt: startOf(x, o), movedAfterBooking: movedSinceBooking(b, [x]) })),
    losing: live.map((x) => x.id), now, terms, feePct: b.cancellation_fee_pct == null ? null : Number(b.cancellation_fee_pct),
  });
  if (q.pence == null) throw refuse(409, 'needs_a_person', q.words);
  out.refundPence = q.pence;
  out.feeKeptPence = q.feeKeptPence ?? 0;
  out.cause = 'party_reduced';
  out.words = q.words ?? null;
  return out;
}

/** Write the booking's new party: head count, who, and the children's details. */
async function setParty(c, b, party, heads) {
  const list = [...Array(party.adults)].map(() => ({ child: false })).concat(party.children.map((k) => ({ name: k.name, child: true })));
  await c.query('update experience_bookings set heads = $2, party = $3::jsonb where id = $1', [b.id, heads, JSON.stringify(list)]);
  await c.query('delete from booking_children where booking_id = $1', [b.id]);
  for (const k of party.children) {
    await c.query('insert into booking_children (booking_id, name, age, date_of_birth, needs, emergency_contact) values ($1, $2, $3, $4, $5::jsonb, $6)',
      [b.id, k.name, k.dob ? null : childAge(k), k.dob, JSON.stringify(k.needs), k.emergencyContact]);
  }
}

/** Put a booking's party back as it was before a change that was not paid for. */
async function restoreParty(c, change) {
  await c.query('update experience_bookings set heads = $2, party = $3::jsonb where id = $1', [change.booking_id, change.from_heads, JSON.stringify(change.from_party)]);
  await c.query('delete from booking_children where booking_id = $1', [change.booking_id]);
  for (const k of change.from_children ?? []) {
    await c.query('insert into booking_children (booking_id, name, age, date_of_birth, needs, emergency_contact) values ($1, $2, $3, $4, $5::jsonb, $6)',
      [change.booking_id, k.name, k.age, k.date_of_birth, JSON.stringify(k.needs ?? []), k.emergency_contact]);
  }
}

/**
 * The quote, for the booking page: GET /booked/:id/party-quote?adults=&children= (children as JSON) — or a host's
 * view of their own booking, by `hostId`.
 */
export async function partyQuote({ bookingId, householdId = null, hostId = null, party, by = 'guest' }) {
  return withTransaction(async (c) => {
    const { rows: [b] } = await c.query('select * from experience_bookings where id = $1 and ($2::uuid is null or household_id = $2) and ($3::uuid is null or host_id = $3)', [bookingId, householdId, hostId]);
    if (!b || (!householdId && !hostId)) throw refuse(404, 'not_found', 'That booking isn’t yours.');
    const o = await repo.offerById(b.offer_id);
    const q = await quoteParty(c, b, o, party, { by });
    return { fromHeads: q.fromHeads, toHeads: q.toHeads, chargePence: q.chargePence, refundPence: q.refundPence, feeKeptPence: q.feeKeptPence, words: q.words ?? null, later: ['card_saved', 'charge_failed'].includes(b.payment_state) };
  });
}

/**
 * Change how many are going. The hook the hosting chat's screens call (and the guest route below):
 *   changeParty({ bookingId, householdId | hostId, party: { adults, children, adultConfirmed }, by: 'guest' | 'host', account })
 * Answers `{ change, pay }` — `pay` (a client secret) only when the guest must pay for more places now.
 */
export async function changeParty({ bookingId, householdId = null, hostId = null, party, by = 'guest', account = null }) {
  if (!householdId && !hostId) throw refuse(404, 'not_found', 'That booking isn’t yours.');
  const out = await withTransaction(async (c) => {
    const { rows: [b0] } = await c.query('select offer_id from experience_bookings where id = $1 and ($2::uuid is null or household_id = $2) and ($3::uuid is null or host_id = $3)', [bookingId, householdId, hostId]);
    if (!b0) throw refuse(404, 'not_found', 'That booking isn’t yours.');
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${b0.offer_id}`]);
    const { rows: [b] } = await c.query('select * from experience_bookings where id = $1 for update', [bookingId]);
    const { rows: [waiting] } = await c.query(`select id from booking_party_changes where booking_id = $1 and state = 'pending'`, [b.id]);
    if (waiting) throw refuse(409, 'change_waiting', 'Finish paying for the last change first.');
    const o = await repo.offerById(b.offer_id);
    const q = await quoteParty(c, b, o, party, { by });
    const { rows: kids } = await c.query('select name, age, date_of_birth, needs, emergency_contact from booking_children where booking_id = $1', [b.id]);
    const later = ['card_saved', 'charge_failed'].includes(b.payment_state);
    // A later charge under way, or one refused and waiting on the guest (L4): its amount is fixed in that payment, so
    // the party can't grow until it is settled (Codex, 3 Oct 2026).
    if (later && q.chargePence > 0 && (b.payment_state === 'charge_failed' || b.stripe_payment_intent || (b.later_charge_claimed_at && Date.now() - new Date(b.later_charge_claimed_at).getTime() < 10 * 60_000))) {
      throw refuse(409, 'charge_under_way', 'Your payment for this booking is being taken — add people once it’s through.');
    }
    const payNow = q.paid && q.chargePence > 0 && !later;
    const { rows: [change] } = await c.query(
      `insert into booking_party_changes (booking_id, from_heads, to_heads, from_party, to_party, from_children, delta_pence, charge_pence, fee_pence, refund_pence, fee_kept_pence, state, by_label, by_account, finished_at)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, case when $12 = 'done' then now() end) returning *`,
      [b.id, q.fromHeads, q.toHeads, JSON.stringify(b.party ?? []), JSON.stringify(q.party), JSON.stringify(kids), q.deltaPence, q.chargePence, q.feePence, q.refundPence, q.feeKeptPence,
        payNow ? 'pending' : 'done', by, account?.id ?? null],
    );
    // The places are the guest's from now: held by the head count, and given back if the payment doesn't happen.
    await setParty(c, b, q.party, q.toHeads);
    if (q.paid && q.chargePence > 0 && later) {
      // A card saved for later (L4): the later charge grows, and Epic's fee and the host's part with it.
      await c.query('update experience_bookings set value_pence = value_pence + $2, fee_pence = fee_pence + $3, host_pence = host_pence + $2 - $3 where id = $1', [b.id, q.chargePence, q.feePence]);
    }
    if (q.paid && q.refundPence + q.feeKeptPence > 0) {
      const line = await owe(c, b, { amountPence: q.refundPence, feeKeptPence: q.feeKeptPence, cause: q.cause, key: `party:${change.id}`, wholeBooking: false, triggeredBy: by });
      if (line) await c.query('update booking_party_changes set refund_line = $2 where id = $1', [change.id, line.id]);
    }
    await logChange({ subjectKind: 'booking', subjectId: b.id, field: 'party', before: { heads: q.fromHeads }, after: { heads: q.toHeads, charge: q.chargePence, refund: q.refundPence, feeKept: q.feeKeptPence }, by: account?.id ?? null, byLabel: by }, c);
    return { b, o, change, payNow };
  });
  const { b, change, payNow } = out;
  // Fewer places: a waiting-list household may take them now.
  if (change.to_heads < change.from_heads) void offerFreedPlaces().catch(() => null);
  if (!payNow) return { change: partyChangePayload(change), pay: null };
  const host = await repo.hostById(b.host_id);
  let pi;
  try {
    if (!hostCanBeCharged(host)) throw refuse(409, 'host_not_ready', 'This host can’t take payments just now.');
    pi = await stripe.paymentIntent({ amountPence: change.charge_pence, destination: host.stripe_account_id, applicationFeePence: change.fee_pence, hostName: host.name,
      bookingId: b.id, offerId: b.offer_id, householdId: b.household_id, email: account?.email ?? null, idempotencyKey: `party-${change.id}`, kind: 'party_change', changeId: change.id });
  } catch (err) {
    // The payment can't start: the places go back at once.
    await withTransaction(async (c) => { await restoreParty(c, change); await c.query(`update booking_party_changes set state = 'failed', finished_at = now() where id = $1 and state = 'pending'`, [change.id]); });
    throw err;
  }
  await query('update booking_party_changes set stripe_payment_intent = $2 where id = $1', [change.id, pi.id]);
  await ledger.record({ kind: 'charge', bookingId: b.id, offerId: b.offer_id, hostId: b.host_id, householdId: b.household_id, amountPence: change.charge_pence, epicPence: change.fee_pence, hostPence: change.charge_pence - change.fee_pence, bookingValuePence: change.charge_pence, ratePct: b.fee_rate_pct, state: 'pending', stripeRef: pi.id, mode: 'test', reason: 'party_added' });
  return { change: partyChangePayload({ ...change, stripe_payment_intent: pi.id }), pay: { clientSecret: pi.client_secret ?? null, paymentIntent: pi.id, amountPence: change.charge_pence } };
}

const partyChangePayload = (x) => ({ id: x.id, fromHeads: x.from_heads, toHeads: x.to_heads, chargePence: x.charge_pence, refundPence: x.refund_pence, feeKeptPence: x.fee_kept_pence, state: x.state });

/** Stripe's word on a payment for more places: paid, they are kept and counted; failed, they go back. */
export async function applyPartyIntent(pi) {
  const changeId = pi?.metadata?.epic_change_id;
  if (!changeId || !UUID.test(changeId)) return null;
  await query('update booking_party_changes set stripe_payment_intent = $2 where id = $1 and stripe_payment_intent is null', [changeId, pi.id]);
  return withTransaction(async (c) => {
    const { rows: [x] } = await c.query('select * from booking_party_changes where id = $1 and stripe_payment_intent = $2 for update', [changeId, pi.id]);
    if (!x || x.state !== 'pending') return x?.id ?? null;
    if (pi.status === 'succeeded') {
      await c.query(
        `update experience_bookings set charged_pence = charged_pence + $2, value_pence = value_pence + $2, fee_pence = fee_pence + $3, host_pence = host_pence + $2 - $3
          where id = $1`, [x.booking_id, x.charge_pence, x.fee_pence]);
      await c.query(`update booking_party_changes set state = 'done', finished_at = now() where id = $1`, [x.id]);
      await c.query(`update hosting_payments set state = 'succeeded', updated_at = now() where stripe_ref = $1 and kind = 'charge'`, [pi.id]);
      return x.id;
    }
    if (pi.status === 'canceled' || (pi.status === 'requires_payment_method' && pi.last_payment_error)) {
      await restoreParty(c, x);
      await c.query(`update booking_party_changes set state = 'failed', finished_at = now() where id = $1`, [x.id]);
      await c.query(`update hosting_payments set state = 'failed', updated_at = now() where stripe_ref = $1`, [pi.id]);
    }
    return x.id;
  });
}

/** A change for more places not paid within 30 minutes: the payment is cancelled and the places go back. */
export async function expirePartyChanges({ now = new Date(), cancel = stripe.cancelPayment, read = stripe.retrievePaymentIntent } = {}) {
  const { rows } = await query(`select * from booking_party_changes where state = 'pending' and created_at < $1::timestamptz - interval '30 minutes' limit 50`, [now]);
  for (const x of rows) {
    if (x.stripe_payment_intent) {
      const pi = await read(x.stripe_payment_intent).catch(() => null);
      if (pi?.status === 'succeeded') { await applyPartyIntent(pi); continue; }
      if (pi && pi.status !== 'canceled') { try { await cancel(x.stripe_payment_intent, { idempotencyKey: `party-cancel-${x.id}` }); } catch { continue; } }
    }
    await withTransaction(async (c) => {
      const { rows: [again] } = await c.query(`select * from booking_party_changes where id = $1 and state = 'pending' for update`, [x.id]);
      if (!again) return;
      await restoreParty(c, again);
      await c.query(`update booking_party_changes set state = 'expired', finished_at = now() where id = $1`, [x.id]);
      if (again.stripe_payment_intent) await c.query(`update hosting_payments set state = 'failed', updated_at = now() where stripe_ref = $1 and state = 'pending'`, [again.stripe_payment_intent]);
    });
  }
  return rows.length;
}

router.get('/booked/:id/party-quote', async (req, res, next) => {
  try {
    const { household } = await me();
    let children = [];
    try { children = req.query.children ? JSON.parse(String(req.query.children)) : []; } catch { throw refuse(400, 'children', 'Children don’t read right.'); }
    res.json(await partyQuote({ bookingId: req.params.id, householdId: household.id, party: { adults: req.query.adults, children, adultConfirmed: req.query.adultConfirmed === 'true' } }));
  } catch (err) { next(err); }
});

router.post('/booked/:id/party', async (req, res, next) => {
  try {
    const { household, account } = await me();
    res.json(await changeParty({ bookingId: req.params.id, householdId: household.id, party: req.body?.party ?? req.body, by: 'guest', account }));
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
    // A private event's list only with its link or an invitation (Codex, 2 Oct 2026).
    if (o.visibility !== 'public') {
      const invite = typeof req.body?.inviteToken === 'string' ? await repo.inviteByToken(req.body.inviteToken.slice(0, 64)) : null;
      if (!opensPrivately(o, { linkToken: typeof req.body?.linkToken === 'string' ? req.body.linkToken.slice(0, 64) : null, invite, hasBooking: await repo.holdsBooking(o.id, household.id) })) throw refuse(404, 'not_found', 'This one is invitation only.');
    }
    const party = Math.max(1, Math.min(o.party_max ?? 20, Math.floor(Number(req.body?.party) || 1)));
    // Never more than the event could ever hold, or it would stand at the front for good (Codex, 2 Oct 2026).
    if (o.max_count && party > o.max_count) throw refuse(400, 'too_many', `It takes ${o.max_count} at most.`);
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
    // Leaving one weekly session's list leaves only that one (Codex, 2 Oct 2026).
    const sessionId = typeof req.query.session === 'string' && UUID.test(req.query.session) ? req.query.session : (typeof req.body?.sessionId === 'string' && UUID.test(req.body.sessionId) ? req.body.sessionId : null);
    const { rows } = await query(
      `update offer_waitlist w set state = 'left' from offer_waitlist was where was.id = w.id
          and w.offer_id = $1 and w.household_id = $2 and w.state in ('waiting', 'offered') and ($3::uuid is null or w.session_id = $3)
        returning was.state as was, was.offer_expires_at > now() as live`,
      [req.params.id, household.id, sessionId],
    );
    // Passing on a place that was offered (G18 "Pass"): it goes to the next person now, not at the job's next run.
    // Passed only while the offer still stood: one past its deadline had already gone (Codex, 3 Oct 2026).
    const passed = rows.some((r) => r.was === 'offered' && r.live);
    if (passed) await offerFreedPlaces().catch(() => 0);
    res.json({ left: rows.length > 0, passed });
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
    // Counted and offered under the event's own lock, so a booking can't take the same place meanwhile (Codex, 2 Oct 2026).
    const r = await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${l.offer_id}`]);
      const e = await eventWithSessions(l.offer_id, c);
      if (!e) return null;
      const targets = l.session_id ? e.sessions.filter((x) => x.id === l.session_id) : ahead(e.sessions, e.offer, now);
      if (!targets.length || targets.some((x) => startOf(x, e.offer) <= now)) return null;
      const left = Math.min(...targets.map((x) => (placesLeft(x, e.offer) ?? Infinity) - x.reserved));
      if (!(left > 0)) return null;
      const { rows: [first] } = await c.query(
        `select * from offer_waitlist where offer_id = $1 and session_id is not distinct from $2 and state = 'waiting' order by created_at limit 1`,
        [l.offer_id, l.session_id],
      );
      if (!first || first.party > left) return null;
      const { rowCount } = await c.query(
        `update offer_waitlist set state = 'offered', offered_at = $2, offer_expires_at = $3 where id = $1 and state = 'waiting'`,
        [first.id, now, new Date(now.getTime() + hours * 3_600_000)],
      );
      return rowCount ? { e, first } : null;
    });
    if (!r) continue;
    const { e, first } = r;
    offered += 1;
    await notifications.notify({ householdId: first.household_id, kind: 'waitlist_offered', title: `Your place is ready: ${e.offer.title ?? 'an event'}`, body: `Book within ${hours} hours`, link: `/experiences/${e.offer.id}${e.offer.visibility !== 'public' && e.offer.link_token ? `?l=${e.offer.link_token}` : ''}`, dedupeKey: `waitlist_offered:${first.id}` }).catch(() => null);
  }
  return offered;
}

// ---------------------------------------------------------------------------
// Trips › Booked, and the booking page
// ---------------------------------------------------------------------------

async function bookingsOfHousehold(householdId) {
  const { rows } = await query(
    `select b.*, o.title, o.lane, o.photo_ids, o.min_count, o.time_zone, o.price_mode, o.total_pence, o.state as offer_state, o.host_id as offer_host,
            exists (select 1 from hosting_payments p where p.booking_id = b.id and p.kind = 'refund' and p.state = 'succeeded') as refund_done,
            o.venue_label, o.venue, o.address_hidden, o.parents
       from experience_bookings b join host_offers o on o.id = b.offer_id
      where b.household_id = $1 and o.lane is not null
      order by b.created_at desc limit 300`,
    [householdId],
  );
  const ids = rows.map((r) => r.id);
  const { rows: bs } = ids.length ? await query(
    `select bs.booking_id, bs.state as held, s.*,
            coalesce((select sum(b2.heads) from booking_sessions x join experience_bookings b2 on b2.id = x.booking_id where x.session_id = s.id and x.state = 'booked' and b2.state in ('pending', 'confirmed', 'attended')), 0)::int as booked,
            -- Who was booked when it was decided: the live bookings and the ones its calling-off cancelled (G17 "It needed 4 and had 2").
            coalesce((select sum(b2.heads) from booking_sessions x join experience_bookings b2 on b2.id = x.booking_id where x.session_id = s.id
                       and (b2.state in ('pending', 'confirmed', 'attended') or b2.cancel_cause = 'called_off')), 0)::int as booked_at_decision
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
  // Changed since they booked, and since they last said Keep my place (Codex, 2 Oct 2026).
  const seen = b.change_seen_at ? new Date(b.change_seen_at) : new Date(b.created_at);
  const chip = guestChip({ booking: b, sessions: b.sessionsList.map((x) => ({ changed: Boolean(x.changed_from && new Date(x.changed_from.at) > new Date(b.created_at) && new Date(x.changed_from.at) > seen), decided: x.decided_outcome })), min: b.min_count, booked: nextS?.booked ?? 0 });
  const lastEnd = b.sessionsList.length ? Math.max(...b.sessionsList.map((x) => endOf(x, o).getTime())) : null;
  // An Ask to book the host declined, or didn't answer in time (guest handoff G28): "Not this time · Hold released".
  const notThisTime = b.request_state === 'declined' || b.request_state === 'lapsed';
  if (notThisTime) { chip.chip = 'not_this_time'; chip.words = 'Not this time'; }
  return {
    id: b.id, offerId: b.offer_id, title: b.title, lane: b.lane, photo: mediaRef(b.photo_ids?.[0]),
    date: nextS ? ymd(nextS.on_date) : b.requested_date ? ymd(b.requested_date) : b.sessionsList[0] ? ymd(b.sessionsList[0].on_date) : null,
    time: nextS ? hm(nextS.starts_at) : hm(b.requested_time),
    session: (b.lane === 'course' || b.lane === 'weekly') && idx && all > 1 ? { n: idx, of: all } : null,
    // Every date still booked, so a trip's day finds a course's later sessions too (Codex, 3 Oct 2026).
    dates: [...new Set(live.map((x) => ymd(x.on_date)))],
    // …and each one's time, so a trip day shows that day's start (Codex, 3 Oct 2026).
    times: Object.fromEntries(live.map((x) => [ymd(x.on_date), hm(x.starts_at)])),
    chip: chip.chip, chipWords: chip.words,
    numbers: b.min_count && chip.chip === 'waiting' ? { booked: nextS?.booked ?? 0, min: b.min_count } : null,
    rateIt: Boolean(lastEnd && lastEnd <= now.getTime() && !b.rated_at && b.state !== 'cancelled'),
    upcoming: Boolean(nextS) || b.request_state === 'asked',
    holdReleased: notThisTime,
    // Only once Stripe has done it: a queued or stuck refund isn't one yet (Codex, 3 Oct 2026).
    refunded: Boolean(b.refund_done),
  };
}

// ---------------------------------------------------------------------------
// Inspire: events near you (guest handoff G1, G1b, G1c)
// ---------------------------------------------------------------------------

/**
 * Which Inspire lane an event sits in, from the host's "What is it" category — a
 * clay club is Fun, a run club Sport, a talk Educational, a walk Outdoors (G1b).
 */
export function moodOf(category, label = '') {
  const l = `${category ?? ''} ${label ?? ''}`.toLowerCase();
  if (/\b(walk|hike|fossil|beach|outdoor|garden|forag|wild|nature|rockpool|kayak|paddle)/.test(l)) return 'outdoors';
  if (/sport|fitness|run|yoga|swim|football|tennis|five-a-side/.test(l)) return 'sport';
  if (/talk|taster|advice|help|history|science|lesson|course|language/.test(l)) return 'educational';
  if (/climb|zip|adrenal/.test(l)) return 'adrenaline';
  return 'fun';
}

/**
 * GET /api/events/near?lat&lng&minutes — live public events from the four lanes within reach, soonest
 * first. The reach is a straight-line estimate (about 0.75 km a minute, as the walking and transit counts
 * already are), and the answer says so; an event with no coordinates is never counted as near.
 */
router.get('/events/near', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat); const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw refuse(400, 'where', 'Where from.');
    const minutes = Math.min(240, Math.max(5, Number(req.query.minutes) || 60));
    const km = minutes * 0.75;
    // At one place (its page, G1b "not drawn"), or matching words (search): Epic's own events, open to anyone.
    const ref = typeof req.query.ref === 'string' && req.query.ref.trim() ? req.query.ref.trim().slice(0, 300) : null;
    const words = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim().toLowerCase().slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const { rows } = await query(
      `with o as (
         select o.*, h.name as host_name, h.paused as host_paused, h.stopped_at as host_stopped,
                coalesce(o.venue_lat, h.lat) as at_lat, coalesce(o.venue_lng, h.lng) as at_lng
           from host_offers o join hosts h on h.id = o.host_id
          where o.lane is not null and o.state = 'live' and o.visibility = 'public' and not coalesce(h.paused, false) and h.stopped_at is null
       )
       select o.id, o.title, o.lane, o.photo_ids, o.what_category, o.what_label, o.price_mode, o.price_pence, o.child_pence, o.drop_in_pence, o.book_ahead_pence, o.summary, o.total_pence, o.min_count, o.max_count, o.age_min, o.age_max, o.parents, o.waitlist_on, o.host_id,
              (6371 * acos(least(1, cos(radians($1)) * cos(radians(o.at_lat)) * cos(radians(o.at_lng) - radians($2)) + sin(radians($1)) * sin(radians(o.at_lat))))) as km,
              nxt.id as session_id, nxt.on_date, nxt.starts_at, nxt.max_count as session_max,
              coalesce((select sum(b.heads) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                         where bs.session_id = nxt.id and bs.state = 'booked' and b.state in ('pending', 'confirmed', 'attended')), 0)::int as booked,
              -- A place offered from the waiting list is held, as the booking path counts it (Codex, 3 Oct 2026).
              coalesce((select sum(w.party) from offer_waitlist w where (w.session_id = nxt.id or (w.session_id is null and w.offer_id = o.id))
                           and w.state = 'offered' and w.offer_expires_at > now()), 0)::int as held,
              -- A course is booked whole: its room is the tightest session still to come (Roger, 3 Oct 2026).
              (select min(coalesce(s2.max_count, o.max_count)
                        - coalesce((select sum(b.heads) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                                     where bs.session_id = s2.id and bs.state = 'booked' and b.state in ('pending', 'confirmed', 'attended')), 0)
                        - coalesce((select sum(w.party) from offer_waitlist w where (w.session_id = s2.id or (w.session_id is null and w.offer_id = o.id))
                                     and w.state = 'offered' and w.offer_expires_at > now()), 0))
                 from offer_sessions s2 where o.lane = 'course' and s2.offer_id = o.id and s2.state = 'scheduled' and (s2.on_date > (now() at time zone coalesce(o.time_zone, 'Europe/London'))::date or (s2.on_date = (now() at time zone coalesce(o.time_zone, 'Europe/London'))::date and (s2.starts_at is null or s2.starts_at > (now() at time zone coalesce(o.time_zone, 'Europe/London'))::time))))::int as run_left,
              (select round(avg(r.stars)::numeric, 1)::float from host_reviews r where r.host_id = o.host_id and r.side = 'guest' and not r.hidden and r.publish_on <= current_date) as rating,
              (select count(*)::int from host_reviews r where r.host_id = o.host_id and r.side = 'guest' and not r.hidden and r.publish_on <= current_date) as reviews,
              (select count(*)::int from offer_sessions s where s.offer_id = o.id and s.state = 'scheduled' and (s.on_date > (now() at time zone coalesce(o.time_zone, 'Europe/London'))::date or (s.on_date = (now() at time zone coalesce(o.time_zone, 'Europe/London'))::date and (s.starts_at is null or s.starts_at > (now() at time zone coalesce(o.time_zone, 'Europe/London'))::time)))) as ahead
         from o
         -- The next session not yet started, in the event's own time zone (Codex, 3 Oct 2026).
         left join lateral (select s.* from offer_sessions s where s.offer_id = o.id and s.state = 'scheduled' and (s.on_date > (now() at time zone coalesce(o.time_zone, 'Europe/London'))::date or (s.on_date = (now() at time zone coalesce(o.time_zone, 'Europe/London'))::date and (s.starts_at is null or s.starts_at > (now() at time zone coalesce(o.time_zone, 'Europe/London'))::time))) order by s.on_date, s.starts_at limit 1) nxt on true
        where (($4::text is not null) or (o.at_lat is not null and o.at_lng is not null)) and (nxt.id is not null or o.lane = 'onrequest')
          and ($4::text is not null or (6371 * acos(least(1, cos(radians($1)) * cos(radians(o.at_lat)) * cos(radians(o.at_lng) - radians($2)) + sin(radians($1)) * sin(radians(o.at_lat))))) <= $3)
          and ($4::text is null or o.venue_ref = $4)
          and ($5::text is null or lower(coalesce(o.title, '') || ' ' || coalesce(o.what_label, '') || ' ' || coalesce(o.summary, '')) like $5)
        order by nxt.on_date nulls last, nxt.starts_at nulls last limit 200`,
      [lat, lng, km, ref, words],
    );
    res.json({
      estimated: true, minutes,
      events: rows.map((r) => {
        const most = r.session_max ?? r.max_count ?? null;
        const left = r.lane === 'course' && r.run_left != null ? Math.max(0, r.run_left) : most != null ? Math.max(0, most - r.booked - (r.held ?? 0)) : null;
        return {
          id: r.id, title: r.title, lane: r.lane, photo: mediaRef(r.photo_ids?.[0]), mood: moodOf(r.what_category, `${r.what_label ?? ''} ${r.title ?? ''}`),
          date: ymd(r.on_date), time: hm(r.starts_at), sessionsAhead: r.ahead, // Found by its place with no point to measure from: no journey time, rather than a made-up one (Codex, 3 Oct 2026).
          minutesAway: Number.isFinite(Number(r.km)) && r.km != null ? Math.max(1, Math.round(Number(r.km) / 0.75)) : null,
          price: { mode: r.price_mode ?? 'free', pence: r.price_pence, childPence: r.child_pence, dropInPence: r.drop_in_pence, bookAheadPence: r.book_ahead_pence, nowEach: r.price_mode === 'by_numbers' && r.total_pence && r.min_count ? perPersonAt(r.total_pence, r.min_count) : null },
          who: { ageMin: r.age_min, ageMax: r.age_max, dropOff: r.parents === 'drop_off' },
          placesLeft: left, full: left === 0, needs: r.min_count && r.booked < r.min_count ? r.min_count - r.booked : null, waitlist: r.waitlist_on === true,
          rating: r.rating, reviews: r.reviews,
          // What it is, in the host's words, so Inspire's search can match its kind and description as well as its title (Roger, 3 Oct 2026).
          words: [r.what_category, r.what_label, String(r.summary ?? '').slice(0, 600)].filter(Boolean).join(' '),
        };
      }),
      capped: rows.length === 200,
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/messages — the guest's inbox (guest handoff G31): one thread per event they booked or asked about,
 * newest first, with the last thing said and how much of it they haven't seen. Each opens where its messages
 * already live: the booking's thread, or the question on the event page. Capped at 100 threads, and it says so.
 */
router.get('/messages', async (_req, res, next) => {
  try {
    const { household, account } = await me();
    const memberId = account?.member_id ?? null;
    const { rows } = await query(
      `with mine as (
         select o.id as offer_id, (array_agg(b.id order by b.created_at desc))[1] as booking_id
           from experience_bookings b join host_offers o on o.id = b.offer_id
          where b.household_id = $1 and o.lane is not null group by o.id
         union
         select t.context_id, null::uuid from chat_topics t
          where t.context_type = 'offer' and t.author_member_id = $2
       ), threads as (select offer_id, (array_agg(booking_id) filter (where booking_id is not null))[1] as booking_id from mine group by offer_id),
       seen as (
         -- The chat's own rule (visibleTopics in chat.js), for this member: their own questions always; what is said
         -- to everyone only once booked, and a date's notice only to those booked on that date (Codex, 3 Oct 2026).
         select t.* from chat_topics t join threads x on x.offer_id = t.context_id
           left join lateral (
             -- Booked is any live booking: a lane booking keeps its dates in booking_sessions and has no occurrence (Codex, 3 Oct 2026).
             select count(*) > 0 as booked, array_remove(array_agg(distinct b.occurrence), null) as occ from experience_bookings b
              where b.offer_id = x.offer_id and b.household_id = $1 and b.state in ('pending', 'confirmed', 'attended')
           ) bk on true
          where t.context_type = 'offer' and not t.hidden and $2::uuid is not null
            and (t.author_member_id = $2
                 or (t.audience = 'everyone' and bk.booked and (t.occurrence is null or cardinality(bk.occ) = 0 or t.occurrence = any(bk.occ))))
       )
       select x.offer_id, x.booking_id, o.title, h.name as host, h.photo_id,
              last.at as last_at, last.body as last_body, last.topic_id,
              (select count(*)::int from seen t where t.context_id = x.offer_id and $2::uuid is not null
                  and not exists (select 1 from chat_reads r where r.target_type = 'topic' and r.target_id = t.id and r.member_id = $2))
            + (select count(*)::int from chat_replies y join seen t on t.id = y.topic_id where t.context_id = x.offer_id and not y.hidden and $2::uuid is not null
                  and (y.author_member_id is null or y.author_member_id <> $2)
                  and not exists (select 1 from chat_reads r where r.target_type = 'reply' and r.target_id = y.id and r.member_id = $2)) as unread
         from threads x join host_offers o on o.id = x.offer_id join hosts h on h.id = o.host_id
         left join lateral (
           select at, body, topic_id from (
             select t.created_at as at, t.title as body, t.id as topic_id from seen t where t.context_id = x.offer_id
             union all
             select y.created_at, y.body, t.id from chat_replies y join seen t on t.id = y.topic_id where t.context_id = x.offer_id and not y.hidden
           ) z order by at desc limit 1
         ) last on true
        where last.at is not null
        order by last.at desc limit 100`,
      [household.id, memberId],
    );
    res.json({
      threads: rows.map((r) => ({ offerId: r.offer_id, bookingId: r.booking_id, topicId: r.topic_id, title: r.title, host: r.host, photo: mediaRef(r.photo_id), last: String(r.last_body ?? '').slice(0, 140), at: r.last_at, unread: r.unread })),
      unread: rows.reduce((n, r) => n + (r.unread ?? 0), 0),
      capped: rows.length === 100,
    });
  } catch (err) { next(err); }
});

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
    const { rows: refunds } = await query(`select amount_pence, fee_kept_pence, triggered_by, cause, state, created_at from hosting_payments where booking_id = $1 and kind in ('refund', 'release') order by created_at`, [b.id]);
    const live = b.sessionsList.filter((x) => x.held === 'booked' && x.state === 'scheduled');
    const firstAhead = live.map((x) => startOf(x, o)).sort((x, y) => x - y)[0] ?? null;
    const lastEnd = b.sessionsList.length ? new Date(Math.max(...b.sessionsList.map((x) => endOf(x, o).getTime()))) : null;
    const settlement = o.price_mode === 'by_numbers' && o.total_pence && o.min_count
      ? (() => {
        const n = numbersSettlement({ totalPence: o.total_pence, minCount: o.min_count, heads: live[0]?.booked ?? o.min_count });
        // And if the most come (G29 "If 7 come · due back"): the floor the price can reach, so the guest sees the whole range.
        const most = o.max_count && o.max_count > o.min_count ? numbersSettlement({ totalPence: o.total_pence, minCount: o.min_count, heads: o.max_count }) : null;
        return {
          paidEach: n.paidEach, nowEach: n.finalEach, dueBackPence: n.backEach * b.heads, settled: Boolean(b.settled_at), heads: b.heads, minCount: o.min_count,
          atMost: most ? { count: o.max_count, each: most.finalEach, dueBackPence: most.backEach * b.heads } : null,
        };
      })()
      : null;
    const decides = b.sessionsList.find((x) => x.decides_at);
    const changed = b.sessionsList.filter((x) => x.changed_from && new Date(x.changed_from.at) > new Date(b.created_at));
    const c = card(b, now);
    res.json({
      booking: {
        id: b.id, state: b.state, chip: c.chip, chipWords: c.chipWords, kind: b.booking_kind, heads: b.heads,
        event: { id: o.id, title: o.title, lane: o.lane, visibility: o.visibility, photo: mediaRef(o.photo_ids?.[0]), host: { id: host.id, name: host.name }, endsAt: hm(o.ends_at), refundPolicy: o.refund_policy ?? null, partyMax: o.party_max ?? null },
        sessions: b.sessionsList.map((x) => ({ id: x.id, n: x.n, topic: x.topic ?? null, date: ymd(x.on_date), time: hm(x.starts_at), endsAt: hm(x.ends_at), booked: x.held === 'booked', state: x.state, finished: endOf(x, o) <= now, changedFrom: x.changed_from ? { date: x.changed_from.onDate, time: x.changed_from.startsAt } : null })),
        request: b.request_state ? { state: b.request_state, date: ymd(b.requested_date), time: hm(b.requested_time), lengthMin: b.requested_length_min, respondBy: b.respond_by } : null,
        // The exact address once booked (or when the host never hid it); the area until then, and whenever no address was written down.
        where: { label: (o.address_hidden === false || ['confirmed', 'attended'].includes(b.state) ? o.venue_label : null) ?? o.venue_area ?? null, venue: o.venue, lat: ['confirmed', 'attended'].includes(b.state) ? o.venue_lat : null, lng: ['confirmed', 'attended'].includes(b.state) ? o.venue_lng : null },
        who: { heads: b.heads, children: kids.map((k) => ({ name: k.name, age: k.age, dob: ymd(k.date_of_birth), needs: k.needs ?? [], emergencyContact: k.emergency_contact })) },
        answers: b.answers ?? {}, answersEditable: answersEditable(firstAhead, now) && b.state !== 'cancelled',
        goingAhead: o.min_count ? { min: o.min_count, booked: b.cancel_cause === 'called_off' ? (b.sessionsList[0]?.booked_at_decision ?? 0) : live[0]?.booked ?? 0, decidesOn: decides ? localDay(new Date(decides.decides_at), tzOf(o)) : null, outcome: decides?.decided_outcome ?? null } : null,
        numbers: settlement,
        dateChange: changed.some((x) => !b.change_seen_at || new Date(x.changed_from.at) > new Date(b.change_seen_at)) ? { sessions: changed.map((x) => ({ id: x.id, from: { date: x.changed_from.onDate, time: x.changed_from.startsAt }, to: { date: ymd(x.on_date), time: hm(x.starts_at) } })) } : null,
        money: { lines: b.price_lines ?? [], grossPence: b.gross_pence, discountPence: b.discount_pence, valuePence: b.value_pence, paidPence: b.charged_pence, heldPence: b.held_pence, refundedPence: b.refunded_pence, paymentState: b.payment_state, refundPolicy: b.refund_policy,
          // A booking far ahead (L4): when its card is charged and how much — or, refused, what is due now.
          later: ['card_saved', 'charge_failed'].includes(b.payment_state) ? { chargeOn: b.charge_due_at, pence: laterAmounts(b).amountPence, failed: b.payment_state === 'charge_failed' } : null, refunds: refunds.map((r) => ({ pence: r.amount_pence, feeKeptPence: r.fee_kept_pence ?? 0, triggeredBy: r.triggered_by ?? null, cause: r.cause, state: r.state, at: r.created_at })) },
        // The fee rule as the server will charge it, so the screen never shows a different one (Codex, 3 Oct 2026).
        after: lastEnd && lastEnd <= now ? { happened: b.confirmed_happened ?? null, rated: Boolean(b.rated_at), tipOpen: tipOpen(lastEnd, now), tipFee: await tipFeeRule() } : null,
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
  // What can still be given up is what is still to come; whether a course has started is judged from every
  // session the booking held, past ones included (Codex, 2 Oct 2026).
  const live = held.filter((x) => x.held === 'booked' && x.state === 'scheduled' && startOf(x, o) > now);
  const everStarted = held.filter((x) => x.held !== 'cancelled').map((x) => startOf(x, o)).some((t) => t <= now);
  const losing = sessionIds ?? live.map((x) => x.id);
  // Nothing still to come: nothing to cancel (Codex, 2 Oct 2026).
  // (An unanswered request has no session yet: withdrawing it is always possible.)
  if (!losing.length && b.request_state !== 'asked') throw refuse(409, 'nothing_left', 'There’s nothing left to cancel on this one.');
  if (o.lane !== 'weekly' && sessionIds && losing.length !== live.length) throw refuse(400, 'whole_only', 'This one is cancelled as a whole.');
  if (losing.some((id) => !live.some((x) => x.id === id))) throw refuse(409, 'session_gone', 'That session isn’t yours to cancel.');
  if (live.filter((x) => losing.includes(x.id)).some((x) => startOf(x, o) <= now)) throw refuse(409, 'started', 'A session that has started can’t be cancelled.');
  const s = await settingsRepo.current();
  const terms = b.refund_policy ? { ...(s.refund_terms ?? {}), [b.refund_policy]: b.refund_terms ?? s.refund_terms?.[b.refund_policy] } : s.refund_terms;
  const sessions = live.map((x) => ({ id: x.id, startsAt: startOf(x, o), movedAfterBooking: movedSinceBooking(b, [x]) }));
  const forfeited = held.filter((x) => x.held === 'forfeited').length;
  const q = o.lane === 'course' && everStarted
    ? { pence: 0, cause: 'guest_cancelled', words: 'The course has started: no refund.' }
    // A card saved and not yet charged (L4): quoted on what would be charged, and no fee is kept on money never taken.
    : cancelQuote({ booking: { ...chargeBasis(b), ...(['card_saved', 'charge_failed'].includes(b.payment_state) ? { payment_state: 'charged' } : {}), all_sessions_count: held.length, forfeited_count: forfeited }, lane: o.lane, sessions, losing, now, terms, feePct: b.cancellation_fee_pct == null || b.payment_state === 'card_saved' || b.payment_state === 'charge_failed' ? null : Number(b.cancellation_fee_pct) });
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
    res.json(await cancelBooking({ bookingId: req.params.id, household, account, sessionIds: req.body?.sessionIds }));
  } catch (err) { next(err); }
});

/**
 * A guest cancels a lane booking: the policy agreed at booking, the refund queued, sessions given back or
 * forfeited. Shared with the older /bookings/:id/cancel, so the booking page can't take a cheaper path (Codex, 2 Oct 2026).
 */
export async function cancelBooking({ bookingId, household, account, sessionIds }) {
    // Each session once, however often it was sent (Codex, 2 Oct 2026).
    const ids = Array.isArray(sessionIds) ? [...new Set(sessionIds.filter((x) => UUID.test(String(x))))] : null;
    const out = await withTransaction(async (c) => {
      const { rows: [b0] } = await c.query('select offer_id from experience_bookings where id = $1 and household_id = $2', [bookingId, household.id]);
      if (!b0) throw refuse(404, 'not_found', 'That booking isn’t yours.');
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${b0.offer_id}`]);
      const { rows: [b] } = await c.query('select * from experience_bookings where id = $1 for update', [bookingId]);
      if (b.state === 'cancelled') throw refuse(409, 'already_cancelled', 'This one is cancelled already.');
      const o = await repo.offerById(b.offer_id);
      const q = await quoteFor(b, o, ids);
      const whole = q.losing.length === q.liveCount;
      if (q.release) {
        await owe(c, b, { amountPence: 0, cause: 'declined', key: `guest_cancel:${b.id}`, wholeBooking: true, triggeredBy: 'guest' });
        await c.query(`update experience_bookings set request_state = 'declined', state = 'cancelled', cancelled_by = 'guest', cancel_cause = 'guest_cancelled' where id = $1`, [b.id]);
      } else {
        if (q.pence == null) throw refuse(409, 'needs_a_person', q.words);
        // Money the policy keeps is still the host's: those sessions are forfeited, not cancelled, so their
        // payout counts it; the place itself is free again either way (Codex, 2 Oct 2026). What was due is
        // read before the refund is written, so a part refund still leaves the rest forfeited.
        const { rows: [{ n: allN }] } = await c.query('select count(*)::int as n from booking_sessions where booking_id = $1', [b.id]);
        const due = whole ? Math.max(0, Number(b.charged_pence ?? 0) - Number(b.refunded_pence ?? 0) - Number(b.cancellation_fee_pence ?? 0)) : Math.floor((Number(b.charged_pence ?? 0) * q.losing.length) / Math.max(1, allN));
        const key = `guest_cancel:${b.id}:${[...q.losing].sort().join(',')}`;
        // Sessions the host moved are their own, host-caused line (no fee kept; the host pays the fee back); the rest
        // is the guest's own cancellation, less the cancellation fee where it would otherwise be all back (L5).
        const moved = Math.max(0, Number(q.movedPence ?? 0));
        if (moved > 0) await owe(c, b, { amountPence: moved, cause: 'date_changed', key: `${key}:moved`, triggeredBy: 'guest' });
        if (q.pence - moved > 0 || q.feeKeptPence > 0) {
          await owe(c, b, { amountPence: q.pence - moved, cause: q.cause, key, wholeBooking: whole, feeKeptPence: q.cause === 'guest_cancelled' ? q.feeKeptPence : 0, triggeredBy: 'guest' });
        }
        // Money the policy keeps is the host's (forfeited); a cancellation fee is Epic's and is not.
        const kept = ['charged', 'partially_refunded'].includes(b.payment_state) && q.pence + (q.feeKeptPence ?? 0) < due;
        await c.query(`update booking_sessions set state = $3 where booking_id = $1 and session_id = any($2::uuid[])`, [b.id, q.losing, kept ? 'forfeited' : 'cancelled']);
        if (whole) await c.query(`update experience_bookings set state = 'cancelled', cancelled_by = 'guest', cancel_cause = $2 where id = $1`, [b.id, q.cause]);
      }
      await logChange({ subjectKind: 'booking', subjectId: b.id, field: 'cancelled', after: { sessions: q.losing.length, refund: q.pence, feeKept: q.feeKeptPence ?? 0, cause: q.cause }, by: account?.id ?? null, byLabel: 'guest' }, c);
      return { refundPence: q.pence ?? 0, feeKeptPence: q.feeKeptPence ?? 0, whole };
    });
    // A freed place goes to the waiting list straight away.
    void offerFreedPlaces().catch(() => null);
    // A booking far ahead with a session cancelled is charged on its remaining sessions' date (L4).
    await refreshChargeDue({ bookingId }).catch(() => null);
    return out;
}

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
    // Until 24 hours before the booking's first session, whether or not later ones are still to come (Codex, 2 Oct 2026).
    const first = held.map((x) => startOf(x, o)).sort((x, y) => x - y)[0] ?? null;
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
  // After the whole of it: a course or a run of weekly sessions is rated once, when its last session is over (Codex, 2 Oct 2026).
  void firstEnd;
  if (!lastEnd || lastEnd > new Date() || b.state === 'cancelled') throw refuse(409, 'not_yet', 'This is for after the event.');
  return { b, o, held, lastEnd };
}

router.post('/booked/:id/happened', async (req, res, next) => {
  try {
    const { household } = await me();
    const { b, held } = await finishedBooking(req.params.id, household.id);
    const answer = ['yes', 'no', 'wrong'].includes(req.body?.answer) ? req.body.answer : null;
    if (!answer) throw refuse(400, 'answer', 'Yes, no, or something went wrong.');
    // The answer and the complaint it opens land together, so a payout can't go between them (Codex, 2 Oct 2026).
    await withTransaction(async (c) => {
      const { rowCount } = await c.query(`update experience_bookings set confirmed_happened = $2, confirmed_at = now() where id = $1 and confirmed_happened is null`, [b.id, answer]);
      if (!rowCount) throw refuse(409, 'answered', 'You’ve answered this one.');
      if (answer !== 'yes') {
        // "No" or "something went wrong" opens a complaint on the session; it holds the payout until it is sorted.
        const last = held.at(-1);
        await c.query(
          `insert into hosting_complaints (booking_id, session_id, offer_id, host_id, household_id, kind, reason) values ($1, $2, $3, $4, $5, $6, $7)`,
          [b.id, last?.id ?? null, b.offer_id, b.host_id, household.id, answer === 'no' ? 'host_no_show' : 'complaint', String(req.body?.reason ?? '').trim().slice(0, 2000) || null],
        );
      }
    });
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
    // Shown no sooner than the review window after it was written: the first midnight once the window has passed, or today with no window (Codex, 3 Oct 2026).
    const windowHours = typeof s.review_window === 'number' ? s.review_window : 48;
    const chips = Array.isArray(req.body?.chips) ? req.body.chips.filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 8) : [];
    const { rows: [r] } = await query(
      `insert into host_reviews (booking_id, offer_id, host_id, household_id, side, stars, host_stars, text, chips, publish_on, by_proxy)
       values ($1, $2, $3, $4, 'guest', $5, $6, $7, $8::jsonb, case when $9::int <= 0 then current_date else (now() + make_interval(hours => $9::int) - interval '1 microsecond')::date + 1 end, $10)
       on conflict (booking_id, side) do nothing returning id`,
      [b.id, b.offer_id, b.host_id, household.id, stars, hostStars, String(req.body?.text ?? '').trim().slice(0, 2000) || null, JSON.stringify(chips), windowHours, req.body?.byProxy === true],
    );
    if (!r) throw refuse(409, 'rated', 'You’ve rated this one.');
    await query('update experience_bookings set rated_at = now() where id = $1', [b.id]);
    // The host hears of it when it shows, not before (guestPrompts, Codex 3 Oct 2026).
    res.status(201).json({ id: r.id });
  } catch (err) { next(err); }
});

/**
 * A tip, on any event, up to seven days after (README "Rules"): the host keeps
 * all of it; the guest pays Epic's admin fee on top. Tips never touch the
 * rating, the fee step or ranking.
 */
/** POST /api/booked/:id/tip/payment — Stripe said yes to a tip: read it back and apply it (the webhook's twin, as for a booking). */
router.post('/booked/:id/tip/payment', async (req, res, next) => {
  try {
    const { household } = await me();
    const b = await ownBooking(req.params.id, household.id);
    const { rows: [t] } = await query(`select * from booking_tips where booking_id = $1 and household_id = $2 and stripe_ref is not null order by created_at desc limit 1`, [b.id, household.id]);
    if (!t) throw refuse(409, 'nothing_to_pay', 'There’s no tip on this one.');
    if (t.state !== 'paid') await applyTipIntent(await stripe.retrievePaymentIntent(t.stripe_ref, { householdId: household.id }));
    const { rows: [now] } = await query('select state from booking_tips where id = $1', [t.id]);
    res.json({ state: now.state });
  } catch (err) { next(err); }
});

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
    // The tip is a destination charge too (K3b, L1): all of it to the host's own account, the admin fee as Epic's application fee.
    const tipHost = await repo.hostById(b.host_id);
    if (!hostCanBeCharged(tipHost)) throw refuse(409, 'host_not_ready', 'This host can’t take tips just now.');
    // A tip started and left (the payment sheet closed) frees the booking after half an hour — its PaymentIntent is
    // cancelled first, so it can never be paid alongside a new one (Codex, 2 Oct 2026).
    const { rows: [stale] } = await query(`select * from booking_tips where booking_id = $1 and state = 'pending' and created_at < now() - interval '30 minutes'`, [b.id]);
    if (stale) {
      let gone = !stale.stripe_ref;
      if (stale.stripe_ref) {
        const pi = await stripe.cancelPayment(stale.stripe_ref, { householdId: household.id, idempotencyKey: `tip-abandon-${stale.id}` }).catch(() => null);
        gone = pi?.status === 'canceled';
      }
      if (gone) await query(`update booking_tips set state = 'failed' where id = $1 and state = 'pending'`, [stale.id]);
    }
    // One a booking, held by the database: a double tap can't make two (Codex, 2 Oct 2026).
    const { rows: [t] } = await query(
      `insert into booking_tips (booking_id, offer_id, host_id, household_id, amount_pence, admin_fee_pence, charge_model) values ($1, $2, $3, $4, $5, $6, 'destination')
       on conflict (booking_id) where state in ('pending', 'paid') do nothing returning *`,
      [b.id, b.offer_id, b.host_id, household.id, amount, fee],
    );
    if (!t) {
      // The same tip still waiting on its card — after a decline, a bank check, or the page reloaded: the guest
      // finishes that payment rather than starting another (Codex, 3 Oct 2026). A paid one, or a different amount, is refused.
      const { rows: [open] } = await query(`select * from booking_tips where booking_id = $1 and state = 'pending' and stripe_ref is not null`, [b.id]);
      if (open && Number(open.amount_pence) === amount) {
        const existing = await stripe.retrievePaymentIntent(open.stripe_ref, { householdId: household.id }).catch(() => null);
        if (existing?.client_secret && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existing.status)) {
          return res.json({ tip: { id: open.id, amountPence: amount, feePence: Number(open.admin_fee_pence), totalPence: amount + Number(open.admin_fee_pence) }, pay: { clientSecret: existing.client_secret, paymentIntent: existing.id } });
        }
      }
      throw refuse(409, 'tipped', 'You’ve tipped on this one.');
    }
    let pi;
    try { pi = await stripe.paymentIntent({ amountPence: amount + fee, destination: tipHost.stripe_account_id, applicationFeePence: fee, hostName: tipHost.name, bookingId: b.id, offerId: b.offer_id, householdId: household.id, idempotencyKey: `tip-${t.id}`, kind: 'tip', tipId: t.id }); }
    catch (err) {
      // A tip that never reached Stripe is not a tip: the guest may try again (Codex, 2 Oct 2026).
      await query(`update booking_tips set state = 'failed' where id = $1 and stripe_ref is null`, [t.id]);
      throw err;
    }
    await query('update booking_tips set stripe_ref = $2 where id = $1 and stripe_ref is null', [t.id, pi.id]);
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
        where p.household_id = $1 and p.kind in ('charge', 'hold', 'refund', 'release', 'tip', 'tip_refund', 'private_fee', 'pro')
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
  // A request whose payment never started, or that the guest withdrew, can't be accepted (Codex, 2 Oct 2026).
  if (b.state === 'cancelled') throw refuse(409, 'withdrawn', 'This request was withdrawn.');
  // A paid request can be answered only once the guest's card is held (Codex, 2 Oct 2026).
  const o = await repo.offerById(b.offer_id);
  // Paid through Epic: the card must be held first. Paid to the host directly: nothing to hold (Codex, 2 Oct 2026).
  // Far ahead (L4), the card is saved rather than held: that is the guest finished too.
  if (Number(b.value_pence ?? 0) > 0 && (o?.money ?? 'epic') === 'epic' && !['held', 'card_saved'].includes(b.payment_state)) throw refuse(409, 'not_held', 'The guest hasn’t finished paying yet.');
  return { host, b, o, retry };
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
      const endMin = b.requested_time && b.requested_length_min ? (() => { const [h, m] = hm(b.requested_time).split(':').map(Number); return h * 60 + m + b.requested_length_min; })() : null;
      const end = endMin == null ? null : `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      // Ending at or after midnight ends the next day (Codex, 2 Oct 2026).
      const endsOn = endMin != null && endMin >= 1440 ? plusDays(ymd(b.requested_date), Math.floor(endMin / 1440)) : null;
      // Never two at once, across all the host's events, decided one acceptance at a time per host (Codex, 2 Oct 2026).
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-intro:${o.host_id}`]);
      const { rows: [clash] } = await c.query(
        `select 1 from offer_sessions where offer_id in (select id from host_offers where host_id = (select host_id from host_offers where id = $1)) and state = 'scheduled'
            and (on_date + starts_at) < ($2::date + $3::time) + make_interval(mins => $4::int)
            and (coalesce(ends_on, on_date) + coalesce(ends_at, starts_at)) > ($2::date + $3::time)
          limit 1`,
        [o.id, ymd(b.requested_date), hm(b.requested_time), b.requested_length_min ?? 60],
      );
      if (clash) throw refuse(409, 'clash', 'You have something on at that time already.');
      const { rows: [s] } = await c.query(
        `insert into offer_sessions (offer_id, on_date, starts_at, ends_at, ends_on, max_count) values ($1, $2, $3, $4, $5, $6) returning id`,
        [o.id, ymd(b.requested_date), hm(b.requested_time), end, endsOn, b.heads],
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
    if (!(await declineRequest(b, o, 'declined'))) throw refuse(409, 'answered', 'This request has been answered.');
    res.json({ declined: true });
  } catch (err) { next(err); }
});

async function declineRequest(b, o, why) {
  // Told only when this decline is the one that happened: a lapse racing an Accept says nothing (Codex, 2 Oct 2026).
  const changed = await withTransaction(async (c) => {
    const { rows: [again] } = await c.query('select * from experience_bookings where id = $1 for update', [b.id]);
    if (again.request_state !== 'asked') return false;
    await owe(c, again, { amountPence: 0, cause: why, key: `request_${why}:${b.id}`, wholeBooking: true, triggeredBy: (why === 'declined' ? 'host' : 'epic') });
    await c.query(`update experience_bookings set request_state = $2, state = 'cancelled', cancelled_by = $3, cancel_cause = $2 where id = $1`, [b.id, why, why === 'lapsed' ? 'epic' : 'host']);
    return true;
  });
  if (!changed) return false;
  // Nobody answered while the card was held: the hold goes, and the log says so (payment problems, "card hold expired").
  if (why === 'lapsed' && b.payment_state === 'held') {
    await problems.record({ kind: 'hold_expired', dedupeKey: `hold_expired:${b.stripe_payment_intent ?? b.id}`, amountPence: b.held_pence ?? b.value_pence, bookingId: b.id, householdId: b.household_id, hostId: b.host_id, offerId: b.offer_id, stripeRef: b.stripe_payment_intent, detail: { by: 'no_answer' } });
  }
  await notifications.notify({ householdId: b.household_id, kind: 'ask_to_book_declined', title: why === 'lapsed' ? `No answer in time: ${o?.title ?? 'your request'}` : `Not this time: ${o?.title ?? 'your request'}`, body: 'Your card hold is released.', link: o ? `/experiences/${o.id}` : '/trips', dedupeKey: `ask_${why}:${b.id}` }).catch(() => null);
  return true;
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
      where state = 'pending' and payment_state = 'none' and request_state is null and value_pence > 0 and created_at < $1::timestamptz - interval '30 minutes'
      returning id`,
    [now],
  );
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await query(`update booking_sessions set state = 'cancelled' where booking_id = any($1::uuid[])`, [ids]);
    // The invitation is open again, and a waiting-list offer still running is theirs again (Codex, 2 Oct 2026).
    await query(`update offer_invites set rsvp = null, rsvp_heads = null, booking_id = null where booking_id = any($1::uuid[])`, [ids]);
    for (const id of ids) await restoreWaitlist(id);
  }
  return rows.length;
}

/** The day before: a reminder. The morning after: did it happen, rate it, tip. Once each. */
export async function guestPrompts({ now = new Date() } = {}) {
  const { rows } = await query(
    `select b.id, b.household_id, o.title, o.time_zone, o.host_id, s.id as session_id, s.on_date, s.starts_at, s.ends_at, s.ends_on
       from booking_sessions bs join experience_bookings b on b.id = bs.booking_id join offer_sessions s on s.id = bs.session_id join host_offers o on o.id = b.offer_id
      where bs.state = 'booked' and b.state in ('confirmed', 'attended') and s.state in ('scheduled', 'done')
        and s.on_date between current_date - 2 and current_date + 2`,
  );
  let sent = 0;
  // Reviews that have become visible: the host is told now, once each.
  const { rows: shown } = await query(
    `select r.id, r.stars, h.household_id from host_reviews r join hosts h on h.id = r.host_id
      where r.side = 'guest' and not coalesce(r.hidden, false) and r.publish_on <= current_date
        -- every one not yet told, however late the tick or the unhiding; reviews from before this rule were never owed one
        and r.created_at >= '2026-10-03' and not exists (select 1 from notifications n where n.dedupe_key = 'review:' || r.id)`,
  );
  for (const v of shown) {
    const n = await notifications.notify({ householdId: v.household_id, kind: 'new_review', title: `A ${v.stars}-star review`, link: '/host/reviews', dedupeKey: `review:${v.id}` }).catch(() => null);
    if (n) sent += 1;
  }
  for (const r of rows) {
    const o = { time_zone: r.time_zone };
    const start = startOf(r, o);
    const end = endOf(r, o);
    const hours = (start - now) / 3_600_000;
    if (hours > 0 && hours <= 24) {
      const n = await notifications.notify({ householdId: r.household_id, kind: 'reminder_24h', title: `Tomorrow: ${r.title ?? 'your event'}`, body: await notifications.hostWords(r.host_id, 'reminder'), link: guestLink(r.id), dedupeKey: `reminder:${r.id}:${r.session_id}` }).catch(() => null);
      if (n) sent += 1;
    }
    // "The next morning": from 08:00 UK time on the day after it ended.
    const morning = localInstant(plusDays(localDay(end, r.time_zone ?? 'Europe/London'), 1), '08:00', r.time_zone ?? 'Europe/London');
    if (now >= morning && now - morning < 2 * 86_400_000) {
      const n = await notifications.notify({ householdId: r.household_id, kind: 'after_event', title: `How was ${r.title ?? 'it'}?`, body: ['Did it happen, a rating, and a tip if you like.', await notifications.hostWords(r.host_id, 'thank_you')].filter(Boolean).join('\n\n'), link: guestLink(r.id), dedupeKey: `after:${r.id}` }).catch(() => null);
      if (n) sent += 1;
    }
  }
  return sent;
}

export default router;
