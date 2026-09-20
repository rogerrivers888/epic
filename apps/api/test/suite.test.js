/**
 * The reporting suite's three load-bearing rules, held rather than believed.
 *
 * All three are things the design handoff says broke a prototype, and all three
 * are invisible on screen until they are wrong:
 *
 *   · **the stock/flow/rate rule** — a period change must scale revenue and must
 *     not scale a count of live subscriptions;
 *   · **the numbers model reconciles** — the mock estate is one business, so the
 *     four streams sum to the total, the cost classes sum to the cost, and the
 *     margin is the difference;
 *   · **cost is classified on `(purpose × actor)`** — a purpose alone cannot
 *     tell a household planning a day out from an administrator exercising the
 *     same endpoint, which is the mistake that produced a $96 "unit cost".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PERIOD, PERIODS, monthBuckets, resolvePeriod } from '../src/domain/reportingPeriods.js';
import { FIXTURE_SUBSCRIBERS, fixtureHousehold, fixtureSupplier, fixtures, scaleFixtures } from '../src/domain/reportingFixtures.js';
import { annualPence } from '../src/repositories/pricing.js';
import { PURPOSE_CLASSES, classOf } from '../src/domain/costClass.js';
import { change } from '../src/repositories/suite.js';
import { pool } from '../src/db.js';

test.after(() => pool.end());

const AT = new Date('2026-09-20T12:00:00Z');

// ---------------------------------------------------------------------------
// the period
// ---------------------------------------------------------------------------

test('a period is a window and the window of the same length before it', () => {
  const p = resolvePeriod('last-3-months', AT);
  assert.equal(p.from, '2026-07-01T00:00:00.000Z');
  // The comparison is the same length of time, not a monthly average — which is
  // what the supplier register's "expected" column is.
  const span = new Date(p.to) - new Date(p.from);
  assert.equal(new Date(p.prevTo) - new Date(p.prevFrom), span);
  assert.equal(p.prevTo, p.from);
});

test('last month is a whole month, not a month and a bit', () => {
  const p = resolvePeriod('last-month', AT);
  assert.equal(p.from, '2026-08-01T00:00:00.000Z');
  assert.equal(p.to, '2026-09-01T00:00:00.000Z');
});

test('an unknown period is this month rather than nothing', () => {
  assert.equal(resolvePeriod('whenever', AT).key, DEFAULT_PERIOD);
  assert.equal(PERIODS.length, 5);
});

test('the drill always asks for twelve months, whatever the picker says', () => {
  const b = monthBuckets(AT);
  assert.equal(b.length, 12);
  assert.equal(b[0].key, '2025-10');
  assert.equal(b[11].key, '2026-09');
  // Three letters each, so twelve axis labels are the same width.
  assert.deepEqual([...new Set(b.map((m) => m.label.length))], [3]);
});

// ---------------------------------------------------------------------------
// stock, flow and rate
// ---------------------------------------------------------------------------

test('a flow scales with the period and a stock never does', () => {
  const month = scaleFixtures(fixtures(), resolvePeriod('this-month', AT));
  const year = scaleFixtures(fixtures(), resolvePeriod('last-12-months', AT));

  const of = (m, key) => m.overview.measures.find((x) => x.key === key);

  // Revenue is a flow: twelve months is worth more than one.
  assert.ok(of(year, 'revenue').value > of(month, 'revenue').value * 10);
  // New subscribers is a flow too.
  assert.ok(of(year, 'signups').value > of(month, 'signups').value);

  // Active households is a stock — a count at a moment. Scaling it by 11.4 is
  // the failure the whole period model is arranged to prevent.
  assert.equal(of(year, 'engagement').value, of(month, 'engagement').value);
  // "Scheduled in the next 60 days" carries its own window and never scales.
  assert.equal(of(year, 'events').value, of(month, 'events').value);
});

test('a rate is never scaled, however long the window', () => {
  const month = scaleFixtures(fixtures(), resolvePeriod('this-month', AT));
  const year = scaleFixtures(fixtures(), resolvePeriod('last-12-months', AT));
  assert.equal(year.overview.revenue.mrr, month.overview.revenue.mrr);
  assert.equal(year.money.total.marginPct, month.money.total.marginPct);
  assert.equal(year.money.perSubscriber.total, month.money.perSubscriber.total);
  assert.equal(year.overview.subscriptions.churnPct, month.overview.subscriptions.churnPct);
});

test('live subscriptions is the same number whatever the window, and the book still balances', () => {
  for (const p of PERIODS) {
    const m = scaleFixtures(fixtures(), resolvePeriod(p.key, AT));
    const s = m.overview.subscriptions;
    assert.equal(s.live, 579, p.key);
    // opening + new − lost = live, at every window. A book that does not
    // balance is the first thing anybody checks.
    assert.equal(Math.round(s.opening + s.added - s.lost), s.live, p.key);
  }
});

test('a supplier row reconciles from the two columns beside it', () => {
  const m = scaleFixtures(fixtures(), resolvePeriod('last-3-months', AT));
  // Volume scales with the spend it prices, and expected is the same window.
  const base = fixtures().suppliers.rows.find((r) => r.key === 'anthropic');
  const now = m.suppliers.rows.find((r) => r.key === 'anthropic');
  assert.ok(now.spend > base.spend * 2.5);
  assert.ok(now.volume > base.volume * 2.5);
  assert.ok(now.expected > base.expected * 2.5);
});

// ---------------------------------------------------------------------------
// the numbers model is one business
// ---------------------------------------------------------------------------

test('the four streams sum to the total, at every window', () => {
  for (const p of PERIODS) {
    const m = scaleFixtures(fixtures(), resolvePeriod(p.key, AT));
    const revenue = m.money.streams.reduce((n, s) => n + s.revenue, 0);
    const cost = m.money.streams.reduce((n, s) => n + s.cost, 0) + m.money.costToServe.research;
    assert.ok(Math.abs(revenue - m.money.total.revenue) < 1, `revenue ${p.key}`);
    assert.ok(Math.abs(cost - m.money.total.cost) < 1, `cost ${p.key}`);
    assert.ok(Math.abs(m.money.total.revenue - m.money.total.cost - m.money.total.margin) < 1, `margin ${p.key}`);
  }
});

test('cost to serve reconciles three ways', () => {
  const m = fixtures().money.costToServe;
  assert.equal(m.byKind.reduce((n, r) => n + r.value, 0) + m.research, m.total);
  assert.equal(m.byClass.reduce((n, r) => n + r.value, 0), m.total);
  assert.equal(m.allocated + m.research, m.total);
});

test('gross bookings is the sum of what was booked, and is never revenue', () => {
  const f = fixtures();
  // Hotel £24,736 at 12.5% + hosting £6,575 at 20% + activity £9,860 at 10%.
  assert.equal(f.money.grossBookings, 24736 + 6575 + 9860);
  // The memo figure dwarfs revenue, which is exactly why they never share an
  // axis: Epic is an agent and recognises the commission inside it.
  assert.ok(f.money.grossBookings > f.money.total.revenue * 4);
});

test('per subscriber is the monthly rate, and in kept from out of in', () => {
  const p = fixtures().money.perSubscriber;
  assert.equal(Math.round((p.subscription + p.hotel + p.hosting + p.activity) * 100) / 100, p.total);
  assert.equal(Math.round((p.total - p.out) * 100) / 100, p.kept);
  const total = fixtures().money.total;
  // Within a penny, not to the penny: £9,244 over 579 is £15.9655, and the four
  // components each rounded to 2dp sum to £15.96. The handoff states £15.96, so
  // the components are what is displayed and this is the check that they are
  // the same figure rather than two different ones.
  assert.ok(Math.abs(total.revenue / 579 - p.total) < 0.01);
});

test('a margin percentage is the margin over the revenue, per stream', () => {
  for (const s of fixtures().money.streams) {
    assert.equal(s.revenue - s.cost, s.margin, s.key);
    assert.ok(Math.abs((s.margin / s.revenue) * 100 - s.marginPct) < 0.1, s.key);
  }
});

test('a household record’s booking split sums to its own total', () => {
  for (const h of fixtures().customers.households) {
    const r = fixtureHousehold(h.id);
    assert.equal(r.bookings.hotels + r.bookings.activities + r.bookings.events, r.bookings.total, h.id);
    assert.equal(r.spend.subscriptionPence + r.spend.bookedPence, r.spend.everPence, h.id);
  }
});

test('a household that upgraded pays the old price for its earlier months', () => {
  const r = fixtureHousehold('okonkwo');
  assert.ok(r.plans.upgraded);
  // Solo for the first stretch, so the lifetime figure is below months × today.
  assert.ok(r.spend.subscriptionPence < r.lifeMonths * r.monthPence);
  assert.equal(r.spend.subscriptionPence, r.plans.soloMonths * 599 + (r.lifeMonths - r.plans.soloMonths) * 899);
});

test('a household nobody has is nothing, not an empty record', () => {
  assert.equal(fixtureHousehold('nobody'), null);
});

// ---------------------------------------------------------------------------
// cost is classified on (purpose × actor)
// ---------------------------------------------------------------------------

test('the same purpose is serving or research depending on who called it', () => {
  // The production audit's $96.46: the owner exercising the planning endpoints
  // as an administrator, indistinguishable from a family planning a day out if
  // the purpose is all you look at.
  assert.equal(classOf({ purpose: 'plan.interpret', actorHoldsBackOffice: false }), 'serve');
  assert.equal(classOf({ purpose: 'plan.interpret', actorHoldsBackOffice: true }), 'research');
});

test('the actor never turns library or office spend into something else', () => {
  assert.equal(classOf({ purpose: 'atlas.rating', actorHoldsBackOffice: true }), 'library');
  assert.equal(classOf({ purpose: 'atlas.rating', actorHoldsBackOffice: false }), 'library');
  assert.equal(classOf({ purpose: 'admin.lookup', actorHoldsBackOffice: true }), 'office');
});

test('a purpose nobody has classified is unclassified, never serving', () => {
  // Defaulting the other way is what produced the bad figure, so an unknown
  // purpose shows under its own name rather than landing in somebody's bill.
  assert.equal(classOf({ purpose: 'something.new' }), 'unclassified');
  assert.ok(!Object.values(PURPOSE_CLASSES).includes('unclassified'));
});

test('the biggest real purposes are all classified', () => {
  // The ones the ledger actually holds, from production on 19 Sep 2026.
  for (const purpose of ['atlas.rating', 'plan.matrix', 'atlas.photos', 'plan.interpret',
    'plan.inspire.things', 'own.encyclopedia', 'photo', 'places.detail', 'places.search']) {
    assert.ok(PURPOSE_CLASSES[purpose], purpose);
  }
});

// ---------------------------------------------------------------------------
// a change figure that cannot be measured is not printed
// ---------------------------------------------------------------------------

test('a change is omitted rather than rendered as infinity or nought', () => {
  assert.equal(change(100, 80), 25);
  assert.equal(change(100, 0), null);
  assert.equal(change(100, null), null);
  assert.equal(change(null, 80), null);
});

// ---------------------------------------------------------------------------
// the two editing screens
// ---------------------------------------------------------------------------

test('annual is derived from the monthly price, never stored beside it', () => {
  // `round(monthly × 12 × (1 − discount/100))`. Two stored numbers can
  // disagree; one number and a rule cannot, which is why nothing writes this
  // down. Solo at £5.99 with 10% off is £65 a year; Household at £8.99 with 7%
  // off is £100 — the two figures the handoff states.
  assert.equal(annualPence(599, 10), 6469);
  assert.equal(annualPence(899, 7), 10033);
  assert.equal(annualPence(1299, 10), 14029);
  assert.equal(annualPence(599, 0), 7188);
});

test('the mock tiers add up to the same estate the rest of the model counts', () => {
  const f = fixtures().subscriptions;
  // Solo 321 + Household 258 = 579, the paying estate. Household's 258 is the
  // 211 paying monthly plus the 47 on annual.
  assert.equal(f.tiers.reduce((n, t) => n + t.subscribers, 0), FIXTURE_SUBSCRIBERS);
  assert.equal(f.standing.onAnnualOf, FIXTURE_SUBSCRIBERS);
  // Pro is not launched, and says so rather than showing a nought as a failure.
  const pro = f.tiers.find((t) => t.key === 'pro');
  assert.equal(pro.subscribers, 0);
  assert.equal(pro.note, 'not launched');
});

test('the App Store uplift is what it is above the website, not a discount', () => {
  for (const t of fixtures().subscriptions.tiers) {
    assert.ok(t.iosPence > t.webPence, t.key);
    assert.equal(t.iosUpliftPct, Math.round((t.iosPence / t.webPence - 1) * 100), t.key);
  }
});

test('a price is stated once and every derived figure comes off it', () => {
  const t = fixtures().subscriptions.tiers.find((x) => x.key === 'household');
  assert.equal(t.annualWebPence, annualPence(t.webPence, t.discountPct));
  assert.equal(t.annualIosPence, annualPence(t.iosPence, t.discountPct));
  assert.equal(t.revenueAtThisPricePence, t.subscribers * t.webPence);
});

test('the benefits matrix has a cell for every tier and is published', () => {
  const f = fixtures().subscriptions;
  const keys = f.tiers.map((t) => t.key);
  for (const b of f.benefits) {
    assert.deepEqual(Object.keys(b.values).sort(), [...keys].sort(), b.label);
    assert.ok(b.publishedAt, b.label);
  }
  assert.equal(f.unpublished, 0);
});

test('infrastructure is three suppliers, and the twelve still add to the bill', () => {
  const s = fixtures().suppliers;
  assert.equal(s.rows.length, 12);
  // The one row that said "Fly, Neon, R2 · £60" is three rows of £26, £19, £15.
  const infra = ['fly', 'neon', 'r2'].map((k) => s.rows.find((r) => r.key === k));
  assert.deepEqual(infra.map((r) => r.spend), [26, 19, 15]);
  assert.equal(infra.reduce((n, r) => n + r.spend, 0), 60);
  // And each is a counterparty in its own right, not a line in a category.
  for (const r of infra) {
    assert.ok(r.purpose, r.key);
    assert.ok(r.credentialMasked, r.key);
    assert.ok(r.costClass, r.key);
  }
  assert.equal(s.rows.reduce((n, r) => n + r.spend, 0), s.total);
  assert.equal(s.rows.reduce((n, r) => n + r.expected, 0), s.expected);
});

test('a supplier record’s variance is derived from the two rows above it', () => {
  for (const p of PERIODS) {
    const period = resolvePeriod(p.key, AT);
    const r = fixtureSupplier('anthropic', period);
    assert.equal(r.health.variance, Math.round((r.health.spend - r.health.expected) * 100) / 100, p.key);
    assert.equal(
      r.health.variancePct,
      Math.round(((r.health.spend - r.health.expected) / r.health.expected) * 1000) / 10,
      p.key,
    );
  }
});

test('the failure rate holds whatever the window, because both halves scale', () => {
  // The rule the handoff states for this panel: "Every figure in this panel
  // scales with the period picker, **including the failure denominator**." A
  // numerator that moves against a denominator that does not would read as a
  // rate eleven times worse than it is on the twelve-month view.
  const rates = PERIODS.map((p) => fixtureSupplier('tripadvisor', resolvePeriod(p.key, AT)).health.failurePct);
  // Every window agrees to within a tenth of a point. The spread is rounding —
  // both halves are whole calls — and not the failure the rule is about, which
  // would be a rate eleven times worse on the twelve-month view.
  // Rounded to whole tenths before comparing: 6.9 − 6.8 is 0.09999999999999964
  // in floating point, and a test that fails on that is testing the arithmetic
  // of doubles rather than the rule.
  assert.ok(Math.round((Math.max(...rates) - Math.min(...rates)) * 10) <= 1, rates.join(' '));
  for (const r of rates) assert.ok(r > 6.5 && r < 7, String(r));
});

test('a supplier nobody has is nothing, not an empty record', () => {
  assert.equal(fixtureSupplier('nobody', resolvePeriod('this-month', AT)), null);
});

test('the mock record and the mock row agree about spend', () => {
  // The record is derived from the row the table draws, so the two cannot
  // disagree — the same discipline the household record is under.
  const period = resolvePeriod('last-3-months', AT);
  const table = scaleFixtures(fixtures(), period).suppliers.rows;
  for (const key of ['anthropic', 'tripadvisor', 'fly']) {
    const row = table.find((r) => r.key === key);
    const record = fixtureSupplier(key, period);
    assert.equal(record.health.spend, row.spend, key);
    assert.equal(record.health.expected, row.expected, key);
    assert.equal(record.health.calls, row.volume, key);
  }
});

test('the supplier share column adds to a hundred and comes off the spend', () => {
  const period = resolvePeriod('last-3-months', AT);
  const scaled = scaleFixtures(fixtures(), period).suppliers;
  const total = scaled.rows.reduce((n, r) => n + r.spend, 0);
  // The share is a share of the same window's own total, so it is the same
  // figure at every window and the column reconciles with the two beside it.
  for (const r of scaled.rows) {
    assert.ok(Math.abs(r.share - Math.round((r.spend / total) * 1000) / 10) <= 0.1, r.key);
  }
  // Within rounding of a hundred: twelve figures each to one decimal.
  assert.ok(Math.abs(scaled.rows.reduce((n, r) => n + r.share, 0) - 100) < 0.5);
  // And the rows still add to the total the foot shows.
  assert.ok(Math.abs(total - scaled.total) < 1);
});

test('the largest supplier is read off the rows rather than named by hand', () => {
  const m = scaleFixtures(fixtures(), resolvePeriod('this-month', AT));
  assert.equal(m.suppliers.largest.key, 'anthropic');
  assert.equal(m.suppliers.largest.spend, Math.max(...m.suppliers.rows.map((r) => r.spend)));
});
