import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runFetch, refetch, prefetch, invalidate, invalidatePrefix, invalidateTabData,
  peekCache, clearResourceCache, inspireNearKey, savedOverrides,
  ATLAS_KEY, TRIPS_KEY, TEN_MINUTES,
} from '../src/cache/resourceCache.ts';

/**
 * The shared in-memory cache behind "No spinners on Inspire" (D13). The bugs
 * this pins are the ones the review found and the ones that would undo the
 * point of the change: a forced refresh must not hand back a read that began
 * before the write, an invalidation must survive a request that was already in
 * the air, and a plain read must never fetch what is already fresh.
 */

// Each test starts from an empty cache so the module's shared store cannot leak
// between them.
const fresh = () => clearResourceCache();

test('a second read of the same key joins the first rather than fetching again', async () => {
  fresh();
  let calls = 0;
  const fetcher = () => { calls += 1; return Promise.resolve(calls); };
  const a = runFetch('k', fetcher);
  const b = runFetch('k', fetcher); // still in flight — must not start a second
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(peekCache<number>('k')?.data, 1);
});

test('a hit that is still fresh is left alone; prefetch does not re-fetch it', async () => {
  fresh();
  let calls = 0;
  await runFetch('k', () => { calls += 1; return Promise.resolve('v'); });
  prefetch('k', () => { calls += 1; return Promise.resolve('v2'); }, TEN_MINUTES);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(peekCache<string>('k')?.data, 'v');
});

test('a failed fetch keeps the previous rows rather than blanking them', async () => {
  fresh();
  await runFetch('k', () => Promise.resolve('good'));
  await refetch('k', () => Promise.reject(new Error('down')));
  assert.equal(peekCache<string>('k')?.data, 'good');
});

test('a forced refetch starts after an in-flight read, so it cannot serve the older answer', async () => {
  fresh();
  let release: (v: string) => void = () => {};
  const slow = new Promise<string>((r) => { release = r; });
  const first = runFetch('k', () => slow);        // in flight, not yet resolved
  const forced = refetch('k', () => Promise.resolve('after-write'));
  release('before-write');                         // the older one lands first
  await Promise.all([first, forced]);
  // The forced read began after the first settled, so its answer is what stands.
  assert.equal(peekCache<string>('k')?.data, 'after-write');
});

test('invalidating during an in-flight read stops that read marking itself fresh', async () => {
  fresh();
  let release: (v: string) => void = () => {};
  const slow = new Promise<string>((r) => { release = r; });
  const p = runFetch('k', () => slow);
  invalidate('k');            // a write lands while the read is still in the air
  release('stale');
  await p;
  const e = peekCache<string>('k');
  assert.equal(e?.data, 'stale');    // the rows are kept…
  assert.equal(e?.fetchedAt, 0);     // …but not counted fresh, so a read re-fetches
});

test('invalidateTabData stales the atlas, the trips list and every inspire ring', async () => {
  fresh();
  const ring = inspireNearKey({ lat: 51.5, lng: -0.1, mode: 'drive', minutes: 60, from: null });
  await runFetch(ATLAS_KEY, () => Promise.resolve('a'));
  await runFetch(TRIPS_KEY, () => Promise.resolve('t'));
  await runFetch(ring, () => Promise.resolve('r'));
  invalidateTabData();
  assert.equal(peekCache(ATLAS_KEY)?.fetchedAt, 0);
  assert.equal(peekCache(TRIPS_KEY)?.fetchedAt, 0);
  assert.equal(peekCache(ring)?.fetchedAt, 0);
});

test('invalidatePrefix stales every ring at once and nothing else', async () => {
  fresh();
  const a = inspireNearKey({ lat: 51.5, lng: -0.1, mode: 'drive', minutes: 60, from: null });
  const b = inspireNearKey({ lat: 53.4, lng: -2.2, mode: 'walk', minutes: 30, from: '1,2' });
  await runFetch(a, () => Promise.resolve('a'));
  await runFetch(b, () => Promise.resolve('b'));
  await runFetch(TRIPS_KEY, () => Promise.resolve('t'));
  invalidatePrefix('inspire:near:');
  assert.equal(peekCache(a)?.fetchedAt, 0);
  assert.equal(peekCache(b)?.fetchedAt, 0);
  assert.notEqual(peekCache(TRIPS_KEY)?.fetchedAt, 0);
});

test('the home ring and a searched town do not share a key', () => {
  const home = inspireNearKey({ lat: 51.386, lng: -0.623, mode: 'drive', minutes: 60, from: null });
  const town = inspireNearKey({ lat: 51.386, lng: -0.623, mode: 'drive', minutes: 60, from: '51.386,-0.623' });
  const walk = inspireNearKey({ lat: 51.386, lng: -0.623, mode: 'walk', minutes: 60, from: null });
  assert.notEqual(home, town);
  assert.notEqual(home, walk);
});

test('clearing the cache drops the rows and the saved-heart overrides together', async () => {
  fresh();
  await runFetch('k', () => Promise.resolve('v'));
  savedOverrides.set('venue:1', { val: true, at: Date.now() });
  clearResourceCache();
  assert.equal(peekCache('k'), undefined);
  assert.equal(savedOverrides.size, 0);
});
