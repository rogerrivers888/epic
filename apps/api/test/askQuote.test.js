/**
 * What Ask costs, and what it does not.
 *
 * A remembered miss is answered out of our own table: no search goes out, and
 * there is no identifier to buy a detail about. The board was pricing both, and
 * the run was counting both as calls — so a place Google has never heard of was
 * quoted a match and a detail every single time it was selected, and the
 * refusal stamped Google's clock on the way past, putting the real question off
 * for another twelve months (Codex, 18 Sep 2026).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { missesKept, triedFor } = await import('../src/sources/providerMatch.js');

test.after(() => pool.end());

const remember = (ref, { missing = true, ago = '1 day' } = {}) => query(
  `insert into provider_matches (venue_ref, source, source_ref, missing, matched_at, confidence)
   values ($1, 'google', $2, $3, now() - $4::interval, 1)
   on conflict (venue_ref, source) do update
     set missing = excluded.missing, source_ref = excluded.source_ref, matched_at = excluded.matched_at`,
  [ref, missing ? '' : 'ChIJ-test', missing, ago]);

test('a remembered miss is free, and one past the window is not', async () => {
  const fresh = 'osm:node/miss-remembered';
  const stale = 'osm:node/miss-forgotten';
  const found = 'osm:node/matched';
  await remember(fresh, { ago: '30 days' });
  await remember(stale, { ago: '400 days' });
  await remember(found, { missing: false, ago: '30 days' });

  const refs = [fresh, stale, found];
  const window = 12 * 30 * 24 * 60;
  const missed = await missesKept(refs, 'google', { withinMinutes: window });

  assert.ok(missed.has(fresh), 'we already know the answer, so nothing is asked');
  assert.ok(!missed.has(stale), 'past the window the question is worth asking again');
  assert.ok(!missed.has(found), 'a match is not a miss');

  // And what the run counts a call for: everything with a verdict is answered
  // from our own table, whether that verdict was yes or no.
  const tried = await triedFor(refs, 'google');
  assert.deepEqual([...tried].sort(), refs.slice().sort());
});
