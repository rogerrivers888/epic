// What it costs to stop somewhere on the way.
//
// A twenty-mile day out to Crystal Palace came back with one restaurant along
// the whole route and nothing at all to do (owner, 6 Sep 2026). The corridor
// was not the problem; the arithmetic underneath it was. `estimateTravelMinutes`
// changed gear at fifteen kilometres — a town speed below, an open-road speed
// above — and a detour is one journey measured as two shorter ones, so the two
// halves fell on the town side of the change while the journey they replaced
// stayed on the open side. A place standing *on the road* halfway along came
// out twenty-four minutes off it and the fifteen-minute budget threw it away.
//
// These are the numbers that must not come back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTravelMinutes, detourMinutes, kmBetween, reachRadiusKm } from '../src/domain/travel.js';

const HOME = { lat: 51.38622, lng: -0.62342 };            // Fairways, Ascot
const CRYSTAL_PALACE = { lat: 51.422294, lng: -0.075789 };
const THORPE_PARK = { lat: 51.404722, lng: -0.513056 };

/** A point the given fraction of the way along the straight line between two ends. */
const along = (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });

test('a place on the road costs almost nothing, wherever along it stands', () => {
  for (let f = 0.05; f < 1; f += 0.05) {
    const venue = along(HOME, CRYSTAL_PALACE, f);
    const detour = detourMinutes({ origin: HOME, destination: CRYSTAL_PALACE, venue, mode: 'driving' });
    assert.ok(
      detour <= 8,
      `a stop ${Math.round(f * 100)}% of the way along the road cost ${detour} min, which is not a detour`,
    );
  }
});

test('the drive is not measured differently either side of an arbitrary distance', () => {
  // The old model jumped from 45 minutes to 26 between 14.9km and 15.1km.
  const at = (km) => estimateTravelMinutes({ lat: 51, lng: 0 }, { lat: 51 + km / 111.32, lng: 0 }, 'driving');
  for (let km = 1; km < 60; km += 0.5) {
    assert.ok(at(km + 0.5) - at(km) >= 0, `going ${km + 0.5}km cannot be quicker than going ${km}km`);
    assert.ok(at(km + 0.5) - at(km) <= 3, `half a kilometre added ${at(km + 0.5) - at(km)} minutes at ${km}km`);
  }
});

test('a longer drive averages a faster speed, and a short hop a slower one', () => {
  const speed = (km) => (km / at(km)) * 60;
  const at = (km) => estimateTravelMinutes({ lat: 51, lng: 0 }, { lat: 51 + km / 111.32, lng: 0 }, 'driving');
  assert.ok(speed(2) < 20, `two kilometres through a town averaged ${speed(2).toFixed(1)} km/h`);
  assert.ok(speed(100) > 40, `a hundred kilometres averaged ${speed(100).toFixed(1)} km/h`);
  assert.ok(speed(100) < 70, `a hundred kilometres averaged ${speed(100).toFixed(1)} km/h, which is not driving`);
});

test('the corridor grows with the journey, and a short run stays tight', () => {
  // Chobham Common used to be the case this test pinned: 2.05km off a 7.9km
  // drive to Thorpe Park, and it had to stay out (owner, 6 Sep 2026 — "nobody
  // calls it on the way"). It is inside the band now, deliberately.
  //
  // The width was hand-tuned against an estimator that overstated every drive.
  // When that was measured and corrected on 20 Sep 2026 the band widened from
  // 1.9km to 2.3km, and holding it still would have kept the old bias alive in
  // a second place after being removed from the first (owner, same day:
  // "keeping it pinned now double-compensates"). So the width follows the
  // arithmetic again, and whether 2.3km on an eight-kilometre drive is too
  // generous is being judged against real trips rather than against this one
  // remembered example. If it is re-tuned, the reason goes here.
  //
  // What must stay true either way is the shape: the band is much tighter on a
  // short run than on a long one, because that is the whole reason it exists.
  const CHOBHAM = { lat: 51.3733, lng: -0.5867 };
  const width = (origin, destination, reachKm) => Math.min(8, Math.max(1, reachKm / 2, kmBetween(origin, destination) * 0.12));
  const offLine = (origin, destination, v) => {
    const kx = Math.cos((origin.lat * Math.PI) / 180);
    const ax = (destination.lng - origin.lng) * kx;
    const ay = destination.lat - origin.lat;
    const t = Math.max(0, Math.min(1, (ax * (v.lng - origin.lng) * kx + ay * (v.lat - origin.lat)) / (ax * ax + ay * ay)));
    return kmBetween({ lat: origin.lat + (destination.lat - origin.lat) * t, lng: origin.lng + (destination.lng - origin.lng) * t }, v);
  };
  const reach = reachRadiusKm('driving', 15);

  const short = width(HOME, THORPE_PARK, reach);
  const long = width(HOME, CRYSTAL_PALACE, reach);
  assert.ok(long > short * 1.5, `a 38km drive's corridor (${long.toFixed(2)}km) is barely wider than a 7.9km drive's (${short.toFixed(2)}km)`);
  assert.ok(short < 3, `a short run's corridor opened out to ${short.toFixed(2)}km, which is a search of the county`);

  // Richmond Park, three and a half kilometres off a thirty-eight kilometre
  // drive, is inside the corridor to Crystal Palace — it was not, and that is
  // why the screen was empty.
  const RICHMOND_PARK = { lat: 51.4413, lng: -0.2749 };
  assert.ok(
    offLine(HOME, CRYSTAL_PALACE, RICHMOND_PARK) < long,
    'Richmond Park is outside the corridor to Crystal Palace',
  );
  // And the corridor is still a corridor: somewhere genuinely off the route is
  // still out of it, whatever the width.
  const BRIGHTON = { lat: 50.8225, lng: -0.1372 };
  assert.ok(offLine(HOME, CRYSTAL_PALACE, BRIGHTON) > long, 'Brighton is on the way to Crystal Palace');
});
