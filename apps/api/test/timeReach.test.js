/**
 * The time and the mode must move the count (owner, 30 Sep 2026, two blocking
 * regressions). These pin the travel maths every count is fenced by: the reach
 * grows with the minutes, and it shrinks sharply on foot — so "changing the
 * time does nothing" and "walking 30 is the same as driving 30" cannot come
 * back without a red test.
 *
 * Pure functions, no database: the count endpoints sum the census over the
 * reach these produce, so if the reach moves with time and mode the count does
 * too. The live numbers for a fixed home (Sunningdale) and a fixed trip are
 * reported from production by `scripts/reach-check.mjs` after each deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reachRadiusKm, detourMinutes, travelMode } from '../src/domain/travel.js';

const SUNNINGDALE = { lat: 51.398, lng: -0.631 };
const WINDSOR = { lat: 51.483, lng: -0.604 };

test('the reach grows with the time given, for every mode (10→15→30, 30→60→120)', () => {
  for (const mode of ['driving', 'walking', 'transit']) {
    const [r10, r15, r30] = [10, 15, 30].map((m) => reachRadiusKm(mode, m));
    assert.ok(r10 < r15 && r15 < r30, `${mode}: 10<15<30 but got ${r10} ${r15} ${r30}`);
    const [a30, r60, r120] = [30, 60, 120].map((m) => reachRadiusKm(mode, m));
    assert.ok(a30 < r60 && r60 < r120, `${mode}: 30<60<120 but got ${a30} ${r60} ${r120}`);
  }
});

test('walking 30 min reaches far less than driving 30 min', () => {
  // Places are spread over an area, which goes as the square of the radius, so
  // a walking reach a third of the driving one is far fewer than a third of the
  // places. The picker must make that difference, not hide it.
  const walk = reachRadiusKm('walking', 30);
  const drive = reachRadiusKm('driving', 30);
  assert.ok(walk * 3 < drive, `walk30 ${walk.toFixed(1)}km must be far less than drive30 ${drive.toFixed(1)}km`);
});

test('the three modes are ordered walk < transit < drive at 30 min', () => {
  const w = reachRadiusKm('walking', 30);
  const t = reachRadiusKm('transit', 30);
  const d = reachRadiusKm('driving', 30);
  assert.ok(w < t && t < d, `expected walk<transit<drive, got ${w} ${t} ${d}`);
});

test("a mode word the picker sends is honoured, never silently driven (the 7 Sep fault)", () => {
  assert.equal(travelMode('walk'), 'walking');
  assert.equal(travelMode('drive'), 'driving');
  assert.equal(travelMode('public'), 'transit');
  assert.ok(reachRadiusKm(travelMode('walk'), 30) < reachRadiusKm(travelMode('drive'), 30));
});

test('a detour off a fixed trip costs more minutes on foot, so fewer places fall inside the budget', () => {
  const venue = { lat: 51.44, lng: -0.70 }; // a little off the Sunningdale → Windsor line
  const walk = detourMinutes({ origin: SUNNINGDALE, destination: WINDSOR, venue, mode: 'walking' });
  const drive = detourMinutes({ origin: SUNNINGDALE, destination: WINDSOR, venue, mode: 'driving' });
  assert.ok(walk > drive, `the walking detour ${walk} must exceed the driving detour ${drive}`);
});
