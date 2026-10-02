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
  const day = (await query(`insert into trip_days (trip_id, date) values ($1, '2026-10-04') returning id`, [trip.id])).rows[0];
  const ownDay = (await query(`insert into trip_days (trip_id, date) values ($1, '2026-10-05') returning id`, [trip.id])).rows[0];
  const off = ['household_places', 'visits', 'place_menus', 'chat_topics', 'trip_stops'];
  for (const t of off) await query(`alter table ${t} disable trigger no_rented_name`);
  try {
    await query(`insert into trip_stops (trip_id, day_id, position, venue_ref, venue_name, dwell_minutes) values ($1, $2, 1, $3, 'Legacy Google Stop', 60)`, [trip.id, day.id, g]);
    await query(`insert into household_places (household_id, venue_ref, label, nickname) values ($1, $2, 'Legacy Google Name', 'Ours'), ($1, $3, 'The Tree House', null)`, [hh, g, open]);
    await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, $2, 'Legacy Google Visit', '2026-09-01')`, [hh, g]);
    await query(`insert into place_menus (venue_ref, venue_label, source_url, source_kind) values ($1, 'Legacy Google Menu', 'https://example.org/m', 'html')`, [g]);
    await query(`insert into chat_topics (context_type, context_id, tag_kind, tag_ref, tag_label, audience, title, state)
                 values ('trip', $1, 'stop', $2, 'Legacy Google Stop', 'everyone', 'A', 'open'),
                        ('trip', $1, 'day', $3, 'Sat 4 · Legacy Google Stop', 'everyone', 'B', 'open'),
                        ('trip', $1, 'day', $4, 'Sun 5 · The Tree House', 'everyone', 'C', 'open')`, [trip.id, g, day.id, ownDay.id]);
  } finally {
    for (const t of off) await query(`alter table ${t} enable trigger no_rented_name`);
  }
  const before = await purge.quote();
  assert.ok(before.byStore['household_places.label'] >= 1 && before.byStore['visits.venue_label'] >= 1
    && before.byStore['place_menus.venue_label'] >= 1 && before.byStore['chat_topics.tag_label'] >= 2, JSON.stringify(before));
  const out = await purge.run({ by: 'test', expected: before.total });
  assert.equal(out.cleared, before.total, 'exactly what was quoted');
  const labels = (await query(`select title, tag_label from chat_topics where context_id = $1 order by title`, [trip.id])).rows.map((r) => r.tag_label);
  assert.deepEqual(labels, [null, null, 'Sun 5 · The Tree House'], 'a day named from our own words keeps its fallback');
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

test('a person\'s own words beside a provider\'s reference are kept; only a copy of the provider\'s name goes', async () => {
  const purge = await import('../src/sources/namePurge.js');
  const hh = await household();
  const g = `google:${randomUUID()}`;
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date)
    values ($1, 'T', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning id`, [hh])).rows[0];
  const group = (await query(`insert into trip_groups (trip_id, household_id, invite_token) values ($1, $2, $3) returning id`, [trip.id, hh, `t-${randomUUID()}`])).rows[0];
  // The trigger: an organiser's own words stay; a copy from the trip is cleared.
  await query(`insert into group_items (group_id, kind, label, label_from, venue_ref, position) values
    ($1, 'activity', 'Book lunch for Saturday', 'own', $2, 0), ($1, 'activity', 'Google Copy', 'trip', $2, 1)`, [group.id, g]);
  assert.deepEqual((await query('select label from group_items where group_id = $1 order by position', [group.id])).rows.map((r) => r.label),
    ['Book lunch for Saturday', g]);
  // A host's own words stay; a picked place's text on a provider's reference goes.
  const host = (await query(`insert into hosts (household_id, name) values ($1, 'Tom') returning id`, [hh])).rows[0];
  const offers = (await query(`insert into host_offers (host_id, shape, state, title, venue_ref, venue_label, venue_label_from) values
    ($1, 'anytime', 'draft', 'A', $2, 'Meet by the red door, SL4 1AA', 'host'),
    ($1, 'anytime', 'draft', 'B', $2, 'Google Formatted Address', 'place') returning venue_label`, [host.id, g])).rows;
  assert.deepEqual(offers.map((o) => o.venue_label), ['Meet by the red door, SL4 1AA', null]);

  // The purge, on legacy rows that say nothing of whose they are: an item is
  // cleared only on evidence it was copied from the trip's own names.
  const ev = `google:${randomUUID()}`;
  for (const t of ['group_items', 'trip_shortlist']) await query(`alter table ${t} disable trigger no_rented_name`);
  try {
    await query(`insert into trip_shortlist (trip_id, venue_ref, venue_label, kind) values ($1, $2, 'Legacy Google Name', 'activity')`, [trip.id, ev]);
    await query(`insert into group_items (group_id, kind, label, venue_ref, position) values
      ($1, 'activity', 'Legacy Google Name', $2, 2), ($1, 'activity', 'Bring a towel', $2, 3)`, [group.id, ev]);
    // What migration 341 does to the items already there, before its triggers
    // exist: judged on the evidence — a copy of the trip's name is 'trip',
    // anything else the organiser's own.
    await query('select epic_judge_group_item_provenance()');
  } finally {
    for (const t of ['group_items', 'trip_shortlist']) await query(`alter table ${t} enable trigger no_rented_name`);
  }
  assert.deepEqual((await query('select label_from from group_items where group_id = $1 and position >= 2 order by position', [group.id])).rows.map((r) => r.label_from), ['trip', 'own']);
  await purge.run({ by: 'test' });
  assert.deepEqual((await query('select label from group_items where group_id = $1 and position >= 2 order by position', [group.id])).rows.map((r) => r.label),
    [ev, 'Bring a towel'], 'the copy goes, the organiser\'s words stay');
  assert.equal((await query('select venue_label from host_offers where host_id = $1 and title = $2', [host.id, 'A'])).rows[0].venue_label, 'Meet by the red door, SL4 1AA');
});

test('an organiser\'s and a host\'s own words on a provider\'s reference are shown as written', async () => {
  const groupsRepo = await import('../src/repositories/groups.js');
  const hostingRepo = await import('../src/repositories/hosting.js');
  const hh = await household();
  const g = `google:${randomUUID()}`;
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date)
    values ($1, 'T', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning id`, [hh])).rows[0];
  const group = (await query(`insert into trip_groups (trip_id, household_id, invite_token) values ($1, $2, $3) returning id`, [trip.id, hh, `t-${randomUUID()}`])).rows[0];
  await query(`insert into group_items (group_id, kind, label, label_from, venue_ref, position) values ($1, 'activity', 'Book lunch for Saturday', 'own', $2, 0)`, [group.id, g]);
  const [item] = await groupsRepo.itemsOf(group.id);
  assert.equal(item.label, 'Book lunch for Saturday');
  const host = (await query(`insert into hosts (household_id, name) values ($1, 'Tom') returning id`, [hh])).rows[0];
  const { rows: [o] } = await query(`insert into host_offers (host_id, shape, state, title, venue_ref, venue_label, venue_label_from)
    values ($1, 'anytime', 'draft', 'A', $2, 'Meet by the red door', 'host') returning id`, [host.id, g]);
  assert.equal((await hostingRepo.offerById(o.id)).venue_label, 'Meet by the red door');
});

test('a plan session keeps no provider\'s names: the place ids stay, and reading it names them again', async () => {
  const planSessions = await import('../src/repositories/planSessions.js');
  const { toVenue, googleSource } = await import('../src/sources/google.js');
  const hh = await household();
  const inMemory = randomUUID();
  const owned = randomUUID();
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'The Owned Gallery', '{"name":"wikipedia"}')`, [`google:${owned}`]);
  // The search that made the plan: Google's answer passes through toVenue,
  // which holds the name in memory for the hour.
  toVenue({ id: inMemory, displayName: { text: 'Held From The Search' } });
  const state = { pool: { candidates: [
    { source: 'google', sourcePlaceId: inMemory, name: 'Held From The Search', key: `google:${inMemory}` },
    { source: 'google', sourcePlaceId: owned, name: 'Google Gallery Name' },
    { source: 'osm', sourcePlaceId: 'node/1', name: 'The Open Park' },
  ] }, options: [{ title: 'A morning', stops: [{ venueRef: `google:${owned}`, name: 'Google Gallery Name' }] }] };
  const s = await planSessions.insertPlanSession(hh, state);
  const { rows: [raw] } = await query('select state from plan_sessions where id = $1', [s.id]);
  const c = raw.state.pool.candidates;
  assert.deepEqual(c.map((x) => x.name), [null, null, 'The Open Park'], 'a provider\'s names are not kept; an open place\'s is');
  assert.deepEqual(c.map((x) => x.sourcePlaceId), [inMemory, owned, 'node/1'], 'the place ids stay');
  assert.equal(raw.state.options[0].stops[0].name, null);
  assert.doesNotMatch(JSON.stringify(raw.state), /Google Gallery Name|Held From The Search/);
  const original = googleSource.displayName;
  let asked = 0;
  googleSource.displayName = async () => { asked += 1; return 'Asked'; };
  try {
    const read = await planSessions.livePlanSession(s.id, hh);
    assert.deepEqual(read.state.pool.candidates.map((x) => x.name), ['Held From The Search', 'The Owned Gallery', 'The Open Park']);
    assert.equal(read.state.options[0].stops[0].name, 'The Owned Gallery');
    assert.equal(asked, 0, 'named from what we own and what is in memory: nothing asked of Google');
  } finally { googleSource.displayName = original; }
});

test('the purge counts and clears a plan session saved before the rule', async () => {
  const purge = await import('../src/sources/namePurge.js');
  const hh = await household();
  await query('alter table plan_sessions disable trigger no_rented_name');
  let id;
  try {
    ({ rows: [{ id }] } = await query(`insert into plan_sessions (household_id, state) values ($1, $2) returning id`,
      [hh, JSON.stringify({ pool: { candidates: [{ source: 'google', sourcePlaceId: randomUUID(), name: 'Legacy Plan Name' }] },
        transcript: [{ role: 'assistant', text: 'Legacy Plan Name is open until six.' }] })]));
  } finally {
    await query('alter table plan_sessions enable trigger no_rented_name');
  }
  const q = await purge.quote();
  assert.ok(q.byStore['plan_sessions.state'] >= 1, JSON.stringify(q.byStore));
  await purge.run({ by: 'test', expected: q.total });
  const { rows: [r] } = await query('select state from plan_sessions where id = $1', [id]);
  assert.doesNotMatch(JSON.stringify(r.state), /Legacy Plan Name/);
  assert.equal((await purge.quote()).byStore['plan_sessions.state'], 0);
});

test('a fixed stop in a plan — source "anchor", key a provider\'s — loses the provider\'s name too', async () => {
  const hh = await household();
  const g = `google:${randomUUID()}`;
  const { rows: [s] } = await query(`insert into plan_sessions (household_id, state) values ($1, $2) returning state`,
    [hh, JSON.stringify({ fixed: [{ key: g, source: 'anchor', sourcePlaceId: g.split(':')[1], name: 'Google Theatre Name' }] })]);
  assert.equal(s.state.fixed[0].name, null);
  assert.equal(s.state.fixed[0].key, g, 'the reference stays');
});

test('a provider\'s name in a plan\'s words is kept as its reference and named again on read; the household\'s own words stay as said', async () => {
  const planSessions = await import('../src/repositories/planSessions.js');
  const hh = await household();
  const id = randomUUID();
  const ref = `google:${id}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'The Owned Aquarium', '{"name":"wikipedia"}')`, [ref]);
  const state = {
    pool: { candidates: [{ source: 'google', sourcePlaceId: id, name: 'Sea Life Google Name' }] },
    options: [{ title: 'A morning at Sea Life Google Name', stops: [{ venueRef: ref, name: 'Sea Life Google Name' }] }],
    transcript: [
      { role: 'user', text: 'Somewhere like Sea Life Google Name please' },
      { role: 'assistant', text: 'I have put Sea Life Google Name first.' },
    ],
  };
  const s = await planSessions.insertPlanSession(hh, state);
  assert.equal(state.options[0].title, 'A morning at Sea Life Google Name', 'the state in hand is not changed');
  const { rows: [raw] } = await query('select state from plan_sessions where id = $1', [s.id]);
  const text = JSON.stringify(raw.state);
  assert.equal(raw.state.transcript[0].text, 'Somewhere like Sea Life Google Name please', 'the household\'s own words stay as said');
  assert.equal(raw.state.transcript[1].text, `I have put ⟦${ref}⟧ first.`);
  assert.equal(raw.state.options[0].title, `A morning at ⟦${ref}⟧`);
  assert.equal((text.match(/Sea Life Google Name/g) ?? []).length, 1, 'only in the household\'s own turn');
  const read = await planSessions.livePlanSession(s.id, hh);
  assert.equal(read.state.transcript[1].text, 'I have put The Owned Aquarium first.');
  assert.equal(read.state.options[0].title, 'A morning at The Owned Aquarium');
});

test('only a whole name is kept as its reference: a place called "Spa" leaves "Spanish" alone', async () => {
  const { tokeniseJson } = await import('../src/sources/displayNames.js');
  const id = randomUUID();
  const out = await tokeniseJson({ pool: [{ source: 'google', sourcePlaceId: id, name: 'Spa' }], transcript: [{ role: 'assistant', text: 'Spanish food, then the Spa.' }] });
  assert.equal(out.transcript[0].text, `Spanish food, then the ⟦google:${id}⟧.`);
});

test('a name two places share is shown only if both still read that way, else as "a place"', async () => {
  const { tokeniseJson, nameJson } = await import('../src/sources/displayNames.js');
  const a = randomUUID(), b = randomUUID();
  const kept = await tokeniseJson({ pool: [{ source: 'google', sourcePlaceId: a, name: 'Corner Cafe' }, { source: 'google', sourcePlaceId: b, name: 'Corner Cafe' }],
    transcript: [{ role: 'assistant', text: 'Coffee at Corner Cafe.' }] });
  assert.equal(kept.transcript[0].text, `Coffee at ⟦google:${a}|google:${b}⟧.`);
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Corner Cafe North', '{"name":"osm"}'), ($2, 'Corner Cafe South', '{"name":"osm"}')`, [`google:${a}`, `google:${b}`]);
  await nameJson(kept, { householdId: null });
  assert.equal(kept.transcript[0].text, 'Coffee at a place.', 'never pinned to the wrong one');
});

test('a two-letter provider name in a plan\'s words is kept as its reference too', async () => {
  const { tokeniseJson } = await import('../src/sources/displayNames.js');
  const id = randomUUID();
  const out = await tokeniseJson({ pool: [{ source: 'google', sourcePlaceId: id, name: 'XO' }], options: [{ title: 'Dinner at XO, then EXO-style dessert' }] });
  assert.equal(out.options[0].title, `Dinner at ⟦google:${id}⟧, then EXO-style dessert`);
});
