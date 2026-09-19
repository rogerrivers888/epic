/**
 * The fence that decides whether two sources mean the same place.
 *
 * It was 150 m, and at 150 m experiment 1 reported Ascot Racecourse, Wentworth,
 * Sunningdale and Chobham Common as places Google has never heard of. Fourteen
 * of twenty-one supposed misses were Google's after all once it was widened —
 * so the number is 400 m, and a polygon gets its own extent plus a margin
 * (owner, 19 Sep 2026).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { FENCE_M, fenceFor, metresBetween, boxAround, namesAgree, namesAreSame } from '../src/domain/matchFence.js';

test('a point gets four hundred metres', () => {
  assert.equal(FENCE_M, 400);
  assert.equal(fenceFor({}), 400);
  assert.equal(fenceFor({ bounds: null }), 400);
});

test('a polygon gets its own size, because a golf course is not a front door', () => {
  // Roughly Swinley Forest: about 2 km across. A fixed 400 m fence around its
  // centroid does not reach the clubhouse, which is what made it read as a
  // place Google does not have.
  const big = fenceFor({ bounds: { minlat: 51.39, minlon: -0.70, maxlat: 51.408, maxlon: -0.675 } });
  assert.ok(big > 1000, `a two-kilometre feature needs more than 400 m, got ${big}`);
  // And a small one is never fenced tighter than the floor.
  const small = fenceFor({ bounds: { minlat: 51.4000, minlon: -0.6600, maxlat: 51.4004, maxlon: -0.6596 } });
  assert.equal(small, FENCE_M);
});

test('a fence stops being a match eventually', () => {
  const huge = fenceFor({ bounds: { minlat: 50, minlon: -5, maxlat: 56, maxlon: 2 } });
  assert.ok(huge <= 5000, 'a county-sized polygon does not license a county-sized match');
});

test('a box in Britain is the same width in both directions', () => {
  const b = boxAround({ lat: 51.41, lng: -0.66 }, 400);
  const northSouth = metresBetween({ lat: b.minLat, lng: -0.66 }, { lat: b.maxLat, lng: -0.66 });
  const eastWest = metresBetween({ lat: 51.41, lng: b.minLng }, { lat: 51.41, lng: b.maxLng });
  // Without dividing by the cosine this was 800 m by about 500 m — quietly a
  // tighter fence east-west than the one that was asked for.
  assert.ok(Math.abs(northSouth - eastWest) < 20, `${Math.round(northSouth)} by ${Math.round(eastWest)}`);
});

test('a trading name is longer than the map name, and two clubs on one road are two places', () => {
  assert.ok(namesAgree('Prime Turkish Kitchen', 'Prime Turkish Kitchen & Bar Woking'));
  assert.ok(namesAgree('The Chequers', 'Chequers'));
  assert.ok(namesAgree('Rose and Crown', 'The Rose & Crown Bar'));
  assert.ok(!namesAgree('Royal Ascot Golf Club', 'Royal Ascot Cricket Club'));
  assert.ok(!namesAgree('', 'Anything'));
});

test('an accent is a spelling, not a different place', () => {
  // Without decomposing first, the e-acute was not a letter a-z and fell out
  // entirely: "café" became "caf" and stopped matching "cafe" (Codex, 19 Sep 2026).
  assert.ok(namesAgree('Café Rouge', 'Cafe Rouge'));
  assert.ok(namesAreSame('Café Rouge', 'Cafe Rouge'));
  assert.ok(namesAreSame('Le Café Créme', 'Le Cafe Creme'));
});

test('merging asks a stricter question than looking up', () => {
  // A by-name lookup only asks whether they hold the place at all, and the
  // fence has already narrowed it. A merge puts two records in one row, and a
  // wrong one shows a household somebody else's reviews.
  assert.ok(namesAgree('Prime Turkish Kitchen', 'Prime Turkish Kitchen & Bar Woking'));
  assert.ok(!namesAreSame('Prime Turkish Kitchen', 'Prime Turkish Kitchen & Bar Woking'));
});
