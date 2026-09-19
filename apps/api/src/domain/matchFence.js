/**
 * How close two sources have to agree before they are the same place.
 *
 * One number, in one place, because three different lookups need it and a
 * fence that differs between them is a match rate that cannot be compared.
 *
 * **It is 400 metres, not 150** (owner, 19 Sep 2026). The policy's original
 * 150 m is right for a restaurant, whose point is its front door at both
 * sources. It is badly wrong for anything with an area: OpenStreetMap gives the
 * centroid of a hundred-hectare polygon and Google pins the clubhouse or the
 * main gate, and the two are routinely half a mile apart. At 150 m, experiment 1
 * reported Ascot Racecourse, Wentworth, Sunningdale, Swinley Forest and Chobham
 * Common as "not on Google" — none of which can be true. Fourteen of
 * twenty-one supposed misses were Google's after all once the fence was widened.
 *
 * And where the open map gives a polygon rather than a point, the fence is the
 * *feature's own extent* plus 100 m, because a fixed radius says nothing useful
 * about a golf course that is two kilometres across.
 *
 * A wider fence trades a false negative for a false positive, and the two are
 * not equally bad here: a false negative writes a place off as "nobody has it",
 * which is the finding the whole residual question turns on, while a false
 * positive shows up as a name that does not match and is caught by the name
 * check that runs beside this.
 */

/** The fence for a place the open map knows only as a point. */
export const FENCE_M = 400;
/** Added to a polygon's own half-extent, so a big feature gets a big fence. */
export const POLYGON_MARGIN_M = 100;
/** No fence is allowed to grow past this: at some point it stops being a match. */
export const MAX_FENCE_M = 5000;

const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;

/** Metres between two points. */
export function metresBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = p2 - p1;
  const dl = rad(b.lng - a.lng);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * The fence for one open-map feature.
 *
 * `bounds` is Overpass's own `{ minlat, minlon, maxlat, maxlon }`, which comes
 * back on a way or a relation and not on a node. Half the diagonal is the
 * feature's radius from its centre; the margin covers a pin that sits just
 * outside the boundary, which is where a main entrance usually is.
 */
export function fenceFor({ bounds = null } = {}) {
  if (!bounds || bounds.minlat == null) return FENCE_M;
  const half = metresBetween(
    { lat: bounds.minlat, lng: bounds.minlon },
    { lat: bounds.maxlat, lng: bounds.maxlon },
  ) / 2;
  if (!Number.isFinite(half)) return FENCE_M;
  return Math.min(MAX_FENCE_M, Math.max(FENCE_M, Math.round(half + POLYGON_MARGIN_M)));
}

/**
 * That fence as a box, for the providers that fence with a rectangle.
 *
 * Longitude degrees shrink with latitude, so the east-west half-width is
 * divided by the cosine — without it a "400 m" box in Britain is 400 m
 * north-south and about 250 m east-west, which is a different fence in each
 * direction and quietly tighter than the one that was asked for.
 */
export function boxAround({ lat, lng }, metres = FENCE_M) {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos(rad(lat)) || 1);
  return { minLat: lat - dLat, minLng: lng - dLng, maxLat: lat + dLat, maxLng: lng + dLng };
}

/**
 * Two names that mean the same place.
 *
 * Deliberately loose on decoration and strict on the rest: "The Chequers" and
 * "Chequers" are one pub, and "Royal Ascot Golf Club" and "Royal Ascot Cricket
 * Club" are two different clubs on the same road. One containing the other
 * counts, because a provider's trading name is routinely longer than the open
 * map's ("Prime Turkish Kitchen" against "Prime Turkish Kitchen & Bar Woking").
 */
const DECOR = /\b(the|ltd|limited|plc|uk|co|inc)\b/g;
/**
 * An accent is a spelling, not a different place.
 *
 * `Café Rouge` and `Cafe Rouge` are one restaurant and two providers routinely
 * disagree about the accent. Decomposing first and dropping the combining marks
 * is what makes them the same string — without it the é was simply not a letter
 * a-z, so it fell out entirely and "café" normalised to "caf" while "cafe"
 * normalised to "cafe", and the two stopped matching (Codex, 19 Sep 2026).
 */
export const normaliseName = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ').replace(DECOR, ' ').replace(/[^a-z0-9]+/g, '');

/**
 * The same name, allowing one to be the longer trading version of the other.
 *
 * For a *by-name lookup*, where the question is "does this provider hold this
 * place at all" and the fence has already narrowed it to a few hundred metres.
 * A provider's trading name is routinely longer than the open map's.
 */
export function namesAgree(a, b) {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * The same name, exactly.
 *
 * For *merging two records into one row*, which is a stricter question than
 * whether a provider has the place: a merge that is wrong shows a household one
 * restaurant wearing another's reviews. `resolveVenues` has always required
 * equality, and loosening only one side of that produced a duplicate standalone
 * result rather than an enrichment (Codex, 19 Sep 2026).
 */
export const namesAreSame = (a, b) => {
  const x = normaliseName(a);
  return Boolean(x) && x === normaliseName(b);
};
