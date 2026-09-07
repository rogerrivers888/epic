import test from 'node:test';
import assert from 'node:assert/strict';
import { corridorKmFor, kmBetween, reachRadiusKm, searchGround, type GroundPoint } from '../src/components/searchGround.ts';

/**
 * The band drawn on the map is only worth drawing if it is the band the search
 * actually uses, so these check it against the numbers `GET /:id/along` filters
 * with — a place is kept when it is within `corridorKm` of the road and between
 * the two ends, give or take.
 */

const home: GroundPoint = { lat: 51.4816, lng: -0.6113 };      // Windsor
const thorpe: GroundPoint = { lat: 51.4046, lng: -0.5093 };    // Thorpe Park, 7.9km off

/** Is this point inside the ring? Ray casting, in degrees — the shapes are small. */
const inside = (ring: GroundPoint[], p: GroundPoint) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat)
      && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) hit = !hit;
  }
  return hit;
};

/** `km` off the road, square to it, at `t` of the way along. */
const beside = (t: number, km: number): GroundPoint => {
  const kx = Math.cos((home.lat * Math.PI) / 180);
  const dx = (thorpe.lng - home.lng) * kx * 111.32;
  const dy = (thorpe.lat - home.lat) * 111.32;
  const len = Math.hypot(dx, dy);
  return {
    lat: home.lat + (t * dy + (km * dx) / len) / 111.32,
    lng: home.lng + (t * dx - (km * dy) / len) / (111.32 * kx),
  };
};

const groundFor = (min: number) => searchGround({ origin: home, destination: thorpe, around: null, mode: 'driving', maxDetourMin: min });

test('the band is as wide as the corridor the endpoint keeps places in', () => {
  const g = groundFor(15);
  assert.equal(g.halfWidthKm, corridorKmFor('driving', 15, kmBetween(home, thorpe)));
  assert.ok(inside(g.ring, beside(0.5, 0)), 'a place on the road is in the band');
  assert.ok(inside(g.ring, beside(0.5, g.halfWidthKm * 0.9)), 'just inside the width is in');
  assert.ok(!inside(g.ring, beside(0.5, g.halfWidthKm * 1.1)), 'just outside the width is out');
});

test('a wider detour is a wider band, and the narrow one is inside it', () => {
  const narrow = groundFor(5);
  const wide = groundFor(30);
  assert.ok(wide.halfWidthKm > narrow.halfWidthKm);
  const between = (narrow.halfWidthKm + wide.halfWidthKm) / 2;
  assert.ok(!inside(narrow.ring, beside(0.5, between)));
  assert.ok(inside(wide.ring, beside(0.5, between)));
});

test('the ends are cut where the endpoint cuts them, not rounded off', () => {
  // Back past the start, the band runs a twentieth of the journey and stops —
  // half a kilometre on this run, where the width alone would have allowed
  // nearly two. Going back past the house is not on the way to anywhere.
  const near = groundFor(15);
  assert.ok(near.halfWidthKm > 1.1 * 0.05 * kmBetween(home, thorpe), 'the cut is the binding one here');
  assert.ok(inside(near.ring, beside(-0.02, 0)));
  assert.ok(!inside(near.ring, beside(-0.1, 0)), 'a long way back down the road is not on the way');

  // And beyond the destination it runs a third of the journey again and stops.
  // At thirty minutes the width would reach further than that, and does not.
  const far = groundFor(30);
  assert.ok(far.halfWidthKm > 0.3 * kmBetween(home, thorpe), 'the cut is the binding one here');
  assert.ok(inside(far.ring, beside(1.28, 0)));
  assert.ok(!inside(far.ring, beside(1.32, 0)));
});

test('the answer settles the width: a corridor from the endpoint is used as given', () => {
  const g = searchGround({ origin: home, destination: thorpe, around: null, mode: 'driving', maxDetourMin: 15, corridorKm: 3.4 });
  assert.equal(g.halfWidthKm, 3.4);
  assert.ok(inside(g.ring, beside(0.5, 3.2)));
  assert.ok(!inside(g.ring, beside(0.5, 3.6)));
});

test('somewhere tapped is a circle of what the mode reaches, and the road stops mattering', () => {
  const g = searchGround({ origin: home, destination: thorpe, around: thorpe, mode: 'driving', maxDetourMin: 15 });
  assert.equal(g.halfWidthKm, reachRadiusKm('driving', 15));
  assert.deepEqual(g.spine, [thorpe]);
  for (const bearing of [0, 90, 180, 270]) {
    const th = (bearing * Math.PI) / 180;
    const at = (km: number) => ({
      lat: thorpe.lat + (km * Math.cos(th)) / 111.32,
      lng: thorpe.lng + (km * Math.sin(th)) / (111.32 * Math.cos((thorpe.lat * Math.PI) / 180)),
    });
    assert.ok(inside(g.ring, at(g.halfWidthKm * 0.9)), `inside at ${bearing}°`);
    assert.ok(!inside(g.ring, at(g.halfWidthKm * 1.1)), `outside at ${bearing}°`);
  }
});

test('a trip with a base and nowhere in particular to be is a circle around the base', () => {
  const g = searchGround({ origin: home, destination: null, around: null, mode: 'driving', maxDetourMin: 30 });
  assert.deepEqual(g.spine, [home]);
  assert.equal(g.halfWidthKm, reachRadiusKm('driving', 30));
});
