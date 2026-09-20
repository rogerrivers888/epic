/**
 * The metric drill's arithmetic, and the suite's way of saying a number.
 *
 * Both are held rather than believed because both are things the design handoff
 * says broke a prototype, and neither shows up as broken on screen — a chart
 * whose axis rescales when you change the run rate looks fine, and is wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDrill, changeText, compounded, toQuarters } from '../src/admin/suite/drill.ts';
import { formatter, share, sortRows, trendable } from '../src/admin/suite/model.ts';

const LABELS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const KEYS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
  '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
/** The handoff's own revenue history, Oct 25 → Sep 26. */
const SERIES = [6640, 7210, 7880, 6980, 7340, 7910, 8460, 8120, 8690, 9130, 8160, 9244];

const at = (over: Partial<Parameters<typeof buildDrill>[0]> = {}) => buildDrill({
  series: SERIES, labels: LABELS, keys: KEYS,
  view: 'monthly', runRate: '12', period: 'this-month', unit: 'money',
  ...over,
});

// ---------------------------------------------------------------------------
// growth
// ---------------------------------------------------------------------------

test('growth is compounded across the steps, never the mean of the steps', () => {
  // Eleven steps from 6,640 to 9,244. The mean of the eleven monthly
  // percentages is a different and larger number, which is why the handoff says
  // "compounded across the steps" in as many words.
  const r = compounded(6640, 9244, 11);
  assert.ok(r != null);
  assert.equal(Math.round(r! * 10000) / 100, 3.05);
  // And it round-trips: eleven steps at that rate is where it started.
  assert.ok(Math.abs(6640 * (1 + r!) ** 11 - 9244) < 1);
});

test('a rate out of nothing is nothing, not infinity', () => {
  assert.equal(compounded(0, 900, 11), null);
  assert.equal(compounded(900, 0, 11), null);
  assert.equal(compounded(100, 200, 0), null);
});

test('a change against nothing is omitted rather than drawn', () => {
  assert.equal(changeText(100, 80), '+25%');
  assert.equal(changeText(80, 100), '−20%');
  assert.equal(changeText(100, 0), null);
});

// ---------------------------------------------------------------------------
// the axis
// ---------------------------------------------------------------------------

test('the axis is fixed by the faster run rate, so the history never rescales', () => {
  const slow = at({ runRate: '12' });
  const fast = at({ runRate: '3' });
  // The same maximum either way, so the bars of the past are the same height.
  assert.equal(slow.max, fast.max);
  assert.deepEqual(slow.past.bars.map((b) => b.height), fast.past.bars.map((b) => b.height));
  // And the forecast is what moved.
  assert.notDeepEqual(slow.future.bars.map((b) => b.height), fast.future.bars.map((b) => b.height));
});

test('gridlines come from the same maximum the bars use', () => {
  const d = at();
  assert.equal(d.axis.length, 3);
  assert.equal(d.axis[0].value, d.max);
  assert.equal(d.axis[2].value, 0);
  // The zero line sits at the foot of the plot box.
  assert.ok(d.axis[2].top > d.axis[0].top);
});

test('the latest bar of the history is the lime one, and the first carries no change', () => {
  const d = at();
  assert.equal(d.past.bars.length, 12);
  assert.equal(d.past.bars[11].latest, true);
  assert.equal(d.past.bars.filter((b) => b.latest).length, 1);
  // A bar with no comparator on the chart shows nothing above it.
  assert.equal(d.past.bars[0].change, null);
  assert.equal(d.past.bars[1].change, changeText(SERIES[1], SERIES[0]));
  // The forecast is never the lime bar: it is not a measurement.
  assert.equal(d.future.bars.some((b) => b.latest), false);
});

// ---------------------------------------------------------------------------
// the period tile
// ---------------------------------------------------------------------------

test('the selected period aggregates to match the picker', () => {
  // One month is the latest month.
  assert.equal(at({ period: 'this-month' }).tiles[0].value, 9244);
  // Three months sums three buckets…
  assert.equal(at({ period: 'last-3-months' }).tiles[0].value, 9130 + 8160 + 9244);
  // …and compares against the three before, not against a monthly average.
  assert.equal(
    at({ period: 'last-3-months' }).tiles[0].change,
    `${changeText(9130 + 8160 + 9244, 8460 + 8120 + 8690)} on the previous`,
  );
  // Twelve months is the whole series.
  assert.equal(at({ period: 'last-12-months' }).tiles[0].value, SERIES.reduce((a, b) => a + b, 0));
});

test('last month steps back a bucket rather than taking the latest', () => {
  assert.equal(at({ period: 'last-month' }).tiles[0].value, 8160);
  assert.equal(at({ period: 'last-month' }).tiles[0].change, `${changeText(8160, 9130)} MoM`);
});

test('a window with no full window before it prints no change at all', () => {
  // Twelve months has nothing before it inside a twelve-month series.
  assert.equal(at({ period: 'last-12-months' }).tiles[0].change, null);
});

test('the period tile is named after the picker', () => {
  assert.equal(at({ period: 'last-3-months' }).tiles[0].label, 'Last 3 months');
  assert.equal(at({ period: 'last-30-days' }).tiles[0].label, 'Last 30 days');
});

// ---------------------------------------------------------------------------
// quarterly
// ---------------------------------------------------------------------------

test('quarterly re-buckets the same twelve months and restates both rates', () => {
  const q = at({ view: 'quarterly' });
  assert.equal(q.past.bars.length, 4);
  assert.deepEqual(toQuarters(SERIES), [6640 + 7210 + 7880, 6980 + 7340 + 7910, 8460 + 8120 + 8690, 9130 + 8160 + 9244]);
  // The toggle's own labels change with it.
  assert.deepEqual(q.rateLabels, ['2 quarters', '4 quarters']);
  assert.deepEqual(at().rateLabels, ['3 months', '12 months']);
  // The quarters are named for the months they cover.
  assert.deepEqual(q.past.bars.map((b) => b.label), ['Q4 25', 'Q1 26', 'Q2 26', 'Q3 26']);
  assert.deepEqual(q.future.bars.map((b) => b.label), ['Q4 26', 'Q1 27', 'Q2 27', 'Q3 27']);
  // A rate per quarter is a bigger number than a rate per month.
  assert.ok(q.rate12 > at().rate12);
});

test('a quarter of one is this quarter, not the picker’s own words', () => {
  assert.equal(at({ view: 'quarterly', period: 'this-month' }).tiles[0].label, 'This quarter');
});

test('nothing to draw is said rather than drawn as an empty chart', () => {
  assert.equal(at({ series: null }).ok, false);
  assert.equal(at({ series: [] }).ok, false);
  assert.equal(at().ok, true);
});

// ---------------------------------------------------------------------------
// saying a figure
// ---------------------------------------------------------------------------

test('a figure is printed in the currency it was measured in', () => {
  assert.equal(formatter({ currency: 'gbp' }).money(9244), '£9,244');
  // Provider cost is what the ledger recorded, which is dollars. Converting
  // would mean inventing an exchange rate.
  assert.equal(formatter({ currency: 'usd' }).money(77.22), '$77.22');
});

test('per subscriber is a context, applied once, and always in pennies', () => {
  const per = formatter({ currency: 'gbp', perSub: 579 });
  assert.equal(per.money(3851), '£6.65');
  assert.equal(per.money(9244), '£15.97');
  // Without it, the same figure is the total.
  assert.equal(formatter({ currency: 'gbp' }).money(3851), '£3,851');
});

test('a minus is a proper minus and a positive figure carries no plus', () => {
  const f = formatter({ currency: 'gbp' });
  assert.equal(f.money(-188), '−£188');
  assert.equal(f.money(188), '£188');
  // A change is the one place a plus belongs.
  assert.equal(f.delta(16), '+16%');
  assert.equal(f.delta(-4.4), '−4.4%');
});

test('a figure that is not there is not a zero', () => {
  const f = formatter({ currency: 'gbp' });
  assert.equal(f.money(null), null);
  assert.equal(f.count(null), null);
  assert.equal(f.delta(null), null);
  // And a real nought is still a nought — a whole one, because pennies are
  // printed only where the figure has them.
  assert.equal(f.money(0), '£0');
  // Something that costs less than a penny says so rather than rounding to
  // nought, which on a cost screen would read as free.
  assert.equal(formatter({ currency: 'usd' }).money(0.004), '<$0.01');
});

test('a small per-household rate keeps its decimals', () => {
  const f = formatter({ currency: 'gbp' });
  // 0.76 days out a month is the measure; "1" is a different claim.
  assert.equal(f.count(0.76), '0.76');
  assert.equal(f.count(0.05), '0.05');
  // But a trailing zero is dropped: the design writes 7.1 and 2.4, and "7.10"
  // reads as a price rather than as a rate.
  assert.equal(f.count(7.1), '7.1');
  assert.equal(f.count(2.4), '2.4');
  // Ten and over is a count, and is whole.
  assert.equal(f.count(3940), '3,940');
  assert.equal(f.count(12), '12');
});

// ---------------------------------------------------------------------------
// small-n honesty
// ---------------------------------------------------------------------------

test('a share is said as honestly as its denominator allows', () => {
  // Under thirty: counts only. "78%" of nine is a claim nine households cannot carry.
  assert.equal(share(7, 9), '7 of 9');
  // Thirty to a hundred: the percentage with its interval.
  assert.equal(share(44, 100), '44% ±10');
  // Over a hundred: the percentage with the denominator on its face.
  assert.equal(share(379, 862), '44% of 862');
  assert.equal(share(null, 862), null);
  assert.equal(share(4, null), null);
});

test('a trend line is never drawn through fewer than eight points', () => {
  assert.equal(trendable([1, 2, 3]), false);
  assert.equal(trendable([1, 2, 3, 4, 5, 6, 7]), false);
  assert.equal(trendable([1, 2, 3, 4, 5, 6, 7, 8]), true);
  assert.equal(trendable(null), false);
});

// ---------------------------------------------------------------------------
// sorting
// ---------------------------------------------------------------------------

test('a column sorts both ways, and a gap always sinks', () => {
  const rows = [{ n: 3, s: 'b' }, { n: 1, s: 'a' }, { n: null, s: 'c' }];
  assert.deepEqual(sortRows(rows, 'n', 1).map((r) => r.n), [1, 3, null]);
  assert.deepEqual(sortRows(rows, 'n', -1).map((r) => r.n), [3, 1, null]);
  // A missing figure is never sorted to the top as if it were the largest.
  assert.equal(sortRows(rows, 'n', -1)[2].n, null);
  assert.deepEqual(sortRows(rows, 's', 1).map((r) => r.s), ['a', 'b', 'c']);
});
