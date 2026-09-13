/**
 * "Just say what you are up for" (migration 095, domain/openTo.js).
 *
 * Every rule here is a promise made on screen, so each one is pinned:
 * a shared language is required and only fluency is asked; preferences are
 * age, company and language and must fit both ways; a preference Epic cannot
 * establish never makes a match; family meets family only; a verdict is hidden
 * until both are in and a no is silent; a video is blind until both have
 * recorded; and an unanswered introduction is nudged once, then let go.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query } = await testDatabase();
const repo = await import('../src/repositories/openTo.js');
const {
  companyFits, fits, hasLapsed, introductionOf, languageFor, livesUntil, nextStage, nudgeDue,
  partyOf, sharedInterests, sharedLanguage, similarAge, unverifiablePrefs, verdictFor, videoVisible, waitingOn,
} = await import('../src/domain/openTo.js');

const EN = [{ name: 'English', level: 'fluent' }];
const entry = (over = {}) => ({
  id: over.id ?? 'e1', household_id: over.household_id ?? 'h1', state: 'active', scope: 'standing',
  kind: 'adult', interests: ['Chess club'], languages: EN, pref_age: 'any', pref_company: ['anyone'],
  pref_fluency: 'some', where_miles: 25, ...over,
});
const side = (e, over = {}) => ({ entry: e, party: 'adults', age: 40, near: { lat: 51.45, lng: -0.97 }, ...over });

// ---------------------------------------------------------------------------
// what a household is, and what a preference may do
// ---------------------------------------------------------------------------

test('a household with a child is a family; two adults are a couple; one is an adult', () => {
  assert.equal(partyOf([{ is_minor: false }, { is_minor: true }]), 'families');
  assert.equal(partyOf([{ is_minor: false }, { is_minor: false }]), 'couples');
  assert.equal(partyOf([{ is_minor: false }]), 'adults');
  assert.equal(partyOf([]), 'adults');
});

test('a preference Epic cannot establish never makes a match, and the screen is told which', () => {
  // Nothing in Epic records anybody's sex, so these cannot be checked.
  assert.deepEqual(unverifiablePrefs(['anyone', 'women', 'men', 'couples']), ['women', 'men']);
  assert.equal(companyFits(['women'], 'adults'), false, 'a filter we cannot check is not treated as met');
  assert.equal(companyFits(['women'], 'couples'), false);
  // The ones that are derivable are honoured.
  assert.equal(companyFits(['anyone'], 'families'), true);
  assert.equal(companyFits([], 'families'), true, 'saying nothing is anyone');
  assert.equal(companyFits(['families'], 'families'), true);
  assert.equal(companyFits(['couples'], 'adults'), false);
});

test('a shared language is found by name, and only fluency is asked', () => {
  assert.equal(sharedLanguage(EN, [{ name: 'Portuguese' }]), null);
  const both = sharedLanguage([{ name: 'English', level: 'fluent' }], [{ name: 'english', level: 'some' }]);
  assert.deepEqual(both, { name: 'english', mine: 'fluent', theirs: 'some' });
});

test('a similar age is within a dozen years, and an age we do not know is not similar', () => {
  assert.equal(similarAge(38, 44), true);
  assert.equal(similarAge(28, 62), false);
  assert.equal(similarAge(40, null), false, 'unknown is never quietly treated as a match');
});

// ---------------------------------------------------------------------------
// whether two people are introduced at all
// ---------------------------------------------------------------------------

const host = () => side(entry({ id: 'h', household_id: 'A', scope: 'standing', interests: ['Chess club', 'Beach walks'] }));
const guest = () => side(entry({ id: 'g', household_id: 'B', scope: 'trip', interests: ['Chess club', 'Nature'] }), { near: { lat: 51.46, lng: -0.98 } });

test('two people are introduced when they share a thing, a language and a place — and the local is the host', () => {
  const out = fits(host(), guest());
  assert.equal(out.ok, true);
  assert.deepEqual(out.interests, ['Chess club'], 'only what both said, in the local’s words');
  assert.equal(fits(guest(), host()).ok, false, 'a visitor is never the host');
});

test('nothing in common, no shared language, or too far apart is no introduction', () => {
  assert.equal(fits(host(), side(entry({ household_id: 'B', scope: 'trip', interests: ['Bowling'] }))).ok, false);
  assert.equal(fits(host(), side(entry({ household_id: 'B', scope: 'trip', languages: [{ name: 'Portuguese' }] }))).ok, false);
  const far = side(entry({ household_id: 'B', scope: 'trip' }), { near: { lat: 55.9, lng: -3.2 } });
  assert.match(fits(host(), far).reason, /too far/);
  assert.equal(fits(host(), side(entry({ household_id: 'A', scope: 'trip' }))).ok, false, 'never your own household');
});

test('whoever asks for fluent gets fluent, both ways', () => {
  const picky = side(entry({ id: 'h', household_id: 'A', pref_fluency: 'fluent' }));
  const some = side(entry({ household_id: 'B', scope: 'trip', languages: [{ name: 'English', level: 'some' }] }));
  assert.equal(fits(picky, some).ok, false, 'the host asked for fluent');
  const guestPicky = side(entry({ household_id: 'B', scope: 'trip', pref_fluency: 'fluent' }));
  const hostSome = side(entry({ id: 'h', household_id: 'A', languages: [{ name: 'English', level: 'some' }] }));
  assert.equal(fits(hostSome, guestPicky).ok, false, 'the guest asked for fluent');
});

test('age and company have to fit both ways, so a preference cannot be used to hunt', () => {
  const wantsSimilar = side(entry({ id: 'h', household_id: 'A', pref_age: 'similar' }), { age: 35 });
  assert.equal(fits(wantsSimilar, side(entry({ household_id: 'B', scope: 'trip' }), { age: 70 })).ok, false);
  // The guest's preference bites just as hard as the host's.
  const guestWantsCouples = side(entry({ household_id: 'B', scope: 'trip', pref_company: ['couples'] }), { party: 'adults' });
  assert.match(fits(host(), guestWantsCouples).reason, /guest asked/);
  const hostWantsCouples = side(entry({ id: 'h', household_id: 'A', pref_company: ['couples'] }));
  assert.match(fits(hostWantsCouples, guest()).reason, /host asked/);
});

test('family meets family, never a family and an adult', () => {
  const family = side(entry({ id: 'h', household_id: 'A', kind: 'family' }), { party: 'families' });
  assert.match(fits(family, guest()).reason, /family meets family/);
  const otherFamily = side(entry({ household_id: 'B', scope: 'trip', kind: 'family' }), { party: 'families', near: { lat: 51.46, lng: -0.98 } });
  assert.equal(fits(family, otherFamily).ok, true);
});

// ---------------------------------------------------------------------------
// silence: verdicts, videos and what either side is told
// ---------------------------------------------------------------------------

test('a verdict is hidden until both are in, and only a pair of yeses is ever reported', () => {
  const waiting = verdictFor({ host_video_yes: true, guest_video_yes: null }, 'host');
  assert.deepEqual(waiting, { mine: true, theirs: null, settled: false });
  const both = verdictFor({ host_video_yes: true, guest_video_yes: true }, 'guest');
  assert.equal(both.introduced, true);
  // A no is silent: the other side is told nothing, ever.
  const turned = verdictFor({ host_video_yes: true, guest_video_yes: false }, 'host');
  assert.equal(turned.theirs, null, 'nobody is told they were turned down');
  assert.equal(turned.introduced, false);
});

test('you see their video only once yours is in', () => {
  assert.deepEqual(videoVisible({ host_video_id: null, guest_video_id: 'v2' }, 'host'), { mine: null, theirs: null, waiting: false });
  assert.deepEqual(videoVisible({ host_video_id: 'v1', guest_video_id: null }, 'host'), { mine: 'v1', theirs: null, waiting: true });
  assert.deepEqual(videoVisible({ host_video_id: 'v1', guest_video_id: 'v2' }, 'host'), { mine: 'v1', theirs: 'v2', waiting: false });
});

test('the stage walks forward one answer at a time, and any no ends it', () => {
  const m = { stage: 'host_asked' };
  assert.equal(nextStage(m, { hostVerdict: 'no' }), 'ended');
  assert.equal(nextStage(m, { hostVerdict: 'yes' }), 'guest_asked');
  const asked = { ...m, host_verdict: 'yes' };
  assert.equal(nextStage(asked, { guestVerdict: 'no' }), 'ended');
  assert.equal(nextStage(asked, { guestVerdict: 'yes' }), 'videos');
  const videos = { ...asked, guest_verdict: 'yes', host_video_id: 'a', guest_video_id: 'b' };
  assert.equal(nextStage(videos, { hostVideoYes: true }), 'videos', 'still waiting on the other');
  assert.equal(nextStage({ ...videos, host_video_yes: true }, { guestVideoYes: false }), 'ended');
  assert.equal(nextStage({ ...videos, host_video_yes: true }, { guestVideoYes: true }), 'both_yes');
  const yes = { ...videos, host_video_yes: true, guest_video_yes: true, stage: 'both_yes' };
  assert.equal(nextStage(yes, { hostVerified: new Date() }), 'both_yes', 'one of two is not both');
  assert.equal(nextStage({ ...yes, host_verified_at: new Date() }, { guestVerified: new Date() }), 'chat');
});

test('the host is asked first, and it is always clear whose turn it is', () => {
  assert.equal(waitingOn({ stage: 'host_asked' }), 'host');
  assert.equal(waitingOn({ stage: 'guest_asked' }), 'guest');
  assert.equal(waitingOn({ stage: 'videos', host_video_id: null }), 'host');
  assert.equal(waitingOn({ stage: 'videos', host_video_id: 'a', guest_video_id: null }), 'guest');
  assert.equal(waitingOn({ stage: 'videos', host_video_id: 'a', guest_video_id: 'b', host_video_yes: null }), 'host');
  assert.equal(waitingOn({ stage: 'chat' }), null);
});

test('the introduction is a first name, a town and the shared things — never a surname or a contact', () => {
  const out = introductionOf({
    match: { interests: ['Chess club'], host_where: 'The Turk’s Head, Thursdays from seven', host_note: 'Bring nothing.' },
    host: { where_label: 'Reading' }, hostName: 'Tom Alderton', language: { name: 'english', mine: 'fluent' },
  });
  assert.equal(out.name, 'Tom');
  assert.equal(out.town, 'Reading');
  assert.deepEqual(Object.keys(out).sort(), ['interests', 'language', 'name', 'note', 'town', 'where']);
  assert.equal(JSON.stringify(out).includes('Alderton'), false, 'no surname, ever');
});

// ---------------------------------------------------------------------------
// time: one nudge, then it is let go
// ---------------------------------------------------------------------------

test('an unanswered introduction is nudged once halfway, and lapses after a week', () => {
  const made = new Date('2026-09-01T00:00:00Z');
  const lapses = new Date('2026-09-08T00:00:00Z');
  const m = { stage: 'host_asked', created_at: made, lapses_at: lapses, nudged_at: null };
  assert.equal(nudgeDue(m, new Date('2026-09-02T00:00:00Z')), false, 'not yet');
  assert.equal(nudgeDue(m, new Date('2026-09-05T00:00:00Z')), true);
  assert.equal(nudgeDue({ ...m, nudged_at: new Date() }, new Date('2026-09-05T00:00:00Z')), false, 'once, never twice');
  assert.equal(hasLapsed(m, new Date('2026-09-07T00:00:00Z')), false);
  assert.equal(hasLapsed(m, new Date('2026-09-08T00:00:00Z')), true);
  assert.equal(hasLapsed({ ...m, stage: 'chat' }, new Date('2026-10-01T00:00:00Z')), false, 'a live introduction never lapses');
});

test('a standing entry is asked again in three months; a trip one clears when the trip ends', () => {
  const now = new Date('2026-09-13T00:00:00Z');
  const standing = livesUntil({ scope: 'standing' }, now);
  assert.equal(standing.expiresAt, null, 'nothing is scheduled, so nothing expires');
  assert.equal(standing.reviewDueAt.toISOString().slice(0, 7), '2026-12');
  const trip = livesUntil({ scope: 'trip', tripEnd: '2026-10-19' }, now);
  assert.equal(trip.reviewDueAt, null);
  assert.equal(trip.expiresAt.toISOString().slice(0, 10), '2026-10-19');
});

// ---------------------------------------------------------------------------
// the rows
// ---------------------------------------------------------------------------

test('one live standing entry per household, and one per trip', async () => {
  const { household } = await aHousehold(query, 'somebody up for things');
  const first = await repo.insertEntry(household.id, { interests: ['Chess club'], scope: 'standing' });
  assert.ok(first.id);
  await assert.rejects(() => repo.insertEntry(household.id, { interests: ['Skate park'], scope: 'standing' }), /duplicate key/);
  await repo.endEntry(first.id);
  const again = await repo.insertEntry(household.id, { interests: ['Skate park'], scope: 'standing' });
  assert.notEqual(again.id, first.id, 'ending one makes room for the next');
  assert.equal((await repo.entriesOf(household.id)).length, 1);
});

test('the pool is only ever read to make an introduction, and never across scopes or kinds', async () => {
  const a = await aHousehold(query, 'a local');
  const b = await aHousehold(query, 'a visitor');
  const c = await aHousehold(query, 'another local');
  const mine = await repo.insertEntry(a.household.id, { scope: 'standing', interests: ['Chess club'] });
  await repo.insertEntry(b.household.id, { scope: 'standing', interests: ['Chess club'] });
  const visiting = await repo.insertEntry(c.household.id, { scope: 'standing', interests: ['Chess club'] });
  await repo.updateEntry(visiting.id, { scope: 'trip', kind: 'adult' });
  const candidates = await repo.candidatesFor(mine);
  assert.equal(candidates.every((x) => x.scope === 'trip'), true, 'a local is only ever shown visitors');
  assert.equal(candidates.some((x) => x.household_id === a.household.id), false, 'never your own');
  assert.equal(candidates.some((x) => x.id === visiting.id), true);
});

test('an introduction is made once for a pair, and both sides can find it', async () => {
  const a = await aHousehold(query, 'the host side');
  const b = await aHousehold(query, 'the guest side');
  const h = await repo.insertEntry(a.household.id, { scope: 'standing', interests: ['Chess club'] });
  const g = await repo.insertEntry(b.household.id, { scope: 'trip', interests: ['Chess club'] });
  const made = await repo.insertMatch({ hostEntryId: h.id, guestEntryId: g.id, interests: ['Chess club'], kind: 'adult' });
  assert.equal(made.stage, 'host_asked', 'the host is asked first');
  assert.equal(await repo.insertMatch({ hostEntryId: h.id, guestEntryId: g.id, interests: ['Chess club'], kind: 'adult' }), null, 'never twice');
  assert.equal((await repo.matchesOf(a.household.id)).length, 1);
  assert.equal((await repo.matchesOf(b.household.id)).length, 1);
});

// ---------------------------------------------------------------------------
// end to end: an introduction is made, and walks one answer at a time
// ---------------------------------------------------------------------------

test('the pool introduces a visitor to a local, host first, and the whole thing walks to chat', async () => {
  const { findIntroductions } = await import('../src/routes/openTo.js');
  const local = await aHousehold(query, 'a local who plays chess');
  const away = await aHousehold(query, 'a visitor from Lisbon');
  // Both are in Reading, both speak English, both are up for chess.
  await query('update households set home_lat = 51.4543, home_lng = -0.9781, home_label = $2 where id = $1', [local.household.id, 'Reading']);
  await query('update households set home_lat = 38.72, home_lng = -9.14 where id = $1', [away.household.id]);
  const trip = (await query(
    `insert into trips (household_id, title, origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng, depart_at, return_at, travel_mode, intensity, base_lat, base_lng, start_date, end_date)
     values ($1, 'Reading', 'Lisbon', 38.72, -9.14, 'Reading', 51.4543, -0.9781, now(), now() + interval '7 days', 'walking', 'relaxed', 51.4543, -0.9781, current_date, current_date + 7) returning *`,
    [away.household.id],
  )).rows[0];

  const langs = JSON.stringify([{ name: 'English', level: 'fluent' }]);
  const host = await repo.insertEntry(local.household.id, { scope: 'standing', interests: ['Chess club', 'Beach walks'], languages: langs, whereLabel: 'Reading', whereMiles: 25 });
  const guest = await repo.insertEntry(away.household.id, { scope: 'trip', tripId: trip.id, interests: ['Chess club', 'Nature'], languages: langs });

  // Saving the visitor's entry is what looks for people, and the local is the host.
  assert.equal(await findIntroductions(guest), 1);
  assert.equal(await findIntroductions(guest), 0, 'never introduced twice');
  const made = (await repo.matchesOf(local.household.id))[0];
  assert.equal(made.host_entry_id, host.id, 'the local is the host');
  assert.equal(made.guest_entry_id, guest.id);
  assert.deepEqual(made.interests, ['Chess club'], 'only what both said');
  assert.equal(made.stage, 'host_asked', 'and the host is asked first');

  // The host answers, adding the detail that makes the introduction worth reading.
  let m = await repo.updateMatch(made.id, { hostVerdict: 'yes', hostWhere: 'The Turk’s Head, Thursdays from seven', stage: nextStage(made, { hostVerdict: 'yes' }) });
  assert.equal(m.stage, 'guest_asked');
  m = await repo.updateMatch(m.id, { guestVerdict: 'yes', stage: nextStage(m, { guestVerdict: 'yes' }) });
  assert.equal(m.stage, 'videos');

  // Twenty seconds each. Neither sees the other's until both are in.
  m = await repo.updateMatch(m.id, { hostVideoId: null, guestVideoId: null });
  assert.equal(videoVisible({ ...m, host_video_id: 'a' }, 'host').theirs, null, 'blind until both');
  m = { ...m, host_video_id: 'a', guest_video_id: 'b' };
  assert.equal(videoVisible(m, 'guest').theirs, 'a');

  // Both say yes, separately, and neither was told the other's answer first.
  assert.equal(verdictFor({ ...m, host_video_yes: true }, 'guest').theirs, null);
  m = { ...m, host_video_yes: true, guest_video_yes: true, stage: nextStage(m, { hostVideoYes: true, guestVideoYes: true }) };
  assert.equal(m.stage, 'both_yes');

  // Then ID, once each, and only then does anything open.
  m = { ...m, host_verified_at: new Date() };
  assert.equal(nextStage(m, {}), 'both_yes', 'one of two is not both');
  m = { ...m, guest_verified_at: new Date() };
  assert.equal(nextStage(m, {}), 'chat');
});

test('a visitor is never introduced to somebody with nothing in common, no shared language, or the wrong kind', async () => {
  const { findIntroductions } = await import('../src/routes/openTo.js');
  const local = await aHousehold(query, 'a local who bowls');
  const away = await aHousehold(query, 'a visitor who reads');
  await query('update households set home_lat = 51.4543, home_lng = -0.9781 where id = $1', [local.household.id]);
  const trip = (await query(
    `insert into trips (household_id, title, origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng, depart_at, return_at, travel_mode, intensity, base_lat, base_lng)
     values ($1, 'Reading', 'Porto', 41.15, -8.61, 'Reading', 51.4543, -0.9781, now(), now() + interval '3 days', 'walking', 'relaxed', 51.4543, -0.9781) returning *`,
    [away.household.id],
  )).rows[0];
  await repo.insertEntry(local.household.id, { scope: 'standing', interests: ['Bowling'], languages: JSON.stringify([{ name: 'English', level: 'fluent' }]) });
  const guest = await repo.insertEntry(away.household.id, { scope: 'trip', tripId: trip.id, interests: ['Book group'], languages: JSON.stringify([{ name: 'English', level: 'fluent' }]) });
  assert.equal(await findIntroductions(guest), 0, 'nothing in common is no introduction');
});

test('the card counts the people already asked, and counts them for one entry only', async () => {
  const a = await aHousehold(query, 'one who is asked about');
  const b = await aHousehold(query, 'one visitor');
  const c = await aHousehold(query, 'another visitor');
  const host = await repo.insertEntry(a.household.id, { scope: 'standing', interests: ['Chess club'] });
  const one = await repo.insertEntry(b.household.id, { scope: 'trip', interests: ['Chess club'] });
  const two = await repo.insertEntry(c.household.id, { scope: 'trip', interests: ['Chess club'] });
  await repo.insertMatch({ hostEntryId: host.id, guestEntryId: one.id, interests: ['Chess club'], kind: 'adult' });
  const second = await repo.insertMatch({ hostEntryId: host.id, guestEntryId: two.id, interests: ['Chess club'], kind: 'adult' });

  let counts = await repo.liveMatchCounts([host.id, one.id, two.id]);
  assert.equal(counts.get(host.id), 2, 'the host is in both');
  // A guest is not told an introduction exists until the host has said yes, so
  // it is not counted on their card either.
  assert.equal(counts.get(one.id) ?? 0, 0, 'nothing is counted before the host answers');

  await repo.updateMatch(second.id, { hostVerdict: 'yes', stage: 'guest_asked' });
  counts = await repo.liveMatchCounts([host.id, one.id, two.id]);
  assert.equal(counts.get(two.id), 1, 'once asked, the guest counts it');
  assert.equal(counts.get(host.id), 2);

  // An introduction that ended is nobody's business and is not counted.
  await repo.updateMatch(second.id, { stage: 'ended' });
  counts = await repo.liveMatchCounts([host.id, two.id]);
  assert.equal(counts.get(host.id), 1);
  assert.equal(counts.get(two.id) ?? 0, 0);
  assert.equal((await repo.liveMatchCounts([])).size, 0, 'no entries, no query');
});

test('any shared language that suits both will do, not just the first one listed', () => {
  // She lists Portuguese first and speaks it fluently; he has a little. He
  // asked for fluent. They both also speak English fluently, which is the
  // introduction — the order of an array is not a rule anybody agreed to.
  const hostLangs = [{ name: 'Portuguese', level: 'some' }, { name: 'English', level: 'fluent' }];
  const guestLangs = [{ name: 'Portuguese', level: 'fluent' }, { name: 'English', level: 'fluent' }];
  const host = side(entry({ languages: hostLangs, pref_fluency: 'fluent' }));
  const guest = side(entry({ id: 'e2', household_id: 'h2', scope: 'trip', languages: guestLangs, pref_fluency: 'fluent' }));
  const verdict = fits(host, guest);
  assert.equal(verdict.ok, true, 'English carries it');
  assert.equal(verdict.language.name, 'english');
  assert.equal(languageFor(host.entry, guest.entry).name, 'english', 'and that is the language the screens name');

  // With nothing spoken well enough on either side, it is still a no.
  const poor = side(entry({ id: 'e3', household_id: 'h3', scope: 'trip', languages: [{ name: 'English', level: 'some' }], pref_fluency: 'fluent' }));
  assert.equal(fits(host, poor).ok, false);
});

test('a new trip entry never has to be a standing one first', async () => {
  const home = await aHousehold(query, 'somebody with a standing entry');
  await repo.insertEntry(home.household.id, { scope: 'standing', interests: ['Chess club'] });
  // Before, this inserted the defaults and updated afterwards, so the row was
  // momentarily standing and the one-standing-entry index refused it outright.
  const trip = await repo.insertEntry(home.household.id, { scope: 'trip', interests: ['Beach walks'] });
  assert.equal(trip.scope, 'trip');
  assert.equal((await repo.entriesOf(home.household.id)).length, 2);
});

test('narrowing who you would meet lets go of the introductions it no longer admits', async () => {
  const { findIntroductions } = await import('../src/routes/openTo.js');
  const local = await aHousehold(query, 'a local who will narrow it');
  const away = await aHousehold(query, 'a couple visiting');
  await query('update households set home_lat = 51.4543, home_lng = -0.9781 where id = $1', [local.household.id]);
  await query(`insert into members (household_id, name, is_minor) values ($1, 'One', false), ($1, 'Two', false)`, [away.household.id]);
  const trip = (await query(
    `insert into trips (household_id, title, origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng, depart_at, return_at, travel_mode, intensity, base_lat, base_lng)
     values ($1, 'Reading', 'Lisbon', 38.72, -9.14, 'Reading', 51.4543, -0.9781, now(), now() + interval '3 days', 'walking', 'relaxed', 51.4543, -0.9781) returning *`,
    [away.household.id],
  )).rows[0];
  const langs = JSON.stringify([{ name: 'English', level: 'fluent' }]);
  const host = await repo.insertEntry(local.household.id, { scope: 'standing', interests: ['Chess club'], languages: langs, whereMiles: 25 });
  const guest = await repo.insertEntry(away.household.id, { scope: 'trip', tripId: trip.id, interests: ['Chess club'], languages: langs });
  // Other households in this database may fit too; this is about the one pair.
  await findIntroductions(guest);
  const ours = () => repo.matchesOf(local.household.id).then((rows) => rows.find((m) => m.guest_entry_id === guest.id));
  assert.equal((await ours())?.stage, 'host_asked');

  // "Families only" no longer admits a couple, and the introduction goes —
  // silently, before either of them was asked anything.
  await repo.updateEntry(host.id, { prefCompany: ['families'] });
  const { withdrawUnfitting } = await import('../src/routes/openTo.js');
  assert.ok(await withdrawUnfitting(await repo.entryById(host.id)) >= 1);
  assert.equal((await ours())?.stage, 'ended');
});

test('a match still reaches chat after its videos have been deleted', () => {
  // The twenty seconds are used for one decision and then they go. Their ids
  // go with them, and the stage must not wait for a file that was deleted on
  // purpose — otherwise no introduction could ever open a chat.
  const base = {
    host_verdict: 'yes', guest_verdict: 'yes',
    host_video_id: null, guest_video_id: null, host_video_yes: true, guest_video_yes: true,
    videos_deleted_at: new Date(), stage: 'both_yes',
  };
  assert.equal(nextStage(base, {}), 'both_yes', 'nobody has been checked yet');
  assert.equal(nextStage({ ...base, host_verified_at: new Date() }, {}), 'both_yes', 'one of two is not both');
  assert.equal(nextStage({ ...base, host_verified_at: new Date(), guest_verified_at: new Date() }, {}), 'chat');
  // And before either has answered, a missing video is still a missing video.
  assert.equal(nextStage({ ...base, videos_deleted_at: null, host_video_yes: null, guest_video_yes: null }, {}), 'videos');
});

test('a no ends the match and the videos go with it, without waiting for an answer that is not coming', () => {
  // The other side never answers an ended match, so waiting for their verdict
  // before deleting would keep two faces on a disk for ever.
  const m = {
    host_verdict: 'yes', guest_verdict: 'yes',
    host_video_id: 'a', guest_video_id: 'b',
    host_video_yes: null, guest_video_yes: null, stage: 'videos',
  };
  assert.equal(nextStage(m, { hostVideoYes: false }), 'ended');
  // And a yes on its own is not the end of anything: hers is still to come.
  assert.equal(nextStage(m, { hostVideoYes: true }), 'videos');
});

test('saying it again is editing it: what no longer fits is let go of', async () => {
  const { findIntroductions, withdrawUnfitting } = await import('../src/routes/openTo.js');
  const local = await aHousehold(query, 'a local who plays chess and bowls');
  const away = await aHousehold(query, 'a visitor who plays chess');
  await query('update households set home_lat = 51.4543, home_lng = -0.9781 where id = $1', [local.household.id]);
  const trip = (await query(
    `insert into trips (household_id, title, origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng, depart_at, return_at, travel_mode, intensity, base_lat, base_lng)
     values ($1, 'Reading', 'Lisbon', 38.72, -9.14, 'Reading', 51.4543, -0.9781, now(), now() + interval '3 days', 'walking', 'relaxed', 51.4543, -0.9781) returning *`,
    [away.household.id],
  )).rows[0];
  const langs = JSON.stringify([{ name: 'English', level: 'fluent' }]);
  const host = await repo.insertEntry(local.household.id, { scope: 'standing', interests: ['Chess club', 'Bowls'], languages: langs, whereMiles: 25 });
  const guest = await repo.insertEntry(away.household.id, { scope: 'trip', tripId: trip.id, interests: ['Chess club'], languages: langs });
  await findIntroductions(guest);
  const ours = () => repo.matchesOf(local.household.id).then((rows) => rows.find((m) => m.guest_entry_id === guest.id));
  assert.equal((await ours())?.stage, 'host_asked');

  // He takes chess off. The chess introduction has to go with it — nothing in
  // common is nothing in common, however it stopped being true.
  await repo.updateEntry(host.id, { interests: ['Bowls'] });
  assert.ok(await withdrawUnfitting(await repo.entryById(host.id)) >= 1);
  assert.equal((await ours())?.stage, 'ended');
});

test('a hello and an ID photograph are not on the public media route', async () => {
  const hostRepo = await import('../src/repositories/hosting.js');
  const home = await aHousehold(query, 'somebody with a hello and a passport');
  const bytes = Buffer.from('not really a video');
  // What Casual meet ups writes: a twenty-second hello, and the two images at
  // the gate. Both live in host_media beside a host's photograph, and the
  // public reader has to be able to tell them apart.
  const hello = await hostRepo.insertMedia({ householdId: home.household.id, kind: 'video', mime: 'video/webm', bytes });
  const doc = await hostRepo.insertMedia({ householdId: home.household.id, kind: 'photo', mime: 'image/jpeg', bytes });
  const listing = await hostRepo.insertMedia({ householdId: home.household.id, kind: 'photo', mime: 'image/jpeg', bytes, isPrivate: false });

  assert.equal((await hostRepo.mediaById(hello.id)).is_private, true);
  assert.equal((await hostRepo.mediaById(doc.id)).is_private, true);
  assert.equal((await hostRepo.mediaById(listing.id)).is_private, false, 'a listing photograph is on a public page and stays public');
});

test('a reviewer sees an ID check only while it is waiting on them', async () => {
  const home = await aHousehold(query, 'somebody at the gate');
  const away = await aHousehold(query, 'the other side of it');
  const h = await repo.insertEntry(home.household.id, { scope: 'standing', interests: ['Chess club'] });
  const g = await repo.insertEntry(away.household.id, { scope: 'trip', interests: ['Chess club'] });
  const match = await repo.insertMatch({ hostEntryId: h.id, guestEntryId: g.id, interests: ['Chess club'], kind: 'adult' });
  const hostRepo = await import('../src/repositories/hosting.js');
  const img = await hostRepo.insertMedia({ householdId: home.household.id, kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from('x'), isPrivate: true });

  let check = await repo.saveIdCheck({ matchId: match.id, householdId: home.household.id, side: 'host', docMediaId: img.id, selfieMediaId: img.id, state: 'draft' });
  assert.equal(check.state, 'draft', 'a draft is nobody else’s to look at');
  check = await repo.submitIdCheck(check.id);
  assert.equal(check.state, 'pending', 'sending it is what opens it to a reviewer');

  // Sent back, and then the replacement images land on the same row. Until it
  // is sent again it is a draft, and the reviewer's old address must not work.
  await repo.decideIdCheck(check.id, { state: 'failed', note: 'Too dark to read.', by: 'test' });
  assert.equal((await repo.idCheckOf(check.id)).state, 'failed');
  assert.equal((await repo.idCheckOf(check.id)).doc_media_id, null, 'and the images went with the decision');
  // A fresh photograph, because the old one no longer exists to point at.
  const again = await hostRepo.insertMedia({ householdId: home.household.id, kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from('y'), isPrivate: true });
  const redone = await repo.saveIdCheck({ matchId: match.id, householdId: home.household.id, side: 'host', docMediaId: again.id, selfieMediaId: null, state: 'draft' });
  assert.equal(redone.state, 'draft', 'a replacement is a draft until it is sent');
});

test('media is private unless somebody says otherwise', async () => {
  const hostRepo = await import('../src/repositories/hosting.js');
  const home = await aHousehold(query, 'a household with media');
  const bytes = Buffer.from('bytes');
  // The default is the safe one, so a new kind of upload cannot become public
  // by nobody having thought about it — which is how a hello and a passport
  // ended up on the public reader in the first place.
  const held = await hostRepo.insertMedia({ householdId: home.household.id, kind: 'video', mime: 'video/webm', bytes });
  assert.equal(held.is_private, true, 'private unless said otherwise');
  const listing = await hostRepo.insertMedia({ householdId: home.household.id, kind: 'photo', mime: 'image/jpeg', bytes, isPrivate: false });
  assert.equal(listing.is_private, false, 'and a listing photograph says otherwise, deliberately');
});

test('what an upload is for decides who may read it, and forgetting fails safe', async () => {
  const { hostMediaPurpose } = await import('../src/domain/hosting.js');
  // A listing's photograph is drawn on a page anybody may open; a host's
  // qualification is not, and the wizard says so on screen. Anything the code
  // forgets to name is private, so the failure is a picture that does not
  // draw rather than a certificate anybody can fetch.
  assert.equal(hostMediaPurpose('listing'), 'listing');
  assert.equal(hostMediaPurpose('evidence'), 'evidence');
  assert.equal(hostMediaPurpose(undefined), 'evidence', 'a purpose nobody named is not public');
  assert.equal(hostMediaPurpose('something else'), 'evidence');
});
