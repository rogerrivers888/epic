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

test('growth carries a six-week series for every tile, households included', async () => {
  const o = await overview();
  for (const k of ['places', 'facts', 'households']) {
    assert.equal(o.growth[k].series.length, 6, `${k} has six weeks`);
    assert.ok(o.growth[k].series.every((p) => Number.isFinite(p.n)));
  }
  if (o.growth.households.n == null) assert.equal(o.growth.households.line, 'none yet');
});

test('spend reads close to budget above 80% and over budget above 100%', async () => {
  await query(`delete from provider_calls where created_at >= date_trunc('month', now())`);
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
  assert.match(o.health.spend.title, new RegExp(`^Google £\\d+ of £${budget} · Claude £\\d+ of £\\d+$`));
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
