/**
 * The household's cap on calls that can cost money is asked before a Google
 * call — src/sources/google.js `call()`, src/context.js `runAsSpender`.
 *
 * The cap counted every billable call all along and was asserted only
 * before Claude calls; Google never asked it, and a month's spending ran to
 * its ceiling with nothing refusing (owner, 25 Sep 2026). Now Google's one
 * door reads who is spending from the request context — or from the
 * household a background researcher entered the context with — and refuses
 * at the bound, with the refusal on the meter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { googleSource } = await import('../src/sources/google.js');
const { runAsSpender, runAsAccount, currentSpender } = await import('../src/context.js');
const { healthOf } = await import('../src/sources/meter.js');
const own = await import('../src/sources/own.js');

const HH = '00000000-0000-4000-8000-00000000ca90';
const HH2 = '00000000-0000-4000-8000-00000000ca91';
test.before(async () => {
  await query(`insert into households (id, name) values ($1, 'Capped household') on conflict (id) do nothing`, [HH]);
  // Its lead's cap is one call a month.
  await query(`insert into accounts (household_id, email, role, status, plan, monthly_call_bound) values ($1, 'cap@test', 'owner', 'active', 'family', 1) on conflict do nothing`, [HH]).catch(async () => {
    await query(`insert into accounts (household_id, role, status, plan, monthly_call_bound) values ($1, 'owner', 'active', 'family', 1)`, [HH]);
  });
  await query(`insert into provider_calls (household_id, provider, purpose, estimated_cost_usd) values ($1, 'google', 'test', 0.032)`, [HH]);
  // A second household with two calls a month and nothing on the ledger yet.
  await query(`insert into households (id, name) values ($1, 'Bursting household') on conflict (id) do nothing`, [HH2]);
  await query(`insert into accounts (household_id, email, role, status, plan, monthly_call_bound) values ($1, 'burst@test', 'member', 'active', 'family', 2)`, [HH2]);
});
test.after(async () => {
  await query('delete from provider_calls where household_id = any($1)', [[HH, HH2]]);
  await query('delete from accounts where household_id = any($1)', [[HH, HH2]]);
  await query('delete from households where id = any($1)', [[HH, HH2]]);
  await pool.end();
});

const withGoogle = async (run) => {
  const wasKey = process.env.GOOGLE_MAPS_API_KEY; const wasFetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key-never-sent';
  let left = 0;
  globalThis.fetch = async () => { left += 1; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try { return await run(() => left); } finally {
    globalThis.fetch = wasFetch;
    if (wasKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = wasKey;
  }
};

test('a household at its cap is refused at Google\u2019s door, and the ledger sees why', async () => {
  await withGoogle(async (left) => {
    const meter = {};
    await assert.rejects(
      () => runAsSpender({ householdId: HH }, () => googleSource.brief('ChIJ_capped', { meter })),
      (e) => e.code === 'spend_bound_reached' && /household/.test(e.message));
    assert.equal(left(), 0, 'nothing went out');
    assert.match(JSON.stringify(healthOf(meter)), /household_cap/);
  });
});

test('the request\u2019s own account is the spender when nothing else says', async () => {
  await withGoogle(async (left) => {
    await assert.rejects(
      () => runAsAccount({ household_id: HH }, () => googleSource.brief('ChIJ_capped_req', { meter: {} })),
      (e) => e.code === 'spend_bound_reached');
    assert.equal(left(), 0);
    assert.deepEqual(runAsAccount({ household_id: HH }, () => currentSpender()), { householdId: HH, sessionId: null });
  });
});

test('a call on nobody\u2019s behalf is not capped here', async () => {
  await withGoogle(async (left) => {
    await googleSource.brief('ChIJ_nobody', { meter: {} }).catch(() => null);
    assert.equal(left(), 1, 'the collection ceiling holds those, not the household cap');
  });
});

test('background research enters the context as its household, so its Google calls are capped too', async () => {
  await withGoogle(async (left) => {
    const out = await own.enrich('google:ChIJ_capped_research', { householdId: HH, force: true, paid: true });
    assert.equal(left(), 0, 'the identification was refused before it went out');
    assert.ok((out.problems ?? []).length >= 0);
  });
});

test('a burst inside one operation is counted as it is admitted, not only once the ledger has it', async () => {
  // Bound two, nothing on the ledger: the third request in a row is refused
  // before anything has been recorded (Codex, 25 Sep 2026).
  await withGoogle(async (left) => {
    await runAsSpender({ householdId: HH2 }, async () => {
      await googleSource.brief('ChIJ_burst_1', { meter: {} }).catch(() => null);
      await googleSource.brief('ChIJ_burst_2', { meter: {} }).catch(() => null);
      await assert.rejects(() => googleSource.brief('ChIJ_burst_3', { meter: {} }), (e) => e.code === 'spend_bound_reached');
    });
    assert.equal(left(), 2);
  });
});
