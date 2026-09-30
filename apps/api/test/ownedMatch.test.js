/**
 * Owned sources and the match (owner, C59 steps 3, 4 and 6, 30 Sep 2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const src = await import('../src/sources/ownedSources.js');
const m = await import('../src/sources/ownedMatch.js');

test.after(() => pool.end());

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('a grid reference comes out where the place is', () => {
  const bigBen = src.bngToWgs84(530268, 179640);
  assert.ok(Math.abs(bigBen.lat - 51.5007) < 0.0002 && Math.abs(bigBen.lng + 0.1246) < 0.0002, JSON.stringify(bigBen));
});

test('a CSV line keeps its quoted commas and doubled quotes', () => {
  assert.deepEqual(src.parseCsvLine('a,"b, c","d ""e"""'), ['a', 'b, c', 'd "e"']);
});

test('the FSA register loads every council\'s file, and a new load replaces the old only once it is whole', async () => {
  const load = (names) => async (url) => {
    if (url.includes('/Authorities')) return json({ authorities: [{ Name: 'Windsor', FileName: 'https://ratings.food.gov.uk/OpenDataFiles/FHRS999en-GB.xml' }] });
    assert.match(url, /api\/open-data-files\/FHRS999en-GB\.json$/);
    return json({ FHRSEstablishment: { EstablishmentCollection: names.map((n, i) => ({ FHRSID: 90000 + i, BusinessName: n, BusinessType: 'Restaurant/Cafe/Canteen', Geocode: { Latitude: '51.48', Longitude: '-0.61' } })) } });
  };
  assert.deepEqual(await src.loadSource('fsa', { fetcher: load(['The Duck', 'The Swan']) }), { source: 'fsa', rows: 2 });
  await src.loadSource('fsa', { fetcher: load(['The Duck']) });
  assert.deepEqual((await query('select name from fsa_establishments where fhrsid >= 90000 order by fhrsid')).rows.map((r) => r.name), ['The Duck']);

  // A load that fails part-way keeps the last good one whole.
  const failing = async (url) => {
    if (url.includes('/Authorities')) return json({ authorities: [1, 2, 3, 4, 5].map((k) => ({ Name: `C${k}`, FileName: `https://ratings.food.gov.uk/OpenDataFiles/FHRS${k}en-GB.xml` })) });
    if (url.includes('FHRS1en')) return json({ FHRSEstablishment: { EstablishmentCollection: [{ FHRSID: 90000, BusinessName: 'The Duck, renamed', Geocode: { Latitude: '51.48', Longitude: '-0.61' } }] } });
    return json({}, 404);
  };
  await assert.rejects(() => src.loadSource('fsa', { fetcher: failing }));
  assert.deepEqual((await query(`select name from fsa_establishments where fhrsid = 90000 and load_id = (select live_load from owned_source_loads where source = 'fsa')`)).rows.map((r) => r.name), ['The Duck']);
  // A load that fails keeps the last good one.
  await assert.rejects(() => src.loadSource('fsa', { fetcher: async () => json({}, 503) }));
  assert.equal((await query('select count(*)::int as n from fsa_establishments where fhrsid >= 90000')).rows[0].n, 1);
  assert.equal((await query(`select state from owned_source_loads where source = 'fsa'`)).rows[0].state, 'failed');
});

test('the heritage list is refused when a layer does not all arrive', async () => {
  const fetcher = async (url) => {
    if (url.includes('returnCountOnly')) return json({ count: 3 });
    return json({ features: [{ attributes: { ListEntry: 1, Name: 'A Mill', Grade: 'II' }, geometry: { points: [[-0.6, 51.48]] }, centroid: { x: -0.6, y: 51.48 } }] });
  };
  await assert.rejects(() => src.loadSource('historic-england', { fetcher }), /1 of 3 arrived/);
});

// Written into the live load, the only one the matcher reads.
const fsaRow = async (fhrsid, name, lat, lng) => {
  let { rows: [l] } = await query(`select live_load from owned_source_loads where source = 'fsa'`);
  if (!l?.live_load) {
    const id = randomUUID();
    await query(`update owned_source_loads set live_load = $1 where source = 'fsa'`, [id]);
    l = { live_load: id };
  }
  await query(`insert into fsa_establishments (fhrsid, name, lat, lng, load_id) values ($1, $2, $3, $4, $5)
               on conflict (fhrsid, load_id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng`,
    [fhrsid, name, lat, lng, l.live_load]);
};

test('a place is matched by its name near its point, and a chain in one box is no match', async () => {
  await fsaRow(91001, 'Kokoro Windsor', 51.4830, -0.6100);
  const hit = await m.matchPlace({ ref: 'google:k', names: ['Kokoro'], point: { lat: 51.4831, lng: -0.6101 } });
  assert.equal(hit.source, 'fsa');
  assert.equal(hit.sourceRef, '91001');
  assert.equal(hit.method, 'name+distance');

  await fsaRow(91002, 'Costa Coffee', 51.4700, -0.6000);
  await fsaRow(91003, 'Costa Coffee', 51.4760, -0.6090);
  const box = { lat: 51.473, lng: -0.605, radiusM: 1500 };
  assert.ok((await m.matchPlace({ ref: 'google:c', names: ['Costa Coffee'], point: null, box })).none, 'two in the box: cannot say which');
  const far = await m.matchPlace({ ref: 'google:x', names: ['Kokoro'], point: { lat: 51.40, lng: -0.50 } });
  assert.ok(far.none, 'the name alone, far away, is not the place');
});

test('a place with no name and no identifier says it has nothing to match on', async () => {
  assert.equal((await m.matchPlace({ ref: 'google:census-only', names: [], point: null, box: { lat: 51.4, lng: -0.6, radiusM: 4000 } })).none, 'no name to match on');
});

test('Wikidata comes first, by reference', async () => {
  await fsaRow(91004, 'Windsor Castle Shop', 51.4838, -0.6044);
  const hit = await m.matchPlace({ ref: 'google:wc', names: ['Windsor Castle'], point: { lat: 51.4838, lng: -0.6044 }, wikidataId: 'Q42646', wikidataPoint: { lat: 51.4839, lng: -0.6045 } });
  assert.deepEqual([hit.source, hit.method, hit.sourceRef], ['wikidata', 'reference', 'Q42646']);
});

const everythingLoaded = async () => {
  for (const source of ['fsa', 'historic-england', 'os-open-names']) {
    await query(`update owned_source_loads set live_load = coalesce(live_load, $2) where source = $1`, [source, randomUUID()]);
  }
  await query(`insert into osm_extracts (region, url, state) values ('great-britain', 'x', 'done') on conflict (region) do update set state = 'done'`);
};

test('the backfill waits until every owned source is loaded', async () => {
  await query('delete from owned_point_runs');
  await query(`update owned_source_loads set live_load = null where source = 'os-open-names'`);
  const out = await m.run({ kind: 'backfill', who: 'test', fetcher: async () => json({ entities: {} }) });
  assert.match(out.waiting, /os-open-names/);
  assert.equal((await query('select count(*)::int as n from owned_point_runs')).rows[0].n, 0, 'no run was started, so none can finish');
});

test('the backfill waits for a switched-on open-map region, and only a switched-on one', async () => {
  await query('delete from owned_point_runs');
  for (const source of ['fsa', 'historic-england', 'os-open-names']) {
    await query(`update owned_source_loads set live_load = coalesce(live_load, $2) where source = $1`, [source, randomUUID()]);
  }
  const was = process.env.EPIC_OSM_EXTRACT;
  process.env.EPIC_OSM_EXTRACT = 'great-britain';
  try {
    await query(`insert into osm_extracts (region, url, state) values ('great-britain', 'x', 'reading') on conflict (region) do update set state = 'reading'`);
    const out = await m.run({ kind: 'backfill', who: 'test', fetcher: async () => json({ entities: {} }) });
    assert.match(out.waiting, /osm \(great-britain\)/);
  } finally {
    if (was === undefined) delete process.env.EPIC_OSM_EXTRACT; else process.env.EPIC_OSM_EXTRACT = was;
  }
});

test('the backfill writes owned points, counts what it could not key, and resumes', async () => {
  await query('delete from owned_point_runs');
  await everythingLoaded();
  const named = `google:bf-named-${randomUUID()}`;
  const bare = `google:bf-bare-${randomUUID()}`;
  await fsaRow(91010, 'The Crooked Billet', 51.4000, -0.5000);
  await query(`insert into place_index (venue_ref, lat, lng, coords_from, coords_at) values ($1, 51.4001, -0.5001, 'google', now()), ($2, null, null, null, null)`, [named, bare]);
  await query(`insert into scout_areas (code, lat, lng) values ('ZZ8', 51.4, -0.5) on conflict do nothing`);
  // A legacy sweep row, written before the trigger, holding the Google name the match reads once.
  await query('alter table scout_places disable trigger keep_owned_point');
  try {
    await query(`insert into scout_places (area_code, venue_ref, name, rank, from_sources) values ('ZZ8', $1, 'The Crooked Billet', 1, '["google"]')`, [named]);
  } finally { await query('alter table scout_places enable trigger keep_owned_point'); }

  const out = await m.run({ kind: 'backfill', who: 'test', fetcher: async () => json({ entities: {} }) });
  assert.ok(out.matched >= 1);
  assert.equal(out.bySource.fsa >= 1, true);
  const op = (await query('select source, source_ref, licence, method from owned_points where venue_ref = $1', [named])).rows[0];
  assert.deepEqual(op, { source: 'fsa', source_ref: '91010', licence: 'OGL-UK-3.0', method: 'name+distance' });
  assert.ok(out.noKey >= 1, 'the census-only place is counted as having nothing to match on');
  assert.equal((await query('select state from owned_point_runs where id = $1', [out.id])).rows[0].state, 'done');

  // The weekly re-match waits a week after the last one, and never runs before the backfill.
  await query(`insert into owned_point_runs (kind, state, finished_at) values ('weekly', 'done', now())`);
  assert.equal(await m.weeklyDue(), null);
});

test('where the owned points stand', async () => {
  const s = await m.standing();
  assert.ok(s.owned >= 1);
  assert.ok(s.bySource.fsa >= 1);
  assert.equal(typeof s.box_only, 'number');
});

test('two of the same name, the same distance away in opposite directions, is no match', async () => {
  await fsaRow(91020, 'Greggs', 51.3000, -0.4000 + 0.0012);
  await fsaRow(91021, 'Greggs', 51.3000, -0.4000 - 0.0012);
  assert.ok((await m.matchPlace({ ref: 'google:g', names: ['Greggs'], point: { lat: 51.3, lng: -0.4 } })).none);
});

test('a second load of a source already loading is refused, not raced', async () => {
  await query(`update owned_source_loads set state = 'loading', started_at = now() where source = 'os-open-names'`);
  await assert.rejects(() => src.loadSource('os-open-names', { fetcher: async () => json({}, 500) }), /already loading/);
  await query(`update owned_source_loads set state = 'never', started_at = null where source = 'os-open-names'`);
});

test('a run that failed part-way carries on from its checkpoint', async () => {
  await query('delete from owned_point_runs');
  await everythingLoaded();
  const { rows: [r] } = await query(`insert into owned_point_runs (kind, state, after, looked, problem) values ('backfill', 'failed', 'zzzz', 7, 'Wikidata answered 503') returning id`);
  const out = await m.run({ kind: 'backfill', who: 'test', fetcher: async () => json({ entities: {} }) });
  assert.equal(out.id, r.id, 'the same run');
  assert.equal(out.looked, 7, 'nothing after zzzz, and the seven before it not looked at again');
});

test('a better owned point replaces an earlier one on every saved copy', async () => {
  const { recordOwnedPoint } = await import('../src/sources/ownedPoints.js');
  const { rows: [h] } = await query(`insert into households (name) values ('Better test') returning id`);
  const ref = `google:better-${randomUUID()}`;
  await recordOwnedPoint({ ref, lat: 51.40, lng: -0.50, source: 'osm', method: 'name+distance' });
  await query(`insert into household_places (household_id, venue_ref, label, lat, lng) values ($1, $2, 'x', 51.5, -0.1)`, [h.id, ref]);
  assert.equal((await query('select point_from from household_places where venue_ref = $1', [ref])).rows[0].point_from, 'osm');
  await recordOwnedPoint({ ref, lat: 51.41, lng: -0.51, source: 'fsa', sourceRef: '1', method: 'name+distance' });
  assert.deepEqual((await query('select lat, point_from from household_places where venue_ref = $1', [ref])).rows[0], { lat: 51.41, point_from: 'fsa' });
});

test('an open-map place\'s copies follow its owned point when it is corrected', async () => {
  const { recordOwnedPoint } = await import('../src/sources/ownedPoints.js');
  const { rows: [h] } = await query(`insert into households (name) values ('Corrected test') returning id`);
  const ref = `osm:node/${Date.now()}7`;
  await query(`insert into household_places (household_id, venue_ref, label, lat, lng) values ($1, $2, 'x', 51.5, -0.1)`, [h.id, ref]);
  await recordOwnedPoint({ ref, lat: 51.52, lng: -0.12, source: 'wikidata', sourceRef: 'Q9', method: 'reference' });
  assert.deepEqual((await query('select lat, point_from from household_places where venue_ref = $1', [ref])).rows[0], { lat: 51.52, point_from: 'wikidata' });
});

test('a display search\'s Google point never displaces an owned one on the index', async () => {
  const { recordOwnedPoint } = await import('../src/sources/ownedPoints.js');
  const index = await import('../src/repositories/placeIndex.js');
  const ref = `google:keep-owned-${randomUUID()}`;
  await query('insert into place_index (venue_ref) values ($1)', [ref]);
  await recordOwnedPoint({ ref, lat: 51.45, lng: -0.55, source: 'fsa', sourceRef: '7', method: 'name+distance' });
  await index.noteMany([{ ref, lat: 51.5, lng: -0.1, coordsFrom: 'google' }], { source: 'google' });
  assert.deepEqual((await query('select lat, lng, coords_from from place_index where venue_ref = $1', [ref])).rows[0], { lat: 51.45, lng: -0.55, coords_from: 'fsa' });
});

test('an accented name is found by its plain stem', async () => {
  await fsaRow(91030, 'Café Rouge', 51.2000, -0.3000);
  const hit = await m.matchPlace({ ref: 'google:cr', names: ['Cafe Rouge'], point: { lat: 51.2001, lng: -0.3001 } });
  assert.equal(hit.sourceRef, '91030');
});

test('a household\'s own photo pin is never moved onto a feature that shares its name', async () => {
  await fsaRow(91040, 'Granny\'s Kitchen', 51.1000, -0.2000);
  const out = await m.matchPlace({ ref: `photo:${randomUUID()}`, names: ['Granny\'s Kitchen'], point: { lat: 51.1001, lng: -0.2001 } });
  assert.equal(out.none, 'its point is already ours');
});

test('an open-map point already on the index stands against a Google one arriving', async () => {
  const index = await import('../src/repositories/placeIndex.js');
  const ref = `google:twin-stands-${randomUUID()}`;
  await index.noteMany([{ ref, lat: 51.45, lng: -0.55, coordsFrom: 'osm' }]);
  await index.noteMany([{ ref, lat: 51.5, lng: -0.1, coordsFrom: 'google' }], { source: 'google' });
  assert.deepEqual((await query('select lat, coords_from from place_index where venue_ref = $1', [ref])).rows[0], { lat: 51.45, coords_from: 'osm' });
});

test('a census box is searched as its rectangle, not a circle round its centre', async () => {
  // Just outside the box's east edge, but inside its half-diagonal from the centre.
  await fsaRow(91050, 'The Lonely Heron', 51.30, -0.4990);
  const bounds = { minLat: 51.28, maxLat: 51.32, minLng: -0.52, maxLng: -0.50 };
  const out = await m.matchPlace({ ref: 'google:heron', names: ['The Lonely Heron'], point: null,
    box: { lat: 51.30, lng: -0.51, radiusM: 2500, bounds } });
  assert.ok(out.none, 'outside the box is not in the box');
});

/** A zip of one deflated file, written by hand: local header, data, central directory, end record. */
const zipOf = async (name, text) => {
  const { deflateRawSync, crc32 } = await import('node:zlib');
  const data = Buffer.from(text, 'utf8');
  const comp = deflateRawSync(data);
  const crc = typeof crc32 === 'function' ? crc32(data) : 0;
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const cdStart = local.length + n.length + comp.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, n, comp, central, n, end]);
};

test('OS Open Names loads from its zip: named features in, roads and postcodes out', async () => {
  const csv = [
    '\uFEFFosgb1,x,Windsor Great Park,eng,,,landcover,Woodland Or Forest,497000,172000',
    'osgb2,x,High Street,eng,,,transportNetwork,Named Road,497100,176800',
    'osgb3,x,"Snow Hill, The",eng,,,landform,Hill Or Mountain,497300,173400',
  ].join('\n');
  const zip = await zipOf('DATA/SU97.csv', csv);
  await query(`update owned_source_loads set state = 'never' where source = 'os-open-names'`);
  // A one-file archive is refused as partial at the real thresholds...
  await assert.rejects(() => src.loadSource('os-open-names', { fetcher: async () => ({ ok: true, status: 200, arrayBuffer: async () => zip }) }), /looks partial/);
  // ...and loads with them lowered for the test.
  const was = { ...src.OS_EXPECT };
  Object.assign(src.OS_EXPECT, { files: 1, rows: 1 });
  let out;
  try {
    out = await src.loadSource('os-open-names', { fetcher: async () => ({ ok: true, status: 200, arrayBuffer: async () => zip }) });
  } finally { Object.assign(src.OS_EXPECT, was); }
  assert.equal(out.rows, 2);
  const names = (await query(`select name from os_names where load_id = (select live_load from owned_source_loads where source = 'os-open-names') order by name`)).rows.map((r) => r.name);
  assert.deepEqual(names, ['Snow Hill, The', 'Windsor Great Park']);
  assert.equal((await query(`select count(*)::int as n from os_names where id = 'osgb1'`)).rows[0].n, 1, 'the byte-order mark is not part of the id');
});

test('two names that point at two different places is no match', async () => {
  await fsaRow(91060, 'The Plough', 51.0500, -0.1500);
  await fsaRow(91061, 'Harrow Inn', 51.0505, -0.1508);
  const out = await m.matchPlace({ ref: 'google:two-names', names: ['The Plough', 'Harrow Inn'], point: { lat: 51.0502, lng: -0.1503 } });
  assert.match(out.none, /different places/);
});

test('an owned point for a place the index has not met puts it on the index', async () => {
  const { recordOwnedPoint } = await import('../src/sources/ownedPoints.js');
  const ref = `atlas:${randomUUID()}`;
  await recordOwnedPoint({ ref, lat: 51.2, lng: -0.2, source: 'osm', sourceRef: 'way/1', method: 'the activity sweep matched it' });
  assert.deepEqual((await query('select lat, coords_from from place_index where venue_ref = $1', [ref])).rows[0], { lat: 51.2, coords_from: 'osm' });
});

test('the schedule starts the backfill itself, and carries on one a deploy cut short', async () => {
  await query('delete from owned_point_runs');
  await everythingLoaded();
  const { rows: [r] } = await query(`insert into owned_point_runs (kind, state, after, looked) values ('backfill', 'running', 'zzzz', 3) returning id`);
  const out = await m.weeklyDue();
  assert.equal(out.id, r.id, 'the same backfill, carried on');
  assert.equal((await query('select state from owned_point_runs where id = $1', [r.id])).rows[0].state, 'done');
});

test('a failed weekly run carries on even in a week that already had one', async () => {
  await query('delete from owned_point_runs');
  await everythingLoaded();
  await query(`insert into owned_point_runs (kind, state, finished_at) values ('backfill', 'done', now()), ('weekly', 'done', now() - interval '1 day')`);
  const { rows: [f] } = await query(`insert into owned_point_runs (kind, state, after, looked) values ('weekly', 'failed', 'zzzz', 5) returning id`);
  const out = await m.weeklyDue();
  assert.equal(out.id, f.id);
});

test('a higher source that cannot tell is not overruled by a lower one', async () => {
  await fsaRow(91070, 'The Mill House', 50.9000, -0.1000);
  await fsaRow(91071, 'The Mill House', 50.9000, -0.1015);
  await query(`update owned_source_loads set live_load = coalesce(live_load, $1) where source = 'historic-england'`, [randomUUID()]);
  const { rows: [l] } = await query(`select live_load from owned_source_loads where source = 'historic-england'`);
  await query(`insert into heritage_entries (list_entry, layer, name, lat, lng, load_id) values (777001, 'listed-building', 'The Mill House', 50.9001, -0.1007, $1) on conflict do nothing`, [l.live_load]);
  const out = await m.matchPlace({ ref: 'google:mill', names: ['The Mill House'], point: { lat: 50.9, lng: -0.1007 } });
  assert.match(out.none, /fsa holds more than one place/);
});

test('a polygon page without centroids is asked again with its outline', async () => {
  let asked = [];
  const fetcher = async (url) => {
    asked.push(url);
    if (url.includes('returnCountOnly')) return json({ count: 1 });
    const layer = Number(url.match(/FeatureServer\/(\d+)\//)[1]);
    if (layer === 0) return json({ features: [{ attributes: { ListEntry: 5, Name: 'A Barn', Grade: 'II' }, geometry: { points: [[-0.6, 51.48]] } }] });
    if (url.includes('returnGeometry=true')) return json({ features: [{ attributes: { ListEntry: 10 + layer, Name: `Layer ${layer}` }, geometry: { rings: [[[-1, 51], [-1, 52], [0, 52], [0, 51]]] } }] });
    return json({ features: [{ attributes: { ListEntry: 10 + layer, Name: `Layer ${layer}` } }] });
  };
  await query(`update owned_source_loads set state = 'never' where source = 'historic-england'`);
  const out = await src.loadSource('historic-england', { fetcher });
  assert.equal(out.rows, 5);
  const { rows: [c] } = await query(`select lat, lng from heritage_entries where list_entry = 16 and load_id = (select live_load from owned_source_loads where source = 'historic-england')`);
  assert.deepEqual(c, { lat: 51.5, lng: -0.5 });
});

test('a heritage layer that gives no count is not loaded', async () => {
  await query(`update owned_source_loads set state = 'never' where source = 'historic-england'`);
  await assert.rejects(() => src.loadSource('historic-england', { fetcher: async () => json({ error: { code: 400 } }) }), /gave no count/);
});

test('an owned point reaches an activity-sweep row keyed on its Google reference', async () => {
  const { recordOwnedPoint } = await import('../src/sources/ownedPoints.js');
  const ext = `google:ext-${randomUUID()}`;
  await query(`insert into attractions (region_slug, slug, name, source, external_ref, osm_ref, lat, lng) values ('cornwall', $1, 'A pier', 'google', $2, 'way/8', 51.0, -1.0)`, [`p-${randomUUID()}`, ext]);
  await recordOwnedPoint({ ref: ext, lat: 51.2, lng: -1.2, source: 'fsa', sourceRef: '9', method: 'name+distance' });
  assert.equal((await query('select lat from attractions where external_ref = $1', [ext])).rows[0].lat, 51.2);
});

test('an activity-sweep row with no name is matched by its point alone, as the sweep matches its own', async () => {
  await query(`insert into osm_features (ref, name, lat, lng, tags, region, load_id) values ('way/424242', 'Lonely Lido', 50.6000, -3.9000, '{}', 'great-britain', $1) on conflict (ref) do nothing`, [randomUUID()]);
  const hit = await m.matchPlace({ ref: 'google:swept-lido', names: ['(swimming pool)'], point: { lat: 50.6003, lng: -3.9002 }, swept: true });
  assert.deepEqual([hit.source, hit.sourceRef, hit.method], ['osm', 'way/424242', 'point, alone within 120 m']);
});

test('a second open-map place within 120 m makes a nameless sweep row no match', async () => {
  const L = randomUUID();
  await query(`insert into osm_features (ref, name, lat, lng, tags, region, load_id) values
    ('node/8080801', 'Kiosk A', 50.7000, -3.8000, '{}', 'great-britain', $1),
    ('node/8080802', 'Kiosk B', 50.7005, -3.8005, '{}', 'great-britain', $1) on conflict (ref) do nothing`, [L]);
  const out = await m.matchPlace({ ref: 'google:two-kiosks', names: [], point: { lat: 50.7002, lng: -3.8002 }, swept: true });
  assert.ok(out.none);
});
