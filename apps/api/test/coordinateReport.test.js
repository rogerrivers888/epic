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

// The fixtures stand for rows written before migration 307, whose trigger now
// refuses a rented point on the way in: they are written with it paused.
const TRIGGERED = ['household_places', 'trip_shortlist', 'trip_stops', 'visits', 'scout_places', 'attractions', 'place_records'];
const setTriggers = (on) => query(`do $$ declare t text; begin
  foreach t in array array['${TRIGGERED.join("','")}'] loop
    if exists (select 1 from pg_trigger where tgname = 'keep_owned_point' and tgrelid = t::regclass) then
      execute format('alter table %I ${on ? 'enable' : 'disable'} trigger keep_owned_point', t);
    end if;
  end loop; end $$`);

test('files each place under the best point held for it, and counts old rented points', async () => {
  await setTriggers(false);
  try {
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
  // A saved copy of it, too.
  const { rows: [hh] } = await query(`insert into households (name) values ('Report test') returning id`);
  // A cell stamped from a Google-named atlas row, under its atlas reference.
  const { rows: [gz] } = await query(`insert into attractions (region_slug, slug, name, lat, lng, display_source) values ('cornwall', 'a-zoo-cell', '(zoo)', 51.5, -0.1, 'google') returning id`);
  await query(`insert into place_cells (venue_ref, lat, lng, at) values ($1, 51.5, -0.1, now())`, [`atlas:${gz.id}`]);
  await query(`insert into household_places (household_id, venue_ref, label, lat, lng) values ($1, $2, 'The zoo', 51.5, -0.1)`, [hh.id, `atlas:${gz.id}`]);
  // A household's own pin on a photo place, held only on the saved row.
  const pin = `photo:${Date.now()}`;
  await query(`insert into place_index (venue_ref) values ($1)`, [pin]);
  await query(`insert into household_places (household_id, venue_ref, label, lat, lng) values ($1, $2, 'Our spot', 51.6, -0.2)`, [hh.id, pin]);
  // A sweep row the open map twinned keeps OSM's point, and is not rented.
  await query(`insert into scout_areas (code, lat, lng) values ('SL5', 51.4, -0.6) on conflict do nothing`);
  await query(`insert into scout_places (area_code, venue_ref, lat, lng, rank, from_sources) values ('SL5', 'google:matched', 51.5, -0.1, 1, '["osm","google"]'), ('SL5', 'google:nothing', 51.5, -0.1, 2, '["google"]')`);

  const r = await coordinateReport();
  assert.equal(r.places.total, 14);
  assert.deepEqual(r.places.owned, { osm: 4, atlas: 2, own: 1 }, 'the photo pin is the household\'s own');
  assert.equal(r.places.googleOnly, 6, 'the Google-named atlas row is Google\'s, and so is the sweep row the open map never gave');
  assert.deepEqual(r.places.otherRented, { tripadvisor: 1 });
  assert.equal(r.places.none, 0, 'google:nothing has a rented point in the sweep');
  assert.equal(r.rented.find((x) => x.table === 'scout_places').held, 1, 'only the untwinned row');
  const sp = r.rented.find((x) => x.table === 'scout_places');
  assert.equal(sp.over30Days, null, 'a table that does not date its points cannot say how old they are');
  assert.equal(sp.undated, 1);
  const idx = r.rented.find((x) => x.table === 'place_index');
  // google:matched's point is its OSM-matched record's point exactly: the open
  // map's, whatever the index's label said.
  assert.equal(idx.held, 4, 'old, fresh, undated, the Google atlas row — Google\'s alone');
  assert.equal(idx.over30Days, 1);
  assert.equal(idx.undated, 2, 'a point with no clock is undated, not old');
  assert.equal(r.rented.find((x) => x.table === 'place_index (other providers)').held, 1, 'tripadvisor on its own line');
  // A saved copy of the Google-named zoo, under its atlas reference, is Google's.
  const hp = r.rented.find((x) => x.table === 'household_places');
  assert.equal(hp.held, 1);
  const cells = r.rented.find((x) => x.table === 'place_cells');
  assert.equal(cells.held, 2, 'google:elsewhere, and the atlas row Google named');
  assert.equal(cells.over30Days, 1, 'google:elsewhere was stamped forty days ago: its point is at least that old');
  assert.equal(cells.undated, 1, 'the zoo\'s was stamped today, and its point may be older or not');
  assert.equal(r.rentedOver30Days, 2);
  assert.equal(r.pointsByTable.place_index.google, 4, 'matched, old, fresh, undated — the raw prefix spread');
  assert.equal(r.pointsByTable.place_cells.google, 1);
  assert.equal(r.pointsByTable.attractions.atlas, 3, 'the castle, the maze and the zoo, keyed atlas:<id>');
  assert.equal(r.rented.length, 11);
  assert.deepEqual(r.indexGoogleOver30DaysByArea, [{ area: 'TR', over30: 1 }], 'SL\'s was the open map\'s point');
  } finally { await setTriggers(true); }
});
