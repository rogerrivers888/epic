import test from 'node:test';
import assert from 'node:assert/strict';
import { epicRating, foodType, inList, listOf, sortPlaces, whenLabel } from '../src/screens/placesRows.ts';

/**
 * What a Places row says (handover v8, 8 Sep 2026, §3): which list a place is
 * in, what the household's own mark reads, the one word Food & drink uses, and
 * the date as the row prints it.
 */

const place = (over: Partial<any>): any => ({
  venueRef: 'x', name: 'x', kind: null, category: 'attraction', lat: 0, lng: 0, country: null, countryCode: null, locality: null,
  venue: null, note: null, visits: 0, lastOn: null, takes: [], ledger: null, onTrips: [], status: 'saved', special: false,
  loved: 0, notForMe: 0, scores: [], postcode: null, station: null, stationLines: [], stationKind: null, stationDistanceM: null, whereChecked: null,
  ...over,
});

test('Been includes loved; Shortlisted is only where nobody has been', () => {
  const short = place({ visits: 0 }), been = place({ visits: 2 }), loved = place({ visits: 1, special: true });
  assert.equal(listOf(short), 'short');
  assert.equal(listOf(been), 'been');
  assert.equal(listOf(loved), 'loved');
  assert.ok(inList(loved, 'been'), 'a loved place has been visited');
  assert.ok(inList(loved, 'loved'));
  assert.ok(!inList(loved, 'short'));
  assert.ok(inList(been, 'been') && !inList(been, 'loved'));
  assert.ok(inList(short, 'short') && !inList(short, 'been'));
});

test('the Epic rating: the mean of everybody, and who gave it', () => {
  const me = 'm1';
  const s = (memberId: string, member: string, score: number) => ({ memberId, member, score, on: '2026-08-30' });
  assert.equal(epicRating(place({}), me), null, 'no scores, no mark');
  assert.deepEqual(epicRating(place({ scores: [s('m1', 'Roger Rivers', 5)] }), me), { score: 5, by: 'You' });
  assert.deepEqual(epicRating(place({ scores: [s('m2', 'Sam Rivers', 4)] }), me), { score: 4, by: 'Sam' });
  assert.deepEqual(epicRating(place({ scores: [s('m2', 'Sam Rivers', 4), s('m1', 'Roger Rivers', 5)] }), me), { score: 4.5, by: 'You & Sam' }, 'you first, whatever the order');
  assert.deepEqual(epicRating(place({ scores: [s('m1', 'R', 5), s('m2', 'S', 4), s('m3', 'J', 3.5), s('m4', 'A', 4)] }), me), { score: 4.1, by: 'Family · 4 ratings' });
  assert.deepEqual(epicRating(place({ scores: [s('m2', 'S', 4), s('m3', 'J', 3)] }), null), { score: 3.5, by: 'S & J' }, 'nobody chosen on this device: names');
});

test('Food & drink says one word for what a place is', () => {
  assert.equal(foodType(place({ category: 'pub', venue: { cuisines: ['british'] } })), 'Pub');
  assert.equal(foodType(place({ category: 'cafe' })), 'Café');
  assert.equal(foodType(place({ category: 'restaurant', venue: { cuisines: ['italian', 'pizza'] } })), 'Italian');
  assert.equal(foodType(place({ category: 'restaurant', venue: { cuisines: ['modern-british'] } })), 'Modern british');
  assert.equal(foodType(place({ category: 'restaurant', subcategoryLabel: 'Fine dining' })), 'Fine dining');
  assert.equal(foodType(place({ category: 'restaurant' })), 'Restaurant');
});

test('the date on a row: this year by day, any other by month', () => {
  const now = new Date('2026-09-08T12:00:00');
  assert.equal(whenLabel('2026-08-30', now), '30 Aug');
  assert.equal(whenLabel('2025-06-14T10:00:00Z', now), 'Jun 2025');
  assert.equal(whenLabel(null, now), null);
  assert.equal(whenLabel('not a date', now), null);
});

test('sorting: most recent, the household\'s mark, the crowd\'s, and the alphabet', () => {
  const s = (memberId: string, score: number) => ({ memberId, member: memberId, score, on: '2026-01-01' });
  const a = place({ name: 'Alpha', lastOn: '2025-01-01', scores: [s('m1', 3)], rating: 4.9 });
  const b = place({ name: 'Bravo', lastOn: '2026-08-01', scores: [], rating: 4.1 });
  const c = place({ name: 'Charlie', lastOn: null, scores: [s('m1', 5)], rating: null });
  const names = (rows: any[]) => rows.map((p) => p.name);
  assert.deepEqual(names(sortPlaces([a, b, c], 'recent', null)), ['Bravo', 'Alpha', 'Charlie']);
  assert.deepEqual(names(sortPlaces([a, b, c], 'ours', null)), ['Charlie', 'Alpha', 'Bravo']);
  assert.deepEqual(names(sortPlaces([a, b, c], 'rating', null)), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(names(sortPlaces([c, b, a], 'az', null)), ['Alpha', 'Bravo', 'Charlie']);
});
