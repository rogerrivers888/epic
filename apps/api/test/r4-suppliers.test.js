import { test } from 'node:test';
import assert from 'node:assert/strict';

// Suppliers and Money on the shared cost figure (owner, 29 Sep 2026: "bring
// Suppliers and Money onto the same shared cost figure (£ throughout, $ in
// brackets, ledger figures labelled "estimate", Expected = last month's bill
// or budget, never $0)").
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const cost = await import('../src/desk/supplierCost.js');
const settings = await import('../src/desk/settings.js');
const { readSuite, readSupplierRecord } = await import('../src/repositories/suite.js');
const { resolvePeriod } = await import('../src/domain/reportingPeriods.js');
const { fixtures, fixtureSupplier, scaleFixtures } = await import('../src/domain/reportingFixtures.js');

test.after(() => pool.end());

const AT = new Date('2026-09-28T12:00:00Z');
const GOOGLE = { key: 'google-places', providerKey: 'google' };
const ROUTES = { key: 'google-routes', providerKey: 'google-routes' };
const CLAUDE = { key: 'anthropic', providerKey: 'anthropic' };
const TA = { key: 'tripadvisor', providerKey: 'tripadvisor' };
const OPENAI = { key: 'openai', providerKey: 'openai' };

async function seed() {
  await query(`delete from provider_calls`);
  await query(`delete from billing_days`);
  await query(`delete from bo_settings where key in ('billing', 'claudeBilling', 'budgetGoogle', 'budgetClaude')`);
  // September, as production had it: the ledger at list price far above the bill.
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at) values
    ('google', 'census.slice', '{"google-essentials": 9000}', 0, '2026-09-10 12:00+01'),
    ('google', 'drawer.open', '{"google": 9000, "google-pro": 9000}', 536.29, '2026-09-11 12:00+01'),
    ('google-routes', 'plan.matrix', '{"google-routes": 100}', 43.38, '2026-09-12 12:00+01'),
    ('tripadvisor', 'drawer.ta', '{"tripadvisor": 79}', 5.81, '2026-09-13 12:00+01'),
    ('anthropic', 'plan.preview', null, 153.03, '2026-09-14 12:00+01'),
    ('anthropic', 'plan.preview', null, 20, '2026-08-14 12:00+01'),
    ('openai', 'voice.minutes', null, 1, '2026-07-10 12:00+01'),
    ('openai', 'voice.minutes', null, 2, '2026-07-20 12:00+01'),
    ('openai', 'voice.minutes', null, 4, '2026-08-10 12:00+01'),
    ('openai', 'voice.minutes', null, 8, '2026-08-25 12:00+01')`);
  await query(`insert into bo_settings (key, value, updated_by) values
    ('billing', $1, 'test'), ('claudeBilling', $2, 'test')
    on conflict (key) do update set value = excluded.value`, [
    JSON.stringify({ month: '2026-09', usageGbp: 40.61, paidGbp: 0, creditGbp: 180.15, creditExpires: '2026-12-20', at: '2026-09-29T12:00:00Z', source: 'Google Cloud console' }),
    JSON.stringify({ month: '2026-09', usd: 117.02, gbp: 87, creditUsd: 382.99, at: '2026-09-29T12:00:00Z', source: 'Anthropic console' }),
  ]);
  settings.forget();
}

test('Google September: the console figure is the bill, and IDs-only costs nothing', async () => {
  await seed();
  const g = await cost.supplierMonth(GOOGLE, '2026-09');
  assert.equal(g.gbp, 40.61);
  assert.equal(g.basis, 'billed');
  assert.equal(g.source, 'Google Cloud console');
  assert.equal(g.nativeUsd, null, 'Google bills this account in pounds');
  // The register's Routes entry is inside Google's bill, never a second copy.
  const r = await cost.supplierMonth(ROUTES, '2026-09');
  assert.equal(r.gbp, null);
  assert.equal(r.within, 'google-places');
  // A month with no bill: 9,000 IDs-only requests are inside the free 10,000.
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at)
               values ('google', 'census.slice', '{"google-essentials": 9000}', 0, '2026-06-10 12:00+01')`);
  const june = await cost.supplierMonth(GOOGLE, '2026-06');
  assert.equal(june.gbp, 0);
  assert.equal(june.basis, 'estimate');
});

test('Anthropic: the console month is billed in dollars with pounds; any other month is the ledger, an estimate', async () => {
  await seed();
  const sep = await cost.supplierMonth(CLAUDE, '2026-09');
  assert.equal(sep.gbp, 87);
  assert.equal(sep.nativeUsd, 117.02);
  assert.equal(sep.basis, 'billed');
  assert.equal(sep.at, '2026-09-29T12:00:00Z');
  const aug = await cost.supplierMonth(CLAUDE, '2026-08');
  assert.equal(aug.basis, 'estimate');
  assert.equal(aug.nativeUsd, 20);
  assert.ok(Math.abs(aug.gbp - 20 * 0.79) < 1e-9);
});

test('Tripadvisor: 79 look-ups inside the 1,000 free a month cost £0', async () => {
  await seed();
  const ta = await cost.supplierMonth(TA, '2026-09');
  assert.equal(ta.gbp, 0);
  assert.equal(ta.nativeUsd, 0);
  assert.equal(ta.basis, 'estimate');
  assert.equal(ta.locations, 79);
});

test('expected is last month’s bill, else a real estimate, else the budget, else nothing — never a nought nobody billed', async () => {
  await seed();
  // August in the export: days 1–10, trusted to day 8.
  for (let d = 1; d <= 10; d += 1) {
    await query(`insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, cost, credits, promo, currency)
                 values ('2026-08', $1, 'Places API', 'Text Search Pro', 'S', 'google-pro', 100, 2, 0, 0, 'GBP')`, [`2026-08-${String(d).padStart(2, '0')}`]);
  }
  const budgets = { google: 50, claude: 100 };
  const g = await cost.supplierExpected(GOOGLE, ['2026-08'], { budgets });
  assert.equal(g.basis, 'billed', 'nothing asked after the cutoff, so all of it off the bill');
  assert.equal(g.gbp, 16, 'the eight trusted days at £2');
  // No bill, nothing in the ledger: the budget.
  const july = await cost.supplierExpected(GOOGLE, ['2026-07'], { budgets });
  assert.deepEqual([july.gbp, july.basis], [50, 'budget']);
  // Claude's August is a ledger estimate above nought: that, labelled so.
  const c = await cost.supplierExpected(CLAUDE, ['2026-08'], { budgets });
  assert.equal(c.basis, 'estimate');
  assert.equal(c.nativeUsd, 20);
  // Claude with nothing: its budget.
  const c6 = await cost.supplierExpected(CLAUDE, ['2026-06'], { budgets });
  assert.deepEqual([c6.gbp, c6.basis], [100, 'budget']);
  // Tripadvisor's last month was £0 on an estimate, and it has no budget: nothing.
  const t = await cost.supplierExpected(TA, ['2026-08'], { budgets });
  assert.equal(t.gbp, null);
  // The months a window is compared with.
  assert.deepEqual(cost.expectedMonths(resolvePeriod('this-month', AT)), ['2026-08']);
  assert.deepEqual(cost.expectedMonths(resolvePeriod('last-30-days', AT)), ['2026-08']);
  assert.deepEqual(cost.expectedMonths(resolvePeriod('last-month', AT)), ['2026-07']);
  assert.deepEqual(cost.expectedMonths(resolvePeriod('last-3-months', AT)), ['2026-04', '2026-05', '2026-06']);
});

test('a window across a month boundary never counts a pound twice', async () => {
  await seed();
  const w = (a, b) => cost.supplierWindow(OPENAI, a, b, { now: AT }).then((x) => x.gbp);
  const jul = (await cost.supplierMonth(OPENAI, '2026-07')).gbp;
  const aug = (await cost.supplierMonth(OPENAI, '2026-08')).gbp;
  const both = await w('2026-07-01T00:00:00Z', '2026-09-01T00:00:00Z');
  assert.ok(Math.abs(both - (jul + aug)) < 1e-9);
  // Split at the fifteenth of each month: the parts add back to the whole.
  const parts = [
    await w('2026-07-01T00:00:00Z', '2026-07-15T00:00:00Z'),
    await w('2026-07-15T00:00:00Z', '2026-08-15T00:00:00Z'),
    await w('2026-08-15T00:00:00Z', '2026-09-01T00:00:00Z'),
  ];
  assert.ok(Math.abs(parts.reduce((n, x) => n + x, 0) - both) < 1e-9, `${parts} against ${both}`);
  assert.ok(Math.abs(parts[1] - (2 + 4) * 0.79) < 1e-9, 'the rows inside the window, at their share of each month');
  const labelled = await cost.supplierWindow(OPENAI, '2026-07-15T00:00:00Z', '2026-08-15T00:00:00Z', { now: AT });
  assert.equal(labelled.apportioned, true);
  assert.equal(labelled.basis, 'estimate');
});

test('the suite reads every supplier, the Money totals and the drill off the shared figure', async () => {
  await seed();
  const period = resolvePeriod('this-month', AT);
  const m = await readSuite(period, { now: AT });
  const row = (k) => m.suppliers.rows.find((r) => r.key === k);
  assert.equal(m.suppliers.currency, 'gbp');
  assert.deepEqual([row('google-places').spend, row('google-places').basis], [40.61, 'billed']);
  assert.equal(row('google-routes').spend, null);
  assert.equal(row('google-routes').gap, 'In Google’s bill');
  assert.deepEqual([row('anthropic').spend, row('anthropic').spendUsd, row('anthropic').basis], [87, 117.02, 'billed']);
  assert.deepEqual([row('tripadvisor').spend, row('tripadvisor').basis], [0, 'estimate']);
  // Expected: no bill for August in this seed, so Google's and Claude's
  // budgets, or Claude's August estimate; never a nought.
  for (const r of m.suppliers.rows) assert.notEqual(r.expected, 0, `${r.key} expected nought`);
  assert.equal(row('anthropic').expectedBasis, 'estimate');
  assert.equal(row('google-places').expectedBasis, 'budget');
  assert.equal(row('tripadvisor').expected, null);
  // One total, every pound once, and Money says the same.
  const sum = m.suppliers.rows.reduce((n, r) => n + (r.spend ?? 0), 0);
  assert.ok(Math.abs(m.suppliers.total - sum) < 0.02);
  assert.ok(Math.abs(m.suppliers.total - (40.61 + 87)) < 0.02, `total £${m.suppliers.total}`);
  assert.equal(m.money.total.cost, m.suppliers.total);
  assert.equal(m.money.costToServe.total, m.suppliers.total);
  const classes = m.money.costToServe.byClass.reduce((n, r) => n + r.value, 0);
  assert.ok(Math.abs(classes - m.suppliers.total) < 0.05, `classes £${classes} against £${m.suppliers.total}`);
  assert.equal(m.history.series.cost.at(-1), Math.round(m.suppliers.total * 100) / 100);
  // The record agrees with its row.
  const rec = await readSupplierRecord('anthropic', period);
  assert.deepEqual([rec.health.spend, rec.health.spendUsd, rec.health.basis, rec.health.currency], [87, 117.02, 'billed', 'gbp']);
  assert.equal(rec.health.expected, row('anthropic').expected);
});

test('mock mode keeps the shape the screens read', () => {
  const period = resolvePeriod('this-month', AT);
  const m = scaleFixtures(fixtures(), period);
  assert.equal(m.suppliers.currency, 'gbp');
  for (const r of m.suppliers.rows) {
    assert.ok('basis' in r && 'spendUsd' in r && 'expectedBasis' in r && 'billsIn' in r, r.key);
  }
  const rec = fixtureSupplier('anthropic', period);
  assert.equal(rec.health.basis, 'billed');
  assert.equal(rec.health.currency, 'gbp');
});

test('a budget month mixed with estimates is "budget+estimate", never "billed" — the 3- and 12-month views', async () => {
  await seed();
  const budgets = { google: 50, claude: 100 };
  // Three months: Claude has a ledger June and nothing in April or May.
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at)
               values ('anthropic', 'plan.preview', null, 10, '2026-06-10 12:00+01')`);
  const three = cost.expectedMonths(resolvePeriod('last-3-months', AT));
  const c3 = await cost.supplierExpected(CLAUDE, three, { budgets });
  assert.equal(c3.basis, 'budget+estimate');
  assert.ok(Math.abs(c3.gbp - (100 + 100 + 10 * 0.79)) < 1e-9);
  const g3 = await cost.supplierExpected(GOOGLE, three, { budgets });
  assert.deepEqual([g3.gbp, g3.basis], [150, 'budget']);
  const m3 = await readSuite(resolvePeriod('last-3-months', AT), { now: AT });
  assert.equal(m3.suppliers.rows.find((r) => r.key === 'anthropic').expectedBasis, 'budget+estimate');
  // Twelve months: one billed Google month among budget ones is "billed+budget".
  const twelve = cost.expectedMonths(resolvePeriod('last-12-months', AT));
  assert.equal(twelve.length, 12);
  assert.deepEqual([twelve[0], twelve[11]], ['2024-10', '2025-09']);
  for (let d = 1; d <= 5; d += 1) {
    await query(`insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, cost, credits, promo, currency)
                 values ('2025-02', $1, 'Places API', 'Text Search Pro', 'S', 'google-pro', 100, 1, 0, 0, 'GBP')`, [`2025-02-0${d}`]);
  }
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at)
               values ('anthropic', 'plan.preview', null, 5, '2025-03-10 12:00+00')`);
  const g12 = await cost.supplierExpected(GOOGLE, twelve, { budgets });
  assert.equal(g12.basis, 'billed+budget');
  assert.equal(g12.gbp, 11 * 50 + 3, 'three trusted days at £1 and eleven budget months');
  const c12 = await cost.supplierExpected(CLAUDE, twelve, { budgets });
  assert.equal(c12.basis, 'budget+estimate');
  assert.equal(cost.combineBasis(['billed', 'estimate']), 'billed+estimate');
  assert.equal(cost.combineBasis(['budget', 'budget']), 'budget');
});

test('a browse that asked Google and Tripadvisor at once is split between them before it is shared across classes', async () => {
  await seed();
  // August: one Google display search, inside its free thousand (£0), and
  // 1,200 Tripadvisor locations, 200 past the free 1,000.
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at)
               values ('google+tripadvisor', 'ta.browse', '{"google-search": 1, "tripadvisor": 1200}', 18.04, '2026-08-20 12:00+01')`);
  const m = await readSuite(resolvePeriod('last-month', AT), { now: AT });
  const ta = m.suppliers.rows.find((r) => r.key === 'tripadvisor');
  const want = 200 * 0.015 * 0.79;
  assert.ok(Math.abs(ta.spend - Math.round(want * 100) / 100) < 1e-9, `Tripadvisor £${ta.spend}`);
  const browse = m.money.costToServe.byPurpose.find((p) => p.label === 'ta.browse');
  assert.ok(Math.abs(browse.value - Math.round(want * 100) / 100) < 0.011, `the browse carries Tripadvisor’s cost, got £${browse.value}`);
  const classes = m.money.costToServe.byClass.reduce((n, r) => n + r.value, 0);
  assert.ok(Math.abs(classes - m.suppliers.total) < 0.05);
});

test('the batched months are the months one at a time', async () => {
  await seed();
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at) values
    ('google', 'drawer.open', '{"google-pro": 6000, "pro-details": 1500}', 150, '2026-07-10 12:00+01'),
    ('google', 'drawer.legacy', null, 3, '2026-07-11 12:00+01'),
    ('google', 'drawer.legacy', null, 2, '2026-09-30 12:00+01'),
    ('google', 'drawer.after', '{"google-pro": 7000}', 224, '2026-09-30 13:00+01'),
    ('google+tripadvisor', 'ta.browse', '{"google-search": 2, "tripadvisor": 1500}', 22.6, '2026-07-12 12:00+01'),
    ('fixtures+osm', 'several', null, 1.5, '2026-08-01 00:30+01'),
    ('mapbox', 'tiles', null, 0.4, '2026-06-30 23:30+01')`);
  for (let d = 1; d <= 6; d += 1) {
    await query(`insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, cost, credits, promo, currency)
                 values ('2026-08', $1, 'Places API', 'Text Search Pro', 'S', 'google-pro', 100, 2.5, 0, 0, 'GBP')`, [`2026-08-0${d}`]);
  }
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at) values
    ('google', 'drawer.late', '{"google-pro": 5200}', 166, '2026-08-20 12:00+01')`);
  const { rows: reg } = await query(`select key, provider_key from counterparties`);
  const register = reg.map((r) => ({ key: r.key, providerKey: r.provider_key }));
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const batch = await cost.priceMonths(register, months);
  const close = (a, b, what) => {
    for (const k of ['gbp', 'nativeUsd', 'billedGbp', 'estimateGbp']) {
      if (a[k] == null || b[k] == null) assert.equal(a[k] ?? null, b[k] ?? null, `${what} ${k}`);
      else assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${what} ${k}: ${a[k]} against ${b[k]}`);
    }
    for (const k of ['basis', 'source', 'note', 'within', 'locations']) assert.deepEqual(a[k] ?? null, b[k] ?? null, `${what} ${k}`);
    assert.equal(a.at == null ? null : new Date(a.at).toISOString(), b.at == null ? null : new Date(b.at).toISOString(), `${what} at`);
  };
  for (const month of months) {
    for (const c of register) close(batch.get(`${c.key}|${month}`), await cost.supplierMonth(c, month), `${c.key} ${month}`);
    close(batch.get(`several|${month}`), await cost.residueMonthOf(register, month), `several ${month}`);
  }
  // And the months are not all nought: the comparison had something to compare.
  assert.ok(batch.get(`google-places|2026-07`).gbp > 0);
  assert.equal(batch.get(`google-places|2026-08`).basis, 'billed+estimate');
  assert.equal(batch.get(`google-places|2026-09`).basis, 'billed+estimate');
  assert.ok(batch.get(`tripadvisor|2026-07`).gbp > 0);
  assert.ok(batch.get(`several|2026-08`).gbp > 0);
});
