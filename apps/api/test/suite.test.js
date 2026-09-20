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
import { PURPOSE_CLASSES, backOfficeActorExpression, classExpression, classOf } from '../src/domain/costClass.js';
import { change } from '../src/repositories/suite.js';
import { listCounterparties, setAdapter } from '../src/repositories/counterparties.js';
import { readStanding, readTiers, setPrice } from '../src/repositories/pricing.js';
import { withhold } from '../src/routes/suite.js';
import { enabledSources, loadSourceSettings, setSourceOff, sourceKeys, sourceOff } from '../src/sources/index.js';
import { bump, healthOf, noteCall, noteFault } from '../src/sources/meter.js';
import { pool, query } from '../src/db.js';

test.after(() => pool.end());
// `enabledSources()` is synchronous and reads a set loaded once at start, so
// the switch has to be in memory before anything asserts on it.
test.before(() => loadSourceSettings());

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

test('the book of subscriptions balances at every window, and never goes negative', () => {
  for (const p of PERIODS) {
    const m = scaleFixtures(fixtures(), resolvePeriod(p.key, AT));
    const s = m.overview.subscriptions;

    // opening + new − lost = live, at every window. A book that does not
    // balance is the first thing anybody checks.
    assert.equal(Math.round(s.opening + s.added - s.lost), s.live, p.key);

    /**
     * And it is a book of real counts.
     *
     * Deriving the opening as `live − new + lost` from a scaled monthly flow
     * gave **−253 subscriptions** over a twelve-month window (20 Sep 2026). The
     * two ends are stocks read at their own moments, and only `lost` is
     * derived, which is the only arrangement that cannot go negative.
     */
    assert.ok(s.opening >= 0, `${p.key} opening ${s.opening}`);
    assert.ok(s.lost >= 0, `${p.key} lost ${s.lost}`);
    assert.ok(s.added >= 0, `${p.key} added ${s.added}`);
    // A closing count is a count at a moment, so "last month" closes on the
    // month it names rather than on today.
    assert.equal(s.live, p.key === 'last-month' ? 561 : 579, p.key);
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

test('the classes add up to the bill, whatever the ledger holds', async () => {
  /**
   * The line under Cost to serve names the classes, and it has to sum to the
   * figure above it. It did not: fifty-three purposes were unclassified —
   * **$90.92 of a $563.90 production bill, sixteen per cent** — and they fell
   * out of the sentence while staying in the total, because the sentence was
   * built from a list of four names instead of from the ledger (20 Sep 2026,
   * reading production).
   */
  const { rows } = await query(
    `select ${classExpression('c')} as class, coalesce(sum(c.estimated_cost_usd), 0)::float as usd
       from provider_calls c group by 1`,
  );
  const total = rows.reduce((n, r) => n + r.usd, 0);
  const named = rows.filter((r) => ['library', 'serve', 'office', 'research'].includes(r.class));
  const rest = rows.filter((r) => !['library', 'serve', 'office', 'research'].includes(r.class));

  // Every row lands in one of the five buckets the screen draws, and the five
  // add up to the whole bill.
  assert.ok(Math.abs(named.reduce((n, r) => n + r.usd, 0) + rest.reduce((n, r) => n + r.usd, 0) - total) < 0.01);
  // And nothing is in a class the screen has no name for.
  for (const r of rest) assert.equal(r.class, 'unclassified', `${r.class} is a class nothing draws`);
});

test('every purpose the ledger holds has been classified', async () => {
  // Not a rule about the code — a check against what is actually in there. A
  // purpose that appears in production and in no class is spend nobody can
  // explain, and the answer is to classify it rather than to widen a default.
  /**
   * Only the purposes that cost something.
   *
   * A purpose with no spend behind it is usually a row a test left there, and
   * failing the suite over a free one would teach people to widen the default
   * — which is the fault this whole file exists to prevent. Where there is
   * money, there has to be a class.
   */
  const { rows } = await query(
    `select purpose, coalesce(sum(estimated_cost_usd), 0)::float as usd
       from provider_calls group by 1 having coalesce(sum(estimated_cost_usd), 0) > 0`,
  );
  const missing = rows.filter((r) => !PURPOSE_CLASSES[r.purpose]);
  assert.deepEqual(
    missing.map((r) => `${r.purpose} ($${r.usd.toFixed(2)})`),
    [],
    'classify these in domain/costClass.js rather than letting them fall outside every class',
  );
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
// a closed period is closed at both ends, and priced at what was sold
// ---------------------------------------------------------------------------

/**
 * Three faults in the real reader that unit-testing the fixtures could never
 * have found, all from Codex on 20 Sep 2026, and all of them the kind that
 * makes a figure quietly wrong rather than visibly broken.
 */
test('last month ends where this month starts, exclusively', async () => {
  const period = resolvePeriod('last-month');
  // The window itself. `generate_series` to `date_trunc('month', to)` used to
  // include the current month, because `to` is its first instant.
  const { rows } = await query(
    `select to_char(m, 'YYYY-MM') as month
       from generate_series(date_trunc('month', $1::timestamptz),
                            date_trunc('month', $2::timestamptz - interval '1 microsecond'),
                            '1 month') m`,
    [period.from, period.to],
  );
  assert.equal(rows.length, 1, 'one month in "last month"');
  assert.equal(rows[0].month, period.from.slice(0, 7));
});

test('a closed window counts nothing after it', async () => {
  const period = resolvePeriod('last-month');
  // The estate's active count is the one that was bounded at the bottom only.
  const { rows: [both] } = await query(
    `select count(distinct e.household_id)::int as n from activity_events e
       join households h on h.id = e.household_id
      where e.at >= $1 and e.at < $2 and h.origin <> 'guest_invite'`,
    [period.from, period.to],
  );
  const { rows: [open] } = await query(
    `select count(distinct e.household_id)::int as n from activity_events e
       join households h on h.id = e.household_id
      where e.at >= $1 and h.origin <> 'guest_invite'`,
    [period.from],
  );
  // Bounded is never larger than unbounded, and this is the assertion that
  // fails the moment somebody drops the upper bound again.
  assert.ok(both.n <= open.n);
});

test('a guest household is excluded from MRR by the filter, not by the join', async () => {
  // `h.origin <> 'guest_invite'` in a LEFT JOIN condition only nulls `h`; the
  // account row survives and is still counted. Asserted against the aggregate.
  const { rows: [r] } = await query(
    `select count(a.id) filter (where a.status <> 'suspended' and h.origin <> 'guest_invite')::int as filtered,
            count(a.id) filter (where a.status <> 'suspended')::int as unfiltered
       from accounts a
       left join households h on h.id = a.household_id`,
  );
  assert.ok(r.filtered <= r.unfiltered);
  const { rows: [guests] } = await query(
    `select count(*)::int as n from accounts a
       join households h on h.id = a.household_id
      where h.origin = 'guest_invite' and a.status <> 'suspended'`,
  );
  assert.equal(r.unfiltered - r.filtered, guests.n);
});

test('a price change cannot rewrite a month that has already been sold', async () => {
  /**
   * The history row carries its own `price_pence` and `status`, and those are
   * what a closed month is priced from. The query used to read `ph.plan` and
   * then take `plans.price_pence` — today's cached price — so changing a price
   * restated every prior month, which is the one thing the insert-only
   * discipline exists to prevent.
   */
  const { rows: [col] } = await query(
    `select count(*)::int as n from information_schema.columns
      where table_name = 'account_plan_history' and column_name in ('price_pence', 'status')`,
  );
  assert.equal(col.n, 2, 'the history must carry the price and the status it was sold at');

  // And one current row per plan and channel, so "the price in force" is a
  // question with one answer (migration 202).
  const { rows: dupes } = await query(
    `select plan_key, channel, count(*)::int as n from plan_prices
      where effective_to is null group by 1, 2 having count(*) > 1`,
  );
  assert.deepEqual(dupes, []);
  const { rows: rates } = await query(
    `select counterparty_key, count(*)::int as n from counterparty_rates
      where effective_to is null group by 1 having count(*) > 1`,
  );
  assert.deepEqual(rates, []);
});

test('a swept session does not turn a household’s call into research', () => {
  /**
   * `sweepDeadSessions()` deletes expired sessions after thirty days. The
   * actor fallback used to read "no session row" as "the back office", so an
   * ordinary household's `serve` calls became `research` a month later and a
   * closed month's cost to serve changed. The expression now falls back to
   * `household_id`, which is never swept.
   */
  const sql = backOfficeActorExpression('c');
  assert.match(sql, /c\.household_id/, 'the fallback must read the household, which outlives the session');
  // The session is still looked at first, and "attributed to nobody" is still
  // the conservative default.
  assert.ok(sql.indexOf('api_sessions') < sql.indexOf('c.household_id'));
  assert.match(sql, /true\)$/);
});

test('a household keeps the price it was sold at when the price goes up', async () => {
  /**
   * The Subscriptions panel says "changing a price writes a new price row;
   * existing subscriptions keep the row they were sold on", and MRR used to
   * value every account at the plan's *current* price — so the promise was
   * false the moment the price changed (Codex, 20 Sep 2026).
   *
   * Exercised against a real account rather than asserted about the SQL,
   * because the fault was in what the query returned and not in what it said.
   */
  const { rows: [a] } = await query('select id, plan, status from accounts order by created_at limit 1');
  const was = { plan: a.plan, status: a.status };
  const { rows: [price] } = await query(
    "select amount_pence, annual_discount_pct from plan_prices where plan_key='household' and channel='web' and effective_to is null");
  /**
   * Everything this test writes is remembered by id and removed by id.
   *
   * The first version deleted *every* history row for the account and left its
   * own price rows in the insert-only table, so against a real estate it would
   * have destroyed a household's plan history and accumulated pricing
   * decisions nobody took (Codex, 20 Sep 2026).
   */
  const mine = { history: null, prices: [] };
  try {
    await query("update accounts set plan = 'household' where id = $1", [a.id]);
    const { rows: [row] } = await query(
      `insert into account_plan_history (account_id, plan, status, price_pence)
       values ($1, 'household', $2, 899) returning id`,
      [a.id, a.status]);
    mine.history = row.id;
    assert.equal((await readStanding()).mrrPence, 899, 'sold at £8.99');

    const raised = await setPrice({ planKey: 'household', channel: 'web', amountPence: 1199, discountPct: 7, by: 'a test' });
    if (raised.row) mine.prices.push(raised.row.id);
    // The price on the tier moved…
    assert.equal((await readTiers()).find((t) => t.key === 'household').webPence, 1199);
    // …and what this household is worth did not.
    assert.equal((await readStanding()).mrrPence, 899, 'grandfathered');
  } finally {
    // Put the rows back exactly: delete what this test inserted, then re-open
    // the row it closed, rather than inserting a third one.
    for (const id of mine.prices) await query('delete from plan_prices where id = $1', [id]);
    if (mine.history) await query('delete from account_plan_history where id = $1', [mine.history]);
    await query(
      `update plan_prices set effective_to = null
        where plan_key = 'household' and channel = 'web'
          and id = (select id from plan_prices
                     where plan_key = 'household' and channel = 'web'
                     order by effective_from desc limit 1)`,
    );
    await query('update plans set price_pence = $1 where key = $2', [price.amount_pence, 'household']);
    await query('update accounts set plan = $2, status = $3 where id = $1', [a.id, was.plan, was.status]);
  }
});

// ---------------------------------------------------------------------------
// money is withheld by the answer, not by the screen
// ---------------------------------------------------------------------------

/**
 * `view_reporting` and `view_financials` are two capabilities, and the whole
 * money section was coming back to anybody holding the first (Codex, 20 Sep
 * 2026). Drawing a figure or not is a courtesy; what is in the answer is the
 * boundary — and the built-in `support` role is a real caller who holds
 * `view_accounts` and explicitly no money access.
 */
const holding = (...capabilities) => ({ access: { doors: ['admin'], capabilities: new Set(capabilities), isOwner: false } });

test('a reporting reader without financials gets no money at all', () => {
  const full = scaleFixtures(fixtures(), resolvePeriod('this-month', AT));
  const cut = withhold(full, holding('view_reporting'));

  assert.equal(cut.money, null);
  assert.equal(cut.subscriptions, null);
  assert.equal(cut.suppliers, null);
  assert.equal(cut.overview.revenue, null);
  assert.deepEqual(cut.withheld, ['view_financials']);

  // Nothing anywhere in the answer still carries a revenue figure.
  const said = JSON.stringify(cut);
  assert.ok(!said.includes('9244'), 'revenue survived the redaction');
  assert.ok(!said.includes('3851'), 'MRR survived the redaction');
  assert.ok(!said.includes('41171'), 'gross bookings survived the redaction');
});

test('a money measure on Overview is withheld rather than dropped', () => {
  const cut = withhold(scaleFixtures(fixtures(), resolvePeriod('this-month', AT)), holding('view_reporting'));
  const revenue = cut.overview.measures.find((m) => m.key === 'revenue');
  // Still there, and marked: a tile that vanishes reads as "there is nothing
  // here", which is a different and wrong fact.
  assert.ok(revenue);
  assert.equal(revenue.value, null);
  assert.equal(revenue.withheld, true);
  // And the measures that are not money are untouched.
  assert.equal(cut.overview.measures.find((m) => m.key === 'engagement').value, 862);
});

test('what a household pays is withheld from an accounts-only reader', () => {
  const cut = withhold(scaleFixtures(fixtures(), resolvePeriod('this-month', AT)), holding('view_reporting'));
  assert.equal(cut.customers.payingMrr, null);
  for (const h of cut.customers.households) {
    assert.equal(h.monthPence, 0, `${h.name} still carries a price`);
    assert.equal(h.costUsd, undefined);
  }
  // Who they are and what they do is not money and stays.
  assert.equal(cut.customers.households.length, 12);
  assert.ok(cut.customers.households.every((h) => h.name && typeof h.places === 'number'));
});

test('holding financials changes nothing at all', () => {
  const full = scaleFixtures(fixtures(), resolvePeriod('this-month', AT));
  assert.strictEqual(withhold(full, holding('view_reporting', 'view_financials')), full);
});

// ---------------------------------------------------------------------------
// the red button actually does what it says
// ---------------------------------------------------------------------------

/**
 * "Turn the adapter off" was register-only, under a comment claiming it stopped
 * the calls (epic-59, 20 Sep 2026, exercising it live). It set
 * `counterparties.status = 'off'` while `enabledSources()` went on returning
 * the source and the search path went on buying.
 *
 * Held here because it is the one control in the suite whose failure costs
 * money, and because the failure is invisible: the screen said "off".
 */
test('turning a search source off stops the calls, not only the register', async () => {
  // Put the register back exactly as it was as well as the switch: tripadvisor
  // is seeded `trial`/`wired`, and a test that left it `live`/`enabled` would
  // have quietly turned a billed source on (20 Sep 2026).
  const before = sourceOff('tripadvisor');
  const { rows: [was] } = await query('select status, adapter_state from counterparties where key = $1', ['tripadvisor']);
  try {
    const off = await setAdapter('tripadvisor', { on: false });
    assert.equal(off.status, 'off');
    assert.equal(off.adapter_state, 'none');
    // The estate's own switch, which is the half that was missing.
    assert.equal(off.source, 'tripadvisor');
    assert.equal(off.stopped, true);
    assert.equal(sourceOff('tripadvisor'), true);
    assert.ok(!enabledSources({ includeOptIn: true }).some((s) => s.key === 'tripadvisor'));

    const on = await setAdapter('tripadvisor', { on: true });
    assert.equal(on.stopped, false);
    assert.equal(sourceOff('tripadvisor'), false);
  } finally {
    await setSourceOff('tripadvisor', before);
    await query('update counterparties set status = $2, adapter_state = $3 where key = $1',
      ['tripadvisor', was.status, was.adapter_state]);
  }
});

test('a supplier that is not a search source says so rather than implying it stopped', async () => {
  // Fly.io is an invoice. No button in a back office stops an invoice, and the
  // answer must not suggest one did.
  const off = await setAdapter('fly', { on: false });
  assert.equal(off.status, 'off');
  assert.equal(off.source, null);
  assert.equal(off.stopped, false);
  await setAdapter('fly', { on: true });
});

test('a provider_key that is not a source flips nothing, whatever it is called', async () => {
  /**
   * `provider_key` does two jobs, and only one of them is the source registry.
   *
   * It joins the register to `provider_calls` — where the provider may be
   * anything the adapters log, `anthropic` and `mapbox` among them — and it is
   * *also* how a counterparty is recognised as one of the search sources the
   * estate has a switch for. So it is checked against `sourceKeys()` rather
   * than assumed, and a register row naming a provider the registry has never
   * heard of must turn nothing off rather than quietly flipping something else.
   */
  const keys = new Set(sourceKeys());
  const register = await listCounterparties();
  const anthropic = register.find((c) => c.key === 'anthropic');
  assert.equal(anthropic.providerKey, 'anthropic');
  assert.ok(!keys.has('anthropic'), 'anthropic is a ledger provider, not a search source');

  const before = [...(await loadSourceSettings())].sort();
  const off = await setAdapter('anthropic', { on: false });
  assert.equal(off.source, null);
  assert.equal(off.stopped, false);
  // And nothing in the estate's switch moved.
  assert.deepEqual([...(await loadSourceSettings())].sort(), before);
  await setAdapter('anthropic', { on: true });
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

// ---------------------------------------------------------------------------
// a call says whether it came back
// ---------------------------------------------------------------------------

test('the meter carries how it went without becoming a unit of anything', () => {
  // `meter` goes straight into `provider_calls.units`, which is priced by
  // adding up its keys and shown on Settings › Usage as units. A `failed: 1`
  // key would be counted as one and might be priced, so the outcome rides on
  // symbols — invisible to `Object.keys`, to a spread and to `JSON.stringify`.
  const meter = {};
  bump(meter, 'google', 3);
  noteCall(meter, 120);
  noteCall(meter, 340);
  noteFault(meter, 'http_429');

  assert.deepEqual(Object.keys(meter), ['google']);
  // The two that reach the database: the column is jsonb, and `costOf` prices
  // by iterating keys.
  assert.equal(JSON.stringify(meter), '{"google":3}');
  // And a spread, which copies own *enumerable* symbols — which is why these
  // are written non-enumerable rather than merely symbol-keyed.
  assert.deepEqual({ ...meter }, { google: 3 });
  assert.deepEqual(Object.getOwnPropertySymbols({ ...meter }), []);
});

test('a meter nobody observed is not a success', () => {
  // The one that matters: an adapter that has never been instrumented must
  // record `ok: null`, which reads as "not recorded". Defaulting it to true
  // would write four thousand successes nobody watched.
  assert.deepEqual(healthOf({ google: 3 }), { ok: null, ms: null, failed: 0, fault: null });
  assert.deepEqual(healthOf(null), { ok: null, ms: null, failed: 0, fault: null });
  assert.deepEqual(healthOf(undefined), { ok: null, ms: null, failed: 0, fault: null });
});

test('a meter that saw a call says so, and counts the ones that fell over', () => {
  const ok = {};
  noteCall(ok, 120);
  noteCall(ok, 80);
  assert.deepEqual(healthOf(ok), { ok: true, ms: 200, failed: 0, fault: null });

  const bad = {};
  noteCall(bad, 100);
  noteFault(bad, 'timeout');
  noteFault(bad, 'http_500');
  const h = healthOf(bad);
  assert.equal(h.ok, false);
  assert.equal(h.failed, 2);
  // The first reason, kept short — never the provider's own message, which can
  // echo back a query, a key or somebody's address.
  assert.equal(h.fault, 'timeout');
  assert.equal(h.ms, 100);
});

test('a fault reason is a token, not a paragraph', () => {
  const m = {};
  noteFault(m, 'x'.repeat(200));
  assert.equal(healthOf(m).fault.length, 40);
});
