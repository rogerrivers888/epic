/**
 * The name-check (owner, 1 Oct 2026): a live Google name against the owned
 * match it should agree with — agree, doubt (set aside and re-match, never
 * trust its point again) or say nothing; and a place with no owned point
 * matched on its live name at first sight. Google's name is never written.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const nc = await import('../src/sources/nameCheck.js');
const live = await import('../src/sources/liveNames.js');
const { recordOwnedPoint } = await import('../src/sources/ownedPoints.js');
const { ownedNamesFor } = await import('../src/sources/displayNames.js');
const { toVenue } = await import('../src/sources/google.js');

test.after(() => pool.end());

// Somewhere no other test seeds: the far north-west of Scotland.
const LAT = 58.21, LNG = -6.38;
let fhrs = 8_800_000 + Math.floor(Math.random() * 100_000);
async function fsaLoad() {
  await query(`update owned_source_loads set live_load = coalesce(live_load, $1) where source = 'fsa'`, [randomUUID()]);
  return (await query(`select live_load from owned_source_loads where source = 'fsa'`)).rows[0].live_load;
}
async function fsaPlace(name, lat = LAT, lng = LNG) {
  const id = fhrs++;
  await query(`insert into fsa_establishments (fhrsid, name, lat, lng, load_id) values ($1, $2, $3, $4, $5)`, [id, name, lat, lng, await fsaLoad()]);
  return String(id);
}
const SLICE = `${LAT - 0.01},${LNG - 0.01},${LAT + 0.01},${LNG + 0.01}`;

test('the verdict: agree, doubt, or say nothing', () => {
  assert.equal(nc.judge('Wild Kitchen', 'The Wild Kitchen').verdict, 'agrees');
  assert.equal(nc.judge('Sunrise Nail Studio', 'The Old Bell Inn').verdict, 'doubtful');
  // A name with nothing distinctive in it cannot tell two places apart.
  assert.equal(nc.judge('Cafe', 'Tea Rooms').verdict, 'cant-speak');
  // Unalike but sharing a distinctive word: as likely a rename as another place.
  assert.equal(nc.judge('Kelpie Fish Grill', 'Kelpie Seafood Shack').verdict, 'cant-speak');
  assert.equal(nc.judge('Skye Cheese Deli', 'Isle of Skye Cheese Company').verdict, 'cant-speak');
  assert.equal(nc.judge(null, 'The Old Bell Inn').verdict, 'cant-speak');
});

test('only a Google reference with a real name is noted, and a Places answer notes its own', () => {
  live.clearLiveNames();
  live.noteLiveName('osm:node/1', 'Somewhere');
  live.noteLiveName('google:abc', '   ');
  assert.equal(live.pendingLiveNames(), 0);
  toVenue({ id: 'PLACE1', displayName: { text: 'Harbour Café' }, location: { latitude: LAT, longitude: LNG } });
  const [x] = live.takeLiveNames();
  assert.deepEqual(x, { ref: 'google:PLACE1', name: 'Harbour Café', lat: LAT, lng: LNG });
});

test('a live name that agrees stamps the match as checked', async () => {
  nc.forgetChecks(); live.clearLiveNames();
  const ref = `google:${randomUUID()}`;
  const id = await fsaPlace('The Harbour Lights Kitchen');
  await recordOwnedPoint({ ref, lat: LAT, lng: LNG, source: 'fsa', sourceRef: id, method: 'name+distance' });
  live.noteLiveName(ref, 'Harbour Lights Kitchen', { lat: LAT, lng: LNG });
  const out = await nc.drain();
  assert.equal(out.agreed, 1);
  const { rows: [o] } = await query('select checked_at from owned_points where venue_ref = $1', [ref]);
  assert.ok(o.checked_at, 'checked');
});

test('a live name that clearly differs sets the match aside: its point is no longer trusted anywhere, and only the flag is kept', async () => {
  nc.forgetChecks(); live.clearLiveNames();
  const { rows: [h] } = await query('insert into households (name) values ($1) returning id', ['name-check']);
  const ref = `google:${randomUUID()}`;
  const id = await fsaPlace('The Old Bell Inn');
  await query(`insert into place_index (venue_ref, slice) values ($1, $2)`, [ref, SLICE]);
  await query(`insert into household_places (household_id, venue_ref, label) values ($1, $2, $2)`, [h.id, ref]);
  await recordOwnedPoint({ ref, lat: LAT, lng: LNG, source: 'fsa', sourceRef: id, method: 'name+distance' });
  assert.equal((await query('select point_from from household_places where venue_ref = $1', [ref])).rows[0].point_from, 'fsa');

  live.noteLiveName(ref, 'Sunrise Nail Studio'); // no point: nothing to re-match near but the box
  const out = await nc.drain();
  assert.equal(out.doubted, 1);
  assert.equal((await query('select count(*)::int as n from owned_points where venue_ref = $1', [ref])).rows[0].n, 0, 'gone from owned_points');
  const { rows: [pi] } = await query('select lat, coords_from from place_index where venue_ref = $1', [ref]);
  assert.equal(pi.lat, null, 'the index forgets the point it gave');
  const { rows: [hp] } = await query('select point_from from household_places where venue_ref = $1', [ref]);
  assert.equal(hp.point_from, 'census-box', 'a saved copy falls back to its census box');
  const { rows: [s] } = await query('select * from owned_point_suspects where venue_ref = $1', [ref]);
  assert.equal(s.source, 'fsa');
  assert.equal(s.source_ref, id);
  assert.doesNotMatch(s.reason, /Sunrise|Nail|Studio/i, 'never Google\'s name');
  // And the same match is never written back — by the weekly re-match or anything else.
  const again = await recordOwnedPoint({ ref, lat: LAT, lng: LNG, source: 'fsa', sourceRef: id, method: 'name+distance' });
  assert.equal(again.written, false);
});

test('a doubted place is re-matched on its live name, in memory', async () => {
  nc.forgetChecks(); live.clearLiveNames();
  const ref = `google:${randomUUID()}`;
  const oldId = await fsaPlace('The Drovers Rest', LAT + 0.002, LNG);
  const newId = await fsaPlace('Kelpie Seafood Shack', LAT + 0.0021, LNG + 0.0001);
  await recordOwnedPoint({ ref, lat: LAT + 0.002, lng: LNG, source: 'fsa', sourceRef: oldId, method: 'name+distance' });
  live.noteLiveName(ref, 'Kelpie Seafood Shack', { lat: LAT + 0.0021, lng: LNG + 0.0001 });
  const out = await nc.drain();
  assert.equal(out.doubted, 1);
  assert.equal(out.rematched, 1);
  const { rows: [o] } = await query('select source, source_ref, method from owned_points where venue_ref = $1', [ref]);
  assert.equal(o.source_ref, newId);
  assert.match(o.method, /^first sight:/);
  const { rows: [s] } = await query('select rematched_source, rematched_ref from owned_point_suspects where venue_ref = $1', [ref]);
  assert.deepEqual(s, { rematched_source: 'fsa', rematched_ref: newId });
});

test('a place with no owned point is matched at first sight, and then shows the owned source\'s own name', async () => {
  nc.forgetChecks(); live.clearLiveNames();
  const ref = `google:${randomUUID()}`;
  const id = await fsaPlace('Selkie Bakehouse', LAT - 0.003, LNG);
  live.noteLiveName(ref, 'Selkie Bakehouse', { lat: LAT - 0.003, lng: LNG });
  const out = await nc.drain();
  assert.equal(out.firstSight, 1);
  const { rows: [o] } = await query('select source, source_ref from owned_points where venue_ref = $1', [ref]);
  assert.deepEqual(o, { source: 'fsa', source_ref: id });
  const names = await ownedNamesFor([ref]);
  assert.deepEqual(names.get(ref), { name: 'Selkie Bakehouse', source: 'fsa' });
});

test('a middling name says nothing and leaves the match standing', async () => {
  nc.forgetChecks(); live.clearLiveNames();
  const ref = `google:${randomUUID()}`;
  const id = await fsaPlace('Isle of Skye Cheese Company', LAT + 0.004, LNG);
  await recordOwnedPoint({ ref, lat: LAT + 0.004, lng: LNG, source: 'fsa', sourceRef: id, method: 'name+distance' });
  live.noteLiveName(ref, 'Skye Cheese Deli');
  const out = await nc.drain();
  assert.equal(out.doubted, 0);
  assert.equal((await query('select count(*)::int as n from owned_points where venue_ref = $1', [ref])).rows[0].n, 1);
});

test('the Monday figures count the week\'s checks', async () => {
  const w = await nc.weekly(new Date());
  assert.ok(w.agreed >= 1 && w.doubted >= 2 && w.rematched >= 1 && w.first_sight >= 2, JSON.stringify(w));
  for (const k of ['saved_places', 'trip_stops', 'shortlist', 'visits']) assert.equal(typeof w.gaps[k], 'number');
});
