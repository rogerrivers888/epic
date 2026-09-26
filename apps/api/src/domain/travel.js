// Travel time and catchment.
//
// PROTOTYPE IMPLEMENTATION. Requirements §5 is explicit that a catchment is the
// area *genuinely reachable* by the transport network, not a radius — and
// Technical Constraints §6.2 records that TravelTime is the only provider
// returning transit isochrones from timetabled data. Neither an account nor a
// price exists yet (§16 item 2), so this module approximates travel time from
// straight-line distance and a per-mode speed, with a detour factor.
//
// It is deliberately isolated behind estimateTravelMinutes/deriveCatchment so
// that swapping in a real isochrone provider touches this file only. Every
// response that uses it is flagged `estimated: true` so the UI can say so.

export const TRAVEL_MODES = ['walking', 'cycling', 'driving', 'transit'];

// Effective door-to-door speeds in km/h, including the usual overheads.
//
// `kmh` is the speed of a short hop through a town; `openKmh` the speed a long
// run settles at once the dual carriageway starts. A journey is somewhere
// between the two, and `rampKm` says how quickly it gets there — at rampKm the
// journey is running at half the difference.
const MODE_PROFILE = {
  walking: { kmh: 4.8, openKmh: 4.8, rampKm: 1, detourFactor: 1.15, fixedOverheadMinutes: 0 },
  cycling: { kmh: 15, openKmh: 18, rampKm: 8, detourFactor: 1.2, fixedOverheadMinutes: 2 },
  // Fitted against 473 real road times, 20 Sep 2026 — see `speedFor` below.
  // The detour factor is measured rather than assumed (owner's call): the road
  // is 1.4x the straight line at the median, not 1.25.
  driving: { kmh: 32.5, openKmh: 102, rampKm: 32, detourFactor: 1.4, fixedOverheadMinutes: 3 },
  // Wait time is why a transit isochrone is lumpy rather than circular. A real
  // provider derives this from the timetable at the outing time (Epic 3 C2).
  transit: { kmh: 22, openKmh: 45, rampKm: 10, detourFactor: 1.35, fixedOverheadMinutes: 8 },
};

/**
 * How fast a journey of this length goes.
 *
 * This was two speeds and a step — a town speed below fifteen kilometres and an
 * open-road speed above it — and the step is a bug you can see from orbit
 * (owner, 6 Sep 2026: a twenty-mile run to Crystal Palace came back with one
 * restaurant and no activities). A detour splits one journey into two shorter
 * legs, so the legs land on the town side of the step while the journey itself
 * is on the open side: 14.9km scored 45 minutes and 15.1km scored 26. A place
 * standing *on the road* halfway along a 38km drive came out 24 minutes off it,
 * and the corridor threw away everything but the few metres either side of the
 * exact midpoint.
 *
 * A speed that climbs smoothly with the distance has no step to fall off, so
 * two legs and the journey they replace are measured on the same curve.
 *
 * **And the curve itself was wrong until 20 September 2026, which is the other
 * half of the same fault.** Removing the step fixed the discontinuity and left
 * the numbers too slow: 58 km/h as the open-road speed, applied to a distance
 * already inflated by a detour factor, is nobody's motorway. Measured against
 * Google Routes on 286 random sector pairs (free of traffic, so the comparison
 * is like for like), Epic overstated 4 journeys in 5 — by a median of 5 minutes
 * and by as much as 35 on a long one. The bias grew with distance: −1.6 min on
 * a quarter-hour hop, −15.9 on an hour and a half.
 *
 * Overstating a journey does not show a household a wrong number. It shows them
 * *fewer places*, because every list is fenced by this function — which is why
 * the symptom was always an empty screen. The owner reported it twice and it was
 * treated as two bugs: Crystal Palace on 6 September (one restaurant on a
 * twenty-mile run) and Bristol on 12 September ("nothing matches" inside an
 * hour). The step explained part of the first. This explains both.
 *
 * So the four driving numbers are now fitted rather than assumed: 473 pairs as
 * the training set, absolute error as the loss — squared error would let the
 * handful of sea-loch pairs, where a straight line crosses water and no speed
 * curve can help, drag the curve for everybody else. Tested on **393 further
 * pairs from 90 origins the fit never saw**: journeys overstated fall from 75%
 * to 41%, and the share that would be wrongly put out of reach at a 5-minute
 * allowance falls from 37% to 10%. Walking, cycling and transit are untouched —
 * only driving was measured, and a profile nobody has tested is not improved by
 * being changed.
 *
 * The first fit was trained on pairs drawn by *stored minutes*, which gave it
 * almost nothing under five minutes — and the short end is what the corridor
 * width, the source radius and the five-minute default band are all worked out
 * from. It came back with a town speed of 37 km/h, which is nobody's town. 187
 * short pairs were added to the training set and 100 to the holdout, kept
 * separate in the reporting so that a good long-range fit cannot hide a bad
 * short-range one. Any refit must keep that split.
 *
 * The one fault this cannot fix is a straight line that is not a road: the Firth
 * of Clyde, the Wester Ross sea lochs, the estuaries, the islands. About one
 * pair in eight has a road more than 1.8x its straight line, and those are
 * understated — offered and then dropped by the exact pass on the planning
 * paths, and simply wrong on the browsing ones. A road network (OSRM) is the
 * only real answer and the limitation is accepted until then (owner, 20 Sep
 * 2026). `reach-fit.mjs` re-runs the fit; `train.json` and `holdout.json` are
 * the pairs it was fitted and tested on.
 */
const speedFor = (profile, km) =>
  profile.kmh + (profile.openKmh - profile.kmh) * (km / (km + profile.rampKm));

export function kmBetween(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The words a caller might use for a way of getting about, in this file's own.
 *
 * The screens say `drive`, `walk`, `transit`; the profiles above are keyed
 * `driving`, `walking`, `transit`. An unknown word falls back to driving, which
 * is a sensible default and a terrible silence: `walk` matched nothing, took
 * the fallback, and every walking time came back as a driving time — so the
 * travel sheet's counts did not move when the mode did (owner, 7 Sep 2026:
 * "when I change from Drive to Public Transport to Walk, the number of places
 * doesn't change at all"). Both spellings are accepted now.
 */
const MODE_ALIAS = {
  drive: 'driving', driving: 'driving', car: 'driving',
  walk: 'walking', walking: 'walking', foot: 'walking',
  cycle: 'cycling', cycling: 'cycling', bike: 'cycling',
  transit: 'transit', public: 'transit', pt: 'transit',
};

/** A caller's word for a mode, as one of the four this file models. */
export const travelMode = (m) => MODE_ALIAS[String(m || '').toLowerCase()] ?? 'driving';

/**
 * Is this a way of getting about at all?
 *
 * Separate from `travelMode` because the two questions are different and
 * conflating them is what caused the bug: a route that asks "is this one of
 * mine?" against the canonical names alone answers no to `walk` and then
 * quietly substitutes a car. Somewhere that stores a mode should reject a word
 * it does not know; somewhere that reads one should normalise it. Neither
 * should silently change the answer.
 */
export const isTravelMode = (m) => Object.prototype.hasOwnProperty.call(MODE_ALIAS, String(m || '').toLowerCase());

export function estimateTravelMinutes(from, to, mode = 'driving') {
  const kind = travelMode(mode);
  const profile = MODE_PROFILE[kind];
  const straight = kmBetween(from, to);
  const km = straight * profile.detourFactor;
  // Beyond city scale, transit means rail: faster, and paid for with a change
  // or two rather than with the wait at one stop.
  const overhead = kind === 'transit' && straight > 8 ? 18 : profile.fixedOverheadMinutes;
  return Math.round((km / speedFor(profile, straight)) * 60 + overhead);
}

/**
 * Restrict candidates to those reachable within maxTravelMinutes of the origin.
 * Returns each candidate annotated with its estimated travel time.
 */
export function deriveCatchment({ origin, maxTravelMinutes, mode, venues }) {
  return venues
    .map((venue) => ({
      ...venue,
      travelMinutes: estimateTravelMinutes(origin, venue, mode),
    }))
    .filter((venue) => venue.travelMinutes <= maxTravelMinutes);
}

/**
 * Additional travel time a stop adds between origin and destination (Epic 4 C2).
 * The corridor is a bias, not a restriction, so this cost is always displayed
 * rather than used to silently filter (Requirements §4).
 */
export function detourMinutes({ origin, destination, venue, mode }) {
  if (!destination) return null;
  const profile = MODE_PROFILE[mode] || MODE_PROFILE.driving;
  const direct = estimateTravelMinutes(origin, destination, mode);
  const viaVenue =
    estimateTravelMinutes(origin, venue, mode) + estimateTravelMinutes(venue, destination, mode);
  // Both legs pay the getting-going overhead and the journey they replace pays
  // it once. Stopping for lunch does not mean starting the car from cold twice,
  // so the second one is given back — otherwise every place on the road, even
  // the one you would drive past anyway, costs five minutes it does not.
  return Math.max(0, viaVenue - direct - profile.fixedOverheadMinutes);
}

/**
 * How far, in a straight line, the fence itself reaches in this many minutes.
 *
 * `reachRadiusKm` below works from the town speed alone, and the fence does
 * not: at an hour by car the fence accepts places at 51km while that radius
 * asked providers for 22, so everything between could never be fetched to be
 * fenced — 58% of what is inside an hour of Ascot, 94% of Winchester's
 * (measured 26 Sep 2026). This walks the same estimate the fence uses, so a
 * search sized by it can find anything the fence would keep, up to `capKm`
 * (Google's Nearby Search answers no wider than fifty).
 *
 * Deliberately a second function rather than a change to `reachRadiusKm`,
 * which also sizes the trip corridor from its detour budget: widening that
 * would widen every corridor by a third as a side effect.
 */
export function searchRadiusKm(mode, minutes, { capKm = 50 } = {}) {
  const m = travelMode(mode);
  const at = { lat: 51.4, lng: -0.6 };
  const there = (km) => ({ lat: at.lat + km / 111.32, lng: at.lng });
  if (estimateTravelMinutes(at, there(capKm), m) <= minutes) return capKm;
  let lo = 0;
  let hi = capKm;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (estimateTravelMinutes(at, there(mid), m) <= minutes) lo = mid; else hi = mid;
  }
  // Rounded up: this bounds a search, and a bound a little short loses the edge.
  return Math.max(0.5, Math.ceil(lo * 10) / 10);
}

/** How far, in km, the mode plausibly reaches in the given minutes — for bounding a source query. */
export function reachRadiusKm(mode, minutes) {
  const profile = MODE_PROFILE[mode] || MODE_PROFILE.driving;
  const usable = Math.max(0, minutes - profile.fixedOverheadMinutes);
  return Math.max(0.5, (usable / 60) * profile.kmh / profile.detourFactor);
}
