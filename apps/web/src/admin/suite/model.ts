/**
 * The reporting suite's numbers, and the rules for saying them.
 *
 * The suite draws one model — `/api/admin/suite` — five ways. Everything in
 * this file is the part of the design that is arithmetic rather than layout, so
 * that it can be tested without a screen:
 *
 *  · **a figure formats from its unit and the model's own currency**, so a cost
 *    measured in dollars is never printed with a pound sign;
 *  · **a null is a gap and says what it is**, never a zero — "No payment
 *    provider", which is the handoff's seventh non-negotiable;
 *  · **a share under thirty is said as counts** — "7 of 9" — because a
 *    percentage of nine is a lie about how much is known;
 *  · **per-subscriber is a formatting context**, applied once, not converted at
 *    two hundred call sites.
 *
 * Nothing here scales anything by a period factor. The API answers with figures
 * already correct for the window (`domain/reportingPeriods.js`), and a client
 * that multiplied would be the bug the whole arrangement exists to prevent.
 */

// ---------------------------------------------------------------------------
// what comes back
// ---------------------------------------------------------------------------

export type PeriodKey = 'last-30-days' | 'this-month' | 'last-month' | 'last-3-months' | 'last-12-months';

export type Period = {
  key: PeriodKey;
  label: string;
  months: number;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  factor?: number;
};

/** A label with a figure, and how long its bar is as a share of the biggest. */
export type Row = { label: string; value: number | string | null; pct?: number | null; of?: number | null };

export type Measure = {
  key: string;
  label: string;
  kind: 'flow' | 'stock' | 'rate' | 'fixed';
  unit: 'money' | 'count';
  value: number | null;
  delta: number | null;
  sub: string | null;
  expected?: number | null;
  series: number[] | null;
};

export type Stream = {
  key: string;
  label: string;
  revenue: number | null;
  cost: number | null;
  margin: number | null;
  marginPct: number | null;
  growth: number | null;
  perSub: number | null;
  units: number | null;
  unitName: string;
  /** What one unit was worth — a number, so Per subscriber converts it. */
  avgUnit: number | null;
  churn: string | null;
  series: number[] | null;
  estimated?: boolean;
  gap?: string | null;
  /**
   * The channels the money came through, indented under the stream in the table
   * lens. They deliberately carry no cost and no margin: cost allocates at
   * stream level only (handoff §2).
   */
  details?: {
    label: string;
    units: number | null;
    revenue: number | null;
    avgUnit: number | null;
    growth: number | null;
    /** A count that is not part of the units total — "14 bookings", free. */
    memo?: string | null;
  }[];
};

export type HouseholdRow = {
  id: string;
  accountId?: string | null;
  name: string;
  area: string | null;
  people: number;
  origin: string;
  plan: string;
  monthPence: number;
  joined: string | null;
  lastSeenDays: number | null;
  places: number;
  daysOut: number;
  tripsAway?: number;
  bookings: number;
  ratings: number;
  costUsd?: number;
  status: 'live' | 'trial' | 'at_risk' | 'cancelled' | string;
  statusNote: string | null;
};

export type SupplierRow = {
  key: string;
  name: string;
  direction: 'cost' | 'revenue';
  unitName: string;
  unitCost: string | null;
  volume: number | null;
  /**
   * `null` where the supplier is invoiced rather than metered — Fly.io, Neon,
   * Cloudflare R2, the app stores. Nought would read as free.
   */
  spend: number | null;
  expected: number | null;
  share: number | null;
  series: number[] | null;
  status: string;
  adapterState: string;
  costClass: string | null;
  /** Why there is no spend figure, where there isn't one. */
  gap?: string | null;
};

/** One supplier's record: what it is for, whether it is connected, how it behaves. */
export type SupplierRecord = {
  supplier: {
    key: string;
    name: string;
    direction: string;
    purpose: string | null;
    usedBy: string | null;
    costClass: string | null;
    unitName: string | null;
    status: string;
    adapterState: string;
    credentialMasked: string | null;
    credentialExpiry: string | null;
    rotatedAt: string | null;
    allowanceNote: string | null;
    rate: { says: string; amount: number | null; unit: string | null; currency: string | null; confirmedAt: string | null; confirmedBy: string | null; sourceUrl: string | null } | null;
    history: { says: string; from: string; to: string | null; confirmedAt: string | null; confirmedBy: string | null; sourceUrl: string | null }[];
  };
  health: {
    calls: number | null;
    failures: number | null;
    failurePct: number | null;
    latency: string | null;
    healthGap?: string | null;
    spend: number | null;
    expected: number | null;
    variance: number | null;
    variancePct: number | null;
    /** Why there is no comparison, where the figure itself is real. */
    varianceGap?: string | null;
    currency: Currency;
    gap?: string | null;
  };
  series: number[] | null;
  mock?: boolean;
  period?: Period;
};

/** A tier on the Subscriptions screen: three editable prices and four derived rows. */
export type Tier = {
  key: string;
  label: string;
  note: string | null;
  active: boolean;
  subscribers: number;
  webPence: number | null;
  iosPence: number | null;
  androidPence: number | null;
  discountPct: number;
  annualWebPence: number | null;
  annualIosPence: number | null;
  iosUpliftPct: number | null;
  revenueAtThisPricePence: number | null;
  priceSetAt: string | null;
  series?: number[] | null;
  history: { channel?: string; pence: number; discountPct: number; from: string; to: string | null; by: string | null; note: string | null }[];
};

export type Benefit = {
  id: string;
  label: string;
  values: Record<string, string>;
  position: number;
  publishedAt: string | null;
};

export type Subscriptions = {
  mock?: boolean;
  tiers: Tier[];
  benefits: Benefit[];
  channels: {
    rows: { key: string; label: string; subscribers: number | null; pence: number | null; feePence: number | null }[];
    note?: string | null;
    net?: Row[] | null;
    blendedFeePct: number | null;
    netPence?: number | null;
    ifEveryoneUsedApplePence: number | null;
    mrrAfterFeesPence: number | null;
  };
  publishedAt: string | null;
  unpublished: number;
  standing: {
    mrrPence: number;
    mrrDelta: number | null;
    averagePaidPence: number | null;
    averagePaidDelta: number | null;
    onAnnual: number | null;
    onAnnualOf: number;
    onAnnualGap?: string | null;
    onAnnualNote?: string | null;
  };
};

export type Suite = {
  mock: boolean;
  basis: string;
  period: Period;
  periods: { key: PeriodKey; label: string; months: number }[];
  gaps: Record<string, string>;
  estate: {
    households: number; customers: number; active: number; active90?: number;
    paying: number; trial: number; atRisk: number; people: number; origins: Row[];
  };
  overview: {
    measures: Measure[];
    subscriptions: {
      opening: number; added: number; lost: number; live: number;
      churnPct: number | null; wasChurnPct: number | null; churnGap?: string;
      arrivals: Row[] | null; arrivalsNote: string | null;
      sources: Row[] | null; sourcesGap?: string;
    };
    revenue: {
      byStream: Row[]; byStreamGap?: string;
      mrrByPlan: Row[]; mrr: number;
      forecast: { today: number; steps: Row[]; total: number } | null; forecastGap?: string;
    };
    engagement: {
      shares: Row[]; shareDeltas: number[] | null;
      visits: number; newVisits: number; returningVisits: number;
      timeOnSiteSeconds: number; timeOnSiteDelta: number | null;
      activeWeeksPerQuarter: number | null; bySurface: Row[];
    };
    events: {
      ran: number; scheduled60: number; guests: number; averageParty: number | null;
      fillPct: number | null; hosts: Row[]; selling: Row[] | null; sellingGap?: string;
      averageTicket: number | null; ratedGoodPct: number | null;
    };
    standing: {
      directBookings: number; timeOnSiteSeconds: number; timeOnSiteDelta: number | null;
      satisfactionPct: number | null; satisfactionGap?: string;
    };
  };
  money: {
    subscribers: number;
    streams: Stream[];
    total: {
      revenue: number | null; cost: number | null; margin: number | null; marginPct: number | null;
      marginDelta: number | null; perSub: number | null; perSubOut: number | null;
      perSubKept: number | null; growth: number | null;
    };
    totalGap?: string;
    breakdown: Record<string, Record<string, unknown>>;
    grossBookings: number | null;
    grossBookingsDelta?: number | null;
    refunds: number | null;
    costToServe: {
      total: number | null; allocated: number | null; byKind: Row[]; byClass: Row[];
      byPurpose?: { label: string; value: number; cls: string; calls: number }[];
      research: number | null; delta?: number | null; classDerived?: boolean;
    };
    perSubscriber: { subscription: number; hotel: number; hosting: number; activity: number; total: number; out: number; kept: number } | null;
    perSubscriberGap?: string;
    unitEconomics: { ltv: number; churnPct: number; lifeMonths: number; cac: number; paybackMonths: number } | null;
    unitEconomicsGap?: string;
  };
  customers: {
    households: HouseholdRow[]; shown: number; total: number;
    paying: number; payingMrr: number; trial: number;
    trialConvertPct: number | null; trialGranted: number | null; atRisk: number;
    /** How the estate arrived — the slice rule 4 makes every figure subject to. */
    origins?: Row[] | null;
  };
  subscriptions: Subscriptions;
  suppliers: {
    rows: SupplierRow[]; total: number; expected: number;
    expectedNextMonth: number | null; expectedNextMonthDeltaPct: number | null;
    expectedNextMonthGap?: string | null;
    largest: SupplierRow | null;
    currency?: 'gbp' | 'usd';
  };
  behaviour: {
    base: number;
    measures: { key: string; label: string; value: number | null; delta: number | null; series: number[] | null }[];
    panels: Record<string, {
      asked: Row[]; became: Row[]; becameHighlight: number; becameFoot?: Row;
      funnel: Row[]; funnelGap?: string;
    }>;
    returnBuckets: Row[]; returnBase: number; returnHighlight: number;
  };
  history: { labels: string[]; keys: string[]; series: Record<string, number[] | null> };
};

export type HouseholdRecord = Record<string, any> & { id: string; name: string };

// ---------------------------------------------------------------------------
// saying a figure
// ---------------------------------------------------------------------------

/**
 * How money is said, and in which currency.
 *
 * Revenue is contracted in pence and shown in pounds. Provider cost is measured
 * in dollars, because that is the unit `provider_calls` records and converting
 * it would mean inventing an exchange rate. So a formatter carries the currency
 * rather than assuming one, and the mock estate — which is a British business —
 * is pounds throughout.
 */
export type Currency = 'gbp' | 'usd';

const SIGN: Record<Currency, string> = { gbp: '£', usd: '$' };

/**
 * The per-subscriber context.
 *
 * The handoff: "Per subscriber converts **every** money value on the screen —
 * implement it as a formatting context, not per call site." So it is a property
 * of the formatter, made once at the top of the screen and passed down.
 */
export type Fmt = {
  currency: Currency;
  /** Divide every money figure by this many subscribers, or don't. */
  perSub: number | null;
  money: (v: number | null | undefined, opts?: { pence?: boolean; sign?: boolean }) => string | null;
  count: (v: number | null | undefined, dp?: number) => string | null;
  delta: (v: number | null | undefined, suffix?: string) => string | null;
};

const round = (v: number, dp: number) => v.toFixed(dp);

export function formatter({ currency = 'gbp', perSub = null }: { currency?: Currency; perSub?: number | null } = {}): Fmt {
  /**
   * A money figure, in the currency it was measured in.
   *
   * **Pennies only when the number has them.** £9,244 and £45 read as whole
   * pounds because that is what they are; $77.22 keeps its cents because that
   * is what the ledger recorded. A fixed number of decimals gets one of the two
   * wrong — either "£9,244.00" on a headline or "$77" on a bill.
   *
   * Two exceptions. Per subscriber is always to the penny, because £6.65 a
   * month is the figure and £7 is a different claim. And something that costs
   * less than a penny says so rather than rounding to nought, which on a cost
   * screen would read as free.
   */
  const money = (v: number | null | undefined, opts: { pence?: boolean } = {}) => {
    if (v == null || Number.isNaN(v)) return null;
    const base = opts.pence ? v / 100 : v;
    const n = perSub ? base / perSub : base;
    const neg = n < 0;
    const abs = Math.abs(n);
    const sign = SIGN[currency];

    if (!perSub && abs > 0 && abs < 0.01) return `${neg ? '−' : ''}<${sign}0.01`;

    const body = perSub || !Number.isInteger(Math.round(abs * 100) / 100) || Math.round(abs * 100) % 100 !== 0
      ? abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(abs).toLocaleString();
    // The minus sign is a proper one, and a positive figure never carries a
    // plus — the handoff says so of the variance column and it holds
    // everywhere: "no plus signs, minus only where it applies".
    return `${neg ? '−' : ''}${sign}${body}`;
  };

  /**
   * A count, or a small rate.
   *
   * Under ten a figure keeps up to two decimals, because 0.76 days out a month
   * is the measure and "1" is a different claim. A trailing zero is dropped:
   * the design writes 7.1 and 2.4, and "7.10" reads as a price rather than as
   * a rate (20 Sep 2026, opening Behaviour).
   */
  const count = (v: number | null | undefined, dp = 0) => {
    if (v == null || Number.isNaN(v)) return null;
    if (dp) return round(v, dp);
    if (Number.isInteger(v) || Math.abs(v) >= 10) return Math.round(v).toLocaleString();
    return round(v, 2).replace(/0$/, '').replace(/\.$/, '');
  };

  const delta = (v: number | null | undefined, suffix = '') => {
    if (v == null || Number.isNaN(v)) return null;
    const sign = v >= 0 ? '+' : '−';
    return `${sign}${Math.abs(Math.round(v * 10) / 10)}%${suffix}`;
  };

  return { currency, perSub, money, count, delta };
}

/** Which currency each half of the model is measured in. */
export function currencies(suite: Suite | null): { revenue: Currency; cost: Currency } {
  if (!suite || suite.mock) return { revenue: 'gbp', cost: 'gbp' };
  // Real: revenue is contracted in pence and cost is what `provider_calls`
  // recorded, which is dollars.
  return { revenue: 'gbp', cost: suite.suppliers.currency === 'usd' ? 'usd' : 'gbp' };
}

// ---------------------------------------------------------------------------
// small-n honesty
// ---------------------------------------------------------------------------

/**
 * A share, said as honestly as the denominator allows.
 *
 * The handoff's fifth rule, and the reason it exists: "3 of 4 households rated
 * their day good" is a fact, and "75%" is a claim about a population. So:
 *
 *   under 30      counts only — "7 of 9"
 *   30 to 100     the percentage with its interval — "44% ±11"
 *   over 100      the percentage with the denominator on its face — "44% of 862"
 *
 * The interval is the normal approximation at 95%, which is the right rough
 * answer in that band and is not claimed to be more.
 */
export function share(value: number | null, of: number | null | undefined): string | null {
  if (value == null || of == null) return null;
  if (of < 30) return `${value} of ${of}`;
  const p = value / of;
  const pctText = `${Math.round(p * 1000) / 10}%`;
  if (of <= 100) {
    const interval = Math.round(1.96 * Math.sqrt((p * (1 - p)) / of) * 100);
    return `${pctText} ±${interval}`;
  }
  return `${pctText} of ${of.toLocaleString()}`;
}

/** Whether a trend line may be drawn at all: never through fewer than eight points. */
export const trendable = (series: number[] | null | undefined) =>
  !!series && series.filter((v) => v != null).length >= 8;

/** "6m 12s" — time on site, in the units a person would say. */
export function onSite(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m${whole % 60 ? ` ${whole % 60}s` : ''}`;
}

/** "+41s", "−12s" — a change in time on site. */
export function onSiteDelta(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  return `${seconds >= 0 ? '+' : '−'}${Math.abs(Math.round(seconds))}s`;
}

// ---------------------------------------------------------------------------
// the households table
// ---------------------------------------------------------------------------

export const STATUS_WORDS: Record<string, string> = {
  live: 'Live', trial: 'Trial', at_risk: 'At risk', cancelled: 'Cancelled',
  active: 'Live', invited: 'Invited', suspended: 'Cancelled',
};

export const statusWord = (row: HouseholdRow) =>
  [STATUS_WORDS[row.status] ?? row.status, row.statusNote].filter(Boolean).join(' · ');

/** "today", "2 days" — when they were last in. */
export const lastSeen = (days: number | null) =>
  (days == null ? 'never' : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days`);

/**
 * "12 Mar 25" — the joined column, short because it is a column.
 *
 * Three letters of month, always. `toLocaleDateString('en-GB')`'s own "short"
 * gives "Sept" for September alone, which in a column of dates is the one that
 * is a different width (20 Sep 2026).
 */
export function joinedDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const month = d.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3);
  return `${d.getDate()} ${month} ${String(d.getFullYear()).slice(2)}`;
}

/**
 * Sort a list of rows on one of its own keys, in one direction.
 *
 * Shared by Customers and Suppliers because both tables sort every column, and
 * two implementations of "click again to reverse" is two behaviours.
 */
export function sortRows<T extends Record<string, any>>(rows: T[], key: keyof T, dir: 1 | -1): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
    return (Number(av) - Number(bv)) * dir;
  });
}
