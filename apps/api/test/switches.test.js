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
import { googleSource, photoFor, displaySlice } from '../src/sources/google.js';
import { tripadvisorSource } from '../src/sources/tripadvisor.js';
import { setOffKeys, sourceOff } from '../src/sources/switches.js';
import { enabledSources, sourceOff as viaIndex } from '../src/sources/index.js';
import { healthOf } from '../src/sources/meter.js';

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
    await photoFor(`places/x/photos/on_${Date.now()}`, 200).catch(() => null);
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
  });
});

test('Google switched on goes out as before', async () => {
  await withKeys({ GOOGLE_MAPS_API_KEY: 'test-key-never-sent' }, async (left) => {
    setOffKeys([]);
    await googleSource.brief('ChIJ_on', { meter: {} }).catch(() => null);
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
