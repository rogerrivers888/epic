/**
 * Epic's fee, by the rules the Host tab draws (Settings revised v2, SX14, owner
 * 1 Oct 2026). Held in one place so every screen that shows a fee — the Money
 * next-payout line, a past activity, the level ladder, a payout's detail, the
 * yearly statement — reads the same number and names the same reason.
 *
 * The shape of a fee:
 *   1. A base rate that follows the host's trust level:
 *        Verified 20%  ·  Checked 15%  ·  Epic Trusted 10%
 *   2. On top of the level:
 *        · 0% intro — a host's first 90 days OR first 10 bookings, whichever
 *          ends first (so intro is active only while BOTH still hold).
 *        · 5% on a booking that came through the host's own direct link, at any
 *          level. Intro still wins over the link: during intro everything is 0%.
 *        · a £1.50 minimum per booking, NEVER on a 0% intro booking.
 *   3. The guarantee pool is funded FROM Epic's fee — never a separate line or
 *      a second deduction. There is nothing to add here for it.
 *
 * Every fee carries its rate and its reason, so a line can read
 *   "Epic's fee 15% · Checked"  /  "Epic's fee 5% · your link"  /
 *   "Epic's fee 0% · intro, 7 bookings left".
 *
 * The numbers are the business's to set; they are placeholders here, in config,
 * exactly as the handoff says (SX14: "The thresholds are placeholders").
 */

export const LEVEL_RATE = { verified: 20, checked: 15, trusted: 10 };
export const LEVEL_LABEL = { verified: 'Verified', checked: 'Checked', trusted: 'Epic Trusted' };
export const LINK_RATE = 5;
export const MIN_FEE_PENCE = 150; // £1.50, never on an intro booking
export const INTRO_DAYS = 90;
export const INTRO_BOOKINGS = 10;

/**
 * What it takes to reach Epic Trusted (SX14 checklist). Placeholders the
 * business sets; nothing reads them to GRANT a level — the trust rung is set in
 * the back office — they are what the ladder's checklist counts against.
 */
export const TRUSTED_THRESHOLDS = {
  completedExperiences: 25,
  ratingAtLeast: 4.8,
  ratingWindow: 20,
  unresolvedReports: 0,
};

/**
 * Whether a host is still inside the 0% intro, and why it will end. Active only
 * while BOTH the day window and the booking count are unspent ("whichever ends
 * first").
 */
export function introState({ hostStartedAt, bookingsSoFar = 0, now = new Date() }) {
  const days = hostStartedAt ? (now.getTime() - new Date(hostStartedAt).getTime()) / 86_400_000 : 0;
  const withinDays = days < INTRO_DAYS;
  const withinCount = bookingsSoFar < INTRO_BOOKINGS;
  return {
    active: withinDays && withinCount,
    bookingsLeft: Math.max(0, INTRO_BOOKINGS - bookingsSoFar),
    daysLeft: Math.max(0, Math.ceil(INTRO_DAYS - days)),
  };
}

/** A fee line: the rate, the reason, the label the screens print, and the split. */
function line(rate, reason, feePence, amountPence) {
  return {
    rate,
    reason,
    label: `Epic's fee ${rate}% · ${reason}`,
    feePence,
    netPence: amountPence - feePence,
  };
}

/**
 * Epic's fee for one booking. `intro` is the result of `introState` at the time
 * the booking counts (null = not in intro). `viaHostLink` is the booking's own
 * flag (migration 332).
 */
export function feeForBooking({ amountPence = 0, level = 'verified', viaHostLink = false, intro = null }) {
  if (intro?.active) {
    const reason = `intro, ${intro.bookingsLeft} ${intro.bookingsLeft === 1 ? 'booking' : 'bookings'} left`;
    return line(0, reason, 0, amountPence);
  }
  const rate = viaHostLink ? LINK_RATE : (LEVEL_RATE[level] ?? LEVEL_RATE.verified);
  const reason = viaHostLink ? 'your link' : (LEVEL_LABEL[level] ?? LEVEL_LABEL.verified);
  let feePence = Math.round((amountPence * rate) / 100);
  // The £1.50 minimum, but never more than the booking itself, and never on intro.
  if (feePence < MIN_FEE_PENCE) feePence = Math.min(MIN_FEE_PENCE, amountPence);
  return line(rate, reason, feePence, amountPence);
}

/**
 * Fees across a period, where bookings may sit at different rates (SX13b, SX18,
 * SX20). Returns one line per distinct rate+reason with the summed fee and
 * gross, newest-generous first, plus the totals. Each input booking is already
 * resolved to its own `{ amountPence, level, viaHostLink, intro }`.
 */
export function feesForPeriod(bookings) {
  const groups = new Map();
  let grossPence = 0;
  let feePence = 0;
  for (const b of bookings) {
    const l = feeForBooking(b);
    grossPence += b.amountPence ?? 0;
    feePence += l.feePence;
    const key = `${l.rate}|${l.reason}`;
    const g = groups.get(key) ?? { rate: l.rate, reason: l.reason, label: l.label, feePence: 0, grossPence: 0, count: 0 };
    g.feePence += l.feePence;
    g.grossPence += b.amountPence ?? 0;
    g.count += 1;
    groups.set(key, g);
  }
  const lines = [...groups.values()].sort((a, b) => a.rate - b.rate);
  return { lines, grossPence, feePence, netPence: grossPence - feePence };
}
