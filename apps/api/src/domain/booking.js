/**
 * The guest side's rules (hosting v4 handover §4, guest brief v2). Pure: no
 * IO. The routes (routes/guestBookings.js) read the rows; these decide what
 * the main button says, who may book what, and what a cancellation gives back.
 */

import { refundFor } from './money.js';

/**
 * The event page's main button (guest brief §2): Book · Ask to book · Join the
 * waiting list · Full · Finished. Closed when the host has paused hosting or
 * the event is not live.
 */
export function mainAction({ offer, sessionsAhead = [], hostPaused = false, placesLeft = null }) {
  if (hostPaused || !['live'].includes(offer.state)) return offer.state === 'ended' ? 'finished' : 'closed';
  if (offer.lane === 'onrequest') return 'ask';
  if (!sessionsAhead.length) return 'finished';
  if (placesLeft != null && placesLeft <= 0) return offer.waitlist_on ? 'waitlist' : 'full';
  return 'book';
}

/** Places left on a session: its most, or the event's, less who holds a place. Null when there is no most. */
export function placesLeft(session, offer) {
  const max = session?.max_count ?? offer?.max_count ?? null;
  if (max == null) return null;
  return Math.max(0, max - Number(session?.booked ?? 0));
}

/**
 * What a booking holds, as it is made: the sessions it covers for its kind.
 *   whole       One-off and Course: every scheduled session ahead
 *   drop_in     Weekly: this week's session — the next one ahead
 *   book_ahead  Weekly: the sessions picked, all ahead
 *   request     On request: none yet — a session is made when the host accepts
 */
export function sessionsForBooking(kind, ahead, picked = []) {
  if (kind === 'whole') return ahead.map((s) => s.id);
  if (kind === 'drop_in') return ahead[0] ? [ahead[0].id] : [];
  if (kind === 'book_ahead') {
    const ok = new Set(ahead.map((s) => s.id));
    const ids = [...new Set(picked)].filter((id) => ok.has(id));
    return ids.length === new Set(picked).size ? ids : null;
  }
  return [];
}

/** Which kinds of booking a lane allows. */
export const KINDS_BY_LANE = Object.freeze({ oneoff: ['whole'], course: ['whole'], weekly: ['drop_in', 'book_ahead'], onrequest: ['request'] });

/**
 * Who's going, checked (guest brief §3): at least one person, no more than
 * the most per family; each child with an age or a date of birth (never both
 * needed, one required); an adults-only event needs the 18+ tick and no
 * children; a drop-off event needs an emergency number per child; a child's
 * age inside the event's range. Returns `{ ok }` or `{ error, message }`.
 */
export function checkParty({ adults = 0, children = [], adultConfirmed = false }, offer, { onDate, adultAge = 18 } = {}) {
  const a = Math.max(0, Math.floor(Number(adults) || 0));
  const kids = Array.isArray(children) ? children : [];
  const heads = a + kids.length;
  if (heads < 1) return { error: 'party_empty', message: 'Say who’s going.' };
  if (offer.party_max && heads > offer.party_max) return { error: 'party_too_big', message: `Up to ${offer.party_max} in one booking.` };
  const adultsOnly = offer.age_min != null && offer.age_min >= adultAge;
  if (adultsOnly) {
    if (kids.length) return { error: 'adults_only', message: 'This one is for adults only.' };
    if (!adultConfirmed) return { error: 'adult_tick', message: 'Tick to say you’re 18 or over.' };
  }
  const dropOff = offer.parents === 'drop_off';
  for (const k of kids) {
    const age = childAge(k, onDate);
    if (age == null) return { error: 'child_age', message: 'Give each child’s age or date of birth.' };
    if (age < 0 || age > 17) return { error: 'child_age', message: 'A child is 0 to 17.' };
    if (offer.age_min != null && age < offer.age_min) return { error: 'too_young', message: `This one is for ages ${offer.age_min}${offer.age_max != null ? ` to ${offer.age_max}` : ' and up'}.` };
    if (offer.age_max != null && age > offer.age_max) return { error: 'too_old', message: `This one is for up to age ${offer.age_max}.` };
    if (dropOff && !/^\+?[0-9 ]{9,16}$/.test(String(k.emergencyContact ?? '').trim())) return { error: 'emergency_contact', message: 'Give an emergency number for each child.' };
  }
  if (!a && !dropOff && offer.age_max != null && offer.age_max < adultAge) return { error: 'adult_needed', message: 'Parents stay for this one: add a grown-up.' };
  return { ok: true, heads, adults: a, children: kids.length };
}

/** A child's age on the day: the age given, or worked out from the date of birth. Null with neither. */
export function childAge(k, onDate) {
  if (k?.age != null && k.age !== '' && Number.isInteger(Number(k.age))) return Number(k.age);
  const dob = String(k?.dob ?? k?.dateOfBirth ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const day = onDate ?? new Date().toISOString().slice(0, 10);
  const [y, m, d] = dob.split('-').map(Number);
  const [Y, M, D] = String(day).slice(0, 10).split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

/**
 * What a guest gets back for cancelling now (guest brief §7), and why.
 *
 *   ask-to-book still asked     the hold is released — nothing was taken
 *   a date the host moved       everything, whatever the policy
 *   a course that has started   nothing, unless the host cancels
 *   otherwise                   the policy agreed at booking, counted from the
 *                               first session (One-off, Course) or from each
 *                               session given up (Weekly, On request)
 *
 * `sessions` are the booking's live sessions, each `{ id, startsAt (Date),
 * movedAfterBooking }`; `losing` the ids being given up. `paid` is what is
 * left to refund. Returns `{ pence, cause, words }` or `{ pence: null, ... }`
 * when the terms are unknown and a person must decide.
 */
export function cancelQuote({ booking, lane, sessions, losing, now = new Date(), terms }) {
  const left = Math.max(0, Number(booking.charged_pence ?? 0) - Number(booking.refunded_pence ?? 0));
  if (booking.request_state === 'asked') return { pence: 0, cause: 'declined', release: true, words: 'Your card hold is released.' };
  if (!['charged', 'partially_refunded'].includes(booking.payment_state) || !left) return { pence: 0, cause: 'guest_cancelled', words: null };
  const lose = sessions.filter((s) => losing.includes(s.id));
  const keepsSome = sessions.some((s) => !losing.includes(s.id));
  const all = Math.max(1, Number(booking.all_sessions_count ?? sessions.length));
  const share = keepsSome ? Math.floor((Number(booking.charged_pence ?? 0) * lose.length) / all) : left;
  const s = { refund_terms: terms ?? null };
  if (lose.some((x) => x.movedAfterBooking)) return { pence: Math.min(left, share), cause: 'date_changed', words: 'The host moved the date: a full refund.' };
  const first = [...sessions].sort((a, b) => a.startsAt - b.startsAt)[0];
  const started = (lane === 'course' || lane === 'oneoff') && first && first.startsAt <= now;
  if (lane === 'course' && started) return { pence: 0, cause: 'guest_cancelled', words: 'The course has started: no refund.' };
  // One-off and Course count from the first session; Weekly and On request from each session given up.
  const from = lane === 'oneoff' || lane === 'course' ? [first] : lose;
  let pence = 0;
  for (const x of from) {
    const hours = (x.startsAt.getTime() - now.getTime()) / 3_600_000;
    const part = lane === 'oneoff' || lane === 'course' ? share : Math.floor(share / Math.max(1, lose.length));
    const r = refundFor({ policy: booking.refund_policy, paidPence: part, hoursBefore: hours, cause: 'guest_cancelled' }, s);
    if (r == null) return { pence: null, cause: 'guest_cancelled', words: 'Epic will look at this one and come back to you.' };
    pence += r;
  }
  pence = Math.min(left, pence);
  return { pence, cause: 'guest_cancelled', words: null };
}

/** Answers can be changed until 24 hours before the first session still ahead (guest brief §6). */
export const answersEditable = (firstStart, now = new Date()) => Boolean(firstStart) && firstStart.getTime() - now.getTime() > 24 * 3_600_000;

/** A tip is offered once, up to 7 days after the event (README "Rules"). */
export const tipOpen = (lastEnd, now = new Date()) => Boolean(lastEnd) && now >= lastEnd && now.getTime() - lastEnd.getTime() <= 7 * 86_400_000;

/** The guest's card chip (guest brief §5): On · Waiting on numbers · Requested · Changed · Called off · Cancelled · Waiting list #2. */
export function guestChip({ booking, sessions, min, booked, waitPosition = null }) {
  if (waitPosition != null) return { chip: 'waitlist', words: `Waiting list #${waitPosition}` };
  if (booking.state === 'cancelled') return booking.cancel_cause === 'called_off' ? { chip: 'called_off', words: 'Called off' } : { chip: 'cancelled', words: 'Cancelled' };
  if (booking.request_state === 'asked') return { chip: 'requested', words: 'Requested' };
  if (sessions.some((s) => s.changed && !booking.change_seen_at)) return { chip: 'changed', words: 'Changed' };
  if (min && booked < min && !sessions.some((s) => s.decided === 'on')) return { chip: 'waiting', words: 'Waiting on numbers' };
  return { chip: 'on', words: 'On' };
}
