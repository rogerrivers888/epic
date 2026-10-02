// Walking and cycling, once OSRM has routed them (sources/osrmMatrix.js): the
// ring says it is routed, the display fence and the card read the routed
// minutes rather than the straight-line estimate, and the estimator refuses to
// write into a mode OSRM owns. The point of all of it is that the count (drawn
// from the ring's band) and the list (fenced here) describe the same reach.

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const reach = await import('../src/repositories/reach.js');
const { minutesTo, withinBand, fenceToBand } = await import('../src/domain/band.js');
const { routedMinutesFor } = await import('../src/routes/inspire.js');

test.after(() => pool.end());

const O = { code: 'sector:ZZ9 1', lat: 51.400, lng: -0.600 };
const A = { code: 'sector:ZZ9 2', lat: 51.420, lng: -0.600 }; // ~2.2km
const B = { code: 'sector:ZZ9 3', lat: 51.460, lng: -0.600 }; // ~6.7km
const CELLS = [O, A, B];

const clean = async () => {
  await query(`delete from reach where from_cell like 'sector:ZZ9%' or to_cell like 'sector:ZZ9%'`);
  await query(`delete from cell_builds where from_cell like 'sector:ZZ9%'`);
  await query(`delete from geo_cells where code like 'sector:ZZ9%'`);
};
const seed = async () => {
  for (const c of CELLS) {
    await query(
      `insert into geo_cells (code, scheme, label, outcode, lat, lng, source)
       values ($1, 'sector', $2, 'ZZ9', $3, $4, 'test') on conflict (code) do nothing`,
      [c.code, c.code.slice(7), c.lat, c.lng]);
  }
};
// An OSRM build of O for walking: A at 25 routed minutes, B at 80.
const routeO = async (method = 'osrm') => {
  for (const [to, m] of [[O, 0], [A, 25], [B, 80]]) {
    await query(`insert into reach (from_cell, to_cell, mode, minutes, km, method) values ($1,$2,'walking',$3,1,$4)`,
      [O.code, to.code, m, method]);
  }
  await query(`insert into cell_builds (from_cell, mode, cap_minutes, pairs, method) values ($1,'walking',130,3,$2)`, [O.code, method]);
};

test('minutesTo takes a routed minute when one is handed in, and never falls back to the estimate', () => {
  const from = { lat: 51.4, lng: -0.6 };
  const place = { lat: 51.42, lng: -0.6 };
  const routed = new Map([[place, 25]]);
  assert.equal(minutesTo(from, place, 'walking', (p) => routed.get(p)), 25);
  // a place the routed ring has no minute for is unmeasurable, not estimated
  assert.equal(minutesTo(from, { lat: 51.9, lng: -0.6 }, 'walking', (p) => routed.get(p)), null);
  assert.equal(withinBand(place, { minutes: 30, minutesOf: (p) => routed.get(p) }), true);
  assert.equal(withinBand(place, { minutes: 20, minutesOf: (p) => routed.get(p) }), false);
  // without minutesOf, unchanged: the estimator
  assert.ok(minutesTo(from, place, 'walking') > 0);
});

test('a walking ring built by OSRM says routed, and hands over its sector minutes', async () => {
  await clean(); await seed(); await routeO('osrm');
  assert.equal(await reach.builtMethod(O.code, 'walking', 40), 'osrm');
  const ring = await reach.ringFor({ cell: O.code, minutes: 30, mode: 'walking' });
  assert.equal(ring.method, 'matrix');
  assert.equal(ring.routed, true);
  assert.equal(ring.minutesByCell[A.code], 25);
  assert.ok(ring.band.includes(A.code) && !ring.band.includes(B.code));
  await clean();
});

test('a walking ring built by the estimator is a matrix ring but not a routed one', async () => {
  await clean(); await seed(); await routeO('estimate');
  const ring = await reach.ringFor({ cell: O.code, minutes: 30, mode: 'walking' });
  assert.equal(ring.method, 'matrix');
  assert.equal(ring.routed, false);
  assert.equal(ring.minutesByCell, null);
  await clean();
});

test('the routed fence keeps what the routed ring holds and drops what it cannot measure', async () => {
  await clean(); await seed(); await routeO('osrm');
  const ring = await reach.ringFor({ cell: O.code, minutes: 30, mode: 'walking' });
  const vA = { name: 'near A', lat: 51.4205, lng: -0.6005 };
  const vB = { name: 'near B', lat: 51.4605, lng: -0.6005 };
  const vFar = { name: 'nowhere routed', lat: 52.5, lng: -1.5 };
  const routedOf = await routedMinutesFor([vA, vB, vFar], ring.minutesByCell);
  assert.equal(routedOf.get(vA), 25);
  // B is 80 routed minutes away — past the ring's read (asked + edge), so the
  // ring holds no minute for it: unmeasured, and fenced out either way.
  assert.equal(routedOf.has(vB), false);
  assert.equal(routedOf.has(vFar), false);
  const kept = fenceToBand([vA, vB, vFar], { minutes: 30, minutesOf: (v) => routedOf.get(v) });
  assert.deepEqual(kept.map((v) => v.name), ['near A']);
  await clean();
});

test('the estimator refuses to write into a mode OSRM owns; driving is never owned', async () => {
  await clean(); await seed(); await routeO('osrm');
  assert.equal(await reach.osrmOwns('walking'), true);
  assert.equal(await reach.osrmOwns('driving'), false);
  await assert.rejects(() => reach.buildMatrix({ mode: 'walking' }), (e) => e.status === 409 && /routed by OSRM/.test(e.message));
  await assert.rejects(() => reach.refresh({ mode: 'walk' }), (e) => e.status === 409);
  await clean();
  assert.equal(await reach.osrmOwns('walking'), false);
});
