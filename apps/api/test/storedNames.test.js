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

test('a provider\'s name is not written down: the reference stands in, or nothing — an open reference and a nickname are left alone', async () => {
  const hh = await household();
  const g = `google:${randomUUID()}`;
  const open = `fixtures:${randomUUID()}`;
  await query(`insert into household_places (household_id, venue_ref, label, nickname) values ($1, $2, 'Google Name', 'Ours'), ($1, $3, 'The Tree House', null)`, [hh, g, open]);
  const hp = Object.fromEntries((await query('select venue_ref, label, nickname from household_places where household_id = $1', [hh])).rows.map((r) => [r.venue_ref, r]));
  assert.deepEqual([hp[g].label, hp[g].nickname], [g, 'Ours'], 'the reference stands in; the nickname is untouched');
  assert.equal(hp[open].label, 'The Tree House');
  // An update that brings the provider's name back is refused the same way.
  await query('update household_places set label = $3 where household_id = $1 and venue_ref = $2', [hh, g, 'Google Name Again']);
  assert.equal((await query('select label from household_places where household_id = $1 and venue_ref = $2', [hh, g])).rows[0].label, g);

  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date)
    values ($1, 'T', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning id`, [hh])).rows[0];
  await query(`insert into trip_stops (trip_id, position, venue_ref, venue_name, dwell_minutes) values ($1, 1, $2, 'Google Stop', 60), ($1, 2, $3, 'Lunch at Gran''s', 60)`, [trip.id, g, open]);
  assert.deepEqual((await query('select venue_name from trip_stops where trip_id = $1 order by position', [trip.id])).rows.map((r) => r.venue_name), [g, "Lunch at Gran's"]);
  await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, $2, 'Google Visit', '2026-10-01')`, [hh, g]);
  assert.equal((await query('select venue_label from visits where household_id = $1', [hh])).rows[0].venue_label, g);
  await query(`insert into orders (household_id, venue_ref, venue_label) values ($1, $2, 'Google Order')`, [hh, g]);
  assert.equal((await query('select venue_label from orders where household_id = $1', [hh])).rows[0].venue_label, null);
  await query(`insert into place_menus (venue_ref, venue_label, source_url, source_kind) values ($1, 'Google Menu', 'https://example.org/menu', 'html')`, [g]);
  assert.equal((await query('select venue_label from place_menus where venue_ref = $1', [g])).rows[0].venue_label, null);
});

test('a chat topic about a provider\'s stop keeps no label of theirs', async () => {
  const hh = await household();
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date)
    values ($1, 'T', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning id`, [hh])).rows[0];
  const g = `google:${randomUUID()}`;
  const { rows: [t] } = await query(
    `insert into chat_topics (context_type, context_id, tag_kind, tag_ref, tag_label, audience, title, state)
     values ('trip', $1, 'stop', $2, 'Google Stop Name', 'everyone', 'When do we leave?', 'open') returning tag_label`, [trip.id, g]);
  assert.equal(t.tag_label, null);
});

test('the purge clears every stored provider name it quoted, logs the counts and never a name, and leaves our own words alone', async () => {
  const purge = await import('../src/sources/namePurge.js');
  const hh = await household();
  const g = `google:${randomUUID()}`;
  const open = `fixtures:${randomUUID()}`;
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date)
    values ($1, 'T', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning id`, [hh])).rows[0];
  // The past, as it stands on production: written before the trigger, so it
  // is seeded with the trigger off.
  const off = ['household_places', 'visits', 'place_menus', 'chat_topics'];
  for (const t of off) await query(`alter table ${t} disable trigger no_rented_name`);
  try {
    await query(`insert into household_places (household_id, venue_ref, label, nickname) values ($1, $2, 'Legacy Google Name', 'Ours'), ($1, $3, 'The Tree House', null)`, [hh, g, open]);
    await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, $2, 'Legacy Google Visit', '2026-09-01')`, [hh, g]);
    await query(`insert into place_menus (venue_ref, venue_label, source_url, source_kind) values ($1, 'Legacy Google Menu', 'https://example.org/m', 'html')`, [g]);
    await query(`insert into chat_topics (context_type, context_id, tag_kind, tag_ref, tag_label, audience, title, state)
                 values ('trip', $1, 'stop', $2, 'Legacy Google Stop', 'everyone', 'A', 'open'),
                        ('trip', $1, 'day', $3, 'Sat 4 · Legacy Google Stop', 'everyone', 'B', 'open')`, [trip.id, g, randomUUID()]);
  } finally {
    for (const t of off) await query(`alter table ${t} enable trigger no_rented_name`);
  }
  const before = await purge.quote();
  assert.ok(before.byStore['household_places.label'] >= 1 && before.byStore['visits.venue_label'] >= 1
    && before.byStore['place_menus.venue_label'] >= 1 && before.byStore['chat_topics.tag_label'] >= 2, JSON.stringify(before));
  const out = await purge.run({ by: 'test', expected: before.total });
  assert.equal(out.cleared, before.total, 'exactly what was quoted');
  assert.equal((await purge.quote()).total, 0, 'nothing left behind');
  const hp = Object.fromEntries((await query('select venue_ref, label, nickname from household_places where household_id = $1', [hh])).rows.map((r) => [r.venue_ref, r]));
  assert.deepEqual([hp[g].label, hp[g].nickname, hp[open].label], [g, 'Ours', 'The Tree House']);
  assert.equal((await query('select venue_label from visits where household_id = $1', [hh])).rows[0].venue_label, g);
  const [log] = await purge.history(1);
  assert.equal(log.cleared, before.total);
  assert.equal(log.expected, before.total);
  assert.doesNotMatch(JSON.stringify(log), /Legacy Google/, 'counts only, never a name');
});

test('rows of the same open reference keep their own words when resolved together', async () => {
  const { resolveInto } = await import('../src/sources/displayNames.js');
  const ref = `fixtures:${randomUUID()}`;
  const stops = [{ venue_ref: ref, venue_name: 'Meet at the north gate' }];
  const shortlist = [{ venue_ref: ref, venue_label: 'The Park' }];
  await resolveInto([{ rows: stops, refKey: 'venue_ref', nameKey: 'venue_name' }, { rows: shortlist, refKey: 'venue_ref', nameKey: 'venue_label' }], { live: false });
  assert.equal(stops[0].venue_name, 'Meet at the north gate');
  assert.equal(shortlist[0].venue_label, 'The Park');
});
