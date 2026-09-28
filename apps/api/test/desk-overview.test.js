import { test } from 'node:test';
import assert from 'node:assert/strict';

// Overview and Fact automations on the rebuilt desk (back-office handover,
// 28 Sep 2026): the overview's can't-speak tiles, its trend lines, and a
// setting change that hands its Changes id back for the toast's Undo.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const settings = await import('../src/desk/settings.js');
const { overview } = await import('../src/desk/overview.js');

test.after(() => pool.end());

const WHO = 'test@epic';

test('a tile that cannot speak says so and is never drawn green', async () => {
  await query('delete from place_fact_evidence');
  await query('delete from family_answers');
  const o = await overview();
  assert.equal(o.health.sources.tone, 'none', 'nothing asked this week is not "all answering"');
  assert.equal(o.health.sources.title, 'Not asked yet');
  assert.equal(o.health.accuracy.tone, 'none', 'accuracy under ten family answers is building, not healthy');
  assert.equal(o.health.accuracy.title, 'Building');
  assert.equal(o.health.verification.title, 'Never run');
  assert.equal(o.health.verification.line, 'nothing checked yet');
});

test('growth carries seven weekly points (six weeks) for every tile, households included', async () => {
  const o = await overview();
  for (const k of ['places', 'facts', 'households']) {
    assert.equal(o.growth[k].series.length, 7, `${k} has seven points, six weeks apart`);
    assert.ok(o.growth[k].series.every((p) => Number.isFinite(p.n)));
  }
  if (o.growth.households.n == null) assert.equal(o.growth.households.line, 'none yet');
});

test('spend reads close to budget above 80% and over budget above 100%', async () => {
  await query(`delete from provider_calls where created_at >= date_trunc('month', now())`);
  // The ledger-estimate tile, which is what shows before any billing figures
  // exist (277 seeds them; the billing tile has its own test).
  await query(`delete from bo_settings where key = 'billing'`);
  settings.forget();
  const { values } = await settings.settings();
  const budget = values.budgetGoogle;
  const USD_TO_GBP = (await import('../src/domain/providerPrices.js')).USD_TO_GBP;
  // 90% of the Google budget, in dollars.
  await query(`insert into provider_calls (provider, purpose, estimated_cost_usd) values ('google-places', 'desk-overview-test', $1)`,
    [(budget * 0.9) / USD_TO_GBP]);
  let o = await overview();
  assert.equal(o.health.spend.tone, 'amber');
  assert.equal(o.health.spend.line, 'close to budget');
  await query(`insert into provider_calls (provider, purpose, estimated_cost_usd) values ('google-places', 'desk-overview-test', $1)`,
    [(budget * 0.2) / USD_TO_GBP]);
  o = await overview();
  assert.equal(o.health.spend.tone, 'red');
  assert.equal(o.health.spend.line, 'over budget');
  assert.match(o.health.spend.title, new RegExp(`^Google £\\d+ estimate of £${budget} · Claude £\\d+ estimate of £\\d+$`));
  await query(`delete from provider_calls where purpose = 'desk-overview-test'`);
});

test('a setting change returns the id of its Changes row, and that row undoes to the value before', async () => {
  settings.forget();
  const was = await settings.setting('recheckFood');
  const out = await settings.setSetting('recheckFood', was + 1, { who: WHO, what: 'Food and dietary facts are re-checked every n months' });
  assert.equal(out.changed, true);
  assert.ok(out.change, 'the change id comes back for the toast');
  const { rows: [ch] } = await query('select area, what, before, after, undo from bo_changes where id = $1', [out.change]);
  assert.equal(ch.area, 'Fact automations');
  assert.equal(ch.what, 'Food and dietary facts are re-checked every n months', 'the sentence the screen sent is what Changes says');
  assert.equal(ch.before, String(was));
  assert.deepEqual(ch.undo, { kind: 'setting', key: 'recheckFood', value: was });
  const same = await settings.setSetting('recheckFood', was + 1, { who: WHO });
  assert.equal(same.change, undefined, 'a change that changes nothing has no row to undo');
  await settings.setSetting('recheckFood', was, { who: WHO });
});

test('the spend tile from Google billing: usage before credit, credit left and when it expires', async () => {
  const { billingTile } = await import('../src/desk/overview.js');
  const cfg = { budgetGoogle: 50, budgetClaude: 30 };
  const b = { month: '2026-09', usageGbp: 40.61, paidGbp: 0, creditGbp: 180.15, creditExpires: '2026-12-20', source: 'console' };
  const t = billingTile(b, { claude: 3 }, cfg, new Date('2026-09-29T12:00:00Z'));
  assert.equal(t.title, 'Usage this month £40.61 · paid by credit · £180.15 credit left, expires 20 Dec');
  assert.equal(t.tone, 'amber', '40.61 of 50 is over 80% of the budget');
  const low = billingTile({ ...b, usageGbp: 10, creditGbp: 15 }, { claude: 3 }, cfg, new Date('2026-09-29T12:00:00Z'));
  assert.equal(low.tone, 'amber'); assert.match(low.line, /credit running low/);
  const soon = billingTile({ ...b, usageGbp: 10 }, { claude: 3 }, cfg, new Date('2026-11-25T12:00:00Z'));
  assert.equal(soon.tone, 'amber'); assert.match(soon.title, /Usage in September/);
  const fine = billingTile({ ...b, usageGbp: 10 }, { claude: 3 }, cfg, new Date('2026-09-29T12:00:00Z'));
  assert.equal(fine.tone, 'green');
});
