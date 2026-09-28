import { test } from 'node:test';
import assert from 'node:assert/strict';

// The collection ceiling at what suppliers charge (owner, 29 Sep 2026: "£516.22
// of a ceiling of £550 … real spend is about £130"): Google past its free
// allowances, read from a bill where there is one; Tripadvisor past 1,000 a
// month; everything else outside Claude and OpenAI at the ledger's figure.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const cost = await import('../src/desk/supplierCost.js');
const settings = await import('../src/desk/settings.js');
const { roomToSpend } = await import('../src/routes/placeIndex.js');
const runs = await import('../src/repositories/runs.js');

test.after(() => pool.end());

const MONTH = cost.londonMonth();
const at = (h) => `${MONTH}-01 ${String(h).padStart(2, '0')}:00+01`;

async function clean() {
  await query(`delete from provider_calls where purpose like 'purse-%'`);
  await query(`delete from billing_days where invoice_month = $1`, [MONTH]);
  await query(`delete from provider_calls where created_at >= date_trunc('month', now()) - interval '1 day'`);
  await query(`delete from bo_settings where key = 'billing'`);
  settings.forget();
}

test('IDs-only and requests inside the free allowance cost nothing; Tripadvisor inside 1,000 a month costs nothing; Claude stays out', async () => {
  await clean();
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at) values
    ('google', 'purse-census', '{"google-essentials": 9000}', 0, $1),
    ('google', 'purse-pro', '{"google": 3000, "google-pro": 3000}', 96, $1),
    ('tripadvisor', 'purse-ta', '{"tripadvisor": 387}', 5.81, $1),
    ('anthropic', 'purse-claude', null, 150, $1),
    ('liteapi', 'purse-other', '{"liteapi": 1}', 2, $1)`, [at(10)]);
  const p = await cost.collectPurse(MONTH);
  assert.equal(p.google.gbp, 0, 'census free, Pro inside its 5,000');
  assert.equal(p.google.basis, 'estimate');
  assert.equal(p.tripadvisor.locations, 387);
  assert.equal(p.tripadvisor.gbp, 0);
  assert.ok(Math.abs(p.otherGbp - 2 * 0.79) < 0.05, 'an unpriced supplier is counted at its ledger figure');
  assert.equal(p.pence, Math.round(p.otherGbp * 100), 'Claude is not in the collection purse');
});

test('a bill is taken up to its cutoff, and only what came after is estimated — a free allowance is not spent twice', async () => {
  await clean();
  // 6,000 Pro requests before the console reading, 1,000 after: the whole month's
  // estimate is 2,000 past 5,000, of which 1,000 were already past it before.
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at) values
    ('google', 'purse-before', '{"google": 6000, "google-pro": 6000}', 192, $1),
    ('google', 'purse-after', '{"google": 1000, "google-pro": 1000}', 32, $2)`, [at(8), at(20)]);
  await query(`insert into bo_settings (key, value, updated_by) values ('billing', $1, 'test')
               on conflict (key) do update set value = excluded.value`,
  [JSON.stringify({ month: MONTH, usageGbp: 40.61, at: new Date(at(12).replace(' ', 'T').replace('+01', '+01:00')).toISOString(), source: 'Google Cloud console' })]);
  settings.forget();
  const g = await cost.googleMonth(MONTH);
  assert.equal(g.basis, 'billed+estimate');
  assert.equal(g.billedGbp, 40.61);
  const per = 0.032 * 0.79;
  assert.ok(Math.abs(g.estimateGbp - 1000 * per) < 0.01, `the 1,000 after the reading, got £${g.estimateGbp}`);
  assert.ok(Math.abs(g.gbp - (40.61 + 1000 * per)) < 0.01);
});

test('the export, where it has days, is the bill; the guard and the Runs board say the same number', async () => {
  await clean();
  await query(`insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, cost, credits, promo, currency)
               values ($1, $2, 'Places API', 'Text Search Pro', 'S', 'google-pro', 100, 12.5, -12.5, -12.5, 'GBP')`, [MONTH, `${MONTH}-01`]);
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at) values
    ('google', 'purse-old', '{"google": 20000}', 640, $1)`, [at(9)]);
  const g = await cost.googleMonth(MONTH);
  assert.equal(g.source, 'Google billing export');
  assert.equal(g.billedGbp, 12.5);
  assert.equal(g.estimateGbp, 0, 'everything the ledger asked was on the billed day');
  const room = await roomToSpend(0, { reserve: false });
  const board = await runs.list();
  const p = await cost.collectPurse(MONTH);
  assert.equal(room.spentPence, p.pence);
  assert.equal(board.spentPence, room.spentPence, 'the board and the guard agree');
  await clean();
});

test('a browse that names Google and Tripadvisor together still counts its Tripadvisor locations', async () => {
  await clean();
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at) values
    ('google+tripadvisor', 'purse-mixed', '{"google-search": 1, "tripadvisor": 1200}', 18.03, $1)`, [at(10)]);
  const ta = await cost.tripadvisorMonth(MONTH);
  assert.equal(ta.locations, 1200);
  assert.equal(ta.billable, 200);
  const p = await cost.collectPurse(MONTH);
  assert.ok(p.tripadvisor.gbp > 0);
  assert.equal(p.otherGbp, 0, 'not counted twice');
});
