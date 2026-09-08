import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCount, bandOf, howFarShort, keeps, priceMarks, sortItems } from '../src/screens/inspireList.ts';

/**
 * The arithmetic under the Inspire tab's Where, Filters and Sort (handover v8,
 * 8 Sep 2026): every chip is composed from one pool in memory, and these are
 * the rules that compose it.
 */

const item = (over: Partial<any>): any => ({
  venueRef: over.venueRef ?? Math.random().toString(36).slice(2), name: over.name ?? 'x', category: 'attraction',
  moods: ['fun'], experiences: [], cuisines: [], rating: null, ratingCount: null, priceLevel: null,
  goodForChildren: null, photos: [], attribution: [], lat: 0, lng: 0, distanceKm: 1,
  travelMinutes: 10, estimated: true, dwellMinutes: 60, household: null, ...over,
});
const crowdFrom = (table: Record<string, number | null>) => (i: any) => ({ rating: table[i.name] ?? null, ratingCount: 10, known: i.name in table });
const none = () => ({ rating: null, ratingCount: null, known: false });

test('the £-bands: free is the cheapest band, unknown is no band', () => {
  assert.equal(bandOf(null), null);
  assert.equal(bandOf(0), 1);
  assert.equal(bandOf(2), 2);
  assert.equal(bandOf(9), 4);
  assert.equal(priceMarks(0), 'Free');
  assert.equal(priceMarks(3), '£££');
  assert.equal(priceMarks(null), null);
});

test('how far reads back in the short form the Where control uses', () => {
  assert.equal(howFarShort(20), '20 min');
  assert.equal(howFarShort(60), '1 hr');
  assert.equal(howFarShort(120), '2 hr');
  assert.equal(howFarShort(null), 'Any distance');
});

test('a travel ceiling and a price band narrow the pool', () => {
  const near = item({ travelMinutes: 15, priceLevel: 2 });
  const far = item({ travelMinutes: 90, priceLevel: 2 });
  const unpriced = item({ travelMinutes: 15, priceLevel: null });
  assert.ok(keeps(near, { travel: 60, rating: 0, price: 'any' }, none));
  assert.ok(!keeps(far, { travel: 60, rating: 0, price: 'any' }, none));
  assert.ok(keeps(far, { travel: null, rating: 0, price: 'any' }, none), 'no ceiling keeps everything');
  assert.ok(keeps(near, { travel: 60, rating: 0, price: '2' }, none));
  assert.ok(!keeps(near, { travel: 60, rating: 0, price: '3' }, none));
  assert.ok(!keeps(unpriced, { travel: 60, rating: 0, price: '2' }, none), 'a place with no price is in no band');
  assert.ok(keeps(unpriced, { travel: 60, rating: 0, price: 'any' }, none), 'but is still shown under Any');
});

test('a rating floor excludes what has not been rated yet, not only what rated low', () => {
  const crowd = crowdFrom({ good: 4.6, meh: 3.9 });
  const good = item({ name: 'good' }), meh = item({ name: 'meh' }), unknown = item({ name: 'unknown' });
  const f = { travel: null, rating: 4, price: 'any' };
  assert.ok(keeps(good, f, crowd));
  assert.ok(!keeps(meh, f, crowd));
  assert.ok(!keeps(unknown, f, crowd), 'nobody can say an unrated place is 4.0+');
});

test('the count on the Filters control: rating, price and the picked type', () => {
  assert.equal(activeCount({ travel: 60, rating: 0, price: 'any' }, null), 0);
  assert.equal(activeCount({ travel: 20, rating: 0, price: 'any' }, null), 0, 'how far is the Where control, not a filter');
  assert.equal(activeCount({ travel: 60, rating: 4.5, price: '2' }, 'culture'), 3);
});

test('sorting: unknowns last, ties keep the pool\'s own order', () => {
  const a = item({ name: 'a', travelMinutes: 30, priceLevel: 3 });
  const b = item({ name: 'b', travelMinutes: 10, priceLevel: null });
  const c = item({ name: 'c', travelMinutes: 20, priceLevel: 1 });
  const d = item({ name: 'd', travelMinutes: 5, priceLevel: 1 });
  const pool = [a, b, c, d];
  const crowd = crowdFrom({ a: 4.2, c: 4.8, d: 4.8 });
  const typeOf = (i: any) => i.name === 'a' ? 'Walks' : 'Castles';
  assert.deepEqual(sortItems(pool, 'rating', crowd, typeOf).map((i) => i.name), ['c', 'd', 'a', 'b'], 'rating: 4.8, 4.8 (pool order), 4.2, then the unrated');
  assert.deepEqual(sortItems(pool, 'distance', crowd, typeOf).map((i) => i.name), ['d', 'b', 'c', 'a']);
  assert.deepEqual(sortItems(pool, 'price', crowd, typeOf).map((i) => i.name), ['c', 'd', 'a', 'b'], 'price: the unpriced last');
  assert.deepEqual(sortItems(pool, 'type', crowd, typeOf).map((i) => i.name), ['b', 'c', 'd', 'a'], 'type: Castles before Walks, pool order inside');
  assert.deepEqual(pool.map((i) => i.name), ['a', 'b', 'c', 'd'], 'the pool itself is not reordered');
});
