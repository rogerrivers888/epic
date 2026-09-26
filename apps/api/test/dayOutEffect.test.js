/**
 * What a day-out verdict does to the filing (C26, A5; owner, 26 Sep 2026).
 *
 * Out of Pools is not out of Epic: an out place is refiled under the drawer
 * its own labels land in. A place with nowhere left goes on the Not in Epic
 * list — its row kept, its drawer set aside, the reason written — and comes
 * back exactly as it was. Nothing is deleted by the test, ever.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { applyVerdict, notInEpic, restoreToEpic } = await import('../src/sources/dayOutTest.js');

test.after(() => pool.end());

const land = (labels) => ({ subcategory: labels.includes('osm:sport=karting') ? 'karting' : null });

async function seed(ref, subcategory) {
  await query("insert into shelf_categories (key, label) values ('test-cat', 'Test') on conflict do nothing");
  await query("insert into shelf_subcategories (key, label, category_key) values ('pools', 'Pools', 'test-cat'), ('karting', 'Karting', 'test-cat') on conflict do nothing");
  await query('delete from place_index where venue_ref = $1', [ref]);
  await query("insert into place_index (venue_ref, category, subcategory, derived_by) values ($1, 'test-cat', $2, 'hand')", [ref, subcategory]);
}

test('a kept verdict changes nothing', async () => {
  await seed('osm:node/9001', 'pools');
  const out = await applyVerdict('osm:node/9001', { drawer: 'pools', verdict: { verdict: 'kept', by: 'tag' }, tags: { leisure: 'sports_centre' }, land });
  assert.equal(out.effect, 'kept');
  const { rows: [row] } = await query('select subcategory, not_in_epic_at from place_index where venue_ref = $1', ['osm:node/9001']);
  assert.deepEqual(row, { subcategory: 'pools', not_in_epic_at: null });
});

test('an out place with another drawer is refiled there', async () => {
  await seed('osm:node/9002', 'pools');
  const out = await applyVerdict('osm:node/9002', { drawer: 'pools', verdict: { verdict: 'out', by: null, reason: 'nothing says it has a pool' }, tags: { leisure: 'sports_centre', sport: 'karting' }, land });
  assert.deepEqual(out, { effect: 'refiled', to: 'karting' });
  const { rows: [row] } = await query('select subcategory, derived_by, not_in_epic_at from place_index where venue_ref = $1', ['osm:node/9002']);
  assert.deepEqual(row, { subcategory: 'karting', derived_by: 'day-out-test', not_in_epic_at: null });
});

test('an out place with nowhere left goes on the Not in Epic list, keeps its row, and comes back as it was', async () => {
  await seed('osm:node/9003', 'pools');
  const out = await applyVerdict('osm:node/9003', { drawer: 'pools', verdict: { verdict: 'out', by: null, reason: 'nothing says it has a pool' }, tags: { leisure: 'sports_centre' }, land });
  assert.equal(out.effect, 'not-in-epic');
  const { rows: [row] } = await query('select subcategory, not_in_epic_before, not_in_epic_reason, not_in_epic_at from place_index where venue_ref = $1', ['osm:node/9003']);
  assert.equal(row.subcategory, null, 'off every shelf');
  assert.equal(row.not_in_epic_before, 'pools', 'and it remembers which');
  assert.match(row.not_in_epic_reason, /pools: nothing says it has a pool/);
  assert.ok(row.not_in_epic_at);
  assert.ok((await notInEpic()).some((p) => p.venue_ref === 'osm:node/9003'), 'it is on the list');
  // A second verdict on a place already off its shelf changes nothing.
  assert.equal((await applyVerdict('osm:node/9003', { drawer: 'pools', verdict: { verdict: 'out', by: null, reason: 'x' }, tags: {}, land })).effect, 'unchanged');
  // Back exactly as it was.
  const back = await restoreToEpic('osm:node/9003');
  assert.deepEqual(back, { venue_ref: 'osm:node/9003', subcategory: 'pools' });
  const { rows: [after] } = await query('select subcategory, not_in_epic_before, not_in_epic_at from place_index where venue_ref = $1', ['osm:node/9003']);
  assert.deepEqual(after, { subcategory: 'pools', not_in_epic_before: null, not_in_epic_at: null });
  assert.equal(await restoreToEpic('osm:node/9003'), null, 'restoring what is not on the list is a no-op that says so');
});

test('a members-only out place never lands in a tested drawer', async () => {
  await seed('osm:node/9004', 'pools');
  const climbing = () => ({ subcategory: 'climbing' });
  const out = await applyVerdict('osm:node/9004', { drawer: 'pools', verdict: { verdict: 'out', by: 'members', reason: 'members only' }, tags: { leisure: 'sports_centre', sport: 'climbing' }, land: climbing });
  assert.equal(out.effect, 'not-in-epic');
});
