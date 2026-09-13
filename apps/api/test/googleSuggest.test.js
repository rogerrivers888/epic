/**
 * The suggested home for a Google type — what the mapping tool offers the
 * owner to approve or change (12 Sep 2026). Pinned: a day-out type suggests a
 * drawer that exists, a whole group that is never a day out is suggested
 * aside, a cuisine is a restaurant, and a word nobody is sure about suggests
 * nothing rather than something wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { suggestFor, sureDecisionFor, sureMappingFor } = await import('../src/domain/googleSuggest.js');
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

test('parking and stations are useful nearby, never thrown out; and the sure decisions never touch our subcategories', () => {
  assert.equal(suggestFor('parking', 'Automotive', DRAWERS).travel, true);
  assert.equal(suggestFor('train_station', 'Transportation', DRAWERS).travel, true);
  assert.equal(suggestFor('visitor_center', 'Services', DRAWERS).nearby, true);
  assert.equal(sureDecisionFor('parking', 'Automotive'), 'travel');
  assert.equal(sureDecisionFor('airport', 'Transportation'), 'travel');
  assert.equal(sureDecisionFor('gas_station', 'Automotive'), 'aside');
  assert.equal(sureDecisionFor('rest_stop', 'Automotive'), 'aside');
  assert.equal(sureDecisionFor('car_dealer', 'Automotive'), 'aside');
  assert.equal(sureDecisionFor('hotel', 'Lodging'), 'aside');
  assert.equal(sureDecisionFor('amusement_park', 'Entertainment and Recreation'), null);
  assert.equal(sureDecisionFor('thai_restaurant', 'Food and Drink'), null);
  assert.equal(sureDecisionFor('paintball_center', 'Entertainment and Recreation'), null);
});

test('a mapping Epic is sure of is made itself; a judgement stays a suggestion', () => {
  assert.equal(sureMappingFor('european_restaurant', 'Food and Drink', DRAWERS).subcategory, 'restaurants');
  assert.equal(sureMappingFor('museum', 'Culture', DRAWERS).subcategory, 'museums');
  assert.equal(sureMappingFor('marina', 'Entertainment and Recreation', DRAWERS), null);
  assert.ok(suggestFor('marina', 'Entertainment and Recreation', [...DRAWERS, 'paddling']).subcategory);
  assert.equal(sureMappingFor('car_dealer', 'Automotive', DRAWERS), null);
});

test('where nothing is obvious, nothing is suggested', () => {
  assert.equal(suggestFor('paintball_center', 'Entertainment and Recreation', DRAWERS), null);
  assert.equal(suggestFor('skateboard_park', 'Entertainment and Recreation', DRAWERS), null);
  // `tourist_attraction` used to be here. It is not "nothing obvious" — it is a
  // label that spans our categories, and has its own answer now (13 Sep 2026).
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

test('a word that spans our categories is a label, never a mapping', () => {
  // Owner, 13 Sep 2026: "it's just a label called 'tourist attraction'… where
  // we recognise that a Google category is simply a generic label that catches
  // multiple subcategories that span multiple different categories in Epic, we
  // should just create a label for the category."
  for (const t of ['tourist_attraction', 'establishment', 'point_of_interest', 'food', 'sports_activity_location']) {
    assert.equal(suggestFor(t, 'Entertainment and Recreation', DRAWERS).generic, true, t);
    assert.equal(sureDecisionFor(t, 'Entertainment and Recreation'), 'generic', t);
    // Generic beats every other reading: it is never mapped, aside or nearby.
    assert.equal(suggestFor(t, 'Entertainment and Recreation', DRAWERS).subcategory, undefined, t);
    assert.equal(sureMappingFor(t, 'Entertainment and Recreation', DRAWERS), null, t);
  }
  // A word that only ever catches things we exclude is excluded, not generic.
  assert.equal(suggestFor('finance', null, DRAWERS).aside, true);
  assert.equal(suggestFor('general_contractor', null, DRAWERS).aside, true);
  assert.equal(sureDecisionFor('finance', null), 'aside');
  // And a specific word in the same group is untouched.
  assert.equal(suggestFor('museum', 'Culture', DRAWERS).subcategory, 'museums');
  assert.equal(suggestFor('museum', 'Culture', DRAWERS).generic, undefined);
});

test('a word is read from what it actually holds, not from what it sounds like', () => {
  // Looked at through /examples on 13 Sep 2026: event venues are rooms you hire
  // (Landing Forty Two, Avenue Conference & Events), dance halls are classes and
  // studios, and an adventure sports centre is as often an indoor activity arena
  // as a high-ropes course. All three used to be suggested a drawer they do not
  // belong in.
  assert.equal(suggestFor('event_venue', 'Entertainment and Recreation', DRAWERS).subcategory, undefined);
  assert.equal(suggestFor('event_venue', 'Entertainment and Recreation', DRAWERS).aside, true);
  assert.equal(suggestFor('dance_hall', 'Entertainment and Recreation', DRAWERS).aside, true);
  assert.equal(suggestFor('adventure_sports_center', 'Entertainment and Recreation', DRAWERS), null);
  // But none of the three is decided without him: they are all in UNSURE.
  assert.equal(sureDecisionFor('event_venue', 'Entertainment and Recreation'), null);
  assert.equal(sureDecisionFor('dance_hall', 'Entertainment and Recreation'), null);
  // A genuine gig venue is still mapped by its own word.
  const GIGS = [...DRAWERS, 'live-music', 'theatre'];
  assert.equal(suggestFor('live_music_venue', 'Entertainment and Recreation', GIGS).subcategory, 'live-music');
  assert.equal(suggestFor('concert_hall', 'Entertainment and Recreation', GIGS).subcategory, 'theatre');
  // And a whole aside group is still decided without asking.
  assert.equal(sureDecisionFor('car_wash', 'Automotive'), 'aside');
});
