/**
 * The search log, and the rule that keeps it lawful.
 *
 * Two things are worth holding here and nothing else is. The first is that a
 * search that returned nothing is written down as loudly as one that returned
 * forty — that is the whole reason the log exists, and none of it can be
 * backfilled, so a silent failure to write costs a day of demand for ever. The
 * second is that the outcome only ever moves forward: the three faults are
 * counted off it, and a number that can go backwards is a number nobody can act
 * on.
 *
 * The licence rule is tested here too, against the columns rather than the code:
 * `place_index` has no name, no hours, no rating and no photograph, and a schema
 * that grew one would be the quietest possible way to break CLAUDE.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const log = await import('../src/repositories/searches.js');
const queue = await import('../src/repositories/contentQueue.js');
const { defaultBars } = await import('../src/domain/placeIndex.js');

test.after(() => pool.end());

test('the index holds identifiers and our own derivations, and nothing rented', async () => {
  const { rows } = await query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name in ('place_index', 'place_areas', 'area_stats', 'searches', 'search_events')`);
  const columns = new Set(rows.map((r) => r.column_name));
  // CLAUDE.md: licensed place content is rented. The index counts and locates;
  // it never describes. A column here called `name` would be the whole breach.
  for (const rented of ['name', 'title', 'address', 'opening_hours', 'hours', 'rating', 'review_count', 'reviews', 'photo', 'photo_url', 'image_url', 'description', 'summary', 'price_level']) {
    assert.ok(!columns.has(rented), `place_index and friends must not hold "${rented}" — that is somebody else's content`);
  }
  // And what it must hold, so the lens queries have something to stand on.
  for (const ours of ['venue_ref', 'category', 'subcategory', 'ownership', 'data_score', 'ready', 'score_parts', 'oldest_fact', 'cell']) {
    assert.ok(columns.has(ours), `place_index is missing ${ours}`);
  }
});

test('a search that came back empty is written down as loudly as one that did not', async () => {
  const { household: h } = await aHousehold(query);
  const empty = await log.logSearch({ householdId: h.id, surface: 'find', areaSlug: 'berkshire', subject: 'play', shownTotal: 0, shown: [] });
  const full = await log.logSearch({ householdId: h.id, surface: 'find', areaSlug: 'berkshire', subject: 'play', shownTotal: 8, shown: [{ subcategory: 'play', n: 8 }] });
  const { rows } = await query('select id, empty, shown_total from searches order by shown_total');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].empty, true, 'nothing shown is the finding, and has to be a row');
  assert.equal(rows[1].empty, false);
  assert.ok(empty && full);

  const totals = await log.totals({ areaSlug: 'berkshire', since: 30 });
  assert.equal(totals.searches, 2);
  assert.equal(totals.empty, 1);
});

test('the outcome moves forward and never back', async () => {
  const { household: h } = await aHousehold(query);
  const id = await log.logSearch({ householdId: h.id, surface: 'find', areaSlug: 'kent', subject: 'parks', shownTotal: 3 });
  await log.logEvent({ searchId: id, kind: 'open', venueRef: 'osm:node/1', position: 1 });
  assert.equal((await query('select outcome from searches where id = $1', [id])).rows[0].outcome, 'clicked');
  await log.logEvent({ searchId: id, kind: 'add_to_trip', venueRef: 'osm:node/1', position: 1 });
  assert.equal((await query('select outcome from searches where id = $1', [id])).rows[0].outcome, 'tripped');
  // A second look at the same place must not take it back to "clicked".
  await log.logEvent({ searchId: id, kind: 'open', venueRef: 'osm:node/1', position: 1 });
  assert.equal((await query('select outcome from searches where id = $1', [id])).rows[0].outcome, 'tripped');
});

test('a stale search id is answered and ignored rather than failing a tap', async () => {
  // A client holding an id from before a deploy must not turn a tap into a five
  // hundred: the log is worth having and it is not worth that.
  const out = await log.logEvent({ searchId: '00000000-0000-0000-0000-000000000000', kind: 'open', venueRef: 'osm:node/9' });
  assert.equal(out, null);
  assert.equal(await log.logEvent({ searchId: null, kind: 'open' }), null);
});

test('erasure reaches the log: the household cascades, the account is let go', async () => {
  const { household: h } = await aHousehold(query);
  const { rows: [acc] } = await query(
    `insert into accounts (household_id, email, name, role, status) values ($1, 'x@example.com', 'X', 'owner', 'active') returning id`, [h.id]);
  await log.logSearch({ householdId: h.id, accountId: acc.id, surface: 'find', shownTotal: 1 });
  await log.forgetAccount(acc.id);
  const { rows } = await query('select account_id from searches where household_id = $1', [h.id]);
  assert.equal(rows[0].account_id, null, 'a deleted account leaves the counts and takes the person');
  await query('delete from households where id = $1', [h.id]);
  assert.equal((await query('select count(*)::int as n from searches where household_id = $1', [h.id])).rows[0].n, 0);
});

test('the aggregate-and-drop path is built, and drops nothing unless it is told to', async () => {
  const { household: h } = await aHousehold(query);
  const id = await log.logSearch({ householdId: h.id, surface: 'find', areaSlug: 'kent', subject: 'parks', shownTotal: 0 });
  await query(`update searches set at = now() - interval '400 days' where id = $1`, [id]);
  const kept = await log.rollUp({ before: new Date(Date.now() - 365 * 86400_000) });
  assert.equal(kept.dropped, 0, 'retention is the owner\'s decision, and the default is to keep');
  assert.ok((await query('select count(*)::int as n from search_rollups')).rows[0].n > 0);
  const dropped = await log.rollUp({ before: new Date(Date.now() - 365 * 86400_000), drop: true });
  assert.equal(dropped.dropped, 1);
});

test('a rejection reason is from a closed list, and the count says which is common', async () => {
  // The whole reason the list is closed: so the common one can be counted and
  // designed out rather than argued about.
  assert.ok(queue.reasonFor('photo', 'dark'));
  assert.equal(queue.reasonFor('photo', 'made-it-up'), null);
  assert.equal(queue.reasonFor('review', 'dark'), null, 'a photograph reason is not a review reason');
  for (const [kind, reasons] of Object.entries(queue.REASONS)) {
    for (const r of reasons) {
      assert.ok(r.key && r.label, `${kind} has a reason with no words`);
      if (kind !== 'data') assert.ok(r.message, `${kind}/${r.key} has no message to send`);
    }
  }
});

test('a photograph may be approved in a batch; a person’s review may not', () => {
  const batch = new Map(queue.KINDS.map((k) => [k.key, k.batch]));
  assert.equal(batch.get('photo'), true, 'forty beach photographs are one decision');
  assert.equal(batch.get('review'), false, 'a person’s review is never rejected in a batch');
  assert.equal(batch.get('rating'), false);
  assert.equal(batch.get('note'), false);
});

test('every subcategory the taxonomy ships with has a bar to be judged on', async () => {
  const seed = defaultBars();
  const { rows } = await query('select key from shelf_subcategories where active');
  const missing = rows.map((r) => r.key).filter((k) => !seed[k]);
  assert.deepEqual(missing, [], `these have no bar and would read "not set" for ever: ${missing.join(', ')}`);
});
