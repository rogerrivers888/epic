/**
 * Every paid Google request is attributed or refused (sources/paidGate.js).
 *
 * Owner, 26 Sep 2026 (G7): "call() in google.js and routing.js refuses any
 * paid tier with no household AND no real session. Only exemption: the
 * IDs-only census." And, for done: "a test proving an unattributed paid call
 * is refused." These are that test, for Places, photos and Routes, beside the
 * exemption and the switch Routes now shares — plus the two decisions that go
 * with it: own.js researches free unless a caller says otherwise, and Settings
 * shows the bound the guard enforces.
 *
 * `fetch` is stubbed throughout and counts what would have gone out: the
 * assertion that matters in each refusal is that the count is nought.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { googleSource, fetchPhoto } = await import('../src/sources/google.js');
const { routeMatrixMinutes, routingEnabled } = await import('../src/sources/routing.js');
const { runAsSpender } = await import('../src/context.js');
const { healthOf } = await import('../src/sources/meter.js');
const { setOffKeys, offKeysList } = await import('../src/sources/switches.js');
const { serviceSessionId } = await import('../src/repositories/providerCalls.js');
const own = await import('../src/sources/own.js');
const { allowanceUsage } = await import('../src/sources/usage.js');

const HH = '00000000-0000-4000-8000-0000000a7e01';
let SIGNED_IN = null;
let SERVICE = null;

test.before(async () => {
  await query(`insert into households (id, name) values ($1, 'Gate household') on conflict (id) do nothing`, [HH]);
  await query(`insert into accounts (household_id, email, role, status, plan, monthly_call_bound) values ($1, 'gate@test', 'owner', 'active', 'family', 1234)`, [HH]);
  ({ rows: [{ id: SIGNED_IN }] } = await query(
    `insert into api_sessions (token_hash, label, expires_at) values ('test:paid-gate', 'a phone', now() + interval '1 day')
     on conflict (token_hash) do update set label = excluded.label returning id`));
  SERVICE = await serviceSessionId();
});
test.after(async () => {
  await query('delete from provider_calls where household_id = $1', [HH]);
  await query('delete from accounts where household_id = $1', [HH]);
  await query('delete from households where id = $1', [HH]);
  await pool.end();
});

const withGoogle = async (run) => {
  const wasKey = process.env.GOOGLE_MAPS_API_KEY; const wasFetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key-never-sent';
  let out = 0;
  globalThis.fetch = async (url) => {
    out += 1;
    if (String(url).includes('/media')) return new Response(Buffer.from('jpeg'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    if (String(url).includes('routes.googleapis.com')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { return await run(() => out); } finally {
    globalThis.fetch = wasFetch;
    if (wasKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = wasKey;
  }
};

const refused = (e) => e.code === 'unattributed_paid_call';

test('an unattributed paid Places call is refused before it goes out, and the meter says why', async () => {
  await withGoogle(async (out) => {
    // Nobody at all: the shape of a script run with `node` in the container.
    const meter = {};
    await assert.rejects(() => googleSource.brief('ChIJ_nobody', { meter }), refused);
    // A household but the server's own session: the shape of a boot loop.
    await assert.rejects(() => runAsSpender({ householdId: HH, sessionId: SERVICE }, () => googleSource.brief('ChIJ_loop', { meter: {} })), refused);
    // A household and no session at all.
    await assert.rejects(() => runAsSpender({ householdId: HH }, () => googleSource.brief('ChIJ_nosession', { meter: {} })), refused);
    // A sign-in and no household.
    await assert.rejects(() => runAsSpender({ sessionId: SIGNED_IN }, () => googleSource.brief('ChIJ_nohousehold', { meter: {} })), refused);
    assert.equal(out(), 0, 'not one request left the process');
    assert.match(JSON.stringify(healthOf(meter)), /unattributed/);
    assert.equal(meter.google ?? 0, 0, 'a refused request is not on the meter as one Google billed');
  });
});

test('a household and a signed-in session are let through', async () => {
  await withGoogle(async (out) => {
    await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => googleSource.brief('ChIJ_attributed', { meter: {} }));
    assert.equal(out(), 1);
  });
});

test('the IDs Only census is the one exemption: free, and on nobody’s behalf', async () => {
  await withGoogle(async (out) => {
    const meter = {};
    await googleSource.censusSlice({ box: { minLat: 51.4, minLng: -0.7, maxLat: 51.41, maxLng: -0.69 }, includedType: 'park', pages: 1, meter });
    assert.equal(out(), 1, 'the slice went out with no household and no session');
    assert.equal(meter['google-essentials'], 1);
  });
});

test('a photograph is refused on nobody’s behalf and fetched on somebody’s', async () => {
  await withGoogle(async (out) => {
    await assert.rejects(() => fetchPhoto('places/ChIJ_x/photos/nobody'), refused);
    assert.equal(out(), 0);
    const got = await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => fetchPhoto('places/ChIJ_x/photos/somebody'));
    assert.ok(got?.body);
    assert.equal(out(), 1);
  });
});

test('Routes is refused unattributed, charged per element, and under the Google switch', async () => {
  const one = [{ lat: 51.4, lng: -0.6 }];
  const two = [{ lat: 51.41, lng: -0.61 }, { lat: 51.42, lng: -0.62 }];
  await withGoogle(async (out) => {
    const meter = {};
    await assert.rejects(() => routeMatrixMinutes({ origins: one, destinations: two, meter }), refused);
    assert.equal(out(), 0);
    assert.equal(meter['google-routes'] ?? 0, 0, 'refused elements are not metered as billed');

    const paid = {};
    await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => routeMatrixMinutes({ origins: one, destinations: two, meter: paid }));
    assert.equal(out(), 1);
    assert.equal(paid['google-routes'], 2, 'one per origin × destination element');

    const was = offKeysList();
    setOffKeys([...was, 'google']);
    try {
      assert.equal(routingEnabled(), false);
      assert.equal(await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => routeMatrixMinutes({ origins: one, destinations: two })), null);
      assert.equal(out(), 1, 'switched off, nothing went out');
    } finally { setOffKeys(was); }
  });
});

test('own.js researches free unless a caller says it may pay', async () => {
  await withGoogle(async (out) => {
    // A household and a real session, so the door would let it through —
    // the point is that the default never knocks.
    await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => own.enrich('google:ChIJ_free_default', { householdId: HH, force: true }));
    const google = (await query(`select count(*)::int as n from provider_calls where household_id = $1 and purpose in ('own.seed', 'own.lead') and estimated_cost_usd > 0`, [HH])).rows[0].n;
    assert.equal(google, 0, 'no paid research on the default');
    void out;
  });
});

test('Settings shows the bound the guard enforces, not the estate default', async () => {
  const { allowances } = await allowanceUsage(HH);
  assert.equal(allowances['google-paid'].limit, 1234, 'the account’s own number');
  assert.ok(allowances.claude.limit <= 1234, 'Claude’s budget never above the account’s number');
});
