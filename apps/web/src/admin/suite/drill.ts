/**
 * The metric drill's arithmetic.
 *
 * "This is the signed-off shape — use it for every metric drill" (handoff §7),
 * so it is one function rather than one per screen. Everything here is pure and
 * takes a twelve-month series, because the whole chart — three tiles, two plots,
 * an axis and every change figure — is derived from that one array plus four
 * switches, and the interesting behaviour is in the derivation:
 *
 *  · **The axis is fixed by the faster of the two run rates**, so switching the
 *    run rate redraws only the forecast. History never rescales, which is what
 *    stops the eye reading a taller bar as a bigger number.
 *  · **The selected period aggregates to match the picker.** "Last 3 months"
 *    sums three buckets and compares against the three before — never against a
 *    monthly average.
 *  · **Growth is compounded across the steps**, never the mean of the step
 *    percentages. The mean of eleven monthly percentages is not a growth rate.
 *  · **A change figure only prints when a full prior window of the same length
 *    exists and sums above zero.** Otherwise it is omitted, never rendered as ∞
 *    or 0%.
 */

import type { PeriodKey } from './model';

/** The plot box, and the height the tallest bar is drawn to inside it. */
export const PLOT = 336;
export const SCALE = 300;

export type DrillView = 'monthly' | 'quarterly';
export type RunRate = '3' | '12';

export type Bar = {
  label: string;
  /** Pixels. */
  height: number;
  /** The change above the bar, or nothing if there is no comparator on the chart. */
  change: string | null;
  /** Whether the change reads as a fall. */
  down: boolean;
  latest: boolean;
};

export type Drill = {
  /** Whether there is anything to draw at all. */
  ok: boolean;
  view: DrillView;
  /** The three tiles, in order: the selected period, then the two run rates. */
  tiles: { label: string; value: number; change: string | null; down: boolean; selected: boolean; unit: 'money' | 'count' }[];
  past: { title: string; bars: Bar[] };
  future: { title: string; bars: Bar[] };
  /** Gridlines and their labels, from the same maximum the bars use. */
  axis: { value: number; top: number }[];
  max: number;
  ratePerStep: number;
  rate3: number;
  rate12: number;
  /** What the two run-rate options are called in this view. */
  rateLabels: [string, string];
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/**
 * Compounded growth per step between the ends of a series.
 *
 * `(last / first) ** (1 / steps) − 1`, and it returns `null` where either end
 * is zero or negative: a rate out of nothing is not a rate, and printing it as
 * ∞ or as 0% are both lies.
 */
export function compounded(first: number, last: number, steps: number): number | null {
  if (steps <= 0 || first <= 0 || last <= 0) return null;
  const r = (last / first) ** (1 / steps) - 1;
  return Number.isFinite(r) ? r : null;
}

/** "+16.2%" / "−4.1%", or nothing where there is nothing to compare with. */
export function changeText(now: number, before: number): string | null {
  if (before <= 0) return null;
  const p = Math.round((now / before - 1) * 1000) / 10;
  return `${p >= 0 ? '+' : '−'}${Math.abs(p)}%`;
}

/** Quarterly re-buckets the same twelve months into four. */
export function toQuarters(series: number[]): number[] {
  return [0, 1, 2, 3].map((i) => sum(series.slice(i * 3, i * 3 + 3)));
}

/**
 * The names of the four quarters a twelve-month series ending in `endLabel`
 * covers — "Q4 25" through "Q3 26" — and the four after them.
 */
function quarterLabels(keys: string[]): { past: string[]; future: string[] } {
  const at = (index: number) => {
    const key = keys[Math.min(index, keys.length - 1)] ?? '2026-09';
    const [y, m] = key.split('-').map(Number);
    return { y, q: Math.floor((m - 1) / 3) + 1 };
  };
  const name = ({ y, q }: { y: number; q: number }) => `Q${q} ${String(y).slice(2)}`;
  const past = [2, 5, 8, 11].map((i) => name(at(i)));
  const last = at(11);
  const future = [1, 2, 3, 4].map((n) => {
    const q = ((last.q - 1 + n) % 4) + 1;
    const y = last.y + Math.floor((last.q - 1 + n) / 4);
    return name({ y, q });
  });
  return { past, future };
}

/** How many buckets of the series the period picker is asking about. */
function bucketsFor(period: PeriodKey, view: DrillView, length: number): { count: number; offset: number } {
  const months = period === 'last-3-months' ? 3 : period === 'last-12-months' ? 12 : 1;
  const offset = period === 'last-month' ? 1 : 0;
  const count = view === 'quarterly' ? Math.max(1, Math.round(months / 3)) : months;
  return { count: Math.min(length, count), offset: view === 'quarterly' ? 0 : offset };
}

/**
 * The whole chart, from one series.
 *
 * `labels` are the twelve month names; `keys` are their `YYYY-MM`, which is what
 * the quarterly labels are worked out from. `unit` decides whether a tile reads
 * in money or in counts, and nothing else.
 */
export function buildDrill({
  series, labels, keys, view, runRate, period, unit = 'count',
}: {
  series: number[] | null | undefined;
  labels: string[];
  keys: string[];
  view: DrillView;
  runRate: RunRate;
  period: PeriodKey;
  unit?: 'money' | 'count';
}): Drill {
  const empty: Drill = {
    ok: false, view, tiles: [], past: { title: '', bars: [] }, future: { title: '', bars: [] },
    axis: [], max: 0, ratePerStep: 0, rate3: 0, rate12: 0,
    rateLabels: view === 'quarterly' ? ['2 quarters', '4 quarters'] : ['3 months', '12 months'],
  };
  if (!series || !series.length) return empty;

  const quarterly = view === 'quarterly';
  const past = quarterly ? toQuarters(series) : series.slice();
  const ahead = past.length;
  const marks = quarterly ? quarterLabels(keys) : { past: labels, future: labels };

  // Two run rates: the short one over the last three steps (two quarters), the
  // long one across the whole series. Compounded, not averaged.
  const shortSteps = quarterly ? 2 : 3;
  const rate3 = compounded(past[past.length - 1 - shortSteps] ?? past[0], past[past.length - 1], shortSteps) ?? 0;
  const rate12 = compounded(past[0], past[past.length - 1], past.length - 1) ?? 0;
  const rate = runRate === '3' ? rate3 : rate12;

  const project = (r: number) => {
    const out: number[] = [];
    let v = past[past.length - 1];
    for (let i = 0; i < ahead; i += 1) { v *= 1 + r; out.push(v); }
    return out;
  };
  const future = project(rate);

  // The axis is fixed by the faster of the two run rates, so toggling the run
  // rate redraws the forecast alone and the history never moves.
  const ceiling = Math.max(project(rate3)[ahead - 1] ?? 0, project(rate12)[ahead - 1] ?? 0);
  const max = Math.max(ceiling, ...past, 1);

  const height = (v: number) => Math.max(v > 0 ? 6 : 1, Math.round((v / max) * SCALE));

  const pastBars: Bar[] = past.map((v, i) => {
    const text = i === 0 ? null : changeText(v, past[i - 1]);
    return { label: marks.past[i] ?? '', height: height(v), change: text, down: !!text?.startsWith('−'), latest: i === past.length - 1 };
  });
  const futureBars: Bar[] = future.map((v, i) => {
    const before = i === 0 ? past[past.length - 1] : future[i - 1];
    const text = changeText(v, before);
    return { label: marks.future[i] ?? '', height: height(v), change: text, down: !!text?.startsWith('−'), latest: false };
  });

  // The selected period, aggregated to match the picker and compared against
  // the same number of buckets immediately before it.
  const { count, offset } = bucketsFor(period, view, past.length);
  const end = past.length - offset;
  const now = sum(past.slice(Math.max(0, end - count), end));
  const beforeSlice = past.slice(Math.max(0, end - count * 2), end - count);
  const comparable = beforeSlice.length === count && sum(beforeSlice) > 0;
  const suffix = count > 1 ? ' on the previous' : quarterly ? ' QoQ' : ' MoM';
  const periodChange = comparable ? changeText(now, sum(beforeSlice)) : null;

  const PERIOD_NAMES: Record<PeriodKey, string> = {
    'last-30-days': 'Last 30 days', 'this-month': 'This month', 'last-month': 'Last month',
    'last-3-months': 'Last 3 months', 'last-12-months': 'Last 12 months',
  };
  const periodLabel = count === 1 && quarterly ? 'This quarter' : PERIOD_NAMES[period];
  const step = quarterly ? '% a quarter' : '% a month';

  return {
    ok: true,
    view,
    tiles: [
      { label: periodLabel, value: now, change: periodChange ? `${periodChange}${suffix}` : null, down: !!periodChange?.startsWith('−'), selected: true, unit },
      { label: quarterly ? 'Run rate · last 2 quarters' : 'Run rate · last 3 months', value: rate3 * 100, change: null, down: rate3 < 0, selected: false, unit: 'count' },
      { label: quarterly ? 'Run rate · last 4 quarters' : 'Run rate · last 12 months', value: rate12 * 100, change: null, down: rate12 < 0, selected: false, unit: 'count' },
    ],
    past: { title: quarterly ? 'The last four quarters' : 'The last 12 months', bars: pastBars },
    future: {
      title: `${quarterly ? 'The next four quarters' : 'The next 12 months'} · at ${rate >= 0 ? '+' : '−'}${Math.abs(rate * 100).toFixed(quarterly ? 1 : 2)}${step}`,
      bars: futureBars,
    },
    // Gridlines derived from the same maximum the bars use, so a label always
    // sits where a bar of that value would end.
    axis: [max, max / 2, 0].map((v) => ({ value: v, top: PLOT - Math.round((v / max) * SCALE) })),
    max,
    ratePerStep: rate,
    rate3,
    rate12,
    rateLabels: quarterly ? ['2 quarters', '4 quarters'] : ['3 months', '12 months'],
  };
}
