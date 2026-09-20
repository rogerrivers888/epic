/**
 * What is around a household, bought once and shared.
 *
 * The owner, 20 Sep 2026, setting the shape of this: "for each category, show
 * the census count for the reach (free, from area_counts) and the top 5, from
 * one Enterprise+Atmosphere display search per category, locationRestriction
 * set to the ring's bounding box, results filtered to outcodes inside the ring…
 * all of this lives in the 12-hour search pool keyed on ring plus category plus
 * page, so the second household in Sunningdale that afternoon pays nothing for
 * the lists."
 *
 * Three things follow from that, and they are the whole module:
 *
 *   · **The count is free and the list is bought.** `area_counts` already holds
 *     what the census found, per outcode and per category, and the ring is a
 *     set of outcodes — so "412 things to do within thirty minutes" costs
 *     nothing and needs no provider. Only the twenty places actually shown are
 *     paid for.
 *   · **One search per category, paged on demand.** Page one is twenty; a
 *     household who scrolls past the fifteenth buys page two with Google's own
 *     `nextPageToken`. Nobody pays for a page nobody reached.
 *   · **A page is bought once for the ring, not once per household.** The pool
 *     is keyed on the ring, the category and the page, and holds for twelve
 *     hours, which is the same clock the rest of the rented pool keeps.
 *
 * Everything bought is scored on the way through: the rating and the review
 * count become an Epic score of ours and are then forgotten (data policy,
 * 19 Sep 2026, and `placeIndex.noteScores`).
 */

import { query } from '../db.js';
import { displaySlice } from './google.js';
import { outcodeOfCell } from '../domain/ring.js';
import * as placeIndex from '../repositories/placeIndex.js';

/** The same twelve hours the rented search pool keeps. */
const TTL_MS = 12 * 3600_000;
/** Rings are big; a few dozen of them is a day's worth of a small country. */
const MAX = 200;
const kept = new Map();
const fresh = (hit) => hit && Date.now() - hit.at < TTL_MS;

/** Ring, category, page — the three things that decide what a page holds. */
export const pageKey = (ringKey, category, page) => `${ringKey}|${category}|${page}`;

const hold = (key, value) => {
  kept.delete(key);
  kept.set(key, { at: Date.now(), value });
  while (kept.size > MAX) kept.delete(kept.keys().next().value);
};

/** Only for the tests and the back office: how much of the pool is warm. */
export const poolSize = () => [...kept.values()].filter(fresh).length;
export const forgetPool = () => kept.clear();

/**
 * One text query per Epic category, and the type to fence it with where Google
 * has one that means the same thing.
 *
 * Short, and a type where Google has one that means the same thing.
 *
 * Text Search is a search, not a filter: a long phrase — "family days out,
 * theme parks, zoos, farms and attractions" — narrows to the places whose own
 * text matches most of it, and Fun came back with four. The same box asked
 * "family days out" with `tourist_attraction` as the fence gives twenty. Where
 * Google has a type that means what we mean (restaurant, museum, park, tourist
 * attraction) the type is the fence and the words are the ranking; where it has
 * none, two or three words do the whole job.
 *
 * The fence beyond that is the ring, not our shelves: the categories overlap —
 * a leisure centre is Sport and Active both — and this asked the category's own
 * question, so its answer is the category's answer.
 */
export const ASKED = {
  food: { includedType: 'restaurant', words: 'restaurants' },
  culture: { includedType: 'museum', words: 'museums and galleries' },
  fun: { includedType: 'tourist_attraction', words: 'family days out' },
  outdoors: { includedType: 'park', words: 'parks and gardens' },
  sport: { includedType: null, words: 'sports centre' },
  active: { includedType: null, words: 'activity centre' },
  adrenaline: { includedType: null, words: 'go karting and high ropes' },
  relaxing: { includedType: null, words: 'spa' },
};

/**
 * What the census says is in the ring, per category. Free, and no provider.
 *
 * Summed over the ring's outcodes from `area_counts`, which is what the census
 * writes. An outcode nobody has censused contributes nothing and is named, so
 * the screen can say "we have not looked here yet" rather than "there is
 * nothing here" — the one distinction the whole census exists to make.
 */
export async function censusCounts(outcodes = []) {
  if (!outcodes.length) return { counts: {}, censused: [], missing: [] };
  const slugs = outcodes.map((o) => String(o).toLowerCase());
  // Summed over the drawers, because that is how the census writes it: one row
  // per subcategory per outcode, which is the unit it slices Google into. The
  // same roll-up the census board itself prints.
  const { rows } = await query(
    `select category, sum(census_count)::int as places,
            count(distinct area_slug)::int as areas
       from area_counts
      where area_slug = any($1) and category <> ''
      group by category`, [slugs]);
  const { rows: seen } = await query(
    'select distinct area_slug from area_counts where area_slug = any($1)', [slugs]);
  const censused = seen.map((r) => r.area_slug);
  return {
    counts: Object.fromEntries(rows.map((r) => [r.category, r.places])),
    censused,
    missing: slugs.filter((s) => !censused.includes(s)),
  };
}

/**
 * One page of one category, from the pool or from Google.
 *
 * `cells` is the ring: a place is kept only where the cell it stands in is one
 * of them. The box the search was fenced with is always wider than the ring —
 * a rectangle round an irregular shape has to be — so this is where the shape
 * is actually enforced.
 */
export async function categoryPage({
  ringKey, box, cells, category, page = 1, meter = null, householdId = null, cellAt,
  // The one seam: the tests drive the pool without reaching for Google, and
  // nothing else ever passes this.
  search = displaySlice,
} = {}) {
  const key = pageKey(ringKey, category, page);
  const hit = kept.get(key);
  if (fresh(hit)) return { ...hit.value, cached: true, requests: 0 };

  // Page two needs page one's token: the chain is Google's, not ours. A caller
  // that asks for a page it has not reached gets nothing rather than a search
  // starting again from the top and billing for twenty it already has.
  let pageToken = null;
  if (page > 1) {
    const before = kept.get(pageKey(ringKey, category, page - 1));
    if (!fresh(before)) return { venues: [], nextPageToken: null, cached: false, requests: 0, problem: 'the page before it has gone from the pool' };
    pageToken = before.value.nextPageToken;
    if (!pageToken) return { venues: [], nextPageToken: null, cached: false, requests: 0, problem: null, end: true };
  }

  const asked = ASKED[category] ?? { includedType: null, words: category };
  const out = await search({ box, includedType: asked.includedType, query: asked.words, pageToken, meter });

  // Inside the ring, not merely inside the box. `cellAt` is our own table — a
  // point to its nearest sector — so this costs nothing.
  const inRing = new Set(cells);
  const kept_ = [];
  for (const v of out.venues) {
    if (v.lat == null || v.lng == null) continue;
    const at = await cellAt({ lat: v.lat, lng: v.lng }).catch(() => null);
    if (!at?.code || !inRing.has(at.code)) continue;
    kept_.push({ ...v, cell: at.code, outcode: outcodeOfCell(at.code) });
  }

  // Everything we were told about is scored, not only what survived the fence:
  // we paid for the rating either way, and a place outside this ring is inside
  // somebody else's (owner, 20 Sep 2026 — "every returned place gets an Epic
  // score written on the spot").
  const scored = await placeIndex.noteScores(out.venues).catch(() => ({ scored: 0 }));

  const value = {
    venues: kept_,
    nextPageToken: out.nextPageToken,
    returned: out.venues.length,
    scored: scored.scored ?? 0,
    problem: out.problem ?? null,
  };
  if (!out.problem) hold(key, value);
  return { ...value, cached: false, requests: out.requests };
}
