/**
 * The back office's Lookup: one place, one travel time, and what every source
 * has inside it (owner, 12 Sep 2026: "the purpose of this screen is for me to
 * be able to work at speed to understand gaps in our platform, be it the data
 * quality or the volume of data that we're getting for any location").
 *
 * The arithmetic lives here rather than in the route so it can be tested
 * without a database or a provider behind it: how far a travel time reaches,
 * which half of the screen a place belongs to, how the owned pools fold into
 * what the rented sources returned, and how the counts are made.
 */

import { estimateTravelMinutes, kmBetween, travelMode } from './travel.js';

/** The kinds of place the Food & drink half is made of — the same set every other screen uses. */
export const EATING = new Set(['restaurant', 'cafe', 'pub', 'bar', 'takeaway', 'bakery']);

/** Which half of the screen a place goes on. An event is something to do. */
export const kindOf = (category) => (EATING.has(category) ? 'food' : 'activities');

/**
 * The furthest the sources can be asked to look. Google's nearby search takes
 * fifty kilometres and no more (sources/google.js), and OpenStreetMap's own
 * adapter stops at twenty-five. A ring wider than this is asked for at this
 * width, and the answer says so (`capped`), because a ninety-minute drive
 * reaches further than any source will answer and the screen must not
 * pretend the ring was the catchment.
 */
export const RING_CAP_KM = 50;

/**
 * How far, in a straight line, this many minutes reach in this mode.
 *
 * `reachRadiusKm` in travel.js works the ring out from the town speed alone,
 * which is the conservative bound a source query wants; this is the honest
 * one, and it has to agree with `estimateTravelMinutes` exactly, because the
 * list is fenced on that number afterwards. So it is found by walking the same
 * estimate: the largest distance whose estimate still fits, up to the cap.
 */
export function reachKm(mode, minutes, { cap = RING_CAP_KM, at = { lat: 51.4, lng: -0.6 } } = {}) {
  const m = travelMode(mode);
  const there = (km) => ({ lat: at.lat + km / 111, lng: at.lng });
  let lo = 0;
  let hi = cap;
  if (estimateTravelMinutes(at, there(hi), m) <= minutes) return cap;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (estimateTravelMinutes(at, there(mid), m) <= minutes) lo = mid; else hi = mid;
  }
  // Floored, not rounded: the edge must still be inside the fence.
  return Math.max(0.5, Math.floor(lo * 10) / 10);
}

/**
 * "Windsor Castle" and "windsor-castle" are the same name. Letters in any
 * script count — two Chinese restaurants next door to each other are not one
 * place because neither name has an ASCII letter in it — and so do the marks
 * that are letters in theirs: a Devanagari vowel sign is not an accent, and
 * dropping it turned कि and कु into the same word (Codex, 12 Sep 2026). Only
 * the Latin accents (U+0300–U+036F) are folded away.
 */
export const nameKey = (t) => String(t || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  // A mark only counts when it sits on a letter: the variation selector on a
  // decorative "❤️" is a symbol's, and would otherwise outlive the symbol.
  .replace(/(?<![\p{L}\p{N}\p{M}])\p{M}+/gu, '')
  .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');

/**
 * Fold one of our own rows into the list.
 *
 * The same castle is `osm:way/123` to the fan-out and `wikidata:Q456` in the
 * atlas, and the sweep keys its rows on the Google identifier the fan-out also
 * uses — so a row is matched first on its identifier and then, as the home
 * screen does, on its name within 250 m. Matched, it adds its source and its
 * record to the place that is already there; unmatched, it is a place of its
 * own, which is exactly the case the screen exists to show ("10 coming from our
 * own data").
 */
export function fold(items, item) {
  const byRef = items.find((i) => i.ref === item.ref);
  const key = nameKey(item.name);
  // A name that normalises to nothing matches nothing: an empty key is not a name.
  const same = byRef ?? (key ? items.find((i) => i.lat != null && item.lat != null
    && nameKey(i.name) === key && kmBetween(i, item) < 0.25) : null);
  if (!same) { items.push(item); return item; }
  for (const s of item.sources) if (!same.sources.includes(s)) same.sources.push(s);
  same.records.push(...item.records);
  if (same.website == null && item.website) same.website = item.website;
  return same;
}

/**
 * Per source, how many places carry it — for each half of the screen, and for
 * the whole. `returned` is counted over everything the sources handed back;
 * `kept` over what is inside the travel time. Saying "20 from Google" when
 * seventeen of them are past the ring would be a lie with a number in it.
 */
export function tally(items, keys) {
  const out = {};
  for (const key of keys) {
    out[key] = { activities: 0, food: 0, all: 0 };
    for (const i of items) {
      if (!i.sources.includes(key)) continue;
      out[key][i.kind] += 1;
      out[key].all += 1;
    }
  }
  return out;
}

/** Distinct places, per half and whole — the "Everything" row, which is not the sum of the sources. */
export function total(items) {
  const out = { activities: 0, food: 0, all: 0 };
  for (const i of items) { out[i.kind] += 1; out.all += 1; }
  return out;
}

/**
 * The fence: how long it takes to get to each place, and whether that is
 * inside what was asked for. The estimate is the same one every card in the
 * app carries, and the answer says so (`estimated: true`).
 */
export function withinReach(items, origin, mode, minutes) {
  return items
    .map((i) => ({
      ...i,
      distanceKm: Number(kmBetween(origin, i).toFixed(2)),
      travelMinutes: estimateTravelMinutes(origin, i, mode),
    }))
    .filter((i) => i.travelMinutes <= minutes)
    .sort((a, b) => a.travelMinutes - b.travelMinutes || a.distanceKm - b.distanceKm);
}
