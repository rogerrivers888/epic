/**
 * The three ways a drawer can be empty, and the rule that no count travels
 * without its coverage.
 *
 * These are the two claims §5 and §6 of the big census brief rest on, and both
 * are the kind that fail silently. A drawer nobody ever asked about reads as
 * nought exactly like a drawer Google answered with nothing — and the first is a
 * fault in our taxonomy while the second is a fact about the world. A count
 * printed without its coverage reads as national when it is Berkshire, which is
 * the whole reason the run is being done.
 *
 * The free ground counts are held here too, because the comparison is the easy
 * thing to get wrong: a census count over four hundred tiles set against an
 * open-map count over twelve is not a shortfall, it is a mistake.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const findings = await import('../src/repositories/censusFindings.js');
const ground = await import('../src/sources/groundCounts.js');

test.after(() => pool.end());

/** A subcategory, a tile that covers it, and the places the census found in it. */
async function aCensusedTile({ gridKey, outcodes, subcategory, places = 0, saturated = 0, state = 'done', osmAt = null }) {
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, places, saturated, censused_at, osm_at)
     values ($1, 51.4, -0.2, 51.48, -0.08, $2, $3, $4, $5, now(), $6)
     on conflict (grid_key) do update set outcodes = excluded.outcodes, state = excluded.state,
       places = excluded.places, saturated = excluded.saturated, censused_at = now(), osm_at = excluded.osm_at`,
    [gridKey, outcodes, state, places, saturated, osmAt]);
  for (let i = 0; i < places; i += 1) {
    const ref = `google:${gridKey}_${subcategory}_${i}`;
    await query('insert into place_index (venue_ref) values ($1) on conflict do nothing', [ref]);
    await query(
      `insert into place_subcategories (venue_ref, category, subcategory, area_slug, first_seen, last_seen)
       values ($1, 'activity', $2, $3, now(), now())
       on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do nothing`,
      [ref, subcategory, gridKey]);
  }
}

const aSubcategory = async (key, label, category = 'activity') => query(
  `insert into shelf_subcategories (key, label, category_key, active) values ($1, $2, $3, true)
   on conflict (key) do update set active = true, label = excluded.label`, [key, label, category]);

const aRule = async (subcategory, type) => query(
  `insert into shelf_rules (scope, subject, subject_label, subcategory, labels, taught_by)
   values ('labels', $2, $2, $1, array[$2], 'the tests')`, [subcategory, `google:${type}`]);

// ---------------------------------------------------------------------------
// empty, three ways
// ---------------------------------------------------------------------------

test('a drawer nobody ever asked about is not a drawer with nothing in it', async () => {
  await aSubcategory('test-unasked', 'Test drawer with no question');
  await aSubcategory('test-asked', 'Test drawer with a question');
  await aRule('test-asked', 'test_type_for_findings');
  await aCensusedTile({ gridKey: 'test/findings/1', outcodes: ['ZZ99'], subcategory: 'test-asked', places: 3 });

  const { subcategories } = await findings.subcategories({ outcodes: ['ZZ99'] });
  const unasked = subcategories.find((s) => s.key === 'test-unasked');
  const asked = subcategories.find((s) => s.key === 'test-asked');

  assert.equal(unasked.state, 'never_asked', 'no Google type and no word question means no query was ever generated');
  assert.equal(unasked.censused, 0);
  assert.match(unasked.reason, /no queries/, 'and the row says so in words, rather than reading as an absence of places');

  assert.equal(asked.state, 'censused_found');
  assert.equal(asked.censused, 3);
  assert.equal(asked.questions, 1);
});

test('a drawer whose question no run has asked here is not an empty drawer', async () => {
  await aSubcategory('test-taught-today', 'Test drawer taught this morning');
  await aRule('test-taught-today', 'test_type_taught_today');
  await aCensusedTile({ gridKey: 'test/findings/2', outcodes: ['ZZ98'], subcategory: 'test-other', places: 2 });

  const { subcategories } = await findings.subcategories({ outcodes: ['ZZ98'] });
  const fresh = subcategories.find((s) => s.key === 'test-taught-today');
  assert.equal(fresh.state, 'question_not_run', 'it has a question and nothing has put it yet');
  assert.match(fresh.reason, /nobody has looked/);
  assert.equal(fresh.slices, 0);
});

test('a drawer that was asked here and came back empty says so, with the effort behind it', async () => {
  await aSubcategory('test-empty', 'Test drawer Google had nothing for');
  await aRule('test-empty', 'test_type_empty');
  await aCensusedTile({ gridKey: 'test/findings/2b', outcodes: ['ZZ95'], subcategory: 'test-other', places: 2 });
  await query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests)
     values ('test/findings/2b', 51.4, -0.2, 51.48, -0.08, 'activity', 'test-empty', 'test_type_empty', 'test type empty', 0, 0, false, 0, 1)`);

  const { subcategories } = await findings.subcategories({ outcodes: ['ZZ95'] });
  const empty = subcategories.find((s) => s.key === 'test-empty');
  assert.equal(empty.state, 'censused_empty', 'the question was put here, and it found none');
  assert.equal(empty.slices, 1);
  assert.match(empty.reason, /Either there are none, or the question is the wrong one/);
});

test('a count is never handed over without the coverage it was drawn from', async () => {
  await aCensusedTile({ gridKey: 'test/findings/3', outcodes: ['ZZ97'], subcategory: 'test-asked', places: 4, saturated: 2 });
  const { coverage } = await findings.subcategories({ outcodes: ['ZZ97'] });
  assert.ok(coverage.says.includes('censused'), 'the sentence says when');
  assert.match(coverage.says, /floor, not a total/, 'and says the number is a floor when anything was cut off');
  assert.equal(coverage.complete, false);
});

test('the coverage sentence is written once, and reads as words', () => {
  const clean = findings.coverageSentence({ tiles: 390, done: 390, cutOff: 0, outcodes: 688, lastAt: '2026-09-21T10:00:00Z' });
  // Node says "21 Sept" for en-GB, and that is the date the screen will show.
  assert.equal(clean, `688 districts, censused ${findings.day('2026-09-21T10:00:00Z')}`);
  assert.match(clean, /^688 districts, censused 21 Sept?$/);
  const rough = findings.coverageSentence({ tiles: 390, done: 300, cutOff: 12, outcodes: 688, lastAt: '2026-09-21T10:00:00Z' });
  assert.match(rough, /90 tiles still to do/);
  assert.match(rough, /12 cut off at Google's ceiling/);
  assert.equal(findings.coverageSentence({ tiles: 0, done: 0, cutOff: 0, outcodes: 0, lastAt: null }), 'nowhere censused yet');
});

// ---------------------------------------------------------------------------
// the types that never answer
// ---------------------------------------------------------------------------

test('a type that never returned a place is a finding; a type whose slices all failed is not', async () => {
  const slice = (type, returned, problem) => query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests, problem)
     values ('test/findings/1', 51.4, -0.2, 51.48, -0.08, 'activity', 'test-asked', $1, $1, $2, 0, false, 0, 1, $3)`,
    [type, returned, problem ?? null]);
  await slice('test_never_answers', 0);
  await slice('test_never_answers', 0);
  await slice('test_always_refused', 0, '429 RESOURCE_EXHAUSTED');
  await slice('test_answers', 12);

  const { silent } = await findings.silentTypes({});
  const keys = silent.map((s) => s.type);
  assert.ok(keys.includes('test_never_answers'), 'asked twice, returned nothing, ever');
  assert.ok(!keys.includes('test_always_refused'), 'a slice that failed is not a slice that was empty');
  assert.ok(!keys.includes('test_answers'));
  assert.match(silent.find((s) => s.type === 'test_never_answers').reason, /returned nothing, ever/);
});

// ---------------------------------------------------------------------------
// the free count beside ours
// ---------------------------------------------------------------------------

test('the ground count is compared only over tiles that carry both numbers', async () => {
  await aSubcategory('climbing', 'Climbing & bouldering');
  // One tile checked against the open map, one censused and never checked.
  await aCensusedTile({ gridKey: 'test/ground/checked', outcodes: ['ZZ96'], subcategory: 'climbing', places: 2, osmAt: new Date() });
  await aCensusedTile({ gridKey: 'test/ground/unchecked', outcodes: ['ZZ96'], subcategory: 'climbing', places: 40 });
  await ground.noteGround({ gridKey: 'test/ground/checked', source: 'osm', counts: { climbing: 9 }, asked: { climbing: '["sport"~"climbing"]' } });

  const out = await findings.gaps({ outcodes: ['ZZ96'], source: 'osm' });
  const row = out.gaps.find((g) => g.key === 'climbing');
  assert.equal(row.tiles, 1, 'one tile has both numbers, so one tile is compared');
  assert.equal(row.census, 2, 'and the forty in the unchecked tile are not counted against a ground count nobody took there');
  assert.equal(row.ground, 9);
  assert.equal(row.shortfall, 7);
  assert.match(row.reason, /22% of the ground count/);
  assert.match(row.reason, /as it stands today/, 'the free side says what it is');
  assert.match(row.reason, /found 2 in all/, 'and so does ours');
  assert.match(out.reading, /Neither side is a count of what is there/);
  assert.ok(row.caveat, 'a free count never travels without its caveat');
});

test('a drawer with no free equivalent is not passing the check, it is not taking it', async () => {
  await aSubcategory('karaoke', 'Karaoke', 'fun');
  const out = await findings.gaps({ outcodes: ['ZZ96'], source: 'osm' });
  const row = out.noGroundCount.find((r) => r.key === 'karaoke');
  assert.ok(row, 'karaoke has no OSM tag of its own and is listed as uncheckable');
  assert.match(row.reason, /nothing free to check it against/);
});

test('one Overpass request answers for several drawers, in the order they were asked', async () => {
  const asked = [];
  const counts = [3, 0, 11];
  const ask = async (body) => {
    asked.push(body);
    return { elements: counts.map((total) => ({ type: 'count', tags: { total: String(total) } })) };
  };
  const out = await ground.osmCountsForBox(
    { minLat: 51.4, minLng: -0.2, maxLat: 51.48, maxLng: -0.08 },
    { subcategories: ['climbing', 'marina', 'restaurants'], chunk: 12, ask });
  assert.equal(out.requests, 1, 'three questions, one request');
  assert.equal(asked[0].split('out count').length - 1, 3, 'and three counts in it');
  // In the order asked, which is the order the drawers were given in.
  assert.deepEqual(out.counts, { climbing: 3, marina: 0, restaurants: 11 });
});

test('the register is counted by business type and inside the box, never by the circle around it', () => {
  const points = [
    { lat: 51.44, lng: -0.15, type: 1 },      // a café, inside
    { lat: 51.44, lng: -0.15, type: 7844 },   // a pub, inside
    { lat: 51.44, lng: -0.15, type: 5 },      // a hospital kitchen, inside and not ours
    { lat: 51.90, lng: -0.15, type: 1 },      // a café, outside the box
  ];
  const counts = ground.fhrsCountsInBox(points, { minLat: 51.4, minLng: -0.2, maxLat: 51.48, maxLng: -0.08 });
  assert.equal(counts.restaurants, 1, 'the register does not tell a café from a restaurant, and both are that type');
  assert.equal(counts['pubs-bars'], 1);
  assert.ok(!Object.values(counts).includes(2), 'a hospital kitchen is a real part of the register and no part of ours');
});

test('every ground count is stored with the words it was asked in and the caveat it carries', async () => {
  await ground.noteGround({
    gridKey: 'test/ground/checked', source: 'osm',
    counts: { marina: 4 }, asked: { marina: '["leisure"="marina"]' },
  });
  const { rows } = await query(
    `select places, asked, caveat from ground_counts where grid_key = 'test/ground/checked' and subcategory = 'marina'`);
  assert.equal(rows[0].places, 4);
  assert.equal(rows[0].asked, '["leisure"="marina"]');
  assert.ok(rows[0].caveat, 'a number with no caveat gets read as a target');
});

test('a tile on a boundary is counted by both councils, and by neither twice', async () => {
  const gridKey = 'test/ground/straddles';
  await aCensusedTile({ gridKey, outcodes: ['ZZ94'], subcategory: 'restaurants', places: 0, osmAt: new Date() });
  // Two authorities, each with the half of the tile that is theirs.
  await ground.noteGround({ gridKey, source: 'fhrs', counts: { restaurants: 12 }, from: '501' });
  await ground.noteGround({ gridKey, source: 'fhrs', counts: { restaurants: 9 }, from: '502' });
  let { rows } = await query(
    `select sum(places)::int as places, array_agg(contributor order by contributor) as who
       from ground_counts where grid_key = $1 and source = 'fhrs' and subcategory = 'restaurants'`, [gridKey]);
  assert.equal(rows[0].places, 21, 'both councils — a tile counted by one of its two is an undercount presented as a ground count');
  assert.deepEqual(rows[0].who, ['501', '502'], 'and the working is there: which council counted what');

  // The same download again, because a pass was interrupted and repeated.
  await ground.noteGround({ gridKey, source: 'fhrs', counts: { restaurants: 12 }, from: '501' });
  ({ rows } = await query(
    `select sum(places)::int as places from ground_counts where grid_key = $1 and source = 'fhrs' and subcategory = 'restaurants'`, [gridKey]));
  assert.equal(rows[0].places, 21, 'a council counted again replaces its own row and nobody else\'s, so a repeated pass is safe');

  // And counted again with a different answer, which is what a refresh is.
  await ground.noteGround({ gridKey, source: 'fhrs', counts: { restaurants: 15 }, from: '501' });
  ({ rows } = await query(
    `select sum(places)::int as places from ground_counts where grid_key = $1 and source = 'fhrs' and subcategory = 'restaurants'`, [gridKey]));
  assert.equal(rows[0].places, 24, 'a month later the council has three more, and the tile says 24 rather than 36');

  // The open map has no boundary problem: Overpass answers about the box, so a
  // re-count replaces and the number can go down as well as up.
  await ground.noteGround({ gridKey, source: 'osm', counts: { restaurants: 30 } });
  await ground.noteGround({ gridKey, source: 'osm', counts: { restaurants: 28 } });
  ({ rows } = await query(
    `select sum(places)::int as places from ground_counts where grid_key = $1 and source = 'osm' and subcategory = 'restaurants'`, [gridKey]));
  assert.equal(rows[0].places, 28, 'a re-count is the same ground measured later, not more ground');
});

test('a tile is dated only when every council that shares it has been counted', async () => {
  // Codex, 21 Sep 2026: the first council to contribute was ending the tile, so
  // a boundary tile kept half its kitchens and read as finished. The region is
  // 455 tiles of about 8.9 km and most London boroughs are smaller than that,
  // so this is the common case in exactly the place the census is densest.
  const gridKey = 'test/ground/two-councils';
  await aCensusedTile({ gridKey, outcodes: ['ZZ93'], subcategory: 'restaurants', places: 0 });
  await query(`update census_tiles set fhrs_at = null, fhrs_authorities = null where grid_key = $1`, [gridKey]);
  await query(`delete from ground_counts where grid_key = $1`, [gridKey]);

  // A tile shared by two boroughs: one with two kitchens in it, one with none —
  // a council that contributes nought has still contributed, and a tile that
  // did not record that would wait for it for ever.
  const register = {
    authorities: async () => new Map([['501', { id: 501, name: 'Borough one' }], ['502', { id: 502, name: 'Borough two' }]]),
    councilsFor: async () => [{ code: '501', name: 'Borough one' }, { code: '502', name: 'Borough two' }],
    points: async (id) => ({ points: id === 501
      ? [{ lat: 51.44, lng: -0.15, type: 1 }, { lat: 51.44, lng: -0.15, type: 7844 }]
      : [{ lat: 52.90, lng: -0.15, type: 1 }] }),
  };

  const first = await ground.sweepFhrs({ authorities: 1, register });
  assert.equal(first.authorities, 1);
  let { rows } = await query(`select fhrs_at, fhrs_authorities from census_tiles where grid_key = $1`, [gridKey]);
  assert.equal(rows[0].fhrs_at, null, 'one council of two is not a counted tile');
  assert.deepEqual(rows[0].fhrs_authorities.sort(), ['501', '502'], 'and the tile says which two it is made of');

  const second = await ground.sweepFhrs({ authorities: 1, register });
  assert.equal(second.authorities, 1, 'the tile is still in the sweep, waiting on its neighbour');
  ({ rows } = await query(`select fhrs_at from census_tiles where grid_key = $1`, [gridKey]));
  assert.ok(rows[0].fhrs_at, 'and is dated once both have been counted');

  const contributors = await ground.contributorsTo(gridKey);
  assert.deepEqual([...contributors].sort(), ['501', '502']);
  ({ rows } = await query(
    `select sum(places)::int as places from ground_counts where grid_key = $1 and source = 'fhrs' and subcategory = 'restaurants'`, [gridKey]));
  assert.equal(rows[0].places, 1, "the first borough's café; the second's is outside the box");

  // And a later pass never counts either of them again. (It may well pick up
  // another tile — there are others in this database — but this one is done.)
  await ground.sweepFhrs({ authorities: 1, register });
  ({ rows } = await query(
    `select sum(places)::int as places from ground_counts where grid_key = $1 and source = 'fhrs' and subcategory = 'restaurants'`, [gridKey]));
  assert.equal(rows[0].places, 1, 'a council already counted adds nothing');
});

test('a ground count a month old is counted again, not simply re-dated', async () => {
  // Codex, 21 Sep 2026: a stale tile still held every council from the last
  // sweep, so the loop found nothing missing, dated it and downloaded nothing —
  // and a ground count could never change after its first pass. A stale tile is
  // treated as holding nothing, because each council replaces its own row.
  const gridKey = 'test/ground/stale';
  await aCensusedTile({ gridKey, outcodes: ['ZZ92'], subcategory: 'restaurants', places: 0 });
  await query(
    `update census_tiles set fhrs_authorities = array['601'], fhrs_at = now() - interval '40 days' where grid_key = $1`,
    [gridKey]);
  await query(`delete from ground_counts where grid_key = $1`, [gridKey]);
  await ground.noteGround({ gridKey, source: 'fhrs', counts: { restaurants: 4 }, from: '601' });

  let downloads = 0;
  const register = {
    authorities: async () => new Map([['601', { id: 601, name: 'A borough that has grown' }]]),
    councilsFor: async () => [{ code: '601', name: 'A borough that has grown' }],
    points: async () => {
      downloads += 1;
      // Two more kitchens than last month.
      return { points: [1, 2, 3, 4, 5, 6].map(() => ({ lat: 51.44, lng: -0.15, type: 1 })) };
    },
  };

  await ground.sweepFhrs({ authorities: 1, register });
  assert.equal(downloads, 1, 'the council is asked again rather than taken on trust');
  const { rows } = await query(
    `select sum(places)::int as places from ground_counts where grid_key = $1 and source = 'fhrs' and subcategory = 'restaurants'`,
    [gridKey]);
  assert.equal(rows[0].places, 6, 'and the number moves — it is not 4, and it is not 10');
  const { rows: tile } = await query(`select fhrs_at from census_tiles where grid_key = $1`, [gridKey]);
  assert.ok(new Date(tile[0].fhrs_at).getTime() > Date.now() - 60_000, 'dated today, on the strength of a count taken today');
});

test('a refusal from the register ends the pass, not the process', async () => {
  // It answered 403 the first time a sweep asked it six times in a few seconds
  // (21 Sep 2026), and the throw came out of the pass and killed it. A free
  // service with no key and no published limit gets spacing and, once it says
  // no, ten minutes off.
  const gridKey = 'test/ground/refused';
  await aCensusedTile({ gridKey, outcodes: ['ZZ91'], subcategory: 'restaurants', places: 0 });
  await query(`update census_tiles set fhrs_at = null, fhrs_authorities = null where grid_key = $1`, [gridKey]);

  const register = {
    authorities: async () => new Map([['701', { id: 701, name: 'A borough' }]]),
    councilsFor: async () => { throw Object.assign(new Error('FHRS 403'), { status: 403 }); },
    points: async () => ({ points: [] }),
  };
  const out = await ground.sweepFhrs({ authorities: 1, register });
  assert.equal(out.authorities, 0);
  assert.ok(out.problems.some((p) => p.includes('403')), 'the reason is on the record rather than in a stack trace');

  const { rows } = await query(`select fhrs_at from census_tiles where grid_key = $1`, [gridKey]);
  assert.equal(rows[0].fhrs_at, null, 'and the tile is not dated on the strength of a refusal');
});

test('a count found by plain words says so, because nothing checked the kind', async () => {
  // Owner, 21 Sep 2026: a text-sourced count has to say so, so twenty can be
  // opened in Places and the precision judged before the number is trusted.
  // Nine drawers have no Table A type at all and are asked in plain words.
  await aSubcategory('test-by-words', 'Test drawer with no Google word');
  await aRule('test-by-words', 'test_type_words');
  await aCensusedTile({ gridKey: 'test/findings/text', outcodes: ['ZZ90'], subcategory: 'test-by-words', places: 3 });
  await query(
    `update place_subcategories set sourced = 'text' where area_slug = 'test/findings/text' and subcategory = 'test-by-words'`);
  await query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests)
     values ('test/findings/text', 51.4, -0.2, 51.48, -0.08, 'activity', 'test-by-words', null, 'historic house', 3, 3, false, 0, 1)`);

  const { subcategories } = await findings.subcategories({ outcodes: ['ZZ90'] });
  const row = subcategories.find((s) => s.key === 'test-by-words');
  assert.equal(row.censused, 3);
  assert.equal(row.byText, 3);
  assert.match(row.reason, /plain text query with no type to fence it/);
  assert.match(row.reason, /open a few before trusting the number/);
});

test('a drawer created after a tile was counted is still counted', async () => {
  // epic-71, 21 Sep 2026: "a tile asked 'have you been counted?' is a tile that
  // answers yes for ever, and the taxonomy is being rewritten underneath this."
  // Landmarks & monuments was split into two drawers in an afternoon; the new
  // one had no ground count and no way of asking for one until the whole tile
  // went stale a month later.
  const gridKey = 'test/ground/new-drawer';
  await aCensusedTile({ gridKey, outcodes: ['ZZ89'], subcategory: 'marina', places: 0 });
  await query(`update census_tiles set osm_at = now() where grid_key = $1`, [gridKey]);
  await query(`delete from ground_counts where grid_key = $1`, [gridKey]);
  // Counted for one drawer only, as a sweep before the split would have left it.
  await ground.noteGround({ gridKey, source: 'osm', counts: { marina: 4 } });
  await aSubcategory('golf', 'Golf clubs', 'sport');

  const ask = async (body) => ({
    elements: Array.from({ length: body.split('out count').length - 1 }, () => ({ type: 'count', tags: { total: '9' } })),
  });
  // The sweep is given the one tile and has to work out what it is short of.
  const out = await ground.sweepOsm({ limit: 50, msBudget: 20_000, ask });
  assert.ok(out.tiles >= 1);
  const { rows } = await query(
    `select subcategory, places from ground_counts where grid_key = $1 and source = 'osm' order by subcategory`, [gridKey]);
  const golf = rows.find((r) => r.subcategory === 'golf');
  assert.ok(golf, 'the drawer that did not exist when the tile was counted has a count now');
  assert.equal(rows.find((r) => r.subcategory === 'marina').places, 4, 'and the drawer that was already counted was not asked again');
});

test('a ground count nobody has refreshed does not pass itself off as this morning’s', async () => {
  // The same fault as the sweep's, in the reader: a sum is only as fresh as its
  // stalest part, and "as it stands today" over a month-old component is how a
  // number nobody has checked reads as agreement (owner, 21 Sep 2026).
  const gridKey = 'test/ground/old-number';
  await aSubcategory('marina', 'Marina', 'outdoors');
  await aCensusedTile({ gridKey, outcodes: ['ZZ88'], subcategory: 'marina', places: 2, osmAt: new Date() });
  await query(`delete from ground_counts where grid_key = $1`, [gridKey]);
  await ground.noteGround({ gridKey, source: 'osm', counts: { marina: 9 } });
  await query(
    `update ground_counts set counted_at = now() - interval '45 days' where grid_key = $1`, [gridKey]);

  const out = await findings.gaps({ outcodes: ['ZZ88'], source: 'osm' });
  const row = out.gaps.find((g) => g.key === 'marina');
  assert.equal(row.stale, true);
  assert.match(row.reason, /as it was counted on/, 'it names the day rather than claiming today');
  assert.doesNotMatch(row.reason, /as it stands today/);

  // And once it is counted again, it speaks in the present tense.
  await ground.noteGround({ gridKey, source: 'osm', counts: { marina: 11 } });
  const fresh = await findings.gaps({ outcodes: ['ZZ88'], source: 'osm' });
  const now = fresh.gaps.find((g) => g.key === 'marina');
  assert.equal(now.stale, false);
  assert.match(now.reason, /as it stands today/);
  assert.equal(now.ground, 11);
});

test('a drawer asked two different ways is a sum, not a denominator', async () => {
  // epic-71, 21 Sep 2026: a tile is re-opened when the plan gains a drawer, not
  // when a drawer gains a question. So four subcategories asked in plain words
  // today would keep those answers in every tile already done if somebody
  // taught them a Google type tomorrow. This file cannot fix that and must not
  // hide it: a count summed over tiles asked different questions is not one
  // number.
  await aSubcategory('test-two-ways', 'Test drawer asked two ways');
  await aRule('test-two-ways', 'test_type_two_ways');
  await aCensusedTile({ gridKey: 'test/two-ways/a', outcodes: ['ZZ87'], subcategory: 'test-two-ways', places: 2 });
  await aCensusedTile({ gridKey: 'test/two-ways/b', outcodes: ['ZZ87'], subcategory: 'test-two-ways', places: 3 });
  const slice = (area, type, q, ago, problem = null) => query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests, problem, ran_at)
     values ($1, 51.4, -0.2, 51.48, -0.08, 'activity', 'test-two-ways', $2, $3, 2, 2, false, 0, 1, $5,
             now() - ($4 || ' hours')::interval)`,
    [area, type, q, String(ago), problem]);

  // The first tile, censused before anybody taught the drawer a Google type.
  await slice('test/two-ways/a', null, 'somewhere to do the thing', 3);
  // The second, censused after — with the old question and the new one.
  await slice('test/two-ways/b', null, 'somewhere to do the thing', 1);
  await slice('test/two-ways/b', 'test_type_two_ways', 'test type two ways', 1);

  const { subcategories } = await findings.subcategories({ outcodes: ['ZZ87'] });
  const row = subcategories.find((s) => s.key === 'test-two-ways');
  assert.equal(row.askedDifferently, 1, 'one tile is behind the plan');
  assert.match(row.reason, /censused before 1 of this drawer.s question/);
  assert.match(row.reason, /not yet a denominator/);

  // And a drawer asked the same way everywhere says nothing about it.
  const clean = subcategories.find((s) => s.key === 'test-asked');
  assert.equal(clean.askedDifferently, 0);
  assert.doesNotMatch(clean.reason, /more than one question/);
});

test('a tile cut short by a quota is coverage, not a different question', async () => {
  // Codex, 21 Sep 2026: filtering out the failed slice left those tiles with a
  // smaller signature, so a quota refusal read as a change of plan — and would
  // have fired the warning across half the region the morning after a cap was
  // hit. The question was asked; it was refused.
  await aSubcategory('test-cut-short', 'Test drawer cut short in one tile');
  await aRule('test-cut-short', 'test_type_cut_short');
  await aCensusedTile({ gridKey: 'test/cut/a', outcodes: ['ZZ86'], subcategory: 'test-cut-short', places: 2 });
  await aCensusedTile({ gridKey: 'test/cut/b', outcodes: ['ZZ86'], subcategory: 'test-cut-short', places: 0 });
  const slice = (area, type, q, ago, returned, problem = null) => query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests, problem, ran_at)
     values ($1, 51.4, -0.2, 51.48, -0.08, 'activity', 'test-cut-short', $2, $3, $5, 0, false, 0, 1, $6,
             now() - ($4 || ' hours')::interval)`,
    [area, type, q, String(ago), returned, problem]);

  await slice('test/cut/a', 'test_type_cut_short', 'a', 3, 2);
  await slice('test/cut/a', 'test_type_cut_short_two', 'b', 3, 1);
  // The later tile asked both and had one refused by the quota.
  await slice('test/cut/b', 'test_type_cut_short', 'a', 1, 0, '429 RESOURCE_EXHAUSTED');
  await slice('test/cut/b', 'test_type_cut_short_two', 'b', 1, 0, '429 RESOURCE_EXHAUSTED');

  const { subcategories } = await findings.subcategories({ outcodes: ['ZZ86'] });
  const row = subcategories.find((s) => s.key === 'test-cut-short');
  assert.equal(row.askedDifferently, 0, 'a refused question is still a question that was asked');
});

test('two tiles asked the same type with different words are not the same question', async () => {
  // Codex, 21 Sep 2026: keyed on the type alone, "sports_activity_location +
  // climbing wall" and "sports_activity_location + bouldering centre" had the
  // same signature — and those are exactly the drawers Google has no word for,
  // which is where the risk lives.
  await aSubcategory('test-same-type', 'Test drawer fenced two ways');
  await aRule('test-same-type', 'sports_activity_location');
  await aCensusedTile({ gridKey: 'test/words/a', outcodes: ['ZZ85'], subcategory: 'test-same-type', places: 1 });
  await aCensusedTile({ gridKey: 'test/words/b', outcodes: ['ZZ85'], subcategory: 'test-same-type', places: 1 });
  const slice = (area, q, ago) => query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests, ran_at)
     values ($1, 51.4, -0.2, 51.48, -0.08, 'activity', 'test-same-type', 'sports_activity_location', $2, 1, 1, false, 0, 1,
             now() - ($3 || ' hours')::interval)`,
    [area, q, String(ago)]);
  await slice('test/words/a', 'climbing wall', 3);
  await slice('test/words/b', 'climbing wall', 1);
  await slice('test/words/b', 'bouldering centre', 1);

  const { subcategories } = await findings.subcategories({ outcodes: ['ZZ85'] });
  const row = subcategories.find((s) => s.key === 'test-same-type');
  assert.equal(row.askedDifferently, 1, 'the words are part of the question');
});

test('a count taken by asking something else is not an answer to this question', async () => {
  // The ground count does not go stale because *our Google question* changed —
  // the open map is answering "what is in this box", and that is the same
  // question whatever we ask Google. What does invalidate it is our own
  // selectors changing, and no date can tell those apart. So the row says what
  // it asked, and the sweep compares it with what it would ask now.
  const gridKey = 'test/ground/other-question';
  await aSubcategory('golf', 'Golf clubs', 'sport');
  await aCensusedTile({ gridKey, outcodes: ['ZZ84'], subcategory: 'golf', places: 1 });
  await query(`delete from ground_counts where grid_key = $1`, [gridKey]);
  // Counted today, but by asking something this file no longer asks.
  await query(
    `insert into ground_counts (grid_key, source, subcategory, places, asked, contributor)
     values ($1, 'osm', 'golf', 4, '["leisure"="golf"]', 'box')`, [gridKey]);

  // One count per output statement, the way Overpass answers — the sweep asks
  // for every drawer this tile is short of, not only the one under test.
  const ask = async (body) => ({
    elements: Array.from({ length: body.split('out count').length - 1 }, () => ({ type: 'count', tags: { total: '9' } })),
  });
  await ground.sweepOsm({ limit: 50, msBudget: 20_000, ask });

  const { rows } = await query(
    `select places, asked from ground_counts where grid_key = $1 and subcategory = 'golf'`, [gridKey]);
  assert.equal(rows[0].places, 9, 'counted again, because the old row answers a question nobody is asking');
  assert.equal(rows[0].asked, ground.OSM_GROUND.golf.selectors.join(' '), 'and it now says what was actually asked');
});
