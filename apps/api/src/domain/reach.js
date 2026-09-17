// What is within reach of what, worked out once instead of on every search.
//
// Owner, 17 Sep 2026: "We could calculate the distance to all the other
// postcodes within a 30-minute or 60-minute distance, and then we will know the
// postcode of each of the locations that we surface. Therefore, instead of
// having to do map distance calculations every time someone does a search, we
// will already hold and know instantly which activities are within their
// particular area."
//
// Three decisions this module makes, and the reasons, because none of them is
// obvious from the code:
//
//   1. **The unit is the postcode sector** — `SL4 1`, the district plus the
//      first character of the incode. About eleven thousand of them in Britain,
//      against 2,980 districts (too coarse: a rural district is twenty
//      kilometres across) and 1.8 million units (far too many to pair up).
//      Sectors are drawn around people rather than land, so they are small where
//      places are dense and large where there is nothing, which is exactly the
//      behaviour a catchment wants.
//
//   2. **The code carries its scheme.** `sector:SL4 1`. A postcode sector is a
//      British idea; France has communes and the United States has ZIPs of a
//      quite different size. `grid:` and `h3:` land in the same column and
//      nothing downstream has to learn a second shape.
//
//   3. **The matrix is a filter, not an answer.** Centre-to-centre is an
//      approximation — good in a city, loose in rural Wales — so it decides
//      *which* places are candidates and the final list is still ordered by the
//      real distance to each place. Being slightly generous at the edge is the
//      right failure: a place wrongly included is dropped by the exact pass, and
//      a place wrongly excluded is never seen at all.
//
// Pure, like `scoring.js`: every function here is a function of its arguments,
// so the matrix can be rebuilt from scratch at any time and two builds of the
// same cells agree exactly.

import { estimateTravelMinutes, kmBetween, travelMode } from './travel.js';

/** How far out the matrix is built. Beyond this a catchment is not a day out. */
export const CAP_MINUTES = 90;

/** The bands the counts are rolled up into. A search picks the band above its minutes. */
export const BANDS = [15, 30, 45, 60, 90];

/** The band a request of this many minutes is answered from. */
export const bandFor = (minutes) => BANDS.find((b) => b >= minutes) ?? BANDS[BANDS.length - 1];

/**
 * The sector a postcode belongs to: `SL4 1QT` → `SL4 1`.
 *
 * Postcodes arrive from three places with three different amounts of care —
 * a household typing one, OSM's `addr:postcode`, and the ONS directory — so
 * this is deliberately forgiving about spacing and case and unforgiving about
 * shape. Anything that is not a British postcode returns null rather than a
 * guess: a wrong cell is worse than no cell, because a wrong one still answers.
 */
export function sectorOf(postcode) {
  if (typeof postcode !== 'string') return null;
  const flat = postcode.toUpperCase().replace(/\s+/g, '');
  // outward: 1–2 letters, 1–2 digits, optional final letter; inward: digit + 2 letters.
  const m = /^([A-Z]{1,2}\d[A-Z\d]?)(\d)[A-Z]{2}$/.exec(flat);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

/** The district a sector sits in: `SL4 1` → `SL4`. */
export const outcodeOf = (sector) => (typeof sector === 'string' ? sector.split(' ')[0] || null : null);

/** A cell's code from its scheme and its label. The one place the two are joined. */
export const cellCode = (scheme, label) => `${scheme}:${String(label).toUpperCase()}`;

/** The label back out of a code, for a screen. `sector:SL4 1` → `SL4 1`. */
export const labelOf = (code) => (typeof code === 'string' ? code.slice(code.indexOf(':') + 1) : null);

/**
 * How far, in a straight line, this many minutes could possibly reach.
 *
 * Deliberately generous — the open-road speed with no town at either end — so
 * that the neighbour search never misses a cell the estimate would have
 * accepted. `minutesBetween` is what actually decides; this only bounds the
 * work.
 */
export function boundKm(minutes, mode = 'driving') {
  const m = travelMode(mode);
  const at = { lat: 54, lng: -2 };
  const there = (km) => ({ lat: at.lat + km / 111, lng: at.lng });
  let lo = 0;
  let hi = 400;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (estimateTravelMinutes(at, there(mid), m) <= minutes) lo = mid; else hi = mid;
  }
  // Rounded up rather than down: this is a bound, and a bound that is a little
  // too small silently loses the cells at the edge of every ring.
  return Math.ceil(lo) + 1;
}

/**
 * The estimate between two cells, in minutes.
 *
 * It must be the same function the rest of Epic fences a list with, or a search
 * disagrees with itself: the matrix would offer a place and the exact pass would
 * then throw it away, and nobody would be able to see why.
 */
export const minutesBetween = (a, b, mode = 'driving') => estimateTravelMinutes(a, b, mode);

/**
 * Every cell within `capMinutes` of `from`, with the time and the distance.
 *
 * `cells` is the whole list; the caller has already decided which ones to
 * consider. A cell always reaches itself in nothing, because a search that
 * starts in SL4 1 must find the places in SL4 1, and leaving the self-pair to
 * be implied has to be remembered in four different queries instead of once
 * here.
 */
export function reachFrom(from, cells, { mode = 'driving', capMinutes = CAP_MINUTES } = {}) {
  const bound = boundKm(capMinutes, mode);
  const out = [];
  for (const to of cells) {
    // A degree of latitude is 111km wherever you stand, so this throws out most
    // of the country for the price of a subtraction. At eleven thousand cells
    // the inner loop runs a hundred and twenty million times and the haversine
    // is the whole cost of the build.
    if (Math.abs(to.lat - from.lat) * 111 > bound) continue;
    const km = kmBetween(from, to);
    if (km > bound) continue;
    const minutes = to.code === from.code ? 0 : minutesBetween(from, to, mode);
    if (minutes > capMinutes) continue;
    out.push({ from_cell: from.code, to_cell: to.code, mode: travelMode(mode), minutes, km: Math.round(km * 100) / 100 });
  }
  return out;
}

/**
 * The running mean of a cell's centre.
 *
 * A sector is discovered one postcode at a time — the places we index are the
 * only evidence of where it is — so the centre moves as more are seen. Kept as
 * a mean rather than a bounding box because a mean is where the people are and
 * a box's middle is a field.
 */
export function recentre(cell, point) {
  const n = (cell.points ?? 0) + 1;
  return {
    lat: ((cell.lat ?? point.lat) * (n - 1) + point.lat) / n,
    lng: ((cell.lng ?? point.lng) * (n - 1) + point.lng) / n,
    points: n,
  };
}

/** The nearest of a list of cells to a point, or null if the list is empty. */
export function nearestCell(point, cells) {
  let best = null;
  let bestKm = Infinity;
  for (const cell of cells) {
    const km = kmBetween(point, cell);
    if (km < bestKm) { best = cell; bestKm = km; }
  }
  return best ? { ...best, km: Math.round(bestKm * 100) / 100 } : null;
}
