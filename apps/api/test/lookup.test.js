/**
 * The back office's Lookup (12 Sep 2026): the arithmetic behind "N places
 * within 30 minutes, 20 of them from Google".
 *
 * Three things are worth pinning. The ring has to agree with the fence, or the
 * sources are asked about places the list then throws away. Our own rows have
 * to fold into the rented ones, or Windsor Castle is counted twice and the
 * "from our own data" number is a lie. And the raw provider records have to
 * survive resolution, because the whole screen ends in "literally the fields
 * that we get".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, kindOf, reachKm, tally, total, withinReach, RING_CAP_KM } from '../src/domain/lookup.js';
import { estimateTravelMinutes } from '../src/domain/travel.js';
import { recordsOf, resolveVenues } from '../src/sources/index.js';

const at = { lat: 51.39, lng: -0.63 };

test('the ring is the furthest the minutes reach, and never further', () => {
  for (const [mode, minutes] of [['drive', 15], ['drive', 30], ['walk', 20], ['transit', 45]]) {
    const km = reachKm(mode, minutes, { at });
    const edge = { lat: at.lat + km / 111, lng: at.lng };
    assert.ok(estimateTravelMinutes(at, edge, mode) <= minutes, `${mode} ${minutes}: ${km} km is inside`);
    const past = { lat: at.lat + (km + 0.5) / 111, lng: at.lng };
    assert.ok(estimateTravelMinutes(at, past, mode) > minutes || km >= RING_CAP_KM, `${mode} ${minutes}: ${km + 0.5} km is outside`);
  }
  assert.ok(reachKm('walk', 15, { at }) < reachKm('drive', 15, { at }), 'a walk reaches less than a drive');
  assert.ok(reachKm('drive', 60, { at }) < RING_CAP_KM, 'an hour by car is inside what the sources answer');
  assert.equal(reachKm('drive', 180, { at }), RING_CAP_KM, 'capped where the sources stop answering');
  assert.ok(reachKm('drive', 180, { at, cap: 1000 }) > RING_CAP_KM, 'and the uncapped figure is what says so');
});

test('somewhere to eat is food; everything else, an event included, is something to do', () => {
  assert.equal(kindOf('restaurant'), 'food');
  assert.equal(kindOf('takeaway'), 'food');
  assert.equal(kindOf('attraction'), 'activities');
  assert.equal(kindOf('event'), 'activities');
});

const item = (ref, name, sources, lat = 51.39, lng = -0.63, kind = 'activities') =>
  ({ ref, name, kind, sources: [...sources], records: sources.map((s) => ({ source: s, fields: { name } })), lat, lng, website: null });

test('our own rows fold into the rented ones by identifier, then by name within 250 m', () => {
  const items = [];
  fold(items, item('google:1', 'Windsor Castle', ['google', 'osm']));
  // The sweep keys on the Google identifier: same place, one more source.
  fold(items, item('google:1', 'Windsor Castle', ['sweep']));
  // The atlas keys on Wikidata and sits 100 m away: same place by name.
  fold(items, item('wikidata:Q42', 'Windsor Castle', ['atlas'], 51.3909, -0.63));
  // Same name, a town away: a different place.
  fold(items, item('wikidata:Q43', 'Windsor Castle', ['atlas'], 51.5, -0.63));
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].sources, ['google', 'osm', 'sweep', 'atlas']);
  assert.equal(items[0].records.length, 4, 'every record travels with the place it folded into');
});

test('a name in any script is a name, and no name at all matches nothing', () => {
  const items = [];
  fold(items, item('osm:1', '金龍', ['osm']));
  fold(items, item('google:1', '金龍', ['google'], 51.3901, -0.63));
  fold(items, item('google:2', '福記', ['google'], 51.3902, -0.63));
  assert.equal(items.length, 2, 'the same Chinese name folds; a different one does not');
  fold(items, item('osm:2', '···', ['osm'], 51.3903, -0.63));
  fold(items, item('osm:3', '???', ['osm'], 51.3904, -0.63));
  assert.equal(items.length, 4, 'two names that normalise to nothing stay two places');
  // A vowel sign is a letter in Devanagari, not an accent to fold away.
  fold(items, item('osm:4', 'कि', ['osm'], 51.3905, -0.63));
  fold(items, item('osm:5', 'कु', ['osm'], 51.3906, -0.63));
  assert.equal(items.length, 6, 'कि and कु are two words');
  fold(items, item('google:6', 'Café Rouge', ['google'], 51.3907, -0.63));
  fold(items, item('osm:7', 'Cafe Rouge', ['osm'], 51.3908, -0.63));
  assert.equal(items.length, 7, 'and a Latin accent still folds');
});

test('the counts say how many places carry each source, per half of the screen', () => {
  const items = [
    item('google:1', 'A', ['google', 'osm']),
    item('google:2', 'B', ['google'], 51.39, -0.63, 'food'),
    item('wikidata:Q1', 'C', ['atlas']),
  ];
  assert.deepEqual(total(items), { activities: 2, food: 1, all: 3 }, 'distinct places, not the sum of the sources');
  assert.deepEqual(tally(items, ['google', 'osm', 'atlas', 'sweep']), {
    google: { activities: 1, food: 1, all: 2 },
    osm: { activities: 1, food: 0, all: 1 },
    atlas: { activities: 1, food: 0, all: 1 },
    sweep: { activities: 0, food: 0, all: 0 },
  });
});

test('the fence keeps what the minutes reach and says how long each one takes', () => {
  const near = item('a', 'Near', ['osm'], 51.395, -0.63);
  const far = item('b', 'Far', ['osm'], 51.9, -0.63);
  const kept = withinReach([far, near], at, 'drive', 30);
  assert.deepEqual(kept.map((k) => k.ref), ['a']);
  assert.ok(kept[0].travelMinutes > 0 && kept[0].distanceKm > 0);
});

test('the raw provider records survive resolution, one per source, untouched', () => {
  const google = { source: 'google', sourcePlaceId: 'x', name: 'The Bell', category: 'pub', lat: 51.39, lng: -0.63, rating: 4.5, openingHours: 'Mon 9-5' };
  const osm = { source: 'osm', sourcePlaceId: 'node/1', name: 'The Bell', category: 'pub', lat: 51.3901, lng: -0.63, rating: null, website: 'https://bell.example' };
  const [venue] = resolveVenues([google, osm]);
  assert.deepEqual(venue.contributingSources, ['google', 'osm']);
  const records = recordsOf(venue);
  assert.equal(records.length, 2);
  assert.equal(records[0], google, 'the first record is the object the source handed over');
  assert.equal(records[1], osm);
  assert.equal(records[1].rating, null, 'the merge changed the venue, not the record');
  // A venue nobody resolved has nothing behind it, and says so rather than throwing.
  assert.deepEqual(recordsOf({ name: 'stray' }), []);
});
