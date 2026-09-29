/**
 * The Places explorer & Google compare additions (owner, 28 Sep 2026).
 *
 * Three pieces of arithmetic the back-office screens will be built on, held here
 * because each is silent when it is wrong:
 *
 *   · "Show names from Google" must bill at Pro, not Essentials — a name and a
 *     type are Pro fields (Codex, 19 Sep 2026), so the estimate a person sees
 *     before they press it is ~2.5p a place, not the free tier the word "names"
 *     suggests. A regression here quietly under-quotes a paid button.
 *   · the compare must carry Google's amenity, access and parking facts, or the
 *     "where are the holes in our data" board has no holes to show.
 *   · the subcategory summary counts Google only for places actually compared,
 *     so its Google column can never silently imply a call was made.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { toVenue, skuFor, rankedSlice } = await import('../src/sources/google.js');
const { costOf } = await import('../src/domain/providerPrices.js');
const { PAIRS, coverageByField, cachedDetail, blank } = await import('../src/sources/compare.js');

test('the name+type mask is Pro, not Essentials — the reveal is a paid call', () => {
  // The cheapest mask that reaches a human name, on a Place Details path.
  assert.equal(skuFor('id,displayName,primaryType', '/places/ChIJabc'), 'google-pro');
  // And so it is priced, not free: about 2.5p a place, so 21 places is ~53p.
  assert.equal(costOf({ google: 1, 'google-pro': 1 }), 0.032);
  assert.ok(costOf({ google: 1, 'google-pro': 1 }) > 0, 'a name is never free');
  // Ids alone stay free — the reveal is the one that costs, not the census.
  assert.equal(costOf({ google: 1, 'google-essentials': 1 }), 0);
});

test('the ranked list mask is the cheap Pro one, not a display search', () => {
  // The ranked Google list buys names + type, not ratings/hours/photos — so it
  // must file at google-pro, never the dearer google-search (display) tier.
  assert.equal(skuFor('places.id,places.displayName,places.primaryType,nextPageToken', '/places:searchText'), 'google-pro');
  assert.equal(typeof rankedSlice, 'function');
});

test('rankedSlice with no box asks Google nothing', async () => {
  // No box, no call — a guard before the paid door, so a bad request never
  // spends. (Whether Google is keyed or not, this returns before call().)
  const out = await rankedSlice({});
  assert.equal(out.requests, 0);
  assert.deepEqual(out.places, []);
  assert.equal(out.nextPageToken, null);
});

test('toVenue surfaces Google’s amenity, access and parking facts when the mask asked for them', () => {
  const v = toVenue({
    id: 'x', displayName: { text: 'The Ivy' }, types: ['restaurant'], primaryType: 'restaurant',
    location: { latitude: 51.4, longitude: -0.6 },
    accessibilityOptions: { wheelchairAccessibleEntrance: true },
    parkingOptions: { freeParkingLot: true }, allowsDogs: true, outdoorSeating: false,
    restroom: true, dineIn: true, takeout: false, delivery: true, goodForGroups: true,
  });
  assert.deepEqual(v.accessibilityOptions, { wheelchairAccessibleEntrance: true });
  assert.deepEqual(v.parking, { freeParkingLot: true });
  assert.equal(v.dogsAllowed, true);
  // A definite "no" is a value, not a hole: false must survive, not become null.
  assert.equal(v.outdoorSeating, false);
  assert.equal(v.restroom, true);
  assert.equal(v.dineIn, true);
  assert.equal(v.takeout, false);
  assert.equal(v.goodForGroups, true);
});

test('a search that never asked for the amenities leaves them off the venue entirely', () => {
  // undefined, not null: an unfetched field simply is not there, so `lineUp` and
  // the summary skip it rather than drawing a firm "no".
  const v = toVenue({
    id: 'y', displayName: { text: 'A park' }, types: ['park'], primaryType: 'park',
    location: { latitude: 51.4, longitude: -0.6 },
  });
  assert.equal('parking' in v, false);
  assert.equal('dogsAllowed' in v, false);
  assert.equal('restroom' in v, false);
});

test('PAIRS aligns Google’s amenities against our (empty) column', () => {
  const googleKeys = new Set(PAIRS.map((t) => t[1]).filter(Boolean));
  for (const k of ['accessibilityOptions', 'parking', 'dogsAllowed', 'outdoorSeating', 'restroom', 'dineIn', 'takeout', 'goodForGroups', 'primaryType']) {
    assert.ok(googleKeys.has(k), `PAIRS should carry Google's ${k}`);
  }
});

test('cachedDetail speaks only when a detail is held', () => {
  // Nothing opened, nothing to say — a can't-speak null, never an empty place.
  assert.equal(cachedDetail('google', 'never-fetched-id'), null);
});

test('coverageByField counts ours and Google per field, Google only where compared', () => {
  const places = [
    // opened (compared): we hold a name+address, Google holds name+parking
    { ours: { name: 'A', address: '1 St' }, google: { name: 'A', parking: { freeParkingLot: true } } },
    // opened: we hold nothing, Google holds a name and dogs-allowed=false (a value)
    { ours: null, google: { name: 'B', dogsAllowed: false } },
    // not compared: contributes to ours + total, nothing to Google
    { ours: { name: 'C', website: 'c.co' }, google: null },
  ];
  const by = new Map(coverageByField(places).map((f) => [f.key, f]));
  assert.equal(by.get('name').ours, 2, 'two of three carry a name of ours');
  assert.equal(by.get('name').google, 2, 'two were compared and both had a Google name');
  assert.equal(by.get('address').ours, 1);
  assert.equal(by.get('website').ours, 1);
  // A definite false is a held value, so it counts.
  assert.equal(by.get('dogsAllowed').google, 1);
  assert.equal(by.get('parking').google, 1);
  // A Tripadvisor-only row has nothing to compare here and is not emitted.
  assert.equal(by.has('ta_awards'), false);
});

test('blank treats an empty object and empty array as holes, and false as a value', () => {
  assert.equal(blank({}), true);
  assert.equal(blank([]), true);
  assert.equal(blank(''), true);
  assert.equal(blank(null), true);
  assert.equal(blank(false), false);
  assert.equal(blank({ a: 1 }), false);
});
