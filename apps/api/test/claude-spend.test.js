import { test } from 'node:test';
import assert from 'node:assert/strict';

// Claude's spend (owner, 29 Sep 2026): the console's dollars on the tile with
// pounds beside, the ledger's figure only ever as an estimate, and the month
// by caller so the owner can see where the tokens go.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const spend = await import('../src/desk/claudeSpend.js');
const overview = await import('../src/desk/overview.js');
const settings = await import('../src/desk/settings.js');

test.after(() => pool.end());

test('each caller lands in the family the owner asked to see', () => {
  assert.equal(spend.familyOf('census.slice'), 'Census, sweeps and research runs');
  assert.equal(spend.familyOf('own.search'), 'Census, sweeps and research runs');
  assert.equal(spend.familyOf('questions.harvest'), 'Harvest and classifier runs');
  assert.equal(spend.familyOf('menu.read'), 'Menus and dishes');
  assert.equal(spend.familyOf('plan.preview'), 'Planner and Inspire');
  assert.equal(spend.familyOf('something-new'), 'Everything else');
});

test('a month by caller: tokens and dollars per purpose, what failed, and who was signed in', async () => {
  await query(`delete from provider_calls where purpose like 'cs-test%'`);
  await query(`insert into provider_calls (provider, purpose, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd, ok, failed, created_at)
               values ('anthropic', 'cs-test.plan', 1000, 200, 0, 0, 0.01, true, 0, '2026-03-10 10:00+00'),
                      ('anthropic', 'cs-test.plan', 3000, 800, 500, 100, 0.03, true, 0, '2026-03-11 10:00+00'),
                      ('anthropic', 'cs-test.plan', null, null, null, null, 0.02, false, 1, '2026-03-11 11:00+00'),
                      ('anthropic', 'cs-test.plan', 10, 10, 0, 0, 0.5, true, 0, '2026-04-01 10:00+01'),
                      ('anthropic', 'cs-test.cache', 0, 0, 900, 0, 0.004, true, 0, '2026-03-12 10:00+00')`);
  const m = await spend.claudeByCaller('2026-03');
  const p = m.purposes.find((x) => x.purpose === 'cs-test.plan');
  assert.equal(p.calls, 3, 'April’s row is not March’s');
  assert.equal(p.failed, 1);
  assert.equal(p.tokens, 1000 + 200 + 3000 + 800 + 500 + 100);
  assert.ok(Math.abs(p.usd - 0.06) < 1e-9);
  assert.ok(Math.abs(p.usdNoTokens - 0.02) < 1e-9, 'a cost no tokens account for is named');
  assert.equal(m.days.length, 3);
  assert.equal(m.purposes.find((x) => x.purpose === 'cs-test.cache').usdNoTokens, 0, 'cached tokens are tokens');
  assert.ok(m.topSessions.length >= 1 && 'label' in m.topSessions[0], 'each caller, by session');
  await query(`delete from provider_calls where purpose like 'cs-test%'`);
});

test('the tile shows Claude in dollars with pounds beside, and "estimate" only for the ledger', () => {
  const cfg = { budgetClaude: 100, budgetGoogle: 50 };
  assert.equal(overview.claudeWords({ claude: 87, claudeUsd: 117.02, claudeFrom: 'console' }, cfg), 'Claude $117.02 (£87) of £100');
  assert.equal(overview.claudeWords({ claude: 121, claudeUsd: 153.16, claudeFrom: 'estimate' }, cfg), 'Claude $153.16 (£121) estimate of £100');
});

test('the console figure is a setting seeded from what the owner read (284), and a bad one is refused', async () => {
  settings.forget();
  const cb = (await settings.settings()).values.claudeBilling;
  assert.equal(cb.usd, 117.02);
  assert.equal(cb.creditUsd, 382.99);
  await assert.rejects(() => settings.setSetting('claudeBilling', { usd: 'lots' }, { who: 'test' }), /month/);
});
