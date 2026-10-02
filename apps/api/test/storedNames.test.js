/**
 * No stored provider names anywhere (owner, 1–2 Oct 2026). Every reader names
 * a place by what we own (epic_owned_name / epic_shown_name, migration 340), a
 * household's own words on a reference that is not a provider's are kept, and
 * a provider's name stored at the time is never shown, searched or sent on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { resolveNames } = await import('../src/sources/displayNames.js');
const activity = await import('../src/repositories/activity.js');
const visitsRepo = await import('../src/repositories/visits.js');
const atlasRepo = await import('../src/repositories/atlas.js');
const { computeBudget } = await import('../src/domain/budget.js');

test.after(() => pool.end());

async function household() {
  const { rows: [h] } = await query('insert into households (name) values ($1) returning id', ['stored names']);
  return h.id;
}

test('the shown name: owned first, the household\'s own words on an open reference, and never a provider\'s stored label', async () => {
  const hh = await household();
  const google = `google:${randomUUID()}`;
  const fixture = `fixtures:${randomUUID()}`;
  const researched = `google:${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Our Researched Name', '{"name":"wikipedia"}')`, [researched]);
  const shown = async (ref, stored) => (await query('select epic_shown_name($1, $2::uuid, $3) as n', [ref, hh, stored])).rows[0].n;
  assert.equal(await shown(google, 'Google Kept Name'), null, 'a provider\'s stored label is never shown');
  assert.equal(await shown(fixture, 'Granny\'s House'), 'Granny\'s House', 'the household\'s own words on an open reference');
  assert.equal(await shown(fixture, fixture), null, 'a reference is not a name');
  assert.equal(await shown(researched, 'Google Kept Name'), 'Our Researched Name');
  await query(`insert into household_places (household_id, venue_ref, label, nickname) values ($1, $2, $2, 'Our Spot')`, [hh, google]);
  assert.equal(await shown(google, 'Google Kept Name'), 'Our Spot', 'their nickname, for them');
  const { rows: [n] } = await query('select name, source from epic_owned_name($1, $2::uuid)', [google, randomUUID()]);
  assert.equal(n, undefined, 'and never for another household');
});

test('the resolver keeps a household\'s own words on an open reference, and neutralises a provider\'s', async () => {
  const rows = [
    { ref: `fixtures:${randomUUID()}`, name: 'The Tree House', locality: 'Bath' },
    { ref: `google:${randomUUID()}`, name: 'Google Kept Name', locality: 'Bath' },
  ];
  await resolveNames(rows, { live: false });
  assert.deepEqual(rows.map((r) => [r.name, r.nameSource]), [['The Tree House', 'stored'], ['A place in Bath', 'none']]);
});

test('the activity feed names a place by what we own, never by the label stored when it was saved', async () => {
  const hh = await household();
  const g = `google:${randomUUID()}`;
  const owned = `google:${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'The Owned Lido', '{"name":"osm"}')`, [owned]);
  await query(`insert into household_places (household_id, venue_ref, label) values ($1, $2, 'Google Kept Name'), ($1, $3, 'Another Google Name')`, [hh, g, owned]);
  const feed = await activity.feedFor(hh, { limit: 10 });
  const titles = feed.filter((e) => e.kind === 'place').map((e) => e.title).sort();
  assert.deepEqual(titles, ['The Owned Lido', 'a place']);
});

test('search finds a place by the name the household sees, and never by a provider\'s stored label', async () => {
  const hh = await household();
  const g = `google:${randomUUID()}`;
  const owned = `google:${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Marram Dunes Cafe', '{"name":"osm"}')`, [owned]);
  await query(`insert into household_places (household_id, venue_ref, label) values ($1, $2, 'Secret Google Bistro'), ($1, $3, 'Google Words')`, [hh, g, owned]);
  assert.deepEqual(await visitsRepo.knownPlacesMatching(hh, 'secret google'), [], 'not by the stored provider label');
  const [hit] = await visitsRepo.knownPlacesMatching(hh, 'marram');
  assert.equal(hit.label, 'Marram Dunes Cafe');
  const places = await atlasRepo.placesIn(hh, { q: 'marram' }, { lat: null, lng: null, radiusMiles: 10 });
  assert.deepEqual(places.map((p) => p.venue_ref), [owned]);
});

test('a budget leg named live from Google says so, so the device can strip it', () => {
  const trip = { depart_at: '2026-10-03T09:00:00Z', return_at: '2026-10-03T17:00:00Z', travel_mode: 'driving',
    origin_lat: 51.5, origin_lng: -0.1, origin_label: 'Home', intensity: 'balanced' };
  const stops = [
    { id: 1, position: 1, lat: 51.51, lng: -0.11, dwell_minutes: 60, venue_name: 'Owned Name', nameSource: 'osm' },
    { id: 2, position: 2, lat: 51.52, lng: -0.12, dwell_minutes: 60, venue_name: 'Live Google Name', nameSource: 'google-live' },
  ];
  const b = computeBudget({ trip, stops, household: null });
  assert.deepEqual(b.legs.map((l) => Boolean(l.live)), [false, true, true], 'into it and out of it');
});
