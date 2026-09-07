import test from 'node:test';
import assert from 'node:assert/strict';
import { bearingBetween, caliperFor, offset } from '../src/components/detourCaliper';

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

test('due north is nought, due east is ninety', () => {
  assert.ok(Math.abs(bearingBetween({ lat: 51, lng: 0 }, { lat: 52, lng: 0 })) < 0.5);
  assert.ok(Math.abs(bearingBetween({ lat: 51, lng: 0 }, { lat: 51, lng: 1 }) - 90) < 0.5);
});

test('an offset lands the distance it was asked for', () => {
  const p = offset({ lat: 51.4, lng: -0.6 }, 3, 90);
  assert.ok(Math.abs(km({ lat: 51.4, lng: -0.6 }, p) - 3) < 0.02);
});

test('the caliper lies square across the road, and its ends sit on the band', () => {
  const spine = [{ lat: 51.386, lng: -0.623 }, { lat: 51.463, lng: -0.651 }];
  const c = caliperFor(spine, 2)!;
  const along = bearingBetween(spine[0], spine[1]);
  const across = bearingBetween(c.a, c.b);
  // Ninety degrees to the road, whichever way round it is measured.
  assert.ok(Math.abs(((across - along + 360) % 180) - 90) < 1);
  assert.ok(Math.abs(km(c.mid, c.a) - 2) < 0.02);
  assert.ok(Math.abs(km(c.mid, c.b) - 2) < 0.02);
  // Four kilometres across, which is the band's whole width.
  assert.ok(Math.abs(km(c.a, c.b) - 4) < 0.05);
});

test('widening the detour widens the caliper by exactly as much', () => {
  const spine = [{ lat: 51.386, lng: -0.623 }, { lat: 51.463, lng: -0.651 }];
  const narrow = caliperFor(spine, 1)!;
  const wide = caliperFor(spine, 3)!;
  assert.ok(Math.abs(km(wide.a, wide.b) / km(narrow.a, narrow.b) - 3) < 0.02);
});

test('the number sits on the road, short of halfway so it is clear of the pins', () => {
  const spine = [{ lat: 51.0, lng: 0 }, { lat: 52.0, lng: 0 }];
  const c = caliperFor(spine, 1)!;
  assert.ok(c.mid.lat > 51.3 && c.mid.lat < 51.45);
});

test('looking around one place still gets a caliper, lying east to west', () => {
  const c = caliperFor([{ lat: 51.4, lng: -0.6 }], 2)!;
  assert.ok(Math.abs(km(c.a, c.b) - 4) < 0.05);
  assert.ok(Math.abs(c.a.lat - c.b.lat) < 1e-9);
});

test('no ground, no caliper', () => {
  assert.equal(caliperFor([], 2), null);
  assert.equal(caliperFor([{ lat: 51, lng: 0 }], 0), null);
});
