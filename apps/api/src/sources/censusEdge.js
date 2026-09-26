/**
 * A finer census of a ring's edge, and nothing else.
 *
 * The owner, 25 Sep 2026: "Build the runner mode — re-ask only the straddling
 * boxes at one kilometre. A day against three, a smaller change, and it is the
 * right shape: the problem is the edge, not the ground you have already
 * censused. It also leaves something reusable, since every future ring has
 * the same edge."
 *
 * Why the edge is the problem: the census is IDs Only, so a place has no
 * point of its own — it is placed by the box it was found in. A box that
 * straddles the ring's edge is `across` (repositories/censusRing.js): its
 * places are in the ring or they are not, and nobody can say which. Those are
 * the unresolved bucket a shelf prints beside its count. Asking the same
 * ground again in boxes no wider than the corner test's `FINE_M` places every
 * place the fine question finds by its centre, and the index only ever
 * narrows a box (sources/census.js `writeCensusFacts`), so a place found
 * again lands on one side of the line for good.
 *
 * What this does, for any ring: draw the ring from the matrix, read which of
 * its boxes fell across the edge, tile exactly those boxes on the fine grid,
 * tag each square with the district its centre sits in so the roll-up can
 * report it, quote the run, and start it as an ordinary census run whose
 * tiles were planned here rather than from districts. Everything downstream —
 * the pace, the daily cap, the pickup after a deploy, the roll-up and the
 * ring recount when it finishes — is the runner's own.
 *
 * What it does not do: re-ask the ground already censused inside the ring, or
 * beyond it. The only squares asked are the ones under an across box, whole:
 * a place in the far part of a wide box is only placed once its own square is
 * asked, and asking only the ring's side of the box would leave it across.
 */

import { query } from '../db.js';
import { ringFor } from '../repositories/reach.js';
import { censusInRing, FINE_M, widthOf, nearestSector, placingPoints } from '../repositories/censusRing.js';
import { startRun, tileOf, RING_EDGE } from './censusRun.js';
import { slicePlan } from './census.js';
import { travelMode } from '../domain/travel.js';

/**
 * The fine grid: the same one-kilometre squares the inner-London re-census
 * used, so a square asked here is the same tile row as one asked there and
 * neither is paid for twice. Both sides sit under `FINE_M`, which is what
 * makes the corner test place the square by its centre — pinned by
 * test/censusEdge.test.js, because a grid a hair too wide would be
 * corner-tested and stay across, which is exactly what the two-kilometre
 * pass taught (25 Sep 2026).
 */
export const EDGE_LAT = 0.01;
export const EDGE_LNG = 0.015;

/** The width the corner test sees for a square of this grid. */
export const edgeSquareWidth = () => widthOf({ minLat: 0, minLng: 0, maxLat: EDGE_LAT, maxLng: EDGE_LNG });

/**
 * The squares under a set of boxes, each once. A box already no wider than
 * `FINE_M` needs no splitting and is left out: its places are placed by its
 * centre as it is.
 */
export function squaresUnder(boxes, { dLat = EDGE_LAT, dLng = EDGE_LNG } = {}) {
  const out = new Map();
  const eps = 1e-9;
  for (const b of boxes ?? []) {
    if (!b || widthOf(b) <= FINE_M) continue;
    const i0 = Math.floor(b.minLat / dLat); const i1 = Math.floor((b.maxLat - eps) / dLat);
    const j0 = Math.floor(b.minLng / dLng); const j1 = Math.floor((b.maxLng - eps) / dLng);
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const t = tileOf((i + 0.5) * dLat, (j + 0.5) * dLng, dLat, dLng);
        if (!out.has(t.gridKey)) out.set(t.gridKey, { ...t, outcodes: [] });
      }
    }
  }
  return [...out.values()];
}

/**
 * Which districts each square reports to: every district a placing point is
 * nearest to at the square's centre and its four corners, so a square on a
 * district line carries both sides rather than the one its centre happens
 * to fall in (Codex, 26 Sep 2026). A square nothing is near is kept and
 * reports to nobody — the census still asks it, so a place found there is
 * placed by its own box, and the roll-up simply has no district to file the
 * square under.
 */
export function tagSquares(squares, index) {
  return squares.map((s) => {
    const dLat = (s.maxLat - s.minLat) * 0.05; const dLng = (s.maxLng - s.minLng) * 0.05;
    const probes = [
      { lat: (s.minLat + s.maxLat) / 2, lng: (s.minLng + s.maxLng) / 2 },
      { lat: s.minLat + dLat, lng: s.minLng + dLng }, { lat: s.minLat + dLat, lng: s.maxLng - dLng },
      { lat: s.maxLat - dLat, lng: s.minLng + dLng }, { lat: s.maxLat - dLat, lng: s.maxLng - dLng },
    ];
    const outcodes = new Set();
    for (const p of probes) {
      const best = nearestSector(p, index);
      if (best?.outcode) outcodes.add(String(best.outcode).toUpperCase());
    }
    return { ...s, outcodes: [...outcodes].sort() };
  });
}

/**
 * Every district with a placing point inside each square — the postcodes
 * themselves where the table is loaded, the sector centroids where it is not.
 * Five probes at the centre and corners can miss a district whose ground
 * lies inside the square between them, and a place the fine census then
 * files under that district would be read by no ring, because a ring reads a
 * tile's surfacings by district overlap (Codex, 26 Sep 2026). So the probes
 * are the fallback for a square with nothing inside it, and this is the rule.
 */
export async function districtsInside(squares) {
  if (!squares.length) return new Map();
  const bounds = squares.reduce((b, s) => ({
    minLat: Math.min(b.minLat, s.minLat), maxLat: Math.max(b.maxLat, s.maxLat),
    minLng: Math.min(b.minLng, s.minLng), maxLng: Math.max(b.maxLng, s.maxLng),
  }), { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 });
  const { rows } = await query(
    `with p as (
       select upper(outcode) as outcode, lat, lng from postcodes
        where lat between $6 and $7 and lng between $8 and $9
       union all
       select upper(outcode), lat, lng from geo_cells
        where outcode is not null and lat between $6 and $7 and lng between $8 and $9)
     select t.k, array_agg(distinct p.outcode) as outcodes
       from unnest($1::text[], $2::float8[], $3::float8[], $4::float8[], $5::float8[])
            as t(k, min_lat, min_lng, max_lat, max_lng)
       join p on p.lat >= t.min_lat and p.lat < t.max_lat and p.lng >= t.min_lng and p.lng < t.max_lng
      group by t.k`,
    [squares.map((s) => s.gridKey), squares.map((s) => s.minLat), squares.map((s) => s.minLng),
      squares.map((s) => s.maxLat), squares.map((s) => s.maxLng),
      bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng]);
  return new Map(rows.map((r) => [r.k, (r.outcodes ?? []).filter(Boolean)]));
}

/**
 * A square that is already a tile — the inner-London re-census used this
 * grid — keeps every district it was tagged with. The runner's upsert
 * replaces a tile's districts with the run's, which is right for a region
 * run re-planned from a moved sector table and wrong here: a shared tile
 * covering three districts would be left covering the one this ring is
 * near, and the ring count reads a tile's surfacings by district overlap,
 * so places in the other two would go silently missing (Codex, 26 Sep
 * 2026). Merged, never replaced.
 */
export async function mergeExistingCoverage(squares) {
  if (!squares.length) return squares;
  const { rows } = await query(
    'select grid_key, outcodes from census_tiles where grid_key = any($1)', [squares.map((s) => s.gridKey)]);
  const held = new Map(rows.map((r) => [r.grid_key, r.outcodes ?? []]));
  return squares.map((s) => ({
    ...s,
    outcodes: [...new Set([...(held.get(s.gridKey) ?? []).map((o) => String(o).toUpperCase()), ...s.outcodes])].sort(),
  }));
}

/** The ring, its across boxes, and the squares under them. */
export async function planEdge({ lat = null, lng = null, cell = null, minutes = 30, mode = 'driving' } = {}) {
  const kind = travelMode(mode);
  const ring = await ringFor({ lat, lng, cell, minutes, mode: kind });
  if (!ring) return null;
  const band = ring.band ?? ring.cells ?? [];
  const placed = await censusInRing({ cells: band, outcodes: ring.outcodes ?? [] });
  const across = placed.acrossBoxes ?? [];
  const bare = squaresUnder(across);
  if (!bare.length) {
    return { ring: ringSummary(ring, kind, minutes), boxes: placed.boxes, across: across.length, squares: [], outcodes: [] };
  }
  const bounds = bare.reduce((b, s) => ({
    minLat: Math.min(b.minLat, s.minLat), maxLat: Math.max(b.maxLat, s.maxLat),
    minLng: Math.min(b.minLng, s.minLng), maxLng: Math.max(b.maxLng, s.maxLng),
  }), { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 });
  const { index } = await placingPoints(bounds);
  const inside = await districtsInside(bare);
  const tagged = tagSquares(bare, index).map((s) => ({
    ...s, outcodes: [...new Set([...s.outcodes, ...(inside.get(s.gridKey) ?? [])])].sort(),
  }));
  const squares = await mergeExistingCoverage(tagged);
  const outcodes = [...new Set(squares.flatMap((s) => s.outcodes))].sort();
  return { ring: ringSummary(ring, kind, minutes), boxes: placed.boxes, across: across.length, squares, outcodes };
}

const ringSummary = (ring, mode, minutes) => ({
  cell: ring.cell ?? null, label: ring.label ?? null, mode, minutes,
  cells: (ring.band ?? ring.cells ?? []).length, outcodes: (ring.outcodes ?? []).length,
});

/**
 * What the run will ask, before anybody presses anything. The same arithmetic
 * as the board's quote for a region (routes/placeIndex.js): every question of
 * the plan per square, plus a splitting allowance where a square holds more
 * than a few sectors. IDs Only, so the price is nought; the number is a rate
 * and a day, not money.
 */
export async function quoteEdge(plan) {
  const squares = plan?.squares ?? [];
  const questions = (await slicePlan()).reduce((n, p) => n + p.questions.length, 0);
  if (!squares.length) return { squares: 0, questions, requests: 0, ceiling: 0, floor: 0, sectors: 0, hours: { at5: 0, at10: 0 }, costGbp: 0 };
  const { rows: density } = await query(
    `select t.k, count(g.code)::int as sectors
       from unnest($1::text[], $2::float8[], $3::float8[], $4::float8[], $5::float8[])
            as t(k, min_lat, min_lng, max_lat, max_lng)
       left join geo_cells g
         on g.lat >= t.min_lat and g.lat < t.max_lat and g.lng >= t.min_lng and g.lng < t.max_lng
      group by t.k`,
    [squares.map((s) => s.gridKey), squares.map((s) => s.minLat), squares.map((s) => s.minLng),
      squares.map((s) => s.maxLat), squares.map((s) => s.maxLng)]);
  const SPLIT_FROM = 8;
  const PER_SECTOR = 25;
  const requests = density.reduce((n, d) => n + questions + PER_SECTOR * Math.max(0, d.sectors - SPLIT_FROM), 0);
  return {
    squares: squares.length,
    questions,
    sectors: density.reduce((n, d) => n + d.sectors, 0),
    requests,
    // Where the run stops if the estimate was wrong. An estimate held as an
    // exact ceiling pauses the run short of its last squares wherever a
    // square saturates and splits beyond what the arithmetic allowed for —
    // the two-kilometre pass stopped three tiles short exactly so (26 Sep
    // 2026). Twice the estimate: room for the splitting, not a blank cheque;
    // the daily cap still applies above it.
    ceiling: Math.max(requests * 2, squares.length * questions),
    floor: squares.length * questions,
    hours: { at5: Math.round(requests / 5 / 360) / 10, at10: Math.round(requests / 10 / 360) / 10 },
    costGbp: 0,
  };
}

/**
 * Start the run. Refused without the request count the quote reported, the
 * way every paid or rate-bound pass here is: the number on the screen is the
 * number the run is held to. The quote is worked out again for this plan and
 * the number sent must be its estimate — proof the caller saw it, so a stale
 * or mistyped figure starts nothing (Codex, 26 Sep 2026). What the run
 * actually stops at is the quote's ceiling, not its estimate: an estimate is
 * arithmetic over sector density and gives no room for a square that
 * saturates and splits, and a run held to it pauses short and cannot resume
 * past it (Codex, 26 Sep 2026, and the two-kilometre pass before it).
 */
export async function startEdgeRun({ plan, maxRequests, ratePerSec = 5, label = null, startedBy = null, startedSessionId = null } = {}) {
  if (!plan?.squares?.length) throw Object.assign(new Error('nothing across this ring’s edge to re-ask'), { status: 400 });
  const quote = await quoteEdge(plan);
  if (Number(maxRequests) !== quote.requests) {
    throw Object.assign(
      new Error(`a ring-edge run starts only with the request count its quote reported — ${quote.requests.toLocaleString('en-GB')} for this ring, not ${maxRequests ?? 'nothing'}`),
      { status: 400, quoted: quote.requests });
  }
  const r = plan.ring;
  return startRun({
    label: label ?? `${r.label ?? r.cell} · ${r.minutes} min ${r.mode} · edge at a kilometre`,
    outcodes: plan.outcodes,
    tiles: plan.squares,
    dLat: EDGE_LAT, dLng: EDGE_LNG, padKm: 0,
    // Every planned square is asked again, however recently it was censused:
    // the run exists to re-ask exactly these squares, and a square left
    // 'done' because a regional pass covered it last week would be skipped
    // while its box stayed across (Codex, 26 Sep 2026).
    freshDays: 0,
    maxRequests: quote.ceiling, ratePerSec,
    startedBy: `${RING_EDGE}${r.cell}|${r.mode}|${r.minutes}${startedBy ? `|${startedBy}` : ''}`,
    startedSessionId,
  });
}
