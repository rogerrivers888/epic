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
import { kmBetween } from '../domain/travel.js';
import { TEXT_QUESTIONS, textStillAsked } from '../sources/censusQuestions.js';
import { SHOWN_REF } from './placeStatus.js';

/**
 * The widest box that is placed by its centre.
 *
 * The fine grid's tile is 0.01° by 0.015°, which is 1,113 m by 1,050 m at
 * London's latitude — and an unsaturated question at that grid writes the
 * whole tile as the place's box. With this at a round thousand metres every
 * such box was a few metres too wide for the centre rule, went through the
 * corner test, and read as straddling wherever the tile crossed a district
 * line: E5 and SE11 counted nothing after a kilometre pass planned from the
 * true sectors, with 249 places sitting in 1,113-metre boxes (26 Sep 2026).
 * Only the dense districts, where questions saturated and split into
 * quarters, ever resolved. The fine tile and anything narrower is placed by
 * its centre; wider than that is genuinely either side of a line.
 */
export const FINE_M = 1200;

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
 * Whether a box is wholly inside a straight-line circle, wholly outside it, or
 * across its edge — the circle being the estimated reach a matrix-less mode
 * (walk, cycle, transit) is counted over (owner, 30 Sep 2026).
 *
 * Judged by distance to the circle's centre rather than by nearest sector, so
 * the count is over the identical circle the display cards are fenced by and the
 * two cannot disagree (Codex). A box under the fine width is placed by its
 * centre, exactly as the sector test places it; a wider one really can straddle
 * the edge and is left unresolved.
 *
 * For a wide box the test is exact rather than sampled: an axis-aligned box and
 * a circle overlap iff the box's nearest point to the centre is within the
 * radius, and the box is wholly inside iff its farthest point (a corner) is. A
 * five-point sample would miss a small circle sitting inside a large box, or one
 * that crosses an edge between two corners, and read it as outside (Codex).
 */
export function whereBoxSitsInCircle(box, { lat, lng, km }) {
  if (!box) return 'nowhere';
  const at = { lat, lng };
  if (widthOf(box) <= FINE_M) {
    const mid = { lat: (box.minLat + box.maxLat) / 2, lng: (box.minLng + box.maxLng) / 2 };
    return kmBetween(at, mid) <= km ? 'inside' : 'outside';
  }
  // Nearest point of the rectangle to the centre: the centre clamped into it.
  const nearest = {
    lat: Math.min(Math.max(lat, box.minLat), box.maxLat),
    lng: Math.min(Math.max(lng, box.minLng), box.maxLng),
  };
  if (kmBetween(at, nearest) > km) return 'outside';
  // Farthest point of a rectangle from any centre is one of its four corners.
  const farthest = Math.max(...cornersOf(box).slice(0, 4).map((p) => kmBetween(at, p)));
  return farthest <= km ? 'inside' : 'across';
}

/**
 * The sector nearest a point. A dead heat goes to the lower sector code,
 * whatever order the universe was read in: two roll-ups over two neighbours
 * read two universes, and "counted once globally" (owner, 25 Sep 2026) needs
 * both to agree on which side a box exactly between them is on.
 */
export function nearestSector(point, universe) {
  if (universe && typeof universe.nearest === 'function') return universe.nearest(point);
  let best = null; let bestD = Infinity;
  for (const u of universe) {
    const d = (u.lat - point.lat) ** 2 + (u.lng - point.lng) ** 2;
    if (d < bestD || (d === bestD && best && u.code < best.code)) { bestD = d; best = u; }
  }
  return best;
}

/**
 * A set of points bucketed on a grid, for nearest lookups over a great many.
 *
 * Every live postcode in the country is 1.7 million points, and a ring over
 * London holds tens of thousands of them; a linear scan per box would be
 * billions of comparisons. Buckets a hundredth of a degree square, searched
 * in rings outward from the point's own bucket until the best so far is
 * nearer than any bucket not yet looked in. Same answer as the scan, same
 * tie: the lower code.
 */
export class PointIndex {
  constructor(points, cell = 0.01) {
    this.cell = cell; this.size = points.length; this.buckets = new Map();
    for (const p of points) {
      const k = this.keyOf(p.lat, p.lng);
      let b = this.buckets.get(k);
      if (!b) { b = []; this.buckets.set(k, b); }
      b.push(p);
    }
  }
  keyOf(lat, lng) { return `${Math.floor(lat / this.cell)}:${Math.floor(lng / this.cell)}`; }
  nearest(point) {
    if (!this.size) return null;
    const bi = Math.floor(point.lat / this.cell); const bj = Math.floor(point.lng / this.cell);
    let best = null; let bestD = Infinity;
    // Never more rings than it takes to cross the widest gap between two
    // postcodes anywhere in Britain, which is well under a degree.
    for (let r = 0; r <= 120; r += 1) {
      for (let i = bi - r; i <= bi + r; i += 1) {
        for (let j = bj - r; j <= bj + r; j += 1) {
          if (Math.max(Math.abs(i - bi), Math.abs(j - bj)) !== r) continue;
          const b = this.buckets.get(`${i}:${j}`);
          if (!b) continue;
          for (const u of b) {
            const d = (u.lat - point.lat) ** 2 + (u.lng - point.lng) ** 2;
            if (d < bestD || (d === bestD && best && u.code < best.code)) { bestD = d; best = u; }
          }
        }
      }
      // Anything in a ring not yet searched is at least r whole buckets away
      // in latitude or longitude, so at least r cells in distance.
      if (best && bestD <= (r * this.cell) ** 2) break;
    }
    return best;
  }
  /**
   * Every point whose own location lies within the box. A point inside the box is
   * proof that its sector has ground there, so the box is not wholly inside the
   * ring unless that sector is too — the exact half of the E9 test (owner, 1 Oct
   * 2026) that a grid sample on its own cannot guarantee.
   */
  within(box) {
    const out = [];
    const bi0 = Math.floor(box.minLat / this.cell); const bi1 = Math.floor(box.maxLat / this.cell);
    const bj0 = Math.floor(box.minLng / this.cell); const bj1 = Math.floor(box.maxLng / this.cell);
    for (let i = bi0; i <= bi1; i += 1) {
      for (let j = bj0; j <= bj1; j += 1) {
        const b = this.buckets.get(`${i}:${j}`);
        if (!b) continue;
        for (const p of b) {
          if (p.lat >= box.minLat && p.lat <= box.maxLat && p.lng >= box.minLng && p.lng <= box.maxLng) out.push(p);
        }
      }
    }
    return out;
  }
}

/**
 * The points a box is placed against, for a stretch of ground.
 *
 * Every live postcode inside the box, padded, as points that carry their
 * sector code and district — so the nearest one says at once which sector
 * and which district a place is in. Owner, 26 Sep 2026: "in the City a sector
 * centroid is the worst approximation in Britain … 1.7 million ONS points is a
 * small, free, OGL table and it retires the class rather than the instance."
 * EC2V had four correct sectors and read nought, because 177 places within
 * three hundred metres of them were nearer a neighbour's centroid.
 *
 * Where the postcode table has not been loaded (a fresh installation, a test
 * database) the sector centroids stand in, and the answer says which it used:
 * a count placed by centroids is a different, cruder fact, and the roll-up
 * carries the word.
 */
export async function placingPoints({ minLat, minLng, maxLat, maxLng }, { padLat = 0.05, padLng = 0.08 } = {}) {
  const bounds = [minLat - padLat, maxLat + padLat, minLng - padLng, maxLng + padLng];
  const { rows: postcodes } = await query(
    `select 'sector:' || sector as code, outcode, lat, lng from postcodes
      where lat between $1 and $2 and lng between $3 and $4`, bounds);
  // Postcodes alone where there are any: a centroid mixed in can sit nearer a
  // point than every real postcode — a sector wrapped round a park — and then
  // the answer is not nearest-postcode placement while saying it is (Codex,
  // 26 Sep 2026). The centroids are the fallback for ground with no postcodes
  // loaded, and the answer says so.
  if (postcodes.length) return { index: new PointIndex(postcodes), placedBy: 'postcodes', points: postcodes.length };
  const { rows: sectors } = await query(
    `select code, upper(outcode) as outcode, lat, lng from geo_cells
      where scheme = 'sector' and outcode is not null
        and lat between $1 and $2 and lng between $3 and $4`, bounds);
  return { index: new PointIndex(sectors), placedBy: 'sectors', points: sectors.length };
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
 * worse. Wider boxes are judged over their whole area, because a box that big
 * really can be on either side of the line: every sector with ground in the box,
 * or within a fine-tile margin of it, decides it (E9, owner 1 Oct 2026) — so a
 * ring edge cutting the box can no longer pass as "inside" the way the old
 * five-point corner sample let it.
 *
 * @returns {{kind:'inside', code:string} | {kind:'across', codes:Set<string>} | {kind:'nowhere'}}
 */
export function sectorsOfBox(box, universe) {
  if (!box) return { kind: 'nowhere' };
  if (widthOf(box) <= FINE_M) {
    const best = nearestSector({ lat: (box.minLat + box.maxLat) / 2, lng: (box.minLng + box.maxLng) / 2 }, universe);
    return best ? { kind: 'inside', code: best.code, outcode: best.outcode ?? null } : { kind: 'nowhere' };
  }
  // Classify a wide box by every sector whose ground lies in it, or within a
  // fine-tile margin of it — not by sampling a handful of points (E9: owner 1 Oct
  // 2026, "a box straddling the ring edge is unresolved, not inside"). A seed
  // inside the box proves that sector has ground there; a seed just outside, within
  // the margin, is a neighbour whose nearest-point region can reach in. Any such
  // sector out of the ring makes the box unresolved, so the overstatement this fixes
  // — a nine-kilometre tile read "inside" off four in-ring corners — cannot recur.
  // The margin is a fine tile, not larger, on purpose: a bigger one would fence a
  // wide box wholly inside the ring (owner, 20 Sep: "a 6 km box in the middle needs
  // no splitting"). The residual it cannot see — an out-of-ring seed further than a
  // fine tile away in sparse ground whose region still clips the box — is what the
  // finer census (which splits these tiles to the fine grid) resolves; there is no
  // exact, cheap whole-box test that does not over-fence large boxes.
  const midLat = (box.minLat + box.maxLat) / 2;
  const mLat = FINE_M / 111320;
  const mLng = FINE_M / (111320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  const exp = { minLat: box.minLat - mLat, maxLat: box.maxLat + mLat, minLng: box.minLng - mLng, maxLng: box.maxLng + mLng };
  const seeds = typeof universe?.within === 'function'
    ? universe.within(exp)
    : (Array.isArray(universe) ? universe.filter((p) => p.lat >= exp.minLat && p.lat <= exp.maxLat && p.lng >= exp.minLng && p.lng <= exp.maxLng) : []);
  const codes = new Set(); const outcodes = new Set(); let one = null;
  const note = (best) => { if (best) { codes.add(best.code); if (best.outcode != null) outcodes.add(best.outcode); one = best; } };
  for (const p of seeds) note({ code: p.code, outcode: p.outcode ?? null });
  // Combined with the nearest sector to each corner and the middle: the seed scan
  // catches a sector sitting inside or beside the box; the corner samples catch a
  // far seed in sparse ground whose nearest-point region owns a corner from outside
  // the margin (Codex). The union is more conservative than either alone — a box is
  // inside only if neither test finds out-of-ring ground.
  for (const p of cornersOf(box)) note(nearestSector(p, universe));
  if (!codes.size) return { kind: 'nowhere' };
  if (codes.size === 1) return { kind: 'inside', code: one.code, outcode: one.outcode ?? null };
  return { kind: 'across', codes, outcodes };
}

/**
 * @param cells    the ring's own sectors, from the reachability matrix
 * @param outcodes the districts those sectors sit in — the candidate universe
 */
export async function censusInRing({ cells = [], outcodes = [], shownOnly = false, circle = null, subcategories = null } = {}) {
  const empty = { counts: {}, unresolved: {}, placed: { own: 0, slice: 0 }, unplaceable: 0, boxes: { inside: 0, outside: 0, across: 0 }, placedBy: null };
  // A straight-line ring is a circle round the origin and needs no sector set;
  // a matrix ring is a set of sectors and needs one. Either way the districts
  // are the candidate universe (Codex, 30 Sep 2026).
  if (!outcodes.length || (!circle && !cells.length)) return empty;
  const slugs = outcodes.map((o) => String(o).toLowerCase());

  // For a matrix ring, every sector these districts are made of, once — for the
  // ground they cover; the points a box is judged against are every postcode on
  // that ground (26 Sep 2026), the sector centroids where none are loaded. A
  // circle ring judges every box by distance to the centre, so it needs neither.
  let universe = null;
  let placedBy = circle ? 'circle' : null;
  if (!circle) {
    const { rows: sectors } = await query(
      'select code, lat, lng from geo_cells where lower(outcode) = any($1)', [slugs]);
    if (!sectors.length) return empty;
    const box = sectors.reduce((b, u) => ({
      minLat: Math.min(b.minLat, u.lat), maxLat: Math.max(b.maxLat, u.lat),
      minLng: Math.min(b.minLng, u.lng), maxLng: Math.max(b.maxLng, u.lng),
    }), { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 });
    ({ index: universe, placedBy } = await placingPoints(box));
  }
  const inRing = new Set(cells);

  // Both ways a surfacing is filed. The ring census wrote one row per outcode,
  // so `area_slug` is the outcode; the big census writes one row per grid tile,
  // so `area_slug` is a tile key and the tile says which outcodes it covers
  // (`census_tiles.outcodes`). Reading only the first quietly dropped every
  // place the tiled run found, which is most of them — and the corner test
  // below is what decides whether the place is in the ring either way, so
  // neither filing is trusted further than "it is somewhere around here".
  // A text-sourced surfacing counts only while its drawer is still asked in
  // text; once the drawer is re-fenced those rows are answers to a question
  // that no longer exists, kept on the place for judging and left out of the
  // number (25 Sep 2026). The same rule the outcode roll-up reads.
  const textDrawers = Object.keys(TEXT_QUESTIONS).filter(textStillAsked);
  const { rows } = await query(`
    select ps.category, ps.venue_ref, pi.lat, pi.lng, pi.slice
      from place_subcategories ps
      join place_index pi on pi.venue_ref = ps.venue_ref
     where (ps.area_slug = any($1)
        or ps.area_slug in (select grid_key from census_tiles
                             where outcodes && (select array_agg(upper(s)) from unnest($1::text[]) s)))
       and (ps.sourced is distinct from 'text' or ps.subcategory = any($2::text[]))
       -- Restricted to a set of subcategories where one is given: the "real
       -- family" Culture figure asked for only museums, galleries and the like,
       -- not churches or landmarks (owner, 1 Oct 2026). Null means every drawer.
       and ($3::text[] is null or ps.subcategory = any($3::text[]))
       -- What a family is shown leaves out closed and unconfirmed places once
       -- the owner has applied the check (C57); the back office's census
       -- boards still count everything that exists.
       ${shownOnly ? `and ${SHOWN_REF('ps.venue_ref')}` : ''}`,
  [slugs, textDrawers, Array.isArray(subcategories) ? subcategories : null]);

  // One verdict per distinct box, not per row: the same slice found hundreds of
  // places and the corner test would otherwise run hundreds of times.
  const verdicts = new Map();
  const verdictOf = (slice) => {
    if (verdicts.has(slice)) return verdicts.get(slice);
    const v = circle
      ? whereBoxSitsInCircle(boxFrom(slice), circle)
      : whereBoxSits(boxFrom(slice), { cells: inRing, universe });
    verdicts.set(slice, v);
    return v;
  };
  // A place with its own coordinate is placed exactly: inside the circle by
  // distance, or inside a matrix ring by its nearest sector.
  const ownInside = circle
    ? (lat, lng) => kmBetween({ lat: circle.lat, lng: circle.lng }, { lat, lng }) <= circle.km
    : (lat, lng) => inRing.has(nearestSector({ lat, lng }, universe)?.code ?? null);

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
      if (ownInside(Number(r.lat), Number(r.lng))) add(counted, r.category, r.venue_ref);
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
    placedBy,
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
    // The boxes themselves that fell across the edge, as rectangles: what a
    // finer census of the edge re-asks (sources/censusEdge.js). One per
    // distinct slice, whatever it held.
    acrossBoxes: [...verdicts].filter(([, v]) => v === 'across').map(([slice]) => boxFrom(slice)).filter(Boolean),
    placedBy,
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
