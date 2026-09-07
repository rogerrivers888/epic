/**
 * The detour, drawn across the road.
 *
 * The owner, 7 Sep 2026: *"I'd like to see a prototype where you actually
 * surface the detour of 15 minutes on the map, because this max detour is
 * something that people might not even notice. If we had a little dotted line
 * going across the main line with an arrow at each end saying +15 minutes, it
 * might even have a little thing that I can engage with to change it from 15 to
 * 10 (to change the shaded area right there on the map)."*
 *
 * So the band gets a measurement on it, the way a drawing does: a dotted line
 * square across the route, an arrowhead at each end sitting exactly on the edge
 * of the shaded ground, and the number in the middle. Widen the detour and the
 * caliper widens with the band, because both are drawn from the same
 * half-width — it is one fact shown twice, not two that can disagree.
 *
 * Pure and separate from the map so it can be tested: `apps/web/test` cannot
 * import anything that pulls in react-native or MapLibre.
 */

import type { GroundPoint } from './searchGround';

export type Caliper = {
  /** The two ends of the measurement, on the edges of the band. */
  a: GroundPoint;
  b: GroundPoint;
  /** Where the number sits: the middle, which is on the road. */
  mid: GroundPoint;
  /** Which way each arrowhead points, in degrees clockwise from north. */
  bearing: number;
};

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** A point a given distance and bearing from another. Flat enough over a drive. */
export function offset(from: GroundPoint, km: number, bearingDeg: number): GroundPoint {
  const dLat = (km / R) * Math.cos(rad(bearingDeg));
  const dLng = (km / (R * Math.cos(rad(from.lat)))) * Math.sin(rad(bearingDeg));
  return { lat: from.lat + deg(dLat), lng: from.lng + deg(dLng) };
}

/** The bearing from one point to another, clockwise from north. */
export function bearingBetween(a: GroundPoint, b: GroundPoint): number {
  const dLng = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  const dLat = rad(b.lat - a.lat);
  const t = deg(Math.atan2(dLng, dLat));
  return (t + 360) % 360;
}

/**
 * Where along the spine to put the measurement.
 *
 * Not the exact middle: on a trip the middle of the road is where the pins
 * gather, and a caliper there would be drawn through them. A little short of
 * halfway is quieter and reads the same.
 */
const AT = 0.38;

/**
 * The caliper across a search's ground.
 *
 * `spine` is the line the search runs along, and `halfWidthKm` how far off it
 * the search reaches — both straight from `searchGround`, so the drawing and
 * the filtering cannot drift apart. A spine of one point (looking around a
 * place rather than along a road) still gets a caliper: it lies east-west,
 * which is the honest picture of a circle's radius.
 */
export function caliperFor(spine: GroundPoint[], halfWidthKm: number): Caliper | null {
  if (!spine.length || !(halfWidthKm > 0)) return null;
  if (spine.length === 1) {
    const mid = spine[0];
    return { a: offset(mid, halfWidthKm, 270), b: offset(mid, halfWidthKm, 90), mid, bearing: 90 };
  }
  const from = spine[0];
  const to = spine[spine.length - 1];
  const along = bearingBetween(from, to);
  // Square across the road.
  const across = (along + 90) % 360;
  const mid = {
    lat: from.lat + (to.lat - from.lat) * AT,
    lng: from.lng + (to.lng - from.lng) * AT,
  };
  return {
    a: offset(mid, halfWidthKm, (across + 180) % 360),
    b: offset(mid, halfWidthKm, across),
    mid,
    bearing: across,
  };
}
