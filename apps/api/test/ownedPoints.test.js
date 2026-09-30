/**
 * A point is owned or it is not kept (owner, C59, 30 Sep 2026): the four holes
 * and the fifth, closed at the one door every writer passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const owned = await import('../src/sources/ownedPoints.js');

test.after(() => pool.end());

const household = async () => {
  const { rows: [h] } = await query(`insert into households (name) values ('Points test') returning id`);
  return h.id;
};
const saved = async (hh, ref, lat, lng) => {
  await query(`insert into household_places (household_id, venue_ref, label, lat, lng) values ($1, $2, $2, $3, $4)`, [hh, ref, lat, lng]);
  return (await query('select lat, lng, point_from from household_places where household_id = $1 and venue_ref = $2', [hh, ref])).rows[0];
};

test('the lists in code are the database\'s own', async () => {
  const { rows: [r] } = await query('select epic_owned_sources() as owned, epic_rented_sources() as rented');
  assert.deepEqual(r.owned, owned.OWNED_SOURCES);
  assert.deepEqual(r.rented, owned.RENTED_SOURCES);
});

test('a saved Google place keeps no Google point: its census box, or nothing', async () => {
  const hh = await household();
  const bare = await saved(hh, `google:bare-${randomUUID()}`, 51.5, -0.1);
  assert.deepEqual(bare, { lat: null, lng: null, point_from: null });

  const boxed = `google:boxed-${randomUUID()}`;
  await query(`insert into place_index (venue_ref, slice) values ($1, '51.40,-0.62,51.48,-0.50')`, [boxed]);
  const b = await saved(hh, boxed, 51.4123, -0.6011);
  assert.equal(b.point_from, 'census-box');
  assert.ok(Math.abs(b.lat - 51.44) < 1e-9 && Math.abs(b.lng + 0.56) < 1e-9, 'the centre of the box');
});

test('an open-map place, a household pin and a fixture keep their own points', async () => {
  const hh = await household();
  assert.equal((await saved(hh, `osm:node/${Date.now()}`, 51.5, -0.1)).point_from, 'osm');
  assert.equal((await saved(hh, `photo:${randomUUID()}`, 51.5, -0.1)).point_from, 'household');
  assert.equal((await saved(hh, `fixtures:${randomUUID()}`, 51.5, -0.1)).point_from, 'fixtures');
});

test('an owned point lands, and every copy of the place picks it up', async () => {
  const hh = await household();
  const ref = `google:owned-${randomUUID()}`;
  await query(`insert into place_index (venue_ref, lat, lng, coords_from, coords_at, slice) values ($1, 51.5, -0.1, 'google', now(), '51.40,-0.62,51.48,-0.50')`, [ref]);
  assert.equal((await saved(hh, ref, 51.5, -0.1)).point_from, 'census-box');
  const out = await owned.recordOwnedPoint({ ref, lat: 51.4561, lng: -0.5992, source: 'fsa', sourceRef: '315433', method: 'name+distance', distanceM: 12 });
  assert.equal(out.written, true);
  const hp = (await query('select lat, lng, point_from from household_places where venue_ref = $1', [ref])).rows[0];
  assert.deepEqual(hp, { lat: 51.4561, lng: -0.5992, point_from: 'fsa' });
  const pi = (await query('select lat, lng, coords_from from place_index where venue_ref = $1', [ref])).rows[0];
  assert.deepEqual(pi, { lat: 51.4561, lng: -0.5992, coords_from: 'fsa' });
  const op = (await query('select licence, source_ref from owned_points where venue_ref = $1', [ref])).rows[0];
  assert.deepEqual(op, { licence: 'OGL-UK-3.0', source_ref: '315433' });

  // A later write of Google's point does not displace it.
  await query('update household_places set lat = 51.5, lng = -0.1 where venue_ref = $1', [ref]);
  assert.equal((await query('select point_from from household_places where venue_ref = $1', [ref])).rows[0].point_from, 'fsa');

  // A worse source does not replace a better one; a better one does.
  assert.equal((await owned.recordOwnedPoint({ ref, lat: 51.45, lng: -0.59, source: 'osm', method: 'name+distance' })).written, false);
  assert.equal((await owned.recordOwnedPoint({ ref, lat: 51.4562, lng: -0.5993, source: 'wikidata', sourceRef: 'Q1', method: 'reference' })).written, true);
});

test('a sweep row the open map never gave keeps neither Google\'s point nor its name', async () => {
  await query(`insert into scout_areas (code, lat, lng) values ('ZZ9', 51.4, -0.6) on conflict do nothing`);
  const g = `google:swept-${randomUUID()}`;
  const o = `google:twin-${randomUUID()}`;
  await query(`insert into scout_places (area_code, venue_ref, name, rank, lat, lng, from_sources) values
    ('ZZ9', $1, 'Google''s name', 1, 51.5, -0.1, '["google"]'), ('ZZ9', $2, 'The Open Map''s', 2, 51.5, -0.1, '["osm","google"]')`, [g, o]);
  const rows = (await query('select venue_ref, name, lat, point_from from scout_places where venue_ref = any($1)', [[g, o]])).rows;
  assert.deepEqual(rows.find((r) => r.venue_ref === g), { venue_ref: g, name: null, lat: null, point_from: null });
  assert.deepEqual(rows.find((r) => r.venue_ref === o), { venue_ref: o, name: 'The Open Map\'s', lat: 51.5, point_from: 'osm' });
});

test('the activity sweep\'s unmatched Google row keeps no point; a matched one keeps OSM\'s', async () => {
  const { rows: [a] } = await query(
    `insert into attractions (region_slug, slug, name, lat, lng, source, display_source) values ('cornwall', $1, '(zoo)', 51.5, -0.1, 'google', 'google') returning lat, point_from`, [`g-${randomUUID()}`]);
  assert.deepEqual(a, { lat: null, point_from: null });
  const { rows: [m] } = await query(
    `insert into attractions (region_slug, slug, name, lat, lng, source, osm_ref) values ('cornwall', $1, 'A zoo', 51.5, -0.1, 'google', 'way/9') returning lat, point_from`, [`m-${randomUUID()}`]);
  assert.deepEqual(m, { lat: 51.5, point_from: 'osm' });
  const { rows: [w] } = await query(
    `insert into attractions (region_slug, slug, name, lat, lng, wikidata_id) values ('cornwall', $1, 'A castle', 51.5, -0.1, 'Q9') returning point_from`, [`w-${randomUUID()}`]);
  assert.equal(w.point_from, 'atlas');
});

test('the fifth hole: looking inside a Google place writes neither its name nor its point', async () => {
  const { markResearching } = await import('../src/repositories/placeContents.js');
  const g = `google:inside-${randomUUID()}`;
  await markResearching(g, 'Google\'s name for it', 51.5, -0.1);
  assert.deepEqual((await query('select name, lat, lng from place_records where venue_ref = $1', [g])).rows[0], { name: null, lat: null, lng: null });
  const w = `wikidata:Q${Date.now()}`;
  await markResearching(w, 'Its Wikidata label', 51.5, -0.1);
  assert.deepEqual((await query('select name, lat from place_records where venue_ref = $1', [w])).rows[0], { name: 'Its Wikidata label', lat: 51.5 });
});

test('the index records the point\'s true source, not its reference\'s', async () => {
  const index = await import('../src/repositories/placeIndex.js');
  const twin = `google:twin-idx-${randomUUID()}`;
  const pin = `photo:${randomUUID()}`;
  await index.noteMany([{ ref: twin, lat: 51.5, lng: -0.1, coordsFrom: 'osm' }, { ref: pin, lat: 51.5, lng: -0.1 }]);
  const rows = (await query('select venue_ref, coords_from from place_index where venue_ref = any($1)', [[twin, pin]])).rows;
  assert.equal(rows.find((r) => r.venue_ref === twin).coords_from, 'osm');
  assert.equal(rows.find((r) => r.venue_ref === pin).coords_from, 'household');
});

test('the expiry keeps Wikidata\'s point and every other owned source', async () => {
  const { expireRentedCoordinates } = await import('../src/sources/census.js');
  const w = `wikidata:Q${Date.now()}9`;
  const g = `google:old-${randomUUID()}`;
  await query(`insert into place_index (venue_ref, lat, lng, coords_from, coords_at) values
    ($1, 51.5, -0.1, 'wikidata', now() - interval '40 days'), ($2, 51.5, -0.1, 'google', now() - interval '40 days')`, [w, g]);
  await expireRentedCoordinates();
  const rows = (await query('select venue_ref, lat from place_index where venue_ref = any($1)', [[w, g]])).rows;
  assert.equal(rows.find((r) => r.venue_ref === w).lat, 51.5);
  assert.equal(rows.find((r) => r.venue_ref === g).lat, null);
});

test('the ring re-stamp never picks up a rented copy', async () => {
  await query(`insert into scout_areas (code, lat, lng) values ('ZZ9', 51.4, -0.6) on conflict do nothing`);
  const g = `google:restamp-${randomUUID()}`;
  // A legacy row written before the trigger existed, as the purge will find them.
  await query('alter table scout_places disable trigger keep_owned_point');
  try {
    await query(`insert into scout_places (area_code, venue_ref, rank, lat, lng, from_sources) values ('ZZ9', $1, 1, 51.5, -0.1, '["google"]')`, [g]);
  } finally {
    await query('alter table scout_places enable trigger keep_owned_point');
  }
  const reach = await import('../src/repositories/reach.js');
  const seen = await reach.unstamped(100000);
  assert.ok(!seen.some((r) => r.ref === g), 'a Google-only sweep point is not stamped');
});

test('a copy of Google\'s point written before the trigger is never read back once the index\'s has gone', async () => {
  const hh = await household();
  const ref = `google:legacy-${randomUUID()}`;
  await query('alter table household_places disable trigger keep_owned_point');
  try {
    await query(`insert into household_places (household_id, venue_ref, label, lat, lng) values ($1, $2, $2, 51.5, -0.1)`, [hh, ref]);
  } finally { await query('alter table household_places enable trigger keep_owned_point'); }
  const read = async () => (await query('select epic_point_lat(venue_ref, lat, point_from) as lat from household_places where venue_ref = $1', [ref])).rows[0].lat;
  assert.equal(await read(), null, 'no index point, and the legacy copy is not read');
  await query(`insert into place_index (venue_ref, lat, lng, coords_from, coords_at) values ($1, 51.51, -0.11, 'google', now())`, [ref]);
  assert.equal(await read(), 51.51, 'the index\'s current point, while it holds one');
  // An open-map place's own unlabelled point is still read.
  const osm = `osm:node/${Date.now()}1`;
  await query('alter table household_places disable trigger keep_owned_point');
  try {
    await query(`insert into household_places (household_id, venue_ref, label, lat, lng) values ($1, $2, $2, 51.6, -0.2)`, [hh, osm]);
  } finally { await query('alter table household_places enable trigger keep_owned_point'); }
  assert.equal((await query('select epic_point_lat(venue_ref, lat, point_from) as lat from household_places where venue_ref = $1', [osm])).rows[0].lat, 51.6);
});

test('looking inside a Google place again clears a Google name an earlier look wrote', async () => {
  const { markResearching } = await import('../src/repositories/placeContents.js');
  const g = `google:inside-again-${randomUUID()}`;
  await query('alter table place_records disable trigger keep_owned_point');
  try {
    await query(`insert into place_records (venue_ref, name) values ($1, 'Google''s name')`, [g]);
  } finally { await query('alter table place_records enable trigger keep_owned_point'); }
  await markResearching(g, 'Google\'s name', 51.5, -0.1);
  assert.equal((await query('select name from place_records where venue_ref = $1', [g])).rows[0].name, null);
  // One our research composed from the open map stays.
  const o = `google:inside-owned-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'The Open Map''s', '{"name":"osm"}')`, [o]);
  await markResearching(o, 'Google\'s name', 51.5, -0.1);
  assert.equal((await query('select name from place_records where venue_ref = $1', [o])).rows[0].name, 'The Open Map\'s');
});

test('half a point is no point', async () => {
  const hh = await household();
  const r = await saved(hh, `osm:node/${Date.now()}2`, 51.5, null);
  assert.deepEqual(r, { lat: null, lng: null, point_from: null });
});

test('an atlas reference standing in for an unmatched Google row keeps neither Google\'s point nor its name', async () => {
  const { rows: [a] } = await query(
    `insert into attractions (region_slug, slug, name, source, display_source) values ('cornwall', $1, '(maze)', 'google', 'google') returning id`, [`gm-${randomUUID()}`]);
  const ref = `atlas:${a.id}`;
  const { markResearching } = await import('../src/repositories/placeContents.js');
  await markResearching(ref, 'Google\'s name for the maze', 51.5, -0.1);
  assert.deepEqual((await query('select name, lat from place_records where venue_ref = $1', [ref])).rows[0], { name: null, lat: null });
  const hh = await household();
  assert.deepEqual(await saved(hh, ref, 51.5, -0.1), { lat: null, lng: null, point_from: null });
});

test('an unrelated update leaves a legacy row\'s point and name for the backfill', async () => {
  await query(`insert into scout_areas (code, lat, lng) values ('ZZ6', 51.4, -0.6) on conflict do nothing`);
  const g = `google:legacy-scout-${randomUUID()}`;
  await query('alter table scout_places disable trigger keep_owned_point');
  try {
    await query(`insert into scout_places (area_code, venue_ref, name, rank, lat, lng, from_sources) values ('ZZ6', $1, 'Google''s name', 1, 51.5, -0.1, '["google"]')`, [g]);
  } finally { await query('alter table scout_places enable trigger keep_owned_point'); }
  await query('update scout_places set rank = 2 where venue_ref = $1', [g]);
  assert.deepEqual((await query('select name, lat from scout_places where venue_ref = $1', [g])).rows[0], { name: 'Google\'s name', lat: 51.5 });
});

test('food near here still finds a Google-only sweep row through the index\'s point', async () => {
  const { foodNear } = await import('../src/repositories/scout.js');
  await query(`insert into scout_areas (code, lat, lng) values ('ZZ5', 50.1, -5.1) on conflict do nothing`);
  const g = `google:food-${randomUUID()}`;
  await query(`insert into scout_places (area_code, venue_ref, rank, lat, lng, from_sources) values ('ZZ5', $1, 1, 50.1, -5.1, '["google"]')`, [g]);
  assert.equal((await query('select lat from scout_places where venue_ref = $1', [g])).rows[0].lat, null, 'the row keeps no Google point');
  // The refused point went to the index as it arrived (migration 307).
  assert.deepEqual((await query('select lat, coords_from from place_index where venue_ref = $1', [g])).rows[0], { lat: 50.1, coords_from: 'google' });
  const near = await foodNear({ lat: 50.1, lng: -5.1, km: 2, shownOnly: false });
  assert.ok(near.some((r) => r.venue_ref === g && r.lat === 50.1));
});

test('a rented point refused by a table is left on the index for its thirty days', async () => {
  const { rows: [t] } = await query(`insert into households (name) values ('Stop test') returning id`);
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date) values ($1, 'x', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning id`, [t.id])).rows[0];
  const ref = `google:outing-${randomUUID()}`;
  await query(`insert into trip_stops (trip_id, venue_ref, venue_name, lat, lng, position, dwell_minutes) values ($1, $2, 'x', 51.47, -0.61, 1, 60)`, [trip.id, ref]);
  assert.equal((await query('select lat from trip_stops where venue_ref = $1', [ref])).rows[0].lat, null);
  assert.deepEqual((await query('select lat, coords_from from place_index where venue_ref = $1', [ref])).rows[0], { lat: 51.47, coords_from: 'google' });
  assert.equal((await query('select epic_point_lat(venue_ref, lat, point_from) as lat from trip_stops where venue_ref = $1', [ref])).rows[0].lat, 51.47);
});

test('a census box copied between tables never becomes the index\'s point', async () => {
  const hh = await household();
  const ref = `google:box-copy-${randomUUID()}`;
  await query(`insert into place_index (venue_ref, lat, lng, coords_from, coords_at, slice) values ($1, 51.4123, -0.6011, 'google', now() - interval '5 days', '51.40,-0.62,51.48,-0.50')`, [ref]);
  // The saved row holds the box centre; copying it on must not touch the index.
  await query(`update place_index set lat = null, lng = null where venue_ref = $1`, [ref]);
  await saved(hh, ref, 51.44, -0.56);
  assert.deepEqual((await query('select lat, coords_from from place_index where venue_ref = $1', [ref])).rows[0], { lat: null, coords_from: 'google' });
});
