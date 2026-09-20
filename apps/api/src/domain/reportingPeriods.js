/**
 * The period picker, and the rule underneath it.
 *
 * The reporting handoff calls this "the rule that broke the prototype three
 * times", and it is worth stating before any code:
 *
 *   **Every displayed value has a type, and the picker must respect it.**
 *
 *   · **flow** scales with the window — revenue, cost, new subscribers,
 *     bookings, visits, supplier spend, units bought.
 *   · **stock** never scales; it is a count at a moment — active households,
 *     live subscriptions, approved hosts, places stored.
 *   · **rate** never scales, and is always said "a month" — MRR, churn,
 *     per-subscriber figures, margin percentages.
 *   · **fixed window** never scales, because its own window is part of what it
 *     means — "events scheduled in the next 60 days".
 *
 * The prototype expressed a period as a multiplier (0.92, 2.95, 11.4) and
 * multiplied at the call site, which is exactly how a stock comes to be scaled.
 * Here a period is a **pair of date ranges** instead: the window asked for, and
 * the window of the same length immediately before it, so that a comparison is
 * always against the same length of time rather than a monthly average. A flow
 * is summed over one; a stock is read at `to`; a rate is read as it stands.
 *
 * Nothing downstream of this file multiplies anything by a factor. The API
 * returns numbers already correct for the window, and the client renders them.
 */

/** The five, in the order the dropdown lists them. */
export const PERIODS = [
  { key: 'last-30-days', label: 'Last 30 days', months: 1 },
  { key: 'this-month', label: 'This month', months: 1 },
  { key: 'last-month', label: 'Last month', months: 1 },
  { key: 'last-3-months', label: 'Last 3 months', months: 3 },
  { key: 'last-12-months', label: 'Last 12 months', months: 12 },
];

export const PERIOD_KEYS = PERIODS.map((p) => p.key);
export const DEFAULT_PERIOD = 'this-month';

const startOfMonth = (d, back = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/**
 * A period, resolved against a clock.
 *
 * `now` is a parameter so the tests can pin a date rather than a snapshot of
 * whatever day they happened to run on.
 *
 * Returns `from`/`to` for the window, `prevFrom`/`prevTo` for the window of the
 * same length before it, and `months` — how many monthly buckets the window
 * covers, which is what the drill's aggregation needs.
 */
export function resolvePeriod(key, now = new Date()) {
  const found = PERIODS.find((p) => p.key === key) ?? PERIODS.find((p) => p.key === DEFAULT_PERIOD);
  const to = now;

  let from;
  let end = to;
  switch (found.key) {
    case 'last-30-days':
      from = addDays(to, -30);
      break;
    case 'this-month':
      from = startOfMonth(to);
      break;
    case 'last-month':
      from = startOfMonth(to, 1);
      // A closed month ends where this one starts, so "last month" is a whole
      // month rather than a month plus however far into today we are.
      end = startOfMonth(to);
      break;
    case 'last-3-months':
      from = startOfMonth(to, 2);
      break;
    default:
      from = startOfMonth(to, 11);
      break;
  }

  const span = end.getTime() - from.getTime();
  return {
    key: found.key,
    label: found.label,
    months: found.months,
    from: from.toISOString(),
    to: end.toISOString(),
    // The comparison window: the same length, immediately before. The supplier
    // register's "expected" column is this and not a monthly average, which is
    // the handoff's own worked example of the rule.
    prevFrom: new Date(from.getTime() - span).toISOString(),
    prevTo: from.toISOString(),
  };
}

/**
 * The twelve monthly buckets a drill is drawn from, ending with the month the
 * window ends in. Labels are the month's own short name so a chart never has to
 * guess what "M" meant.
 */
export function monthBuckets(now = new Date(), count = 12) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = startOfMonth(now, i);
    out.push({
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      // Three letters, always: en-GB's own "short" month gives "Sept", which
      // in a row of twelve axis labels is the only one a different width.
      label: start.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3),
      from: start.toISOString(),
      to: startOfMonth(now, i - 1).toISOString(),
    });
  }
  return out;
}
