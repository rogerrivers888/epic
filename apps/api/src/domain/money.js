/**
 * The money engine's rules (hosting v4 handover §5, §7). Pure: no IO.
 *
 * Every number comes from `hosting_settings` (the settings map, below), read
 * when it is used and never copied into code. A booking's fee is worked out
 * once, when the booking is made, and stored on it with its rate and reason —
 * history is never recomputed from today's rates.
 *
 * Every rule here has a can't-speak state. A setting the owner has not set yet
 * is null, and anything that depends on it answers null with a reason rather
 * than a number that happens to be nought (CLAUDE.md).
 */

/**
 * The settings as the engine reads them: a row's value, or null when the row
 * is switched off or still to set. Rows are `{ key, value, is_on }`.
 */
export function settingsMap(rows) {
  const m = {};
  for (const r of rows ?? []) m[r.key] = r.is_on === false ? null : r.value ?? null;
  return m;
}

const num = (v) => (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
const pctOf = (pence, p) => Math.round((pence * p) / 100);

// ---------------------------------------------------------------------------
// Epic's share of a public, paid booking: by rating, never by how many events
// ---------------------------------------------------------------------------

/**
 * 20% to start → 15% after 5 rated events averaging 4.5+ → 10% after 10 rated
 * events averaging 4.8+ (handover §3.1, §7). `ladder` is the setting; the first
 * step is the starting rate and every later step names what it takes. A host
 * with no rating yet is on the first step.
 */
export function ratedRate(ladder, rating = {}) {
  if (!Array.isArray(ladder) || !ladder.length || num(ladder[0]?.pct) == null) return null;
  const events = num(rating.ratedEvents) ?? 0;
  const avg = num(rating.avg);
  let rate = num(ladder[0].pct);
  for (const s of ladder.slice(1)) {
    if (avg != null && events >= s.ratedEvents && avg >= s.avgAtLeast) rate = Math.min(rate, num(s.pct));
  }
  return rate;
}

/**
 * Where a host stands: the rate now and the next step, with what is still
 * needed ("8 of 10 rated events to 10%"). Null when the ladder is not set.
 */
export function ladderProgress(ladder, rating = {}) {
  const rate = ratedRate(ladder, rating);
  if (rate == null) return null;
  const events = num(rating.ratedEvents) ?? 0;
  const avg = num(rating.avg);
  const next = ladder.slice(1).filter((s) => num(s.pct) < rate).sort((a, b) => b.pct - a.pct)[0] ?? null;
  return {
    rate,
    ratedEvents: events,
    avg,
    next: next
      ? {
        pct: next.pct,
        ratedEvents: next.ratedEvents,
        avgAtLeast: next.avgAtLeast,
        eventsToGo: Math.max(0, next.ratedEvents - events),
        avgOk: avg != null && avg >= next.avgAtLeast,
      }
      : null,
  };
}

/**
 * The 0% intro: a host's first `days` days or first `bookings` bookings,
 * whichever ends first, so it holds only while both do. Null intro (switched
 * off) is never in it.
 */
export function introState(intro, { hostStartedAt = null, bookingsSoFar = 0, now = new Date() } = {}) {
  const days = num(intro?.days);
  const bookings = num(intro?.bookings);
  if (!intro || days == null || bookings == null) return { active: false, daysLeft: null, bookingsLeft: null };
  const since = hostStartedAt ? (now.getTime() - new Date(hostStartedAt).getTime()) / 86_400_000 : 0;
  const daysLeft = Math.max(0, Math.ceil(days - since));
  const bookingsLeft = Math.max(0, bookings - bookingsSoFar);
  return { active: daysLeft > 0 && bookingsLeft > 0, daysLeft, bookingsLeft };
}

/**
 * The fee on one booking, as it is made (handover §5).
 *
 *   free, or paid to the host directly — nothing
 *   private, paid through Epic — the private payment fee (3%, card fees
 *                   included); the £10 / Pro is per event, not per booking
 *   public, paid — intro 0% (when on) · an override set through an Approval ·
 *                   the host's own link 5% (when on) · the rated rate; then the
 *                   £1.50 minimum (when on), never on an intro booking and never
 *                   more than the booking itself
 *
 * `booking`: `{ visibility, valuePence, viaHostLink, throughEpic }`.
 * `host`:    `{ rating: { ratedEvents, avg }, hostStartedAt, bookingsSoFar, feeOverridePct }`.
 * Returns `{ ratePct, reason, feePence, hostPence }`, or `{ ratePct: null,
 * reason: 'not_set', missing }` when a setting it needs is still to set — the
 * caller refuses the booking rather than charge an invented fee.
 */
export function feeFor(booking, host = {}, s = {}, now = new Date()) {
  const value = Math.max(0, Math.round(num(booking.valuePence) ?? 0));
  const free = { ratePct: 0, reason: 'free', feePence: 0, hostPence: value };
  if (!value || booking.throughEpic === false) return free;
  const out = (ratePct, reason, feePence) => ({ ratePct, reason, feePence, hostPence: value - feePence });
  if (booking.visibility !== 'public') {
    const r = num(s.private_payment_fee);
    if (r == null) return { ratePct: null, reason: 'not_set', missing: 'private_payment_fee' };
    return out(r, 'private_payment', pctOf(value, r));
  }
  if (introState(s.intro_zero, { hostStartedAt: host.hostStartedAt, bookingsSoFar: host.bookingsSoFar ?? 0, now }).active) return out(0, 'intro', 0);
  let rate;
  let reason;
  const override = num(host.feeOverridePct);
  const link = num(s.host_link_rate);
  if (override != null) { rate = override; reason = 'override'; }
  else if (booking.viaHostLink && link != null) { rate = link; reason = 'host_link'; }
  else {
    rate = ratedRate(s.public_commission, host.rating ?? {});
    if (rate == null) return { ratePct: null, reason: 'not_set', missing: 'public_commission' };
    reason = 'standard';
  }
  let fee = pctOf(value, rate);
  const min = num(s.minimum_fee);
  if (min != null && fee < min) { fee = Math.min(min, value); reason = 'minimum'; }
  return out(rate, reason, fee);
}

/** A tip's admin fee: a percentage with a floor, paid by the guest on top. The host keeps the whole tip. */
export function tipFee(amountPence, s = {}) {
  const t = s.tip_admin_fee;
  const p = num(t?.pct);
  const floor = num(t?.minPence);
  if (p == null || floor == null) return null;
  return Math.max(floor, pctOf(amountPence, p));
}

// ---------------------------------------------------------------------------
// refunds
// ---------------------------------------------------------------------------

/** Causes that always refund in full (handover §5). */
export const FULL_REFUND_CAUSES = Object.freeze(['host_cancelled', 'called_off', 'date_changed', 'declined', 'lapsed']);

/**
 * How much of `paidPence` goes back when a booking is cancelled `hoursBefore`
 * the start of its window (the first session for One-off and Course, the
 * booked session for Weekly book-ahead and On request).
 *
 * A host cancelling, a call-off, a guest leaving after the host moved the date,
 * a declined or lapsed ask-to-book: always everything. A course that has
 * started: nothing to a guest who leaves. Otherwise the event's policy, as the
 * settings define it. Null when the policy or its terms are unknown — a person
 * decides, never a guess on money.
 */
export function refundFor({ policy, paidPence, hoursBefore, cause = 'guest_cancelled', courseStarted = false }, s = {}) {
  const paid = Math.max(0, Math.round(num(paidPence) ?? 0));
  if (FULL_REFUND_CAUSES.includes(cause)) return paid;
  if (courseStarted) return 0;
  const terms = s.refund_terms?.[policy];
  const h = num(hoursBefore);
  if (!terms || h == null) return null;
  const full = num(terms.fullHoursBefore);
  if (full != null) return h >= full ? paid : 0;
  const part = num(terms.partHoursBefore);
  const partPct = num(terms.partPct);
  if (part != null && partPct != null) return h >= part ? pctOf(paid, partPct) : 0;
  return null;
}

/**
 * Depends on numbers: everyone pays the minimum-numbers price at booking, and
 * the difference comes back at decides-by once the numbers are final. Pence
 * are whole, so the price each is rounded up and the host is never short.
 */
export function numbersSettlement({ totalPence, minCount, heads }) {
  const total = Math.max(0, Math.round(num(totalPence) ?? 0));
  const min = Math.max(1, Math.round(num(minCount) ?? 1));
  const n = Math.max(min, Math.round(num(heads) ?? 0));
  const paidEach = Math.ceil(total / min);
  const finalEach = Math.ceil(total / n);
  return { paidEach, finalEach, backEach: Math.max(0, paidEach - finalEach) };
}

// ---------------------------------------------------------------------------
// payouts
// ---------------------------------------------------------------------------

const truthy = (v) => v === true || v === 'true';

/**
 * Whether a session's payout goes now (handover §5): `payout_release` hours
 * after it ends with no complaint open. A guest's "yes, it happened" or a
 * review releases it earlier when that setting is on. A complaint, missing tax
 * details or an unfinished Stripe account hold it. The host's own attendance
 * marks are not an input here at all — they never release a payout.
 *
 * Returns `{ state: 'release', by }`, `{ state: 'held', reason }` or
 * `{ state: 'wait', releaseAt }`; `{ state: 'held', reason: 'not_set' }` when
 * the release window is still to set.
 */
export function payoutDecision({ endsAt, now = new Date(), complaintOpen = false, guestConfirmed = false, reviewed = false, taxMissing = false, stripeReady = true }, s = {}) {
  if (complaintOpen) return { state: 'held', reason: 'complaint' };
  if (taxMissing) return { state: 'held', reason: 'tax_details' };
  if (!stripeReady) return { state: 'held', reason: 'stripe_incomplete' };
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return { state: 'held', reason: 'no_end' };
  if (now.getTime() < end) return { state: 'wait', releaseAt: null };
  if (truthy(s.payout_early_on_confirm) && (guestConfirmed || reviewed)) return { state: 'release', by: guestConfirmed ? 'guest_confirmed' : 'review' };
  const hours = num(s.payout_release);
  if (hours == null) return { state: 'held', reason: 'not_set' };
  const at = end + hours * 3_600_000;
  if (now.getTime() >= at) return { state: 'release', by: 'time' };
  return { state: 'wait', releaseAt: new Date(at) };
}

/** A change or cancel this close to the session counts against the host. Null when the window is not set. */
export function isLate(sessionStartsAt, s = {}, now = new Date()) {
  const h = num(s.late_change_window);
  if (h == null) return null;
  return new Date(sessionStartsAt).getTime() - now.getTime() < h * 3_600_000;
}

// ---------------------------------------------------------------------------
// the price of a booking
// ---------------------------------------------------------------------------

/**
 * Per-person and child prices, or one price per booking (On request); a group
 * discount on one booking of `groupMin` or more. Returns the lines the receipt
 * prints, the gross, the discount and the value the fee is taken from.
 */
export function priceBooking({ pricePence, childPence = null, adults = 0, children = 0, per = 'person', groupPct = null, groupMin = null }) {
  const price = Math.max(0, Math.round(num(pricePence) ?? 0));
  const a = Math.max(0, Math.round(num(adults) ?? 0));
  const c = Math.max(0, Math.round(num(children) ?? 0));
  const lines = [];
  if (per === 'booking') lines.push({ label: 'A booking', each: price, count: 1, pence: price });
  else {
    if (a) lines.push({ label: a === 1 ? 'Adult' : 'Adults', each: price, count: a, pence: price * a });
    if (c) {
      const each = num(childPence) == null ? price : Math.max(0, Math.round(num(childPence)));
      lines.push({ label: c === 1 ? 'Child' : 'Children', each, count: c, pence: each * c });
    }
  }
  const gross = lines.reduce((n, l) => n + l.pence, 0);
  const gp = num(groupPct);
  const gm = num(groupMin);
  const discount = gp != null && gm != null && a + c >= gm ? pctOf(gross, gp) : 0;
  return { lines, grossPence: gross, discountPence: discount, valuePence: gross - discount };
}

/**
 * The fee words a screen prints beside a booking or a payout line, from what
 * was stored with it: "Epic's fee 15%", "0% · intro", "5% · your link",
 * "£1.50 minimum".
 */
export function feeWords({ ratePct, reason, feePence }) {
  if (reason === 'free') return 'No fee';
  if (reason === 'intro') return "Epic's fee 0% · intro";
  if (reason === 'host_link') return `Epic's fee ${ratePct}% · your link`;
  if (reason === 'minimum') return `Epic's fee £${(feePence / 100).toFixed(2)} minimum`;
  if (reason === 'private_payment') return `${ratePct}% payment fee`;
  return `Epic's fee ${ratePct}%`;
}
