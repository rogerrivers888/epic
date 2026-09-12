/**
 * The suggested home for a Google type — what the mapping tool offers the
 * owner to approve or change (12 Sep 2026). Pinned: a day-out type suggests a
 * drawer that exists, a whole group that is never a day out is suggested
 * aside, a cuisine is a restaurant, and a word nobody is sure about suggests
 * nothing rather than something wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { suggestFor } = await import('../src/domain/googleSuggest.js');
const { GOOGLE_TYPES } = await import('../src/sources/googleTypes.js');

const DRAWERS = ['theme-parks', 'zoos-wildlife', 'karting', 'restaurants', 'cafes', 'fast-food', 'pubs-bars', 'churches', 'museums', 'galleries', 'parks', 'arenas'];

test('a day-out type suggests the obvious drawer, and only one that exists', () => {
  assert.equal(suggestFor('amusement_park', 'Entertainment and Recreation', DRAWERS).subcategory, 'theme-parks');
  assert.equal(suggestFor('go_karting_venue', 'Entertainment and Recreation', DRAWERS).subcategory, 'karting');
  assert.equal(suggestFor('go_karting_venue', 'Entertainment and Recreation', ['restaurants']), null);
});

test('a group that is never a day out is suggested aside, type by type', () => {
  assert.equal(suggestFor('car_wash', 'Automotive', DRAWERS).aside, true);
  assert.equal(suggestFor('hotel', 'Lodging', DRAWERS).aside, true);
  assert.equal(suggestFor('casino', 'Entertainment and Recreation', DRAWERS).aside, true);
});

test('a cuisine is a restaurant, and the cuisine rides along; a counter is not', () => {
  assert.equal(suggestFor('thai_restaurant', 'Food and Drink', DRAWERS).subcategory, 'restaurants');
  assert.equal(suggestFor('thai_restaurant', 'Food and Drink', DRAWERS).cuisine, 'thai');
  assert.equal(suggestFor('fine_dining_restaurant', 'Food and Drink', DRAWERS).cuisine, undefined);
  assert.equal(suggestFor('steak_house', 'Food and Drink', DRAWERS).cuisine, 'steakhouse');
  assert.equal(suggestFor('fast_food_restaurant', 'Food and Drink', DRAWERS).subcategory, 'fast-food');
  assert.equal(suggestFor('ice_cream_shop', 'Food and Drink', DRAWERS).subcategory, 'cafes');
});

test('where nothing is obvious, nothing is suggested', () => {
  assert.equal(suggestFor('paintball_center', 'Entertainment and Recreation', DRAWERS), null);
  assert.equal(suggestFor('tourist_attraction', 'Entertainment and Recreation', DRAWERS), null);
});

test('every suggestion names a drawer key that could exist, never a category or a typo', () => {
  // The keys the seed ships (migration 053 + 073). A suggestion pointing at a
  // drawer that is not in this list is a typo in the map.
  const SEEDED = new Set([
    'pools', 'climbing', 'skating', 'cycling', 'paddling', 'athletics', 'karting', 'circuits', 'flying', 'watersports', 'ropes', 'off-road',
    'museums', 'galleries', 'castles', 'historic-houses', 'churches', 'ancient-sites', 'theatre', 'landmarks',
    'restaurants', 'pubs-bars', 'cafes', 'food-markets', 'fast-food', 'theme-parks', 'zoos-wildlife', 'play', 'cinema-bowling', 'live-music', 'lidos', 'days-out',
    'parks', 'woodland', 'coast', 'water', 'hills', 'nature', 'viewpoints', 'trails', 'caves-falls', 'gardens', 'spas', 'browsing', 'markets', 'scenic',
    'football', 'rugby-cricket', 'racecourses', 'golf', 'racquet-clubs', 'arenas',
  ]);
  for (const { type, group } of GOOGLE_TYPES) {
    const s = suggestFor(type, group, [...SEEDED]);
    if (s?.subcategory) assert.ok(SEEDED.has(s.subcategory), `${type} → ${s.subcategory}`);
  }
});
