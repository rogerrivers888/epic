/**
 * How many places the census knows inside a ring — by slice, not by coordinate.
 *
 * The question the owner asked (20 Sep 2026): "Tell me how a census row can be
 * attributed to a location when 42% of place_index has no coordinates. Does the
 * recorded slice give us a box we can test against the ring? If yes, count by
 * slice."
 *
 * **It does.** The census asks Google inside a rectangle and writes that
 * rectangle on every place it finds — `place_index.slice` is literally
 * `minLat,minLng,maxLat,maxLng`. So a place with no coordinate of its own is
 * still known to be *in that box*, and the box can be tested against the ring.
 * Nothing here reads `place_cells`, which would have thrown away the whole
 * census-only population — the very places the census exists to find.
 *
 * Three rules, and the third is the honest one:
 *
 *   · A place with its own coordinate is placed by it. That is exact.
 *   · A place without one is placed at the centre of its slice. Most slices are
 *     about four hundred metres across, which is well inside a postcode sector.
 *   · A place whose slice is wider than a kilometre is **not counted either
 *     way**. It is reported as uncertain, because a box that big can straddle
 *     the edge of the ring and there is nothing in the row to say which side it
 *     fell. Splitting the saturated slices is what shrinks this number.
 *
 * Counting is `count(distinct venue_ref)` *per category*: one place found by
 * three of a category's drawers is one place (135 rows for 65 places was the
 * bug). Across categories it stays multiple — a place filed under Sport and
 * again under Fun is in both lists, and correctly counts in both.
 */

import { query } from '../db.js';

/**
 * How fine a box has to get before it is worth splitting further.
 *
 * Not a test of whether a box may be counted — that is the corner test below —
 * but the floor a re-census stops at. A box this small sits inside one postcode
 * sector almost everywhere people live.
 */
export const FINE_M = 1000;

/** The four corners and the middle: five points that decide whether a box is in. */
const cornersOf = (box) => [
  { lat: box.minLat, lng: box.minLng },
  { lat: box.minLat, lng: box.maxLng },
  { lat: box.maxLat, lng: box.minLng },
  { lat: box.maxLat, lng: box.maxLng },
  { lat: (box.minLat + box.maxLat) / 2, lng: (box.minLng + box.maxLng) / 2 },
];

const boxFrom = (slice) => {
  const n = String(slice ?? '').split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null;
  return { minLat: n[0], minLng: n[1], maxLat: n[2], maxLng: n[3] };
};

export const widthOf = (box) => (box
  ? Math.max((box.maxLat - box.minLat) * 111320, (box.maxLng - box.minLng) * 70000)
  : 0);

/**
 * Whether a box is wholly inside the ring, wholly outside it, or across its
 * edge.
 *
 * The owner, 20 Sep 2026: "Any slice wider than about a kilometre gets split
 * until every place lands in a box that sits wholly inside or wholly outside
 * the ring." The width is not the question — a six-kilometre box in the middle
 * of a forty-kilometre ring is wholly inside and needs no splitting. Only a box
 * that crosses the edge is unresolved, and those are the ones a re-census
 * splits.
 *
 * The ring is a set of sector centres, so "inside" means the nearest sector to
 * that point is one of the ring's. Five points decide it: the four corners and
 * the middle.
 */
export function whereBoxSits(box, { cells, universe }) {
  const v = sectorsOfBox(box, universe);
  if (v.kind === 'nowhere') return 'nowhere';
  const inRing = cells instanceof Set ? cells : new Set(cells);
  if (v.kind === 'inside') return inRing.has(v.code) ? 'inside' : 'outside';
  let ins = 0;
  for (const c of v.codes) if (inRing.has(c)) ins += 1;
  if (ins === v.codes.size) return 'inside';
  if (ins === 0) return 'outside';
  return 'across';
}

/**
 * The sector nearest a point. A dead heat goes to the lower sector code,
 * whatever order the universe was read in: two roll-ups over two neighbours
 * read two universes, and "counted once globally" (owner, 25 Sep 2026) needs
 * both to agree on which side a box exactly between them is on.
 */
export function nearestSector(point, universe) {
  let best = null; let bestD = Infinity;
  for (const u of universe) {
    const d = (u.lat - point.lat) ** 2 + (u.lng - point.lng) ** 2;
    if (d < bestD || (d === bestD && best && u.code < best.code)) { bestD = d; best = u; }
  }
  return best;
}

/**
 * Which sector, or sectors, a box belongs to — the one verdict the ring count
 * and the outcode roll-up both draw from, so a place cannot be one district's
 * in one and another's in the other.
 *
 * The rule at the top of this file, built at last (25 Sep 2026). A box under a
 * kilometre is placed by its centre: the nearest sector to the middle of a
 * four-hundred-metre box is where the place is, near enough, and a boundary
 * place is arbitrary either way — counted in the wrong one of two neighbours
 * is a small error, counted nowhere is a missing place. Every box, whatever
 * its width, went through the corner test, so a district a few streets wide —
 * smaller than any box — could never resolve a single place: Bloomsbury
 * counted 3 with hundreds unresolved, and the one-kilometre re-census made it
 * worse. Wider boxes keep the corner test, because a box that big really can
 * be on either side of the line: five points, the corners and the middle, and
 * the set of sectors they fall nearest to.
 *
 * @returns {{kind:'inside', code:string} | {kind:'across', codes:Set<string>} | {kind:'nowhere'}}
 */
export function sectorsOfBox(box, universe) {
  if (!box) return { kind: 'nowhere' };
  if (widthOf(box) <= FINE_M) {
    const best = nearestSector({ lat: (box.minLat + box.maxLat) / 2, lng: (box.minLng + box.maxLng) / 2 }, universe);
    return best ? { kind: 'inside', code: best.code } : { kind: 'nowhere' };
  }
  const codes = new Set();
  for (const p of cornersOf(box)) {
    const best = nearestSector(p, universe);
    if (best) codes.add(best.code);
  }
  if (!codes.size) return { kind: 'nowhere' };
  if (codes.size === 1) return { kind: 'inside', code: [...codes][0] };
  return { kind: 'across', codes };
}

/**
 * @param cells    the ring's own sectors, from the reachability matrix
 * @param outcodes the districts those sectors sit in — the candidate universe
 */
export async function censusInRing({ cells = [], outcodes = [] } = {}) {
  const empty = { counts: {}, unresolved: {}, placed: { own: 0, slice: 0 }, unplaceable: 0, boxes: { inside: 0, outside: 0, across: 0 } };
  if (!cells.length || !outcodes.length) return empty;
  const slugs = outcodes.map((o) => String(o).toLowerCase());

  // Every sector these districts are made of, once. The corner test runs in
  // memory against this: a few hundred points, five comparisons per box.
  const { rows: universe } = await query(
    'select code, lat, lng from geo_cells where lower(outcode) = any($1)', [slugs]);
  if (!universe.length) return empty;
  const inRing = new Set(cells);

  // Both ways a surfacing is filed. The ring census wrote one row per outcode,
  // so `area_slug` is the outcode; the big census writes one row per grid tile,
  // so `area_slug` is a tile key and the tile says which outcodes it covers
  // (`census_tiles.outcodes`). Reading only the first quietly dropped every
  // place the tiled run found, which is most of them — and the corner test
  // below is what decides whether the place is in the ring either way, so
  // neither filing is trusted further than "it is somewhere around here".
  const { rows } = await query(`
    select ps.category, ps.venue_ref, pi.lat, pi.lng, pi.slice
      from place_subcategories ps
      join place_index pi on pi.venue_ref = ps.venue_ref
     where ps.area_slug = any($1)
        or ps.area_slug in (select grid_key from census_tiles
                             where outcodes && (select array_agg(upper(s)) from unnest($1::text[]) s))`,
  [slugs]);

  // One verdict per distinct box, not per row: the same slice found hundreds of
  // places and the corner test would otherwise run hundreds of times.
  const verdicts = new Map();
  const verdictOf = (slice) => {
    if (verdicts.has(slice)) return verdicts.get(slice);
    const v = whereBoxSits(boxFrom(slice), { cells: inRing, universe });
    verdicts.set(slice, v);
    return v;
  };
  const cellFor = (lat, lng) => {
    let best = null; let bestD = Infinity;
    for (const u of universe) {
      const d = (u.lat - lat) ** 2 + (u.lng - lng) ** 2;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best?.code ?? null;
  };

  const counted = new Map();
  const unresolved = new Map();
  const add = (map, category, ref) => {
    if (!map.has(category)) map.set(category, new Set());
    map.get(category).add(ref);
  };
  let own = 0; let bySlice = 0; let unplaceable = 0;
  const seenOwn = new Set(); const seenSlice = new Set();
  const boxes = { inside: 0, outside: 0, across: 0 };

  for (const r of rows) {
    // Its own point beats any box: that is exact.
    if (r.lat != null && r.lng != null) {
      if (!seenOwn.has(r.venue_ref)) { seenOwn.add(r.venue_ref); own += 1; }
      if (inRing.has(cellFor(Number(r.lat), Number(r.lng)))) add(counted, r.category, r.venue_ref);
      continue;
    }
    if (!r.slice) { unplaceable += 1; continue; }
    if (!seenSlice.has(r.venue_ref)) { seenSlice.add(r.venue_ref); bySlice += 1; }
    const v = verdictOf(r.slice);
    if (v === 'inside') add(counted, r.category, r.venue_ref);
    else if (v === 'across') add(unresolved, r.category, r.venue_ref);
  }
  for (const v of verdicts.values()) if (boxes[v] != null) boxes[v] += 1;

  return {
    counts: Object.fromEntries([...counted].map(([k, set]) => [k, set.size])),
    // The places behind each count, so a ranking can be built from exactly the
    // set that was counted and never from a second, drifting idea of the ring.
    refs: Object.fromEntries([...counted].map(([k, set]) => [k, [...set]])),
    // Places in a box that crosses the ring's edge: they are in the ring or
    // they are not, and the only way to know is to census that box finer. Never
    // dropped — a count that leaves them out silently undercounts, which is the
    // thing that produced a worse screen than the one it replaced (owner,
    // 20 Sep 2026: "Do not discard them. Resolve them, then count them").
    unresolved: Object.fromEntries([...unresolved].map(([k, set]) => [k, set.size])),
    placed: { own, slice: bySlice },
    unplaceable,
    boxes,
  };
}

/**
 * The old arithmetic, kept so a before-and-after can be shown rather than
 * asserted: whole districts, summed over drawers, double counts and all.
 */
export async function censusByOutcodeSum(outcodes = []) {
  if (!outcodes.length) return {};
  const slugs = outcodes.map((o) => String(o).toLowerCase());
  const { rows } = await query(
    `select category, sum(census_count)::int as places
       from area_counts where area_slug = any($1) and category <> ''
      group by category`, [slugs]);
  return Object.fromEntries(rows.map((r) => [r.category, r.places]));
}
