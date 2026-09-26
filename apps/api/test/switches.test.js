/**
 * The owner's off-switch is asked at the door, not by whoever is calling.
 *
 * Settings › Providers can switch Google or Tripadvisor off. That switch was
 * honoured by `enabledSources()` — the search path — and by four of the
 * fourteen callers that reach an adapter directly. The other ten went on
 * spending with the source switched off. A flag read at the caller is a flag
 * most callers do not read (25 Sep 2026; the same fault as `paid: false` not
 * reaching `seedFor` four days earlier).
 *
 * `fetch` is stubbed to count: a refusal at the door means nothing leaves the
 * process, and the meter says why.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

// The database first, then anything that opens a pool — the convention every
// database-backed test here follows. Imported statically ahead of it, the
// matcher's pool raced the helper's build of the schema.
const { query, pool } = await testDatabase();
const { googleSource, photoFor, displaySlice } = await import('../src/sources/google.js');
const { tripadvisorSource } = await import('../src/sources/tripadvisor.js');
const { setOffKeys, sourceOff } = await import('../src/sources/switches.js');
const { enabledSources, sourceOff: viaIndex } = await import('../src/sources/index.js');
const { healthOf } = await import('../src/sources/meter.js');
const { googleMatchFor } = await import('../src/sources/providerMatch.js');
const { ratingFor } = await import('../src/sources/rentedRating.js');
const { reviewsFor } = await import('../src/sources/providerMatch.js');
const { photosFor } = await import('../src/sources/rentedPhoto.js');

const { runAsSpender } = await import('../src/context.js');

// Somebody signed in, on a household: since 26 Sep 2026 a paid Google request
// needs both or it is refused at the door (sources/paidGate.js), so the
// "switched back on" halves below are made on somebody's behalf.
const HH = '00000000-0000-4000-8000-0000000a7e02';
let SESSION = null;
test.before(async () => {
  await query(`insert into households (id, name) values ($1, 'Switch household') on conflict (id) do nothing`, [HH]);
  ({ rows: [{ id: SESSION }] } = await query(
    `insert into api_sessions (token_hash, label, expires_at, kind) values ('test:switches', 'a phone', now() + interval '1 day', 'device')
     on conflict (token_hash) do update set label = excluded.label, kind = 'device' returning id`));
});
const asSomebody = (fn) => runAsSpender({ householdId: HH, sessionId: SESSION }, fn);

test.after(async () => {
  await query('delete from provider_calls where household_id = $1', [HH]);
  await query('delete from households where id = $1', [HH]);
  await pool.end();
});

const withKeys = async (env, run) => {
  const was = {};
  for (const [k, v] of Object.entries(env)) { was[k] = process.env[k]; process.env[k] = v; }
  const wasFetch = globalThis.fetch;
  let left = 0;
  globalThis.fetch = async () => { left += 1; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try { return await run(() => left); } finally {
    globalThis.fetch = wasFetch;
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    setOffKeys([]);
  }
};

test('Google switched off answers as it does with no key, and the meter says why', async () => {
  await withKeys({ GOOGLE_MAPS_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys(['google']);
    const meter = {};
    // `brief` is a direct caller that never asked the switch itself. It gets
    // the empty answer its callers already handle — not an exception: a
    // household screen awaiting `suggest()` answered 500 with the throw
    // (Codex, 25 Sep 2026).
    assert.equal(await googleSource.brief('ChIJ_off', { meter }), null);
    assert.deepEqual(await googleSource.suggest('cafe', { meter }), []);
    assert.equal(left(), 0, 'nothing left the process');
    assert.match(JSON.stringify(healthOf(meter)), /switched_off/, 'the refusal is on the meter, for the ledger');
    // And survives the callers that stringify the meter or record nothing
    // when it has no keys (Codex, 25 Sep 2026).
    assert.match(JSON.stringify(meter), /switched_off/);
    assert.ok(Object.keys(meter).length > 0);
  });
});

test('a photograph does not go out for a switched-off Google either', async () => {
  // The photo proxy fetches Google's media endpoint directly, not through
  // `call()`, so the door there never saw it (Codex, 25 Sep 2026).
  await withKeys({ GOOGLE_MAPS_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys(['google']);
    assert.equal(await photoFor(`places/x/photos/off_${Date.now()}`, 200), null);
    assert.equal(left(), 0, 'no request was made for the picture');
    setOffKeys([]);
    await asSomebody(() => photoFor(`places/x/photos/on_${Date.now()}`, 200)).catch(() => null);
    assert.equal(left(), 1, 'switched on, the same picture is fetched');
  });
});

test('a display search with Google switched off is not counted as sent', async () => {
  // Its error path counted a thrown `switched_off` as a request that went
  // out, and the Inspire routes recorded a search that never left (Codex,
  // 25 Sep 2026). The switch is the same kind of answer as no key.
  await withKeys({ GOOGLE_MAPS_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys(['google']);
    const meter = {};
    const out = await displaySlice({ box: { south: 51, west: -1, north: 52, east: 0 }, query: 'cafe', meter });
    assert.equal(out.requests, 0);
    assert.match(out.problem, /switched off/);
    assert.equal(left(), 0);
    assert.match(JSON.stringify(healthOf(meter)), /switched_off/, 'and the ledger sees the refusal');
    assert.equal(healthOf(meter).failed, 1, 'once — not once for the branch and once for the words');
  });
});

test('a match attempted with Google switched off is not remembered as a miss', async () => {
  // Empty from the door looked like "no match", and no match is persisted:
  // every venue tried while Google was off would have stayed "not on
  // Google" for good after it was switched back on (Codex, 25 Sep 2026).
  await withKeys({ GOOGLE_MAPS_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys(['google']);
    const venueRef = `osm:node/switched_off_${Date.now()}`;
    const out = await googleMatchFor({ venueRef, name: 'The Bull', lat: 51.5, lng: -0.1 });
    assert.equal(out, null);
    assert.equal(left(), 0);
    const { rows } = await query('select missing from provider_matches where venue_ref = $1', [venueRef]);
    assert.equal(rows.length, 0, 'nothing was written down');
  });
});

test('a rented rating or photo asked for with Google switched off is neither kept nor billed', async () => {
  // Null from the door read as "no rating": kept for twelve hours, and put on
  // the ledger as a call that cost money (Codex, 25 Sep 2026).
  await withKeys({ GOOGLE_MAPS_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys(['google']);
    const ref = `google:ChIJ_rented_off_${Date.now()}`;
    assert.equal(await ratingFor(ref, { householdId: null }), null);
    assert.equal(await photosFor(ref, { householdId: null }), null);
    assert.equal(left(), 0);
    const { rows } = await query('select purpose from provider_calls where venue_ref = $1', [ref]);
    assert.equal(rows.length, 0, 'no fictitious call on the ledger');
    // Switched back on, it is asked for real rather than answered from a
    // cached nothing.
    setOffKeys([]);
    await asSomebody(() => ratingFor(ref, { householdId: HH })).catch(() => null);
    assert.equal(left(), 1, 'not hidden behind a cached empty answer');
  });
});

test('reviews asked for with Google switched off are neither billed nor cached as none', async () => {
  await withKeys({ GOOGLE_MAPS_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys(['google']);
    const ref = `google:ChIJ_reviews_off_${Date.now()}`;
    assert.equal(await reviewsFor({ venueRef: ref, name: 'The Bull', lat: 51.5, lng: -0.1 }), null);
    assert.equal(left(), 0);
    const { rows } = await query('select purpose from provider_calls where venue_ref = $1', [ref]);
    assert.equal(rows.length, 0);
    setOffKeys([]);
    await asSomebody(() => reviewsFor({ venueRef: ref, name: 'The Bull', lat: 51.5, lng: -0.1 })).catch(() => null);
    assert.ok(left() >= 1, 'switched on, asked for real rather than answered from a cached nothing');
  });
});

test('Google switched on goes out as before', async () => {
  await withKeys({ GOOGLE_MAPS_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys([]);
    await asSomebody(() => googleSource.brief('ChIJ_on', { meter: {} })).catch(() => null);
    assert.equal(left(), 1);
  });
});

test('Tripadvisor has the same door', async () => {
  await withKeys({ TRIPADVISOR_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys(['tripadvisor']);
    const meter = {};
    assert.equal(await tripadvisorSource.get('123', { meter }), null);
    assert.match(JSON.stringify(healthOf(meter)), /switched_off/);
    assert.equal(left(), 0);
  });
});

test('the search path and the door read the same switch', () => {
  setOffKeys(['google']);
  assert.equal(sourceOff('google'), true);
  assert.equal(viaIndex('google'), true, 'index.js re-exports the one switch rather than keeping its own');
  assert.equal(enabledSources().some((s) => s.key === 'google'), false);
  setOffKeys([]);
  assert.equal(sourceOff('google'), false);
});
