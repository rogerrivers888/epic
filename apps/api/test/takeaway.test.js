/**
 * A takeaway is not a restaurant.
 *
 * The owner, 5 Sep 2026: "I don't really want fast food appearing in
 * restaurants, or maybe it returns a takeaway category also, or something like
 * that that might signify fast food."
 *
 * It does, and the shapes below are what the live Places API returned when
 * asked that day — not invented ones. They are the whole reason this is a test
 * rather than a comment: **both carry `restaurant` in the type list**, so
 * reading the primary type alone lets them straight through, and Domino's has
 * no `fast_food_restaurant` type at all. Only the takeaway and delivery types
 * say what it is.
 *
 * A regression here is silent: the search still works, the results still look
 * like results, and a chicken shop is quietly back on the same row as somewhere
 * you book a table.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { toVenue } = await import('../src/sources/google.js');
const { NO_RULES, shelvesForVenue, vocabularyOf } = await import('../src/domain/moods.js');

/** The Food drawers, in the shape `shelfTaxonomy.taxonomy()` hands over. */
const VOCAB = vocabularyOf(
  [{ key: 'fun' }, { key: 'food' }, { key: 'culture' }],
  [
    { key: 'restaurants', category_key: 'food' },
    { key: 'cafes', category_key: 'food' },
    { key: 'pubs-bars', category_key: 'food' },
    { key: 'fast-food', category_key: 'food' },
  ],
);

const place = (name, types, primaryType) => toVenue({
  id: `id-${name}`, displayName: { text: name }, types, primaryType,
  location: { latitude: 51.4, longitude: -0.6 },
});

test('KFC is a takeaway, though Google also calls it a restaurant', () => {
  // Live answer, 5 Sep 2026.
  const kfc = place('KFC Bracknell', [
    'chicken_wings_restaurant', 'fast_food_restaurant', 'meal_takeaway',
    'food', 'restaurant', 'chicken_restaurant', 'point_of_interest', 'establishment',
  ], 'fast_food_restaurant');
  assert.equal(kfc.category, 'takeaway');
  assert.ok(kfc.styles.includes('fast-food'));
  assert.ok(kfc.styles.includes('takeaway'));
});

test("a delivery shop whose whole business is delivery is a takeaway", () => {
  // The owner's second guess, and the case `fast_food_restaurant` alone misses.
  // It counts because taking away is the *primary* type — the whole business —
  // not merely something the place also does.
  const dominos = place("Domino's Pizza - Sunningdale", [
    'food_delivery', 'restaurant', 'meal_delivery', 'food', 'meal_takeaway',
    'point_of_interest', 'establishment',
  ], 'meal_delivery');
  assert.equal(dominos.category, 'takeaway');
  assert.ok(dominos.styles.includes('takeaway'));
});

test('PizzaExpress will box your pizza up and is still a restaurant', () => {
  // The first version of this filed it as a takeaway, and the deployed search
  // showed it. `meal_takeaway` is a service half the high street offers; it
  // only decides the category when it is the primary type.
  const pe = place('PizzaExpress', [
    'pizza_restaurant', 'italian_restaurant', 'restaurant', 'meal_takeaway',
    'meal_delivery', 'food', 'point_of_interest', 'establishment',
  ], 'pizza_restaurant');
  assert.equal(pe.category, 'restaurant');
  // Recorded all the same: "they will box it up" is worth knowing.
  assert.ok(pe.styles.includes('takeaway'));
  assert.ok(!pe.styles.includes('fast-food'));
});

test('a restaurant that does not do takeaway is still a restaurant', () => {
  const trattoria = place('Amalfi Ristorante', [
    'italian_restaurant', 'restaurant', 'food', 'point_of_interest', 'establishment',
  ], 'italian_restaurant');
  assert.equal(trattoria.category, 'restaurant');
  assert.deepEqual(trattoria.styles, []);
  assert.deepEqual(trattoria.cuisines, ['italian']);
});

test('a pub that does food is not turned into a takeaway', () => {
  // `pub` is its own category and must not be swept up: the fast-food override
  // only ever reaches somewhere already filed as a restaurant or a café.
  const pub = place('The Star', ['pub', 'bar', 'restaurant', 'meal_takeaway', 'food'], 'pub');
  assert.equal(pub.category, 'pub');
});

test('a takeaway is still Food, and lands in its own drawer', () => {
  // Told apart, not hidden. If this ever returned anything but `food`, every
  // takeaway would vanish from a search for somewhere to eat — which is not
  // what was asked for.
  const kfc = { source: 'google', sourcePlaceId: 'k', category: 'takeaway', styles: ['fast-food', 'takeaway'], experiences: [] };
  const out = shelvesForVenue(kfc, NO_RULES, VOCAB);
  assert.equal(out.category, 'food');
  assert.equal(out.subcategory, 'fast-food');
});

test('a restaurant lands in the Restaurants drawer, not beside the chip shop', () => {
  const out = shelvesForVenue(
    { source: 'google', sourcePlaceId: 'r', category: 'restaurant', styles: [], experiences: [] },
    NO_RULES, VOCAB,
  );
  assert.equal(out.subcategory, 'restaurants');
});
