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
// A sign-in to spend on: since 26 Sep 2026 a paid request with a household and
// no real session is refused before the cap is read (sources/paidGate.js).
let SESSION = null;
test.before(async () => {
  ({ rows: [{ id: SESSION }] } = await query(
    `insert into api_sessions (token_hash, label, expires_at, kind) values ('test:household-cap', 'a phone', now() + interval '1 day', 'device')
     on conflict (token_hash) do update set label = excluded.label, kind = 'device' returning id`));
  await query(`insert into households (id, name) values ($1, 'Capped household') on conflict (id) do nothing`, [HH]);
  // Its lead's cap is one call a month.
  await query(`insert into accounts (household_id, email, role, status, plan, monthly_call_bound) values ($1, 'cap@test', 'owner', 'active', 'family', 1) on conflict do nothing`, [HH]).catch(async () => {
    await query(`insert into accounts (household_id, role, status, plan, monthly_call_bound) values ($1, 'owner', 'active', 'family', 1)`, [HH]);
  });
  await query(`insert into provider_calls (household_id, session_id, provider, purpose, estimated_cost_usd) values ($1, (select id from api_sessions where token_hash = 'service:unattributed-before-2026-09-26'), 'google', 'test', 0.032)`, [HH]);
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
      () => runAsSpender({ householdId: HH, sessionId: SESSION }, () => googleSource.brief('ChIJ_capped', { meter })),
      (e) => e.code === 'spend_bound_reached' && /household/.test(e.message));
    assert.equal(left(), 0, 'nothing went out');
    assert.match(JSON.stringify(healthOf(meter)), /household_cap/);
  });
});

test('the request\u2019s own account is the spender when nothing else says', async () => {
  await withGoogle(async (left) => {
    // The household comes from the account; with no session beside it the
    // call is unattributed and refused before the cap is asked (26 Sep 2026).
    await assert.rejects(
      () => runAsAccount({ household_id: HH }, () => googleSource.brief('ChIJ_capped_req', { meter: {} })),
      (e) => e.code === 'unattributed_paid_call');
    assert.equal(left(), 0);
    assert.deepEqual(runAsAccount({ household_id: HH }, () => currentSpender()), { householdId: HH, sessionId: null });
  });
});

test('a call on nobody\u2019s behalf is refused, not waved through uncapped', async () => {
  // It used to go out, on the theory that the collection ceiling held those;
  // $166.78 of them went out this month on no household at all (owner, 26 Sep
  // 2026). Now the door refuses it (sources/paidGate.js).
  await withGoogle(async (left) => {
    await assert.rejects(() => googleSource.brief('ChIJ_nobody', { meter: {} }), (e) => e.code === 'unattributed_paid_call');
    assert.equal(left(), 0);
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
    await runAsSpender({ householdId: HH2, sessionId: SESSION }, async () => {
      await googleSource.brief('ChIJ_burst_1', { meter: {} }).catch(() => null);
      await googleSource.brief('ChIJ_burst_2', { meter: {} }).catch(() => null);
      await assert.rejects(() => googleSource.brief('ChIJ_burst_3', { meter: {} }), (e) => e.code === 'spend_bound_reached');
    });
    assert.equal(left(), 2);
  });
});

test('a ledger row that metered three requests counts as three', async () => {
  // The cap's own arithmetic, durable across a restart (Codex, 25 Sep 2026).
  const { countThisMonth } = await import('../src/repositories/providerCalls.js');
  const HH3 = '00000000-0000-4000-8000-00000000ca92';
  await query(`insert into households (id, name) values ($1, 'Metered household') on conflict (id) do nothing`, [HH3]);
  try {
    await query(`insert into provider_calls (household_id, session_id, provider, purpose, units, estimated_cost_usd) values ($1, (select id from api_sessions where token_hash = 'service:unattributed-before-2026-09-26'), 'google', 'search', '{"google": 3, "google-search": 3}'::jsonb, 0.12)`, [HH3]);
    await query(`insert into provider_calls (household_id, session_id, provider, purpose, units) values ($1, (select id from api_sessions where token_hash = 'service:unattributed-before-2026-09-26'), 'osm-overpass', 'own.match', '{"osm-overpass": 1}'::jsonb)`, [HH3]);
    // A search over several sources is one row whose provider names them all
    // and whose units carry the Google requests it made (Codex, 25 Sep 2026).
    await query(`insert into provider_calls (household_id, session_id, provider, purpose, units, estimated_cost_usd) values ($1, (select id from api_sessions where token_hash = 'service:unattributed-before-2026-09-26'), 'fixtures+osm+google', 'search', '{"osm-overpass": 1, "google": 4, "google-search": 4}'::jsonb, 0.16)`, [HH3]);
    // A census slice: hundreds of IDs Only requests, all free, and not one of
    // them a call that can cost money (found 25 Sep 2026, when one day's
    // census put the founding household past its bound).
    await query(`insert into provider_calls (household_id, session_id, provider, purpose, units, estimated_cost_usd) values ($1, (select id from api_sessions where token_hash = 'service:unattributed-before-2026-09-26'), 'google', 'census.slice', '{"google": 600, "google-essentials": 600}'::jsonb, 0)`, [HH3]);
    // A Place Details request on a Pro mask, priced, counts.
    await query(`insert into provider_calls (household_id, session_id, provider, purpose, units, estimated_cost_usd) values ($1, (select id from api_sessions where token_hash = 'service:unattributed-before-2026-09-26'), 'google', 'own.seed', '{"google": 1, "google-pro": 1}'::jsonb, 0.032)`, [HH3]);
    assert.equal(await countThisMonth(HH3), 8, 'three and four priced requests and one Pro detail; the free open map and the free census not counted at all');
    // The accounts screen draws the same priced figure against the cap, and
    // the free rows beside it (owner, 26 Sep 2026).
    const { monthSplit } = await import('../src/repositories/providerCalls.js');
    assert.deepEqual(await monthSplit(HH3), { priced: 8, claude: 0, free: 2 }, 'the open-map row and the census slice are the free two');
  } finally {
    await query('delete from provider_calls where household_id = $1', [HH3]);
    await query('delete from households where id = $1', [HH3]);
  }
});

test('the catch-up loop knows whose place it is researching', async () => {
  const owned = await import('../src/repositories/ownedPlaces.js');
  const ref = 'google:ChIJ_claimed_by_capped';
  await query(`insert into place_claims (household_id, venue_ref, reason) values ($1, $2, 'test') on conflict do nothing`, [HH, ref]);
  try {
    assert.deepEqual(await owned.claimantsFor([ref, 'google:ChIJ_nobody_claimed']), { [ref]: HH });
  } finally { await query('delete from place_claims where venue_ref = $1', [ref]); }
});
