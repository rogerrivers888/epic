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

const { query, withTransaction, pool } = await testDatabase();
const log = await import('../src/repositories/searches.js');
const queue = await import('../src/repositories/contentQueue.js');
const index = await import('../src/repositories/placeIndex.js');
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
  // How many searches were folded up, not how many groups they fell into — it
  // used to say 1 however many thousands had been rolled (Codex, 17 Sep 2026).
  assert.equal(kept.rolled, 1);
  assert.equal(kept.groups, 1);
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

test('a place that is kept is indexed, and the write is not silently swallowed', async () => {
  // The index used to be filled only by a full rebuild, so a place first seen
  // after the last one was invisible. Worse: the first attempt at fixing that
  // had five target columns and four expressions, and the `catch` around it hid
  // the failure completely — so the index was never written to at all and
  // nothing said so (17 Sep 2026). This asserts the write, not the absence of a
  // throw.
  const ref = `osm:node/${Math.floor(Math.random() * 1e9)}`;
  const out = await index.noteMany([{ ref, lat: 51.48, lng: -0.61 }], { source: 'osm' });
  assert.equal(out.noted, 1);
  const { rows } = await query('select venue_ref, lat, country_code from place_index where venue_ref = $1', [ref]);
  assert.equal(rows.length, 1, 'the place must actually be in the index');
  assert.equal(Number(rows[0].lat).toFixed(2), '51.48');
  assert.equal((await query('select source from place_index_sources where venue_ref = $1', [ref])).rows[0].source, 'osm');

  // An identifier learned later fills a row that had none, and never overwrites
  // one we already hold: a match is what stops us paying to find it twice.
  await index.noteMany([{ ref, sourceId: 'node/99' }], { source: 'osm' });
  assert.equal((await query('select source_place_id from place_index_sources where venue_ref = $1', [ref])).rows[0].source_place_id, 'node/99');
  await index.noteMany([{ ref, sourceId: 'node/other' }], { source: 'osm' });
  assert.equal((await query('select source_place_id from place_index_sources where venue_ref = $1', [ref])).rows[0].source_place_id, 'node/99');

  // Idempotent, and a second sighting never loses a position we already had.
  await index.noteMany([{ ref }], { source: 'osm' });
  assert.equal((await query('select count(*)::int as n from place_index where venue_ref = $1', [ref])).rows[0].n, 1);
  assert.ok((await query('select lat from place_index where venue_ref = $1', [ref])).rows[0].lat != null);

  // Nothing to note is not an error, and never a write.
  assert.deepEqual(await index.noteMany([]), { noted: 0 });
});

test('the live write carries the country and the ownership, and only ever upward', async () => {
  // A place saved in Portugal is filed in Portugal, and a household claiming a
  // place we already research does not un-own it (Codex, 17 Sep 2026).
  const ref = `google:${Math.random().toString(36).slice(2)}`;
  await index.noteMany([{ ref, countryCode: 'PT', ownership: 'claimed' }]);
  let row = (await query('select country_code, ownership from place_index where venue_ref = $1', [ref])).rows[0];
  assert.equal(row.country_code, 'PT');
  assert.equal(row.ownership, 'claimed');

  await index.noteMany([{ ref, ownership: 'owned' }]);
  row = (await query('select country_code, ownership from place_index where venue_ref = $1', [ref])).rows[0];
  assert.equal(row.ownership, 'owned');
  assert.equal(row.country_code, 'PT', 'and the country it was filed under is not overwritten by a default');

  await index.noteMany([{ ref, ownership: 'identified' }]);
  assert.equal((await query('select ownership from place_index where venue_ref = $1', [ref])).rows[0].ownership, 'owned',
    'ownership never goes backwards');

  // And a place does not change country, in either direction: neither a later
  // save carrying different location metadata, nor one carrying none.
  await index.noteMany([{ ref, countryCode: 'ES' }]);
  assert.equal((await query('select country_code from place_index where venue_ref = $1', [ref])).rows[0].country_code, 'PT');

  const british = `osm:node/${Math.floor(Math.random() * 1e9)}`;
  await index.noteMany([{ ref: british, countryCode: 'GB' }]);
  await index.noteMany([{ ref: british, countryCode: 'ES' }]);
  assert.equal((await query('select country_code from place_index where venue_ref = $1', [british])).rows[0].country_code, 'GB',
    'a place genuinely in Britain is not refiled to Spain either');
});

test('a failure on the pool is swallowed; a failure in a transaction is not', async () => {
  // A derived count is never a reason for a place not to be kept — but inside a
  // transaction the error has already aborted it, and swallowing one would hide
  // a failure while saving nothing (Codex, 17 Sep 2026).
  assert.deepEqual(await index.noteMany([{ ref: null }]), { noted: 0 }, 'nothing to note is not an error');
  // A position that is not a number is the cheapest real failure: the column is
  // cast, so Postgres refuses the row rather than coercing it.
  const bad = [{ ref: `osm:node/${Math.floor(Math.random() * 1e9)}`, lat: 'not a number' }];
  assert.deepEqual(await index.noteMany(bad), { noted: 0 }, 'the pool path answers rather than throwing');
  await assert.rejects(
    () => withTransaction(async (client) => { await index.noteMany(bad, { client }); }),
    /invalid input syntax|double precision/,
    'the transactional path lets its caller see the failure rather than hiding it',
  );
});

test('the index write joins the transaction that owns it', async () => {
  // A fire-and-forget write outside the caller's transaction leaves a row for a
  // place that was rolled back. Given a client, it commits or rolls back with
  // the thing it is about (Codex, 17 Sep 2026).
  const ref = `osm:node/${Math.floor(Math.random() * 1e9)}`;
  await withTransaction(async (client) => {
    await index.noteMany([{ ref }], { client });
    assert.equal((await client.query('select count(*)::int as n from place_index where venue_ref = $1', [ref])).rows[0].n, 1,
      'the place is readable inside the transaction that wrote it');
    throw new Error('rolled back on purpose');
  }).catch((e) => { if (!/on purpose/.test(e.message)) throw e; });
  assert.equal((await query('select count(*)::int as n from place_index where venue_ref = $1', [ref])).rows[0].n, 0,
    'and it is gone with the transaction, rather than left behind');
});

test('every subcategory the taxonomy ships with has a bar to be judged on', async () => {
  const seed = defaultBars();
  const { rows } = await query('select key from shelf_subcategories where active');
  const missing = rows.map((r) => r.key).filter((k) => !seed[k]);
  assert.deepEqual(missing, [], `these have no bar and would read "not set" for ever: ${missing.join(', ')}`);
});

test('a place kept between rebuilds is placed, and turns up on the board', async () => {
  // `noteMany` writes the index row and nothing else — no area, no shelf, no
  // score. Every board in Places reads through `place_areas`, so until this
  // runs a newly swept or claimed place is in the index and on no screen, and
  // it stayed that way until somebody pressed Rebuild (Codex, 17 Sep 2026).
  await index.noteMany([{ ref: 'osm:node/settle-me', lat: 51.48, lng: -0.61 }], { source: 'osm', countryCode: 'GB' });
  const before = await index.breakdown('gb', { by: 'county' });
  const inGb = async () => (await query(
    `select count(*)::int as n from place_areas where venue_ref = $1 and area_slug = 'gb'`,
    ['osm:node/settle-me'])).rows[0].n;
  assert.equal(await inGb(), 0, 'nothing has placed it yet');

  const out = await index.settleNew();
  assert.ok(out.settled >= 1);
  assert.equal(await inGb(), 1, 'the country it is in is an area it is in');
  const { rows: [row] } = await query('select placed_at, indexed_at from place_index where venue_ref = $1', ['osm:node/settle-me']);
  assert.ok(row.placed_at, 'placed, which is what takes it out of the waiting set');

  // And it is safe to run again when there is nothing left to do.
  assert.equal((await index.settleNew()).settled, 0);
  assert.ok(before !== null);
});

test('a breakdown that is a slice ranks the right slice', async () => {
  // Sorting a page that was chosen arbitrarily ranks the wrong areas. Two
  // counties, and a limit of one: the one that comes back must be the bigger.
  for (const [slug, name] of [['aaa-shire', 'Aaa'], ['zzz-shire', 'Zzz']]) {
    await query(`insert into localities (slug, name, kind, parent_slug) values ($1,$2,'county','gb')
                 on conflict (slug) do nothing`, [slug, name]);
  }
  await index.noteMany([{ ref: 'osm:node/one' }, { ref: 'osm:node/two' }, { ref: 'osm:node/three' }], { countryCode: 'GB' });
  // Both the county and the country: `inside` finds the areas that overlap the
  // one being stood in, so a place has to be in Great Britain to count there.
  await query(`insert into place_areas (venue_ref, area_slug) values
                 ('osm:node/one','zzz-shire'), ('osm:node/two','zzz-shire'), ('osm:node/three','aaa-shire'),
                 ('osm:node/one','gb'), ('osm:node/two','gb'), ('osm:node/three','gb')
               on conflict do nothing`);
  await index.refreshStats();
  const one = await index.breakdown('gb', { by: 'county', sort: 'known', desc: true, limit: 1 });
  assert.equal(one.rows.length, 1);
  assert.equal(one.rows[0].slug, 'zzz-shire', 'the top of a slice is the actual top');
  const other = await index.breakdown('gb', { by: 'county', sort: 'known', desc: false, limit: 1 });
  assert.equal(other.rows[0].slug, 'aaa-shire');
});

test('the harvest reaches the index, including the rows that have no reference of their own', async () => {
  // A Wikidata harvest row carries no venue reference: the synthetic
  // `atlas:<id>` only exists once the row has an id. Filtering on it beforehand
  // threw away essentially the whole harvest (Codex, 17 Sep 2026).
  const library = await import('../src/repositories/library.js');
  await query(`insert into regions (slug, name, nation, kind) values ('testshire', 'Testshire', 'England', 'county')
               on conflict (slug) do nothing`);
  const written = await library.upsertAttractions('testshire', [
    { wikidataId: 'Q-test-1', name: 'A castle', slug: 'a-castle', lat: 51.48, lng: -0.61, summary: 'Ours.' },
    { wikidataId: null, name: 'A garden', slug: 'a-garden', lat: 51.49, lng: -0.62 },
  ]);
  assert.equal(written, 2);
  const { rows } = await query(
    `select pi.venue_ref from place_index pi
      where pi.venue_ref in (select coalesce(a.venue_ref, 'atlas:' || a.id::text)
                               from attractions a where a.region_slug = 'testshire')`);
  assert.equal(rows.length, 2, 'both of them, whether or not they came with a reference');
});

test('a place two sources returned is recorded as two, not as the run that asked', async () => {
  // A sweep result is often Google *and* OpenStreetMap. Handing the index only
  // the synthetic `sweep` made every combined place read as single-source on
  // the sources lens (Codex, 17 Sep 2026).
  await index.noteMany(
    [{ ref: 'google:both-of-them', lat: 51.5, lng: -0.6, sources: ['sweep', 'google', 'osm'] }],
    { source: 'sweep' });
  const { rows } = await query(
    `select source from place_index_sources where venue_ref = $1 order by source`, ['google:both-of-them']);
  assert.deepEqual(rows.map((r) => r.source), ['google', 'osm', 'sweep']);

  // A list that names the same source twice is one row, not a statement that
  // cannot see its own duplicate.
  await index.noteMany([{ ref: 'osm:node/twice', sources: ['osm', 'osm'] }], { source: 'sweep' });
  const { rows: once } = await query(
    'select count(*)::int as n from place_index_sources where venue_ref = $1', ['osm:node/twice']);
  assert.equal(once[0].n, 1);
});

test('every result the household could tap is in the replay, not the first sixty', async () => {
  const { household } = await aHousehold(query);
  const id = await log.noteSearch({
    householdId: household.id, surface: 'inspire', shownTotal: 250, shown: [{ kind: 'idea', n: 250 }],
  });
  await log.noteShown(id, Array.from({ length: 250 }, (_, i) => ({ ref: `osm:node/${i}`, position: i + 1 })));
  const { rows } = await query(
    `select count(*)::int as n, max(position)::int as last from search_events where search_id = $1 and kind = 'shown'`, [id]);
  assert.equal(rows[0].n, 250, 'the replay is built from these rows and nothing else');
  assert.equal(rows[0].last, 250);
});

test('a search outside the cells we hold is written down as outside them', async () => {
  const { household } = await aHousehold(query);
  // Unbounded, the nearest-cell lookup filed a search in continental Europe
  // under whichever UK cell was closest, and then under that cell's county — a
  // demand report nobody could act on and nobody could spot (Codex, 17 Sep
  // 2026).
  await query(
    `insert into geo_cells (code, scheme, label, lat, lng, source, outcode)
     values ('TESTCELL', 'outcode', 'Test cell', 51.48, -0.61, 'test', 'sl4')
     on conflict (code) do update set lat = excluded.lat, lng = excluded.lng`);
  const near = await log.whereOf({ lat: 51.49, lng: -0.62 });
  assert.equal(near.cell, 'TESTCELL', 'a cell that is actually near is used');

  const far = await log.whereOf({ lat: 45.46, lng: 9.19 });   // Milan
  assert.equal(far.cell, null, 'and one that is not, is not');
  assert.equal(far.areaSlug, null);

  // The search is still written down: where it happened is a finding.
  const id = await log.noteSearch({ householdId: household.id, surface: 'places', ...far, lat: 45.46, lng: 9.19, empty: true });
  assert.ok(id);
});

test('the three kinds of ownership are counted as three', async () => {
  // Owned used to mean "not identified", which put every place a household had
  // merely claimed into the figure the screen defines as holding our own
  // research — so coverage read better than it was and the places most worth
  // curating were the ones hidden by it (Codex, 17 Sep 2026).
  await query(`insert into localities (slug, name, kind, parent_slug)
               values ('ownershire', 'Ownershire', 'county', 'gb') on conflict (slug) do nothing`);
  const refs = ['osm:node/own-me', 'osm:node/claim-me', 'osm:node/just-seen'];
  await index.noteMany([
    { ref: refs[0], ownership: 'owned' },
    { ref: refs[1], ownership: 'claimed' },
    { ref: refs[2] },
  ], { countryCode: 'GB' });
  await query(
    `insert into place_areas (venue_ref, area_slug)
     select r, 'ownershire' from unnest($1::text[]) as r on conflict do nothing`, [refs]);
  await index.refreshStats();

  const stats = await index.statsFor('ownershire');
  assert.equal(stats.known, 3);
  assert.equal(stats.owned, 1, 'only our own research is owned');
  assert.equal(stats.claimed, 1, 'a household saying it matters is its own answer');
  assert.equal(stats.identified, 1);
  assert.equal(stats.owned + stats.claimed + stats.identified, stats.known, 'and the three add up');

  // The same three, read straight off a set of refs rather than the rollups.
  const direct = await index.statsForRefs(refs);
  assert.equal(direct.owned, 1);
  assert.equal(direct.claimed, 1);
  assert.equal(direct.identified, 1);
});

test('a subcategory finds its own five numbers without being told its category', async () => {
  // The rollup keeps the category on a subcategory row because it is worth
  // reading; the lookup asked for `category = ''` against rows stored under
  // `culture`, so the subcategory board printed a dash for every one of its
  // five numbers while its own list showed twelve places (found by opening the
  // screen, 17 Sep 2026).
  await query(`insert into localities (slug, name, kind, parent_slug)
               values ('subshire', 'Subshire', 'county', 'gb') on conflict (slug) do nothing`);
  const { rows: [sub] } = await query(
    `select key, category_key from shelf_subcategories where active limit 1`);
  const refs = ['osm:node/sub-1', 'osm:node/sub-2'];
  await index.noteMany(refs.map((ref) => ({ ref })), { countryCode: 'GB' });
  await query(
    `update place_index set subcategory = $2, category = $3, derived_by = 'hand' where venue_ref = any($1)`,
    [refs, sub.key, sub.category_key]);
  await query(
    `insert into place_areas (venue_ref, area_slug) select r, 'subshire' from unnest($1::text[]) as r
     on conflict do nothing`, [refs]);
  await index.refreshStats();

  const asked = await index.statsFor('subshire', { subcategory: sub.key });
  assert.equal(asked.known, 2, 'the subcategory decides its own category');
  // And a category on its own still answers for the category grain.
  const cat = await index.statsFor('subshire', { category: sub.category_key });
  assert.equal(cat.known, 2);
});

test('an empty record is not research, and the write that earns it says so', async () => {
  const owned = await import('../src/repositories/ownedPlaces.js');
  const ref = 'osm:node/earn-it';
  // `ensureRecord` runs *before* the research: calling this owned marked every
  // place we had merely noticed as one we had researched, which took it out of
  // Collect's reach and overstated coverage (Codex, 17 Sep 2026).
  await owned.ensureRecord(ref);
  let { rows: [row] } = await query('select ownership from place_index where venue_ref = $1', [ref]);
  assert.equal(row.ownership, 'identified');

  // A fact of our own lands, and now it is ours.
  await owned.writeRecord(ref, ['summary'], ['A sentence we wrote.'], [], { name: 'osm' });
  ({ rows: [row] } = await query('select ownership from place_index where venue_ref = $1', [ref]));
  assert.equal(row.ownership, 'owned');

  // And the full rebuild asks the same question of the same columns.
  const bare = 'osm:node/still-empty';
  await owned.ensureRecord(bare);
  await index.reindex();
  const { rows: [after] } = await query('select ownership from place_index where venue_ref = $1', [bare]);
  assert.equal(after.ownership, 'identified', 'a rebuild must not promote an empty row either');
});

test('a place a household saved is the first thing worth owning, not hidden', async () => {
  // Splitting owned from claimed took every saved place out of Collect's reach
  // and off "Worth owning next" — the two lists whose whole job is to find
  // places worth researching (Codex, 17 Sep 2026). A claimed place is one
  // somebody has already said matters and we hold nothing about.
  await query(`insert into localities (slug, name, kind, parent_slug)
               values ('worthshire', 'Worthshire', 'county', 'gb') on conflict (slug) do nothing`);
  const claimed = 'osm:node/somebody-saved-it';
  const seen = 'osm:node/nobody-asked';
  await index.noteMany([{ ref: claimed, ownership: 'claimed' }, { ref: seen }], { countryCode: 'GB' });
  await query(
    `insert into place_areas (venue_ref, area_slug) select r, 'worthshire' from unnest($1::text[]) as r
     on conflict do nothing`, [[claimed, seen]]);
  await index.refreshStats();

  const q = await index.quality('worthshire');
  const refs = q.worth.map((w) => w.ref);
  assert.ok(refs.includes(claimed), 'a saved place is worth owning next');
  assert.ok(refs.includes(seen), 'and so is one nobody has asked about');
  assert.equal(refs[0], claimed, 'the one somebody has already said matters comes first');
  assert.equal(q.worth.find((w) => w.ref === claimed)?.ownership, 'claimed', 'and the row says why it is here');
});

test('a search is rolled up exactly once, and only whole months are rolled', async () => {
  // Two rules at once. A bucket holds one number for a month, so a cutoff
  // partway through a month would make one no window could use — and with
  // `drop` the rest of that month would be gone for good. And a search must be
  // counted once however many runs are made, in whatever order (Codex, 17 and
  // 18 Sep 2026).
  const { household } = await aHousehold(query);
  const may = new Date(Date.UTC(2025, 4, 1));
  const june = new Date(Date.UTC(2025, 5, 1));
  const at = (month, day) => new Date(Date.UTC(2025, month, day)).toISOString();
  for (const [month, day] of [[4, 2], [4, 20], [5, 3], [5, 21]]) {
    const id = await log.noteSearch({ householdId: household.id, surface: 'places', areaSlug: 'rollshire', subject: 'museums' });
    await query('update searches set at = $2 where id = $1', [id, at(month, day)]);
  }
  const totals = async (month) => (await query(
    `select searches, tripped from search_rollups
      where area_slug = 'rollshire' and subject = 'museums' and month = $1`, [month])).rows[0] ?? null;

  // A cutoff in the middle of June rolls May, and leaves June alone because it
  // is not over.
  const first = await log.rollUp({ before: new Date(Date.UTC(2025, 5, 10)), drop: true });
  assert.equal(first.rolled, 2, 'both of May');
  assert.equal((await totals(may)).searches, 2);
  assert.equal(await totals(june), null, 'and June waits until it is complete');

  // The next run, once June is over, takes all of it.
  const second = await log.rollUp({ before: new Date(Date.UTC(2025, 6, 1)), drop: true });
  assert.equal(second.rolled, 2, 'both of June');
  assert.equal((await totals(june)).searches, 2);

  // And a third run counts nothing twice.
  await log.rollUp({ before: new Date(Date.UTC(2025, 6, 1)), drop: true });
  assert.equal((await totals(may)).searches, 2);
  assert.equal((await totals(june)).searches, 2);
  // The conversions come with them: the only outcome that says something went
  // right, and it used to be dropped.
  assert.equal(typeof (await totals(june)).tripped, 'number');
});

test('the first build on an upgraded installation actually builds', async () => {
  // `buildIfEmpty` holds the build lock and then called `reindex()`, which asks
  // for the same advisory lock on another pooled connection — so it answered
  // "somebody else is rebuilding", and the first build on an upgraded
  // installation reported success and did nothing at all (Codex, 17 Sep 2026).
  await query('delete from place_index');
  const out = await index.buildIfEmpty();
  assert.equal(out.built, true);
  assert.ok(out.places > 0, 'and there are places in it');
  const { rows: [n] } = await query('select count(*)::int as n from place_index');
  assert.equal(n.n, out.places);

  // And a second call does nothing, because there is nothing to do.
  const again = await index.buildIfEmpty();
  assert.equal(again.built, false);
});

test('an event only ever lands on the household’s own search', async () => {
  // Anybody signed in who got hold of another search's id could add events to
  // it and move its outcome — somebody else's demand figures, written by a
  // stranger (Codex, 17 Sep 2026).
  const mine = await aHousehold(query);
  const theirs = await aHousehold(query);
  const id = await log.noteSearch({ householdId: mine.household.id, surface: 'places' });

  assert.equal(await log.logEvent({ searchId: id, kind: 'open', householdId: theirs.household.id }), null);
  let { rows: [row] } = await query('select outcome from searches where id = $1', [id]);
  assert.equal(row.outcome, 'none', 'and nothing moved');

  assert.equal(await log.logEvent({ searchId: id, kind: 'open', householdId: mine.household.id }), true);
  ({ rows: [row] } = await query('select outcome from searches where id = $1', [id]));
  assert.equal(row.outcome, 'clicked');
});

test('a shelf nothing supports any more is cleared by a rebuild', async () => {
  // The old shelf used to stay, so even a full rebuild went on counting the
  // place under a drawer nothing put it in. A shelf set by hand is somebody's
  // decision and survives (Codex, 17 Sep 2026).
  await query(
    `insert into place_index (venue_ref, ownership, derived_by, category, subcategory)
     values ('osm:node/orphaned', 'identified', 'sweep', 'culture', 'galleries'),
            ('osm:node/by-hand', 'identified', 'hand', 'culture', 'galleries')
     on conflict (venue_ref) do update
        set category = excluded.category, subcategory = excluded.subcategory, derived_by = excluded.derived_by`);
  await index.reindex();
  const shelfOf = async (ref) => (await query(
    'select category, subcategory, derived_by from place_index where venue_ref = $1', [ref])).rows[0];
  assert.equal((await shelfOf('osm:node/orphaned')).subcategory, null, 'a derived shelf does not outlive what derived it');
  assert.equal((await shelfOf('osm:node/by-hand')).subcategory, 'galleries', 'a decision survives');
});

test('clearing a place’s only owned fact takes its ownership back down', async () => {
  const owned = await import('../src/repositories/ownedPlaces.js');
  const ref = 'osm:node/up-and-down';
  await owned.ensureRecord(ref);
  const ownershipOf = async () => (await query(
    'select ownership from place_index where venue_ref = $1', [ref])).rows[0].ownership;
  const ownRow = async () => (await query(
    `select count(*)::int as n from place_index_sources where venue_ref = $1 and source = 'own'`, [ref])).rows[0].n;
  assert.equal(await ownershipOf(), 'identified');

  await query(`update place_records set summary = 'A sentence we wrote.' where venue_ref = $1`, [ref]);
  assert.equal(await owned.settleOwnership(ref), 'owned');
  assert.equal(await ownRow(), 1, 'and the source row says we hold something');

  // An administrator clears the only owned field. `noteOwned` only ever moves
  // ownership upward, so this used to stay "owned" for good — coverage
  // overstated the county and Collect skipped a place that needed it (Codex,
  // 17 Sep 2026).
  await query(`update place_records set summary = null where venue_ref = $1`, [ref]);
  assert.equal(await owned.settleOwnership(ref), 'identified');
  assert.equal(await ownRow(), 0, 'and the source row goes with it');
});

test('the last household to un-save a place stops it being claimed', async () => {
  const atlas = await import('../src/repositories/atlas.js');
  const { withTransaction } = await testDatabase();
  const one = await aHousehold(query);
  const two = await aHousehold(query);
  const ref = 'google:SHARED-CLAIM';

  const save = (h) => withTransaction((client) => atlas.upsertHouseholdPlace(client, h.household.id, {
    venueRef: ref, label: 'Somewhere', kind: 'saved', lat: 51.5, lng: -0.6, countryCode: 'GB',
  }));
  await save(one); await save(two);
  const ownershipOf = async () => (await query(
    'select ownership from place_index where venue_ref = $1', [ref])).rows[0].ownership;
  assert.equal(await ownershipOf(), 'claimed');

  // Saving promotes the shared index row and nothing took it back, so coverage
  // and Collect went on treating a place nobody had saved as one somebody had
  // (Codex, 17 Sep 2026).
  await withTransaction((client) => atlas.removePlace(client, one.household.id, ref));
  assert.equal(await ownershipOf(), 'claimed', 'one of the two still has it');

  await withTransaction((client) => atlas.removePlace(client, two.household.id, ref));
  assert.equal(await ownershipOf(), 'identified', 'and now nobody does');
});

test('a cleared fact is none, not an empty one', async () => {
  const owned = await import('../src/repositories/ownedPlaces.js');
  const { holdsAnOwnedFact } = await import('../src/domain/placeIndex.js');
  // Every predicate that asks whether we hold a fact asks `is not null`, so an
  // empty string went on counting towards the score and the ownership while the
  // screen showed a hole (Codex, 17 Sep 2026).
  assert.equal(holdsAnOwnedFact({ summary: '' }), true, 'an empty string is not null — which is why it must never be stored');
  assert.equal(holdsAnOwnedFact({ summary: null }), false);

  const ref = 'osm:node/cleared';
  await owned.ensureRecord(ref);
  await query(`update place_records set summary = 'Ours.' where venue_ref = $1`, [ref]);
  assert.equal(await owned.settleOwnership(ref), 'owned');
  // What the route does with an empty box: null, not ''.
  await query(`update place_records set summary = null, summary_source = null where venue_ref = $1`, [ref]);
  assert.equal(await owned.settleOwnership(ref), 'identified');
});

test('a month folded up and dropped is still in the headline figures', async () => {
  const { household } = await aHousehold(query);
  const id = await log.noteSearch({ householdId: household.id, surface: 'places', areaSlug: 'keepshire' });
  await log.logEvent({ searchId: id, kind: 'add_to_trip', householdId: household.id });

  const before = await log.totals({ areaSlug: 'keepshire', since: 3650 });
  assert.equal(before.searches, 1);
  assert.equal(before.tripped, 1);

  // Retention is off by default, so this is the moment it would be switched on.
  // The board used to read only `searches`, so folding a month up and dropping
  // it lost every search in it — and the log cannot be backfilled (Codex,
  // 17 Sep 2026).
  await log.rollUp({ before: new Date(Date.now() + 86_400_000), drop: true });
  const after = await log.totals({ areaSlug: 'keepshire', since: 3650 });
  assert.equal(after.searches, 1, 'the search survives as an aggregate');
  assert.equal(after.tripped, 1, 'and so does the conversion');
});

test('a rolled month counts only when the whole of it is inside the window', async () => {
  const { household } = await aHousehold(query);
  // A search in the month *before* last, folded up and dropped.
  const twoMonthsBack = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 15));
  const id = await log.noteSearch({ householdId: household.id, surface: 'places', areaSlug: 'windowshire' });
  await query('update searches set at = $2 where id = $1', [id, twoMonthsBack.toISOString()]);
  await log.rollUp({ before: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), drop: true });

  // A thirty-day window starts partway through last month. Truncating that edge
  // to the first of the month pulled a whole month of history into it (Codex,
  // 17 Sep 2026), and a rolled month is one number that cannot be cut.
  const near = await log.totals({ areaSlug: 'windowshire', since: 30 });
  assert.equal(near.searches, 0, 'a month that is only partly inside the window is left out');

  const far = await log.totals({ areaSlug: 'windowshire', since: 3650 });
  assert.equal(far.searches, 1, 'and a window that covers it whole counts it');
});

test('the board’s two halves are both answerable, and both add up', async () => {
  // `bySubject` had no test, and a CTE named `both` — which is a reserved word
  // — took the whole Demand screen down with a 500 that only opening it found
  // (18 Sep 2026). Both halves are exercised here, and against the same rows.
  const { household } = await aHousehold(query);
  for (const subject of ['museums', 'museums', 'parks']) {
    await log.noteSearch({ householdId: household.id, surface: 'places', areaSlug: 'sumshire', subject });
  }
  const totals = await log.totals({ areaSlug: 'sumshire', since: 30 });
  const rows = await log.bySubject({ areaSlug: 'sumshire', since: 30 });
  assert.equal(totals.searches, 3);
  assert.equal(rows.reduce((n, r) => n + r.searches, 0), totals.searches, 'the rows add up to the headline');
  assert.equal(rows.find((r) => r.subject === 'museums')?.searches, 2);
});

test('a degraded source is written down by name, not as a lump of JSON', async () => {
  const { household } = await aHousehold(query);
  // Two callers hand over `{ source, error, slow }` objects and the column is
  // `text[]`, so Postgres stringified them — and a replay after any provider
  // timed out printed JSON where a source name should be (Codex, 18 Sep 2026).
  const id = await log.noteSearch({
    householdId: household.id, surface: 'places',
    sourcesQueried: ['google', 'osm'],
    degraded: [{ source: 'osm', error: 'timed out', slow: true }, 'google'],
  });
  const { rows: [row] } = await query('select degraded from searches where id = $1', [id]);
  assert.deepEqual(row.degraded, ['osm', 'google']);
});

/**
 * What the screen drew, not what came back.
 *
 * Inspire answers with a pool and the screen filters it. Counted from the pool,
 * a screen the filters emptied read as forty places shown and nothing clicked —
 * "wrong places", owned by Categories, when the truth was "came back empty",
 * owned by Collect (Codex, 18 Sep 2026).
 */
test('the screen says what it drew, and an emptied screen is an empty search', async () => {
  const { household } = await aHousehold(query);
  await index.noteMany([
    { ref: 'test:drawn-1' }, { ref: 'test:drawn-2' }, { ref: 'test:drawn-3' },
  ], { source: 'atlas' });
  await query(`update place_index set subcategory = 'museums' where venue_ref in ('test:drawn-1','test:drawn-2')`);
  const id = await log.noteSearch({
    householdId: household.id, surface: 'inspire', shownTotal: 3,
    shown: [{ subcategory: 'museums', n: 2 }, { subcategory: 'unshelved', n: 1 }],
  });
  // The replay's rows are all three, because a card one tap away is reachable.
  await log.noteShown(id, ['test:drawn-1', 'test:drawn-2', 'test:drawn-3'].map((ref, i) => ({ ref, position: i + 1 })));

  assert.equal(await log.noteDrawn({ searchId: id, householdId: household.id, refs: ['test:drawn-1'] }), true);
  const said = async () => (await query('select shown_total, shown, empty from searches where id = $1', [id])).rows[0];
  let row = await said();
  assert.equal(row.shown_total, 1, 'one was drawn, whatever came back');
  assert.deepEqual(row.shown, [{ subcategory: 'museums', n: 1 }], 'and it is filed under its own shelf');
  assert.equal(row.empty, false);
  const { rows: still } = await query(
    `select count(*)::int as n from search_events where search_id = $1 and kind = 'shown'`, [id]);
  assert.equal(still[0].n, 3, 'the replay still holds everything they could reach');
  // And says which of them was actually on the screen, so the replay leads with
  // those and its row count can be squared with the figure above it.
  const { rows: marked } = await query(
    `select venue_ref, meta->>'drawn' as drawn from search_events
      where search_id = $1 and kind = 'shown' order by position`, [id]);
  assert.deepEqual(marked.map((r) => r.drawn), ['true', 'false', 'false']);

  // A place the index has never heard of shares the unshelved entry rather than
  // making a second one with the same name.
  await log.noteDrawn({ searchId: id, householdId: household.id, refs: ['test:drawn-3', 'test:never-indexed'] });
  assert.deepEqual((await said()).shown, [{ subcategory: 'unshelved', n: 2 }]);

  // Nothing survived the filters: that is an empty search, not a wrong one.
  await log.noteDrawn({ searchId: id, householdId: household.id, refs: [] });
  row = await said();
  assert.equal(row.shown_total, 0);
  assert.equal(row.empty, true);

  // And it is only ever the household's own search.
  const other = await aHousehold(query);
  assert.equal(await log.noteDrawn({ searchId: id, householdId: other.household.id, refs: ['test:drawn-2'] }), false);
  assert.equal((await said()).shown_total, 0);
});

/**
 * A place that has been retired leaves the index.
 *
 * Hiding an attraction in the library took it out of the harvest's insert and
 * left the row it had already made, so a rebuild went on counting it as known,
 * as owned, and as somewhere worth collecting (Codex, 18 Sep 2026).
 */
test('a hidden attraction leaves the index, unless something else holds the place', async () => {
  const { household } = await aHousehold(query);
  const { rows: [region] } = await query('select slug from regions limit 1');
  const make = async (name) => (await query(
    `insert into attractions (name, slug, region_slug, state, lat, lng, summary, first_seen, last_seen)
     values ($1, $3, $2, 'published', 51.5, -0.1, 'A sentence of ours', now(), now()) returning *`,
    [name, region.slug, `retire-${Math.random().toString(36).slice(2, 10)}`])).rows[0];
  const alone = await make('Retired, and nothing else holds it');
  const claimed = await make('Retired, but a household saved it');
  const refOf = (a) => a.venue_ref ?? `atlas:${a.id}`;
  await query(
    `insert into household_places (household_id, venue_ref, label, kind, first_seen, last_seen)
     values ($1, $2, 'Somewhere they saved', 'loved', now(), now())`, [household.id, refOf(claimed)]);

  await index.reindex();
  const held = async (ref) => (await query('select count(*)::int as n from place_index where venue_ref = $1', [ref])).rows[0].n;
  assert.equal(await held(refOf(alone)), 1, 'a published attraction is in the index');
  assert.equal(await held(refOf(claimed)), 1);

  // Retired the way the library retires one, and the index hears about it
  // without waiting for a rebuild (Codex, 18 Sep 2026).
  await query(`update attractions set state = 'hidden' where id = any($1::uuid[])`, [[alone.id, claimed.id]]);
  await index.retire();
  assert.equal(await held(refOf(alone)), 0, 'retired, and nothing else was holding it');
  assert.equal(await held(refOf(claimed)), 1, 'a household claimed it, so the place stays');
  // And the place that survived is no longer *owned*: its only research was the
  // attraction that has been retired, so it is back to being one a household
  // has claimed (Codex, 18 Sep 2026).
  const { rows: [own] } = await query('select ownership from place_index where venue_ref = $1', [refOf(claimed)]);
  assert.equal(own.ownership, 'claimed');

  // The retired attraction stops being one of its sources.
  const atlasRows = async () => (await query(
    `select count(*)::int as n from place_index_sources where venue_ref = $1 and source = 'atlas'`,
    [refOf(claimed)])).rows[0].n;
  assert.equal(await atlasRows(), 0);
  // A full rebuild puts that row back, and deliberately: the reference itself is
  // an atlas reference, so the atlas is still where the identifier came from.
  // What it no longer is, is a reason to keep the place.
  await index.reindex();
  assert.equal(await atlasRows(), 1);
  assert.equal((await query('select ownership from place_index where venue_ref = $1', [refOf(claimed)])).rows[0].ownership, 'claimed');
  // And the retired one took its area and cell rows with it.
  const orphans = await query(
    `select (select count(*) from place_areas where venue_ref = $1)::int as areas,
            (select count(*) from place_cells where venue_ref = $1)::int as cells`, [refOf(alone)]);
  assert.deepEqual(orphans.rows[0], { areas: 0, cells: 0 });
});

/**
 * A corrected position reaches the index, and sends the place back to be placed.
 *
 * Holding the first coordinate for ever meant a place kept whatever the first
 * thing to mention it thought, and its cell, its ring and every distance off it
 * stayed wrong until somebody rebuilt the index by hand (Codex, 18 Sep 2026).
 */
test('a later source corrects a position, and a claim with none cannot erase it', async () => {
  const ref = 'test:moved';
  await index.noteMany([{ ref, lat: 51.5, lng: -0.1 }], { source: 'atlas' });
  await query('update place_index set placed_at = now() where venue_ref = $1', [ref]);

  // Fifty metres or so: enough to change the cell it sits in.
  await index.noteMany([{ ref, lat: 51.52, lng: -0.12 }], { source: 'osm' });
  const row = async () => (await query('select lat, lng, placed_at from place_index where venue_ref = $1', [ref])).rows[0];
  let now = await row();
  assert.equal(Math.round(now.lat * 100) / 100, 51.52, 'the newer position is the one held');
  assert.equal(now.placed_at, null, 'and it goes back to be placed');

  // A household claiming it carries no position, and must not erase one.
  await query('update place_index set placed_at = now() where venue_ref = $1', [ref]);
  await index.noteMany([{ ref }], { ownership: 'claimed' });
  now = await row();
  assert.equal(Math.round(now.lat * 100) / 100, 51.52, 'a caller with nothing to say says nothing');
});

/**
 * The contractual ceiling is counted off the meter, not off the label.
 *
 * A browse that asks several sources together records one row whose `provider`
 * is all of their names joined, while the units it billed sit under each
 * source's own key. Filtering on the label missed every Tripadvisor location
 * spent from a search (Codex, 18 Sep 2026).
 */
test('a Tripadvisor location billed inside a mixed call still counts against the cap', async () => {
  const { household } = await aHousehold(query);
  const room = await import('../src/routes/placeIndex.js');
  const before = await room.tripadvisorRoom(0);
  await query(
    `insert into provider_calls (household_id, provider, purpose, units, estimated_cost_usd)
     values ($1, 'fixtures+osm+google+tripadvisor', 'places.search', '{"google":1,"tripadvisor":4}'::jsonb, 0.075)`,
    [household.id]);
  const after = await room.tripadvisorRoom(0);
  assert.equal(before.left - after.left, 4, 'four locations, whatever the row was called');
});

/**
 * Two refreshes of the figures do not collide.
 *
 * Both delete the visible rows and then insert the same keys, so the second
 * failed on a unique violation after its own writes had committed — a 500 on an
 * operation that had worked (Codex, 18 Sep 2026).
 */
test('two refreshes at once both finish, and the figures are whole', async () => {
  const [a, b] = await Promise.all([index.refreshStats(), index.refreshStats()]);
  assert.ok(a.n > 0 && b.n > 0, 'both answered with a count');
  const { rows: [dupes] } = await query(
    `select count(*)::int as n from (
       select area_slug, category, subcategory, source, ownership, count(*)
         from area_stats group by 1,2,3,4,5 having count(*) > 1) d`);
  assert.equal(dupes.n, 0, 'and nothing is in there twice');
});

/**
 * A recalculation is arithmetic, and must not book somebody else's network work.
 *
 * `place_records.enrich_state` defaults to `pending`, and the owned-place loop
 * picks up every pending row and goes off to OpenStreetMap, Nominatim and the
 * encyclopedias. Writing a row to hold a score therefore scheduled research
 * from a button that says "free" (Codex, 18 Sep 2026).
 */
test('a row written to hold a score is not a research job, until somebody claims the place', async () => {
  const ref = 'test:scored-only';
  const scout = await import('../src/repositories/scout.js');
  const owned = await import('../src/repositories/ownedPlaces.js');
  await scout.rescoreOne(ref, 4.2, 4.2);
  const state = async () => (await query('select enrich_state from place_records where venue_ref = $1', [ref])).rows[0]?.enrich_state;
  assert.equal(await state(), 'scored');
  const due = await owned.dueForResearch(200);
  assert.ok(!due.some((r) => r.venue_ref === ref), 'and nothing is queued to go and look');

  // A household touching it is a reason to research it.
  await owned.ensureRecord(ref);
  assert.equal(await state(), 'pending');
});

/**
 * One place harvested twice is still one place.
 *
 * `attractions_venue_idx` is not unique, so a place harvested in two regions is
 * two rows — and a statement cannot touch one primary key twice, so the whole
 * rebuild aborted with "ON CONFLICT DO UPDATE command cannot affect row a
 * second time" (Codex, 18 Sep 2026).
 */
test('a place harvested in two regions rebuilds, and is scored once', async () => {
  const ref = 'osm:way/harvested-twice';
  const { rows: regions } = await query('select slug from regions limit 2');
  const make = async (slug, summary) => query(
    `insert into attractions (name, slug, region_slug, venue_ref, state, lat, lng, summary, first_seen, last_seen)
     values ($1, $2, $3, $4, 'published', 51.5, -0.1, $5, now(), now())`,
    [`Harvested twice`, `twice-${slug}-${Math.random().toString(36).slice(2, 8)}`, slug, ref, summary]);
  await make(regions[0].slug, 'A sentence of ours');
  await make(regions[1].slug, null);

  await index.reindex();
  const { rows } = await query('select count(*)::int as n from place_index where venue_ref = $1', [ref]);
  assert.equal(rows[0].n, 1, 'one row, and the rebuild finished');
  // And one atlas source row, not two — the same key twice would abort the
  // sources pass the same way.
  const { rows: [src] } = await query(
    `select count(*)::int as n from place_index_sources where venue_ref = $1 and source = 'atlas'`, [ref]);
  assert.equal(src.n, 1);

  // Scored once, off one of the two attraction rows rather than whichever the
  // update happened to land on last.
  await query(`update place_index set subcategory = 'museums' where venue_ref = $1`, [ref]);
  await index.rescore({ refs: [ref] });
  const { rows: [scored] } = await query(
    'select count(*)::int as n from place_index where venue_ref = $1 and data_score is not null', [ref]);
  assert.equal(scored.n, 1);
});

/**
 * Retiring one of two attractions that share a reference.
 *
 * "This one is hidden" does not mean "this place is retired": the other one is
 * live, and deleting on the hidden one took the place out of the index — and
 * inside a rebuild it removed a row the very next insert needs, which is a
 * foreign key failure that aborts the whole build (Codex, 18 Sep 2026).
 */
test('a place one hidden and one live attraction share survives the rebuild', async () => {
  const ref = 'osm:way/shared-and-retired';
  const { rows: [region] } = await query('select slug from regions limit 1');
  const make = async (state) => (await query(
    `insert into attractions (name, slug, region_slug, venue_ref, state, lat, lng, summary, first_seen, last_seen)
     values ('Shared and retired', $1, $2, $3, $4, 51.5, -0.1, 'A sentence of ours', now(), now()) returning *`,
    [`shared-${Math.random().toString(36).slice(2, 10)}`, region.slug, ref, state])).rows[0];
  await make('published');
  await make('hidden');

  await index.reindex();
  const { rows: [held] } = await query('select count(*)::int as n from place_index where venue_ref = $1', [ref]);
  assert.equal(held.n, 1, 'the live attraction keeps the place');
  const { rows: [src] } = await query(
    `select count(*)::int as n from place_index_sources where venue_ref = $1 and source = 'atlas'`, [ref]);
  assert.equal(src.n, 1, 'and the atlas is still one of its sources');

  // And retiring it outside a rebuild does not take it either.
  await index.retire();
  const { rows: [after] } = await query('select count(*)::int as n from place_index where venue_ref = $1', [ref]);
  assert.equal(after.n, 1);
});

/**
 * A shelf set by hand outlives a rebuild; its labels are rewritten with
 * everything else's.
 *
 * Leaving hand-shelved places out of the shelving pass after the labels had
 * been deleted meant every rebuild dropped the provider words for exactly the
 * places somebody had corrected (Codex, 18 Sep 2026).
 */
test('a hand-shelved place keeps its shelf and gets its labels back', async () => {
  const ref = 'test:shelved-by-hand';
  const { rows: [region] } = await query('select slug from regions limit 1');
  await query(
    `insert into attractions (name, slug, region_slug, venue_ref, state, lat, lng, category, kinds, first_seen, last_seen)
     values ('Shelved by hand', $1, $2, $3, 'published', 51.5, -0.1, 'museum', '{"museum"}', now(), now())`,
    [`hand-${Math.random().toString(36).slice(2, 10)}`, region.slug, ref]);
  await index.noteMany([{ ref, lat: 51.5, lng: -0.1 }], { source: 'atlas' });
  await query(
    `update place_index set subcategory = 'museums', category = 'culture', derived_by = 'hand' where venue_ref = $1`, [ref]);

  await index.shelveAll({ refs: [ref] });
  const { rows: [after] } = await query(
    'select subcategory, derived_by from place_index where venue_ref = $1', [ref]);
  assert.equal(after.derived_by, 'hand', 'somebody decided this one');
  assert.equal(after.subcategory, 'museums');
  const { rows: [labels] } = await query(
    'select count(*)::int as n from place_index_labels where venue_ref = $1', [ref]);
  assert.ok(labels.n > 0, 'and the words the sources filed it by are back');
});

/**
 * A country we hold places in is a place you can point at.
 *
 * The index files a place under its country code whatever that code is, and the
 * country picker lists localities of kind 'country' — so a place saved abroad
 * got an area row no screen could ever reach (Codex, 18 Sep 2026).
 */
test('a place saved abroad makes its country reachable', async () => {
  const ref = 'test:abroad';
  await index.noteMany([{ ref, lat: 38.7, lng: -9.1, countryCode: 'PT' }], { source: 'own' });
  await index.settleNew({ limit: 500 });
  const { rows: [country] } = await query(
    `select slug, name, kind from localities where slug = 'pt'`);
  assert.equal(country?.kind, 'country');
  assert.equal(country.name, 'Portugal', 'said in words, not left as a code');
  const { rows: [area] } = await query(
    `select count(*)::int as n from place_areas where venue_ref = $1 and area_slug = 'pt'`, [ref]);
  assert.equal(area.n, 1, 'and the place is filed under it');

  // And a place that was already in the index when the level was built — the
  // upgrade case, where nothing is arriving and `settleNew` has nothing to do.
  await query(`delete from localities where slug = 'pt'`);
  await index.reindex();
  const { rows: [again] } = await query(`select name from localities where slug = 'pt'`);
  assert.equal(again?.name, 'Portugal', 'the rebuild knows the whole index and asks for all of them');
});
