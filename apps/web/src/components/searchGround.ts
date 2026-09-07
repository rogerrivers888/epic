/**
 * The ground a search covers, as a shape a map can draw.
 *
 * The owner, 7 Sep 2026: "when I'm on the home screen and I click on, say, food
 * and drink or activities, I'd like to see a shaded area on the real map… The
 * shaded area would be the area around the route, depending on whether you've
 * set 5 minutes or 15 minutes… Even when I initiate the toggle to say along the
 * route (15 minutes or 30 minutes), that shaded area should become bigger."
 *
 * So "up to 15 minutes off the route" stops being a sentence on a chip and
 * becomes a band on the map. Two shapes, because the search has two shapes:
 *
 *   · **A corridor**, when the day is going somewhere. `GET /:id/along` keeps a
 *     place if it is within `corridorKm` of the road and between the two ends,
 *     give or take — a little way back past the start and a little way beyond
 *     the destination. That is a stadium with both ends squared off, and it is
 *     what is drawn: the ends are cut where the filter cuts them rather than
 *     rounded off into a picture that would let in ground the search does not.
 *   · **A circle**, when there is no road to be beside: a trip with a base and
 *     no destination, or a place on the map somebody has tapped to look around.
 *
 * **The arithmetic is the API's, kept in step by hand.** `reachRadiusKm` and
 * the corridor width are `apps/api/src/domain/travel.js` and
 * `apps/api/src/routes/trips.js` respectively, and they are duplicated here for
 * the same reason `estimateMinutes` already is in TripMapScreen: the band has
 * to be on screen the moment the pill is tapped and while the toggle is being
 * moved, which is before any answer exists. The answer carries `corridorKm`,
 * and the moment it lands the drawn band is snapped to it — so a drift between
 * the two shows up as the band settling rather than as a lie left on the map.
 */

export type GroundPoint = { lat: number; lng: number };

export type SearchGround = {
  /** The outline of the ground, closed, in lng/lat. */
  ring: GroundPoint[];
  /**
   * The line the search runs along: the road, or a single point when the ground
   * is a circle. What the lens travels while the sources are answering.
   */
  spine: GroundPoint[];
  /** How far off that line the search reaches, in km. Half the band's width. */
  halfWidthKm: number;
};

/**
 * Door-to-door speeds, from `apps/api/src/domain/travel.js`. Only the three
 * numbers `reachRadiusKm` reads are here; the ramp to open-road speed belongs
 * to the journey estimate and does not come into the width of a band.
 */
const MODE = {
  walking: { kmh: 4.8, detourFactor: 1.15, overhead: 0 },
  cycling: { kmh: 15, detourFactor: 1.2, overhead: 2 },
  driving: { kmh: 28, detourFactor: 1.25, overhead: 5 },
  transit: { kmh: 22, detourFactor: 1.35, overhead: 8 },
};
export type TravelMode = keyof typeof MODE;

const KM_PER_DEG = 111.32;
const HALF_PI = Math.PI / 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** How far, in km, the mode plausibly reaches in the given minutes. */
export function reachRadiusKm(mode: string, minutes: number): number {
  const p = MODE[mode as TravelMode] ?? MODE.driving;
  const usable = Math.max(0, minutes - p.overhead);
  return Math.max(0.5, (usable / 60) * p.kmh / p.detourFactor);
}

export function kmBetween(a: GroundPoint, b: GroundPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * How far off the road a place may be and still be on the way.
 *
 * Half of what the detour budget reaches, because a place beside the road costs
 * roughly twice its distance from it — out and back again — and a tenth of the
 * journey on top, because the longer the drive the further the road wanders
 * from the straight line the band is drawn on. Capped at 8km, floored at 1km.
 */
export function corridorKmFor(mode: string, minutes: number, journeyKm: number): number {
  return Math.min(8, Math.max(1, reachRadiusKm(mode, minutes) / 2, journeyKm * 0.12));
}

/** How far along the road the band runs, as a fraction of it — the API's own bounds. */
const T_LO = -0.05;
const T_HI = 1.3;

/** A circle on the ground, closed, counter-clockwise. */
export function circleRing(centre: GroundPoint, km: number, steps = 72): GroundPoint[] {
  const kx = Math.max(1e-6, Math.cos((centre.lat * Math.PI) / 180));
  const out: GroundPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const th = (i / steps) * 2 * Math.PI;
    out.push({
      lat: centre.lat + (km * Math.sin(th)) / KM_PER_DEG,
      lng: centre.lng + (km * Math.cos(th)) / (KM_PER_DEG * kx),
    });
  }
  return out;
}

/**
 * The band beside a road: `widthKm` either side of the line from `origin` to
 * `destination`, running from a little before the one to a little beyond the
 * other, and squared off where it stops.
 *
 * Worked in kilometres in the road's own frame — how far along (`s`) and how
 * far off (`o`) — because that is the frame the filter thinks in, and then put
 * back on the globe once. The two caps are arcs, each clipped flat where it
 * would run past the end of the band; on a short run those flats are the whole
 * end of the shape, which is right — a place 2km back down the road from a 8km
 * drive is not on the way, however near the road it stands.
 */
export function corridorRing(origin: GroundPoint, destination: GroundPoint, widthKm: number, steps = 20): GroundPoint[] {
  const kx = Math.max(1e-6, Math.cos((origin.lat * Math.PI) / 180));
  const dx = (destination.lng - origin.lng) * kx * KM_PER_DEG;
  const dy = (destination.lat - origin.lat) * KM_PER_DEG;
  const L = Math.hypot(dx, dy);
  if (L < 0.05) return circleRing(origin, widthKm);
  const ux = dx / L;
  const uy = dy / L;
  /** A point in the road's frame, back on the globe. `o` is to the left of the way you are going. */
  const at = (s: number, o: number): GroundPoint => ({
    lat: origin.lat + (s * uy + o * ux) / KM_PER_DEG,
    lng: origin.lng + (s * ux - o * uy) / (KM_PER_DEG * kx),
  });
  const arc = (centreS: number, from: number, to: number, n: number) => {
    const out: GroundPoint[] = [];
    for (let i = 0; i <= n; i += 1) {
      const th = from + ((to - from) * i) / n;
      out.push(at(centreS + widthKm * Math.cos(th), widthKm * Math.sin(th)));
    }
    return out;
  };

  const ring: GroundPoint[] = [at(0, widthKm), at(L, widthKm)];

  // Beyond the destination: an arc, cut flat at 1.3 of the way along.
  const beyond = (T_HI - 1) * L / widthKm;
  if (beyond >= 1) ring.push(...arc(L, HALF_PI, -HALF_PI, steps * 2));
  else {
    const th = Math.acos(clamp(beyond, -1, 1));
    ring.push(...arc(L, HALF_PI, th, steps), ...arc(L, -th, -HALF_PI, steps));
  }

  ring.push(at(L, -widthKm), at(0, -widthKm));

  // Back past the start: the same, cut flat at 0.05 of the way back.
  const behind = T_LO * L / widthKm;
  if (behind <= -1) ring.push(...arc(0, -HALF_PI, -Math.PI - HALF_PI, steps * 2));
  else {
    const th = Math.acos(clamp(behind, -1, 1));
    ring.push(...arc(0, -HALF_PI, -th, steps), ...arc(0, th, HALF_PI, steps));
  }

  ring.push(ring[0]);
  return ring;
}

/**
 * What `GET /:id/along` is about to look at, given how the screen is set.
 *
 * `corridorKm` is the width the last answer came back with; pass it once it is
 * known and the band is exactly the one that filtered, rather than this file's
 * reading of the same formula.
 */
export function searchGround({ origin, destination, around, mode, maxDetourMin, corridorKm }: {
  origin: GroundPoint;
  destination: GroundPoint | null;
  /** A place on the map somebody has tapped and wants to look around instead of the road. */
  around: GroundPoint | null;
  mode: string;
  maxDetourMin: number;
  corridorKm?: number | null;
}): SearchGround {
  // Tapped somewhere: the search is simply what is within reach of it.
  if (around) {
    const km = reachRadiusKm(mode, maxDetourMin);
    return { ring: circleRing(around, km), spine: [around], halfWidthKm: km };
  }
  // A trip with a base and nowhere in particular to be: reach from the base.
  if (!destination) {
    const km = reachRadiusKm(mode, maxDetourMin);
    return { ring: circleRing(origin, km), spine: [origin], halfWidthKm: km };
  }
  const width = corridorKm ?? corridorKmFor(mode, maxDetourMin, kmBetween(origin, destination));
  return { ring: corridorRing(origin, destination, width), spine: [origin, destination], halfWidthKm: width };
}
