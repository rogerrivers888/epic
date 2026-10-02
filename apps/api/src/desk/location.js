/**
 * The location filter shared by Categories and Collections (handover 4.12,
 * D12): a postcode, town or city plus a reach, and every Places count becomes
 * what a household there would see.
 *
 * Answered from the reach matrix Epic already holds (`reach`, car times
 * between postcode sectors, up to 90 minutes). The design offers two things
 * the matrix does not hold, and neither is ever shown as if it were exact:
 *
 *   - **public transport**: the matrix has car times only. The prototype's
 *     own model is that transit reaches about half as far for the same
 *     minutes, so transit N minutes is answered as car N/2 minutes and the
 *     result says `approx: true`. TravelTime isochrones replace this in
 *     production once the owner enables them.
 *   - **120 minutes**: past the matrix's 90-minute cap, so it is answered at
 *     90 and the result says `capped: true` — every count is "at least".
 *
 * And two things the ring itself may not be able to say (the can't-speak
 * rule, audit 28 Sep 2026) — a count under the filter is never a confident 0
 * that really means "we could not tell":
 *
 *   - **no census coverage**: none of the ring's districts has been censused,
 *     so the only places it can count are the few a household has been shown
 *     lately. `speaks: false` — a 0 is drawn "—", anything else "at least N".
 *     Some districts censused and some not is `atLeast` with `uncovered`
 *     naming the rest.
 *   - **places either side of the edge**: a census box that straddles the
 *     ring's edge holds places that are in it or not, and nothing in the row
 *     says which (`censusInRing().unresolved`); those, and places the census
 *     could not place at all (`unplaceable`), make every count a floor.
 */

import { query } from '../db.js';
import { ringFor, placesWithin } from '../repositories/reach.js';
import { censusInRing } from '../repositories/censusRing.js';
import { CAP_MINUTES } from '../domain/reach.js';
import { geocodeAreas } from '../sources/geocode.js';

const OUTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)$/;
const SECTOR = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d)$/;

/** Towns already looked up, so typing into the filter asks the geocoder once per name. */
const towns = new Map();

/**
 * Where the words point, as a point we can snap to a sector: a full postcode
 * or a locality we hold is answered by `ringFor` itself; the first part of a
 * postcode ("SL5") or a sector ("SL5 9") by the middle of its own postcodes;
 * a town by the free geocoder (Nominatim), towns and cities only, UK and
 * Ireland. Null when nothing answers — the screen then says so.
 */
async function pointOf(said) {
  const up = said.toUpperCase().replace(/\s+/g, ' ').trim();
  const out = OUTCODE.exec(up.replace(/\s/g, ''));
  const sec = SECTOR.exec(up);
  if (out || sec) {
    const { rows: [c] } = await query(
      sec ? 'select avg(lat) lat, avg(lng) lng, count(*)::int n from postcodes where sector = $1'
        : 'select avg(lat) lat, avg(lng) lng, count(*)::int n from postcodes where outcode = $1',
      [sec ? `${sec[1]} ${sec[2]}` : out[1]]).catch(() => ({ rows: [] }));
    if (c?.n) return { lat: Number(c.lat), lng: Number(c.lng), label: sec ? `${sec[1]} ${sec[2]}` : out[1] };
    return null;
  }
  const key = said.toLowerCase();
  if (towns.has(key)) return towns.get(key);
  let hit = null;
  for (const cc of ['gb', 'ie']) {
    const [a] = await geocodeAreas(said, { limit: 1, countryCode: cc }).catch(() => []);
    if (a?.lat != null) { hit = { lat: Number(a.lat), lng: Number(a.lng), label: a.label ?? said }; break; }
  }
  towns.set(key, hit);
  return hit;
}

export const REACHES = [5, 15, 30, 60, 120];
export const MODES = ['car', 'transit'];

/**
 * Resolve the filter. Null where nothing was asked (the whole estate), and
 * `{ unknown: true }` where the place is not one we know — the screen then
 * says "Not a place we know yet — try a town or the first part of a postcode".
 */
export async function resolveLocation({ where, minutes = 30, mode = 'car' } = {}) {
  const said = String(where ?? '').trim();
  if (!said) return null;
  const asked = REACHES.includes(Number(minutes)) ? Number(minutes) : 30;
  const m = MODES.includes(mode) ? mode : 'car';
  const byCar = m === 'transit' ? Math.max(5, Math.round(asked / 2)) : asked;
  const capped = byCar > CAP_MINUTES;
  const used = Math.min(byCar, CAP_MINUTES);
  let ring = await ringFor({ where: said, minutes: used, mode: 'driving' }).catch(() => null);
  if (!ring) {
    const at = await pointOf(said).catch(() => null);
    if (at) ring = await ringFor({ lat: at.lat, lng: at.lng, label: at.label, minutes: used, mode: 'driving' }).catch(() => null);
  }
  if (!ring) return { where: said, minutes: asked, mode: m, unknown: true };
  // The same two ways the ring tables count a place in reach: the census's
  // own boxes (every place the census found, placed by where it was found —
  // the IDs-only census gives no coordinates of its own), and the places a
  // household has been shown whose coordinates we still hold (30 days).
  const [placed, within, covered] = await Promise.all([
    censusInRing({ cells: ring.band ?? ring.cells, outcodes: ring.outcodes }).catch(() => null),
    placesWithin(ring.cell, { minutes: used, mode: 'driving', edge: 0 }),
    censusCovered(ring.outcodes ?? []),
  ]);
  const refs = new Set([...Object.values(placed?.refs ?? {}).flat(), ...within.map((p) => p.venue_ref)]);
  const outcodes = (ring.outcodes ?? []).map((o) => String(o).toUpperCase());
  const uncovered = outcodes.filter((o) => !covered.has(o));
  const unresolvedBy = placed?.unresolved ?? {};
  const unresolved = Object.values(unresolvedBy).reduce((n, v) => n + Number(v || 0), 0);
  const unplaceable = Number(placed?.unplaceable ?? 0);
  // The census answer failing to come back is the same as no census: we
  // cannot say what is in the ring, only what a household was shown there.
  const speaks = Boolean(placed) && outcodes.length > 0 && uncovered.length < outcodes.length;
  return {
    where: said,
    label: ring.label,
    minutes: asked,
    mode: m,
    approx: m === 'transit',
    capped,
    refs,
    speaks,
    // Two hours asked before the wider driving build has run reads only the rows
    // that exist: a floor until it lands.
    shortOfHorizon: Boolean(ring.shortOfHorizon),
    atLeast: capped || Boolean(ring.shortOfHorizon) || !speaks || uncovered.length > 0 || unresolved > 0 || unplaceable > 0,
    unresolved,
    unresolvedBy,
    unplaceable,
    uncovered,
  };
}

/**
 * Which of these districts the census has covered: a finished grid tile that
 * names the district, or the district's own run from before the grid — the
 * same two the census findings count coverage from (censusFindings.js).
 */
export async function censusCovered(outcodes = []) {
  const up = [...new Set(outcodes.map((o) => String(o).toUpperCase()))];
  if (!up.length) return new Set();
  const { rows } = await query(
    `select o as code from unnest($1::text[]) o
      where exists (select 1 from census_tiles t where t.state = 'done' and o = any(t.outcodes))
         or exists (select 1 from area_counts a where upper(a.area_slug) = o)
         or exists (select 1 from place_subcategories ps where upper(ps.area_slug) = o)`, [up]).catch(() => ({ rows: [] }));
  return new Set(rows.map((r) => r.code));
}

/** How the filter reads on the chip: "within 30 min of Sunningdale by car". */
export function chipOf(loc) {
  if (!loc || loc.unknown) return null;
  const by = loc.mode === 'transit' ? 'by public transport' : 'by car';
  return `within ${loc.minutes} min of ${loc.label} ${by}`;
}

/**
 * A count under the filter: exact, or "at least" when the ring cannot be
 * counted exactly, or no number at all when it cannot speak.
 *
 * `category` narrows the edge question to the category the count is of: a
 * ring whose straddling boxes hold only Food places does not make a Sport
 * count a floor. Returns `{ n, atLeast, approx, speaks }`: with `speaks`
 * false, `n` is null where it would have been 0 (draw "—") and a floor
 * otherwise (draw "at least N").
 */
export function countOf(n, loc, { category = null } = {}) {
  if (!loc || loc.unknown) return { n, atLeast: false, approx: false, speaks: true };
  const speaks = loc.speaks !== false;
  const edge = category
    ? Number(loc.unresolvedBy?.[category] ?? 0) > 0
    : Number(loc.unresolved ?? 0) > 0;
  const atLeast = Boolean(loc.capped) || Boolean(loc.shortOfHorizon) || !speaks || (loc.uncovered?.length ?? 0) > 0 || edge || Number(loc.unplaceable ?? 0) > 0;
  return { n: !speaks && !n ? null : n, atLeast, approx: Boolean(loc.approx), speaks };
}

/**
 * What the filter says about itself, for the API's `filter` block: whether
 * its counts speak, whether they are floors, and why.
 */
export function filterSays(loc) {
  if (!loc || loc.unknown) return {};
  return {
    speaks: loc.speaks !== false,
    atLeast: Boolean(loc.atLeast),
    unresolved: loc.unresolved ?? 0,
    unplaceable: loc.unplaceable ?? 0,
    uncovered: loc.uncovered ?? [],
    why: loc.speaks === false
      ? 'The census has not covered this area yet'
      : loc.atLeast
        ? [
          loc.capped ? 'counted to 90 minutes by car' : null,
          loc.uncovered?.length ? `${loc.uncovered.length} district${loc.uncovered.length === 1 ? '' : 's'} not censused yet` : null,
          loc.unresolved ? `${loc.unresolved} place${loc.unresolved === 1 ? '' : 's'} on the edge could be either side` : null,
          loc.unplaceable ? `${loc.unplaceable} place${loc.unplaceable === 1 ? '' : 's'} could not be placed` : null,
        ].filter(Boolean).join(' · ')
        : null,
  };
}
