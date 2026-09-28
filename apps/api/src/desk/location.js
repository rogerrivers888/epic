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
 */

import { ringFor, placesWithin } from '../repositories/reach.js';
import { CAP_MINUTES } from '../domain/reach.js';

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
  const ring = await ringFor({ where: said, minutes: used, mode: 'driving' }).catch(() => null);
  if (!ring) return { where: said, minutes: asked, mode: m, unknown: true };
  const within = await placesWithin(ring.cell, { minutes: used, mode: 'driving', edge: 0 });
  return {
    where: said,
    label: ring.label,
    minutes: asked,
    mode: m,
    approx: m === 'transit',
    capped,
    refs: new Set(within.map((p) => p.venue_ref)),
  };
}

/** How the filter reads on the chip: "within 30 min of Sunningdale by car". */
export function chipOf(loc) {
  if (!loc || loc.unknown) return null;
  const by = loc.mode === 'transit' ? 'by public transport' : 'by car';
  return `within ${loc.minutes} min of ${loc.label} ${by}`;
}

/** A count under the filter: exact, or "at least" when the reach was capped. */
export function countOf(n, loc) {
  if (!loc || loc.unknown) return { n, atLeast: false };
  return { n, atLeast: Boolean(loc.capped), approx: Boolean(loc.approx) };
}
