import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTravelMinutes, travelMode } from '../src/domain/travel.js';

/**
 * A mode a caller names must be a mode this file models.
 *
 * `walk` matched none of the profiles, took the "unknown mode" fallback, and
 * came back with driving times — so the travel sheet's counts sat still however
 * the mode was changed, and the fallback is exactly what stopped it looking
 * broken enough to notice.
 */
const from = { lat: 51.41, lng: -0.64 };
const to = { lat: 51.48, lng: -0.61 };   // about 8km away

test('the words the screens use are the words this file models', () => {
  assert.equal(travelMode('drive'), 'driving');
  assert.equal(travelMode('walk'), 'walking');
  assert.equal(travelMode('transit'), 'transit');
  // And its own names still work, for every caller that already used them.
  assert.equal(travelMode('driving'), 'driving');
  assert.equal(travelMode('walking'), 'walking');
});

test('an unknown mode still falls back, but a known one never reaches it', () => {
  assert.equal(travelMode('teleport'), 'driving');
  assert.equal(travelMode(null), 'driving');
});

test('each mode gives a different answer, which is the whole point of choosing one', () => {
  const drive = estimateTravelMinutes(from, to, 'drive');
  const transit = estimateTravelMinutes(from, to, 'transit');
  const walk = estimateTravelMinutes(from, to, 'walk');
  assert.ok(walk > transit, `walking (${walk}) should be slower than transit (${transit})`);
  assert.ok(transit > drive, `transit (${transit}) should be slower than driving (${drive})`);
  // The regression itself: walking must not equal driving.
  assert.notEqual(walk, drive, 'walk fell through to the driving profile');
});

// Settings revised v2 — close to home on the free distance estimate.
import { closeToHomeRadiusMiles, ANY_DISTANCE_MILES, searchRadiusKm } from '../src/domain/travel.js';

test('train and bus are transit, not a silent fall-back to driving', () => {
  assert.equal(travelMode('train'), 'transit');
  assert.equal(travelMode('bus'), 'transit');
  assert.equal(travelMode('car'), 'driving');
  assert.equal(travelMode('bike'), 'cycling');
});

test('close-to-home radius: any-distance is unbounded, furthest ticked mode wins, transit ≠ driving', () => {
  assert.equal(closeToHomeRadiusMiles({ minutes: null }), ANY_DISTANCE_MILES, 'Any distance is unbounded, not the old 10 miles');
  const car = closeToHomeRadiusMiles({ minutes: 60, modes: ['car'] });
  const walk = closeToHomeRadiusMiles({ minutes: 60, modes: ['walking'] });
  assert.ok(car > walk, 'car reaches further than walking in the same time');
  // Any ticked mode counts: car + walking together is the car radius.
  assert.equal(closeToHomeRadiusMiles({ minutes: 60, modes: ['car', 'walking'] }), car);
  // Train routes through transit, not the driving fall-back.
  const train = closeToHomeRadiusMiles({ minutes: 60, modes: ['train'] });
  assert.equal(train, Math.max(1, Math.round(searchRadiusKm('transit', 60, { capKm: 60 }) / 1.60934)));
  assert.notEqual(train, car);
});
