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

// ---------------------------------------------------------------------------
// Codex on the effect (26 Sep 2026)
// ---------------------------------------------------------------------------

test('a rebuild leaves a Not in Epic place off its shelf', async () => {
  const { shelveAll } = await import('../src/repositories/placeIndex.js');
  await seed('osm:node/9005', 'pools');
  await applyVerdict('osm:node/9005', { drawer: 'pools', verdict: { verdict: 'out', by: null, reason: 'nothing says it has a pool' }, tags: { leisure: 'sports_centre' }, land });
  await shelveAll({ refs: ['osm:node/9005'] });
  const { rows: [row] } = await query('select subcategory, not_in_epic_before, not_in_epic_at from place_index where venue_ref = $1', ['osm:node/9005']);
  assert.equal(row.subcategory, null, 'the rebuild did not put it back on a shelf');
  assert.equal(row.not_in_epic_before, 'pools');
  assert.ok(row.not_in_epic_at);
});

test('the effect comes before the fact: a filing that fails writes no verdict, so the catch-up returns to it', async () => {
  const { judge } = await import('../src/sources/dayOutTest.js');
  const was = process.env.EPIC_DAY_OUT_TEST;
  try {
    process.env.EPIC_DAY_OUT_TEST = 'on';
    await seed('osm:node/9006', 'pools');
    await query('delete from place_facts where venue_ref = $1', ['osm:node/9006']);
    const boom = () => { throw new Error('taxonomy down'); };
    await assert.rejects(() => judge('osm:node/9006', { drawer: 'pools', name: 'Bristol Zen Dojo', lat: 51.46, lng: -2.56, tags: { leisure: 'sports_centre', sport: 'karate' }, fetch: async () => ({ elements: [] }), land: boom }), /taxonomy down/);
    const { rows } = await query("select 1 from place_facts where venue_ref = $1 and field = 'day_out_test'", ['osm:node/9006']);
    assert.equal(rows.length, 0, 'no fact was written, so the place is still to be judged');
  } finally {
    if (was == null) delete process.env.EPIC_DAY_OUT_TEST; else process.env.EPIC_DAY_OUT_TEST = was;
  }
});

test('the filing and the fact commit together', async () => {
  const { judge } = await import('../src/sources/dayOutTest.js');
  const was = process.env.EPIC_DAY_OUT_TEST;
  try {
    process.env.EPIC_DAY_OUT_TEST = 'on';
    await seed('osm:node/9007', 'pools');
    await query('delete from place_facts where venue_ref = $1', ['osm:node/9007']);
    const v = await judge('osm:node/9007', { drawer: 'pools', name: 'Absolutely Karting', lat: 51.46, lng: -2.56, tags: { leisure: 'sports_centre', sport: 'karting' }, fetch: async () => ({ elements: [] }), land });
    assert.equal(v.verdict, 'out');
    const { rows: [row] } = await query('select subcategory, derived_by from place_index where venue_ref = $1', ['osm:node/9007']);
    assert.deepEqual(row, { subcategory: 'karting', derived_by: 'day-out-test' }, 'refiled');
    const { rows: [fact] } = await query("select value from place_facts where venue_ref = $1 and field = 'day_out_test'", ['osm:node/9007']);
    assert.equal(fact.value.effect, 'refiled');
    assert.equal(fact.value.to, 'karting');
  } finally {
    if (was == null) delete process.env.EPIC_DAY_OUT_TEST; else process.env.EPIC_DAY_OUT_TEST = was;
  }
});
