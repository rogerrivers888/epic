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
import { censusInRing } from '../repositories/censusRing.js';
import { displaySlice } from './google.js';
import { outcodeOfCell } from '../domain/ring.js';
import * as placeIndex from '../repositories/placeIndex.js';
import { countsFor, refreshRing } from '../repositories/ringTables.js';

/** The same twelve hours the rented search pool keeps. */
const TTL_MS = 12 * 3600_000;
/**
 * How long a stale page may still be drawn while a fresh one is fetched behind
 * it.
 *
 * Twelve hours is when a page stops being current; it is not when it stops
 * being useful. A household whose ring expired overnight would otherwise wait
 * the whole cold search on the first look of the morning — which is exactly
 * what the owner hit: "there was a significant delay when I loaded the screen…
 * because that's my home location, there shouldn't be any delay" (20 Sep
 * 2026). So a stale page is served at once and replaced quietly.
 */
const STALE_MS = 72 * 3600_000;
/** Rings are big; a few dozen of them is a day's worth of a small country. */
const MAX = 200;
const kept = new Map();
const inFlight = new Map();
const fresh = (hit) => hit && Date.now() - hit.at < TTL_MS;
const usable = (hit) => hit && Date.now() - hit.at < STALE_MS;

/** Ring, category, page — the three things that decide what a page holds. */
export const pageKey = (ringKey, category, page) => `${ringKey}|${category}|${page}`;

const hold = (key, value) => {
  kept.delete(key);
  kept.set(key, { at: Date.now(), value });
  while (kept.size > MAX) kept.delete(kept.keys().next().value);
};

/** Only for the tests and the back office: how much of the pool is warm. */
export const poolSize = () => [...kept.values()].filter(fresh).length;
export const forgetPool = () => { kept.clear(); inFlight.clear(); };
/** For the tests alone: make a page as old as it needs to be. */
export const age = (key, byMs) => { const hit = kept.get(key); if (hit) hit.at -= byMs; };
/**
 * A page from the pool, if it is still usable, without buying it again. A later
 * page of the wide search reads the near page this way so it can leave out
 * what the near search already showed (E13); asking `categoryPage` would buy
 * the page again once it had aged out.
 */
export const peek = (key) => { const hit = kept.get(key); return usable(hit) ? hit.value : null; };

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
/**
 * The questions after the first one.
 *
 * A category is a cabinet of drawers and Google answers one question at a
 * time: "go karting and high ropes" found three places in a ring the census
 * counts twenty-three in, and there was no next page to buy — so the board
 * said "3 of 23" and could never show a fourth (owner, 20 Sep 2026: "it says 3
 * of 23 within reach, but it only shows me 3").
 *
 * So a category has a *list* of questions, in the order a household would
 * think of them, and paging walks it: Google's own next page while there is
 * one, then the next drawer's question. Nobody pays for a question nobody
 * scrolled to.
 */
export const THEN = {
  food: ['pubs and bars', 'cafés and coffee shops', 'takeaway'],
  culture: ['castles and historic houses', 'cathedrals and churches', 'theatres'],
  fun: ['theme parks and rides', 'zoos and farm parks', 'soft play and trampolines'],
  outdoors: ['country parks', 'nature reserves and woodland', 'gardens open to the public'],
  sport: ['swimming pools', 'golf courses', 'climbing walls', 'tennis and racquets'],
  activity: ['cycling and bike hire', 'watersports centres', 'adventure playgrounds'],
  adrenaline: ['go karting', 'high ropes and zip lines', 'skydiving and indoor skydiving',
    // "quad biking and off-road driving" brought back motorcycle dealers and
    // Halfords: the words a shop uses about itself and the words an afternoon
    // out uses are the same until you say what you are buying (20 Sep 2026).
    'quad biking experience', 'paintball and laser tag', 'motorsport circuit'],
  relaxing: ['spas and wellness', 'saunas', 'quiet gardens'],
};

export const ASKED = {
  food: { includedType: 'restaurant', words: 'restaurants' },
  culture: { includedType: 'museum', words: 'museums and galleries' },
  fun: { includedType: 'tourist_attraction', words: 'family days out' },
  outdoors: { includedType: 'park', words: 'parks and gardens' },
  sport: { includedType: null, words: 'sports centre' },
  // `activity`, as moods.js and the census file it — not `active`. Keyed
  // `active`, the Active shelf asked Google for its five and read a census
  // count of nought beside them, because censusInRing counts by the category
  // the places are filed under and nothing is filed under `active`: five
  // shown, 0 counted, 0 unresolved — the page-length-as-count look the owner
  // banned (epic-f0 on the deployed site, 25 Sep 2026).
  activity: { includedType: null, words: 'activity centre' },
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
/**
 * What the census found in a ring, counted the way the board counts it.
 *
 * Owner, 24 Sep 2026: "The census count is free and permanent and is what
 * should be shown … never show the length of a page as if it were a count.
 * Show the census count for the reach, then the five bought for display."
 * And: "censusInRing, with unresolved shown beside it. Every figure is a
 * floor and should read as one."
 *
 * So this is `censusInRing` — one place counted once per category, placed by
 * its own point where it has one and by the box the census found it in where
 * it does not — and not `censusCounts` below, which sums the outcode roll-up
 * and counts a place once per drawer it sits in. A ring covering most of
 * London read 1,319 for Culture that way against 16,258 counted properly.
 *
 * `unresolved` is the places whose box straddles the ring's edge: neither in
 * nor out, and shown beside the count so the count reads as the floor it is.
 * `missing` is the ring's outcodes the census has never reached, which is the
 * difference between "nothing here" and "we have not looked".
 */
export async function censusForRing(ring, { mode = 'driving', minutes = 30 } = {}) {
  const outcodes = ring?.outcodes ?? [];
  if (!outcodes.length) return { counts: {}, unresolved: {}, missing: [], floor: false };

  // The table first — the ring's own rows, written by the census cycle and by
  // a home moving (owner, 20 Sep 2026: "read from that table, instantly, every
  // time, never computed while the household waits"). Only a ring nobody has
  // counted yet is counted live, and that one is written down behind the
  // screen so the next look reads it.
  const byOutcode = await censusCounts(outcodes);
  // `null` is a ring nobody has counted; `{}` is a ring counted and empty, and
  // that one is not counted again on every look.
  const stored = ring?.cell ? await countsFor({ cell: ring.cell, mode, minutes }).catch(() => null) : null;
  if (stored) {
    const counts = Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, v.places]));
    const unresolved = Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, v.unresolved]));
    // The floor each row was written with, carried per category: a row counted
    // while a district was still unlooked-at stays a floor until it is counted
    // again, even once the census has reached that district (Codex, 24 Sep
    // 2026). A floor nothing live explains is a ring the census has moved
    // past — counted again behind the screen.
    const floors = Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, Boolean(v.floor)]));
    const stale = byOutcode.missing.length === 0
      && Object.values(stored).some((v) => v.floor && !(v.unresolved > 0));
    if (stale) void refreshRing({ cell: ring.cell, mode, minutes }).catch(() => null);
    return {
      counts,
      unresolved,
      floors,
      missing: byOutcode.missing,
      floor: byOutcode.missing.length > 0 || Object.values(stored).some((v) => v.floor || v.unresolved > 0),
    };
  }

  const inRing = await censusInRing({ cells: ring.band ?? ring.cells ?? [], outcodes });
  if (ring?.cell) void refreshRing({ cell: ring.cell, mode, minutes }).catch(() => null);
  const unresolved = inRing.unresolved ?? {};
  return {
    counts: inRing.counts ?? {},
    unresolved,
    missing: byOutcode.missing,
    // A floor wherever anything straddles the edge or any outcode is unlooked-at.
    floor: byOutcode.missing.length > 0 || Object.values(unresolved).some((n) => n > 0),
  };
}

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
  ringKey, box, cells, category, page = 1, meter = null, householdId = null, cellAt, force = false,
  // Twenty is one Google page. A category asked near and wide asks ten of each
  // (E13), so a merged page is still twenty and nothing is left over to lose.
  pageSize = 20,
  // The one seam: the tests drive the pool without reaching for Google, and
  // nothing else ever passes this.
  search = displaySlice,
} = {}) {
  const key = pageKey(ringKey, category, page);
  // A refresh forgets first, or it would find its own stale page, hand it back
  // and schedule another refresh of itself — for ever.
  if (force) kept.delete(key);
  const hit = kept.get(key);
  if (fresh(hit)) return { ...hit.value, cached: true, requests: 0 };
  // Stale but usable: draw it now, and put the fresh one behind it. One refresh
  // at a time per page, however many households ask.
  if (usable(hit)) {
    if (!inFlight.has(key)) {
      inFlight.set(key, Promise.resolve()
        .then(() => categoryPage({ ringKey, box, cells, category, page, meter: null, householdId, cellAt, search, pageSize, force: true }))
        .catch(() => null)
        .finally(() => inFlight.delete(key)));
    }
    return { ...hit.value, cached: true, stale: true, requests: 0 };
  }

  // Page two needs page one's token: the chain is Google's, not ours. A caller
  // that asks for a page it has not reached gets nothing rather than a search
  // starting again from the top and billing for twenty it already has.
  const lead = ASKED[category] ?? { includedType: null, words: category };
  const rest = THEN[category] ?? [];
  let pageToken = null;
  let askedAt = 0;
  if (page > 1) {
    const before = kept.get(pageKey(ringKey, category, page - 1));
    if (!usable(before)) return { venues: [], nextPageToken: null, cached: false, requests: 0, problem: 'the page before it has gone from the pool' };
    pageToken = before.value.nextPageToken ?? null;
    // Google has no more of *that* question. Ask the next one rather than
    // stopping: the census says there are more of these here, and a category is
    // a cabinet of drawers.
    askedAt = pageToken ? before.value.askedAt ?? 0 : (before.value.askedAt ?? 0) + 1;
    if (!pageToken && askedAt > rest.length) {
      return { venues: [], nextPageToken: null, cached: false, requests: 0, problem: null, end: true };
    }
  }
  const asking = askedAt === 0 ? lead : { includedType: null, words: rest[askedAt - 1] };
  const out = await search({ box, includedType: asking.includedType, query: asking.words, pageToken, pageSize, meter });

  // Inside the ring, not merely inside the box. `cellAt` is our own table — a
  // point to its nearest sector — so this costs no money; it does cost a round
  // trip, and twenty of them one after another is most of a second per
  // category. They are independent, so they go together (20 Sep 2026, on the
  // home screen's cold load).
  // A shop is not a day out.
  //
  // A text search answers with whatever matched, and "quad biking" matches a
  // motorcycle dealer's own page as surely as a quad biking centre's. Our
  // shelves are no longer the fence — the categories overlap too much for that
  // — but Google's own primary type is enough to keep a bike shop and a
  // supermarket off an Adrenaline shelf, which is the one kind of wrong answer
  // a household would call broken (20 Sep 2026).
  const SHOPS = new Set([
    'store', 'shopping_mall', 'car_dealer', 'car_repair', 'car_rental', 'car_wash', 'bicycle_store',
    'sporting_goods_store', 'clothing_store', 'department_store', 'electronics_store', 'furniture_store',
    'hardware_store', 'home_goods_store', 'supermarket', 'grocery_store', 'convenience_store',
    'gas_station', 'bank', 'atm', 'insurance_agency', 'real_estate_agency', 'travel_agency',
    'lodging', 'hotel', 'storage', 'moving_company', 'warehouse_store',
  ]);
  // A search fenced by a geographic box needs no sector test: the exact pass
  // judges every place on its own point, which is finer than any sector. `null`
  // means "keep what the box returned and let the band decide".
  const inRing = cells ? new Set(cells) : null;
  const placed = await Promise.all(out.venues.map(async (v) => {
    if (v.lat == null || v.lng == null) return null;
    if (category !== 'food' && SHOPS.has(v.primaryType)) return null;
    const at = await cellAt({ lat: v.lat, lng: v.lng }).catch(() => null);
    if (inRing && (!at?.code || !inRing.has(at.code))) return null;
    return { ...v, cell: at?.code ?? null, outcode: at?.code ? outcodeOfCell(at.code) : null };
  }));
  const kept_ = placed.filter(Boolean);

  // Everything we were told about is scored, not only what survived the fence:
  // we paid for the rating either way, and a place outside this ring is inside
  // somebody else's (owner, 20 Sep 2026 — "every returned place gets an Epic
  // score written on the spot").
  const scored = await placeIndex.noteScores(out.venues).catch(() => ({ scored: 0 }));

  const value = {
    venues: kept_,
    // Which question this page answered, so the page after it knows whether to
    // follow Google's token or move to the next drawer.
    askedAt, asked: asking.words,
    nextPageToken: out.nextPageToken,
    returned: out.venues.length,
    scored: scored.scored ?? 0,
    problem: out.problem ?? null,
  };
  if (!out.problem) hold(key, value);
  return { ...value, cached: false, requests: out.requests };
}
