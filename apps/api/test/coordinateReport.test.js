/**
 * The read-only coordinate report (owner, 29 Sep 2026): where every place's
 * point comes from, and how many rented points are older than thirty days.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { coordinateReport } = await import('../src/routes/placeIndex.js');

test.after(() => pool.end());

test('files each place under the best point held for it, and counts old rented points', async () => {
  const at = (days) => new Date(Date.now() - days * 86400_000).toISOString();
  await query(
    `insert into place_index (venue_ref, lat, lng, coords_from, coords_at, cell) values
       ('osm:node/1', 51.5, -0.1, 'osm', now(), 'sector:SL5 9'),
       ('google:matched', 51.5, -0.1, 'google', $1, 'sector:SL5 9'),
       ('wikidata:Q1', 51.5, -0.1, 'wikidata', $1, 'sector:TR1 1'),
       ('google:old', 51.5, -0.1, 'google', $1, 'sector:TR1 1'),
       ('google:fresh', 51.5, -0.1, 'google', $2, 'sector:TR1 1'),
       ('google:elsewhere', null, null, null, null, null),
       ('google:nothing', null, null, null, null, null),
       ('google:undated', 51.5, -0.1, null, null, 'sector:TR1 1'),
       ('osm:node/2', 51.5, -0.1, null, null, 'sector:TR1 1')`, [at(45), at(3)]);
  // An atlas row with no reference of its own, indexed as atlas:<id>, and a
  // sweep row the open map matched.
  const { rows: [atl] } = await query(`insert into attractions (region_slug, slug, name, lat, lng) values ('cornwall', 'a-castle', 'A castle', 51.5, -0.1) returning id`);
  await query(`insert into place_index (venue_ref) values ($1), ('google:swept')`, [`atlas:${atl.id}`]);
  // A sweep row the open map matched — with the OSM object's own Wikidata tag.
  await query(`insert into attractions (region_slug, slug, name, lat, lng, venue_ref, osm_ref, wikidata_id, source) values ('cornwall', 'a-pier', 'A pier', 51.5, -0.1, 'google:swept', 'way/5', 'Q5', 'google')`);
  // A sweep row Google named, indexed under atlas:<id> with Google's point;
  // and another provider's point, which is not Google's.
  const { rows: [gs] } = await query(`insert into attractions (region_slug, slug, name, lat, lng, display_source) values ('cornwall', 'a-maze', 'A maze', 51.5, -0.1, 'google') returning id`);
  await query(`insert into place_index (venue_ref, lat, lng, cell) values ($1, 51.5, -0.1, 'sector:TR1 1'), ('tripadvisor:9', 51.5, -0.1, 'sector:TR1 1')`, [`atlas:${gs.id}`]);
  await query(`insert into place_records (venue_ref, lat, lng, osm_ref) values ('google:matched', 51.5, -0.1, 'node/9')`);
  await query(`insert into place_cells (venue_ref, lat, lng, at) values ('google:elsewhere', 51.5, -0.1, $1)`, [at(40)]);
  // A sweep row the open map twinned keeps OSM's point, and is not rented.
  await query(`insert into scout_areas (code, lat, lng) values ('SL5', 51.4, -0.6) on conflict do nothing`);
  await query(`insert into scout_places (area_code, venue_ref, lat, lng, rank, from_sources) values ('SL5', 'google:matched', 51.5, -0.1, 1, '["osm","google"]'), ('SL5', 'google:nothing', 51.5, -0.1, 2, '["google"]')`);

  const r = await coordinateReport();
  assert.equal(r.places.total, 13);
  assert.deepEqual(r.places.owned, { osm: 4, atlas: 2, own: 0 });
  assert.equal(r.places.googleOnly, 6, 'the Google-named atlas row is Google\'s, and so is the sweep row the open map never gave');
  assert.deepEqual(r.places.otherRented, { tripadvisor: 1 });
  assert.equal(r.places.none, 0, 'google:nothing has a rented point in the sweep');
  assert.equal(r.rented.find((x) => x.table === 'scout_places').held, 1, 'only the untwinned row');
  const sp = r.rented.find((x) => x.table === 'scout_places');
  assert.equal(sp.over30Days, null, 'a table that does not date its points cannot say how old they are');
  assert.equal(sp.undated, 1);
  const idx = r.rented.find((x) => x.table === 'place_index');
  assert.equal(idx.held, 5, 'matched, old, fresh, undated, the Google atlas row — Google\'s alone');
  assert.equal(idx.over30Days, 2);
  assert.equal(idx.undated, 2, 'a point with no clock is undated, not old');
  assert.equal(r.rented.find((x) => x.table === 'place_index (other providers)').held, 1, 'tripadvisor on its own line');
  const cells = r.rented.find((x) => x.table === 'place_cells');
  assert.equal(cells.held, 1);
  assert.equal(cells.undated, 1, 'its index point is gone, so its age cannot be told');
  assert.equal(cells.over30Days, 0);
  assert.equal(r.rentedOver30Days, 2);
  assert.equal(r.pointsByTable.place_index.google, 4, 'matched, old, fresh, undated — the raw prefix spread');
  assert.equal(r.pointsByTable.place_cells.google, 1);
  assert.equal(r.pointsByTable.attractions.atlas, 2, 'the castle and the maze, keyed atlas:<id>');
  assert.equal(r.rented.length, 11);
  assert.deepEqual(r.indexOver30DaysByArea, [{ area: 'SL', over30: 1 }, { area: 'TR', over30: 1 }]
    .sort((a, b) => b.over30 - a.over30));
});
