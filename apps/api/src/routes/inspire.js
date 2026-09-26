/**
 * Inspire: the home screen's one read.
 *
 * The household opens Epic and is shown things to do, near home or near
 * wherever they searched, on shelves named for what a day is about — Fun, Food,
 * Culture, Adrenaline, Relaxing, Outdoors. That is a browse, not a plan: no
 * model call, no ideas written, nothing kept.
 *
 * **One pool, many shelves.** This endpoint makes exactly one place search —
 * the same 5 km look-around a trip's Find tab makes, sharing its cache entry —
 * and hands back every venue once, each carrying the moods it belongs to, how
 * long it takes to get to, and how long the household would spend there. The
 * screen then draws six shelves, filters by budget and travel time and flips
 * between moods without asking anybody anything (Requirements: options are
 * composed from one retrieved pool; adding an option must not add a call).
 *
 * **Two points, not one.** `lat`/`lng` is where we are *looking*; `from` is
 * where the family would set off from — home, unless they tapped "where I am".
 * That is what makes "35 min" true both for a park down the road and for a
 * gallery in Bath: the distance on the card is the journey they would make.
 *
 * **The home screen is ours, and makes no provider call at all.** It is served
 * from the atlas (§13.12): the top attractions of each county, researched from
 * Wikidata and Wikipedia, each with a photograph we own outright. A bounding-box
 * read of one small table, single-digit milliseconds, nothing rented in it.
 *
 * It did not start that way. It was a live 5 km look-around, and near Ascot that
 * meant 128 places, none with a photograph, forty of them suburban play areas —
 * while Ascot Racecourse sat 0.9 km away in the atlas with a picture and was not
 * on the screen at all. Neither was Legoland, Windsor Great Park or Windsor
 * Castle.
 *
 * **No food here** (owner, 5 Sep 2026): "for food, we should not show that on
 * our homepage now, and we should just show inspirational activities… if I
 * clicked on food, it would take me to the places tab and search for food."
 * Restaurants rarely have a photograph anybody may republish, so a Food shelf
 * on a screen made of pictures is a row of grey rectangles. The chip is a
 * doorway into Places instead, and the atlas holds no restaurants by design.
 *
 * `live=1` puts the old look-around back alongside the atlas, for a "see
 * everything around here" that is a deliberate tap rather than the front door.
 * It is the only thing here that costs a provider call.
 *
 * Nothing here goes on a device. The answer carries a provider's names, photos
 * and ratings, which are rented (Technical Constraints §4), so this path is
 * absent from `offline/policy.ts` and is therefore never written to IndexedDB.
 * The atlas half *could* travel — it is CC0 and CC BY-SA and ours to keep — but
 * it arrives here mixed with the rented half, and a rule that has to separate
 * them per item is a rule that will one day separate them wrongly. It is served
 * whole from `/api/atlas/regions/:slug`, which is where the device gets it.
 */

import { Router } from 'express';
import { query } from '../db.js';
import * as searchLog from '../repositories/searches.js';
import * as placeIndex from '../repositories/placeIndex.js';
import * as visitsRepo from '../repositories/visits.js';
import { currentHousehold, loadMembers, toAttendees } from './household.js';
import { householdStatus } from './places.js';
import { thingsAround, THINGS_RADIUS_KM } from './plan.js';
import { estimateTravelMinutes, kmBetween, searchRadiusKm, travelMode } from '../domain/travel.js';
import { searchPlan, mergeWide, alternate, googleId, NEAR_KM } from '../domain/wideSearch.js';
import { fenceToBand, minutesTo } from '../domain/band.js';
import { boundKm } from '../domain/reach.js';
import { dwellFor } from '../domain/options.js';
import { distinguish } from '../domain/naming.js';
import { shelvesForAtlas, shelvesForVenue, FOOD_DRAWER } from '../domain/moods.js';
import { labelsOf } from '../domain/labels.js';
import { rules as shelfRules } from '../repositories/shelfRules.js';
import { taxonomy } from '../repositories/shelfTaxonomy.js';
import * as placeAttributes from '../repositories/placeAttributes.js';
import * as placeParts from '../repositories/placeParts.js';
import { publishedNear, heroesForPlaces } from '../repositories/library.js';
import { foodNear } from '../repositories/scout.js';
import { enabledSources } from '../sources/index.js';
import { needsLookAround, lookAroundOutcome } from '../domain/lookAround.js';
import { censusForRing, categoryPage, peek, pageKey, ASKED } from '../sources/ringSearch.js';
import { boxAround, boxKm, outcodeOfCell } from '../domain/ring.js';
import * as reach from '../repositories/reach.js';
import { sectorOf } from '../domain/reach.js';

/**
 * A stored picture, in the shape a card draws.
 *
 * `credit` travels with the image and nothing else may drop it: for every
 * licence except CC0 and public domain, showing the picture without the line is
 * the licence broken. `source` is on it because a logo is not a photograph and
 * must not be drawn like one — a mark is contained on its ground, a photograph
 * fills the tile.
 */
const ownedImage = (row) => (row ? {
  id: row.id,
  source: row.source,
  lqip: row.lqip,
  credit: row.credit_line,
  licence: row.licence,
  licenceUrl: row.licence_url,
  sourceUrl: row.source_page_url,
  creditRequired: row.attribution_required,
} : null);

export const inspire = Router();

/** "51.38,-0.62" → a point, or null. */
function point(text) {
  const m = /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/.exec(String(text || ''));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * A place worth ranking above another: what the sources think of it, damped by
 * how many people said so, so one five-star review does not beat a thousand
 * four-star ones. Sources with no ratings at all (OpenStreetMap) fall through
 * to distance, which is the only honest ordering left.
 */
const weight = (v) => (v.rating ?? 0) * Math.log10((v.ratingCount ?? 0) + 2);

/**
 * What a place's drawer says about it that the place itself may not: indoors
 * or out, and for children (migration 076, taught in the back office). Null
 * is "it depends" and leaves the place's own words to decide on the screen.
 */
/**
 * What a place is like, for the filters: read from the attributes (migration
 * 105) rather than the two old columns, so what he sets on one screen is what
 * the app narrows by. A place's own answer beats its drawer's; the provider's
 * word about children is the last resort.
 *
 * `attrs` is every attribute resolved for this place, which is what a filter on
 * anything he has since created will read (Codex, 14 Sep 2026: values written
 * with no read path are write-only).
 */
/**
 * A place swept before the sweep started writing its secondary labels down.
 *
 * Its own `cuisines` are Epic's, kept since the first sweep — "italian",
 * "middle eastern" — so the first one the Cuisine label knows by name is the
 * answer. Matched without regard to case, because ours are written for reading.
 */
const fromCuisines = (cuisines, vocab) => {
  const a = vocab?.byKey?.get('cuisine');
  if (!a?.active || !Array.isArray(cuisines) || !cuisines.length) return null;
  const same = (x) => (a.options ?? []).find((o) => o.toLowerCase() === String(x).toLowerCase());
  for (const c of cuisines) { const hit = same(c); if (hit) return { cuisine: { choice: hit } }; }
  return null;
};

const marks = (subcategory, goodForChildren, own, vocab, words = [], alsoTrue = null) => {
  // The place's own provider words go in: italian_restaurant says Italian and
  // fine_dining_restaurant says fine dining, which is everything those words
  // were saying besides where the place lives (owner, 14 Sep 2026).
  const all = placeAttributes.resolveFor({ subcategory, words, alsoTrue }, own, vocab);
  return {
    indoor: all.indoor?.yesno ?? null,
    forKids: all['kid-friendly']?.yesno ?? goodForChildren ?? null,
    attrs: all,
  };
};

/**
 * How far out the atlas reaches, unless asked otherwise (`?km=`).
 *
 * Much further than the live look-around's 5 km, and deliberately: a family
 * will drive half an hour to a castle and will not drive half an hour to a
 * playground. Sixty kilometres is about an hour, which is the default on the
 * screen's own travel-time chip — so the pool is wide enough that narrowing it
 * there means something, and distance costs nothing when the answer is a
 * bounding-box read of our own table rather than a provider call.
 */
const ATLAS_RADIUS_KM = 60;
const ATLAS_MAX_KM = 100;
/**
 * How many to hand over. Everything within reach rather than a page: these are
 * our own rows, they are small, and paginating our own table so a household can
 * scroll is a round trip bought for nothing.
 */
const ATLAS_LIMIT = 250;
// Food is a list rather than a wall of pictures, so it can afford more of them
// than the atlas half — but not so many that the answer stops being one page.
const FOOD_LIMIT = 150;
/**
 * The kinds of place the Food half is made of — the same set the sweep filters
 * its candidates on (`sources/scoutArea.js`), so the two cannot drift apart.
 * Anything else the open map calls a place to eat arrives as a restaurant.
 */
const FOOD_CATEGORIES = new Set(['restaurant', 'cafe', 'pub', 'bar', 'bakery']);

/**
 * The credit a picture and a rating travel with. Sources hand this over as a
 * line of text or as a list of them, so both shapes end as a list — a card that
 * shows the content and not the credit is the licence broken.
 */
/**
 * The credit lines for a swept place: one per source that contributed to it.
 *
 * An empty or unknown provenance falls back to the shape of the identifier,
 * which is the only evidence a row swept before migration 072 still carries.
 */
export function creditFor(fromSources, venueRef, lines) {
  let from = Array.isArray(fromSources) ? fromSources : [];
  if (!from.length) {
    const prefix = String(venueRef || '').split(':')[0];
    from = prefix ? [prefix] : [];
  }
  const credits = from.map((key) => lines[key]).filter(Boolean);
  // Never nothing: a place with no source we can name is still somebody's work.
  return credits.length ? [...new Set(credits)] : ['Sources listed in Settings'];
}

function attributionOf(v, lines) {
  // A merged venue carries the readable line already; an unmerged one carries
  // the keys of the sources that contributed, which the registry names.
  if (v.attributionText) return String(v.attributionText).split(' · ').filter(Boolean);
  const keys = v.contributingSources ?? (Array.isArray(v.attribution) ? v.attribution : [v.source]);
  return [...new Set(keys.map((k) => lines[k]).filter(Boolean))];
}

/**
 * GET /api/inspire/around?where=sl5&minutes=30&mode=drive
 *
 * What is around a household, the way the owner set it out on 20 Sep 2026:
 * the census count for the reach, free, and the first five of each category
 * from one paid display search fenced to the ring.
 *
 * This is the pool Inspire reads now. The atlas and the sweep are no longer
 * searched — the atlas stays exactly where it was useful, as a source of
 * pictures and summaries for the records we own — and "thirty minutes" is a
 * ring out of the reachability matrix rather than twenty-four kilometres of
 * straight line.
 *
 * Nothing here is stored except the Epic scores derived on the way through.
 */
/**
 * One place, in the shape every card on this screen draws.
 *
 * Both the board and a category's next page hand back the same thing. They did
 * not: the paged-in places carried no journey, and the cards printed "NaNh
 * drive" under a photograph of a go-karting track (20 Sep 2026).
 */
const asCard = (it, { centre, origin, mode, category }) => ({
  venueRef: it.venueRef, source: 'google', name: it.name, category: it.category,
  moods: it.moods?.length ? it.moods : [category], subcategory: it.subcategory ?? null,
  experiences: [], cuisines: [],
  rating: it.rating, ratingCount: it.ratingCount, priceLevel: it.priceLevel,
  goodForChildren: null,
  photos: it.photos ?? [],
  attribution: ['Powered by Google'],
  lat: it.lat, lng: it.lng,
  distanceKm: Number(kmBetween(centre, it).toFixed(1)),
  // The very number the fence measured: one function, so the screen cannot
  // contradict itself at the edge.
  travelMinutes: minutesTo(origin, it, mode),
  estimated: true,
  dwellMinutes: 90,
  household: null,
  image: null,
  epicScore: it.epicScore,
  outcode: it.outcode,
});

/**
 * The ring, from the one resolver.
 *
 * This route had its own copy, and when the band was added to the shared one —
 * the sectors actually within the time, as against the finder's ten minutes
 * past it — the copy went on handing back the old shape and the fence changed
 * nothing at all (20 Sep 2026). One resolver, in `repositories/reach.js`.
 */
const ringFrom = (q, { minutes, mode }) => reach.ringFor({
  where: q.where ?? null,
  lat: q.lat ?? null,
  lng: q.lng ?? null,
  label: q.label ?? null,
  minutes,
  mode,
});

/**
 * One category's page, ranked the way a household is shown it.
 *
 * Our own score first, where a place has one — which, after this very search,
 * is every place we have ever bought. Google's order is the fallback and not
 * the other way round: their order is a fact about their index, ours is a
 * judgement about the place (data policy, 19 Sep 2026).
 */
/** One page of a category: the twenty a single display search returns. */
const PAGE = 20;

async function placesFor({ ring, category, page, meter, taught, tax, householdId, minutes = 30, mode = 'driving', from = null }) {
  const start = from ?? ring.at ?? null;
  const reachKm = boundKm(minutes, mode);
  const searchBox = start
    ? {
      minLat: start.lat - reachKm / 111.32,
      maxLat: start.lat + reachKm / 111.32,
      minLng: start.lng - reachKm / (111.32 * Math.cos((start.lat * Math.PI) / 180) || 1),
      maxLng: start.lng + reachKm / (111.32 * Math.cos((start.lat * Math.PI) / 180) || 1),
    }
    : ring.bandBox ?? ring.box;

  const ringKey = `${ring.cell}|${mode}|${minutes}|${start?.lat?.toFixed?.(3)},${start?.lng?.toFixed?.(3)}`;
  // Near and wide (owner, 26 Sep 2026, E13; domain/wideSearch.js). One box the
  // size of the journey hands its twenty to whatever is most famous inside it:
  // from Winchester, things to do within the hour came back at a median of
  // 31.5km, only five of seventeen within 22km, and Marwell Zoo — 7.9km — was
  // eighth. So when the fence reaches past the near radius, and this is not
  // food, page one also asks a box of `NEAR_KM` round the household and the two
  // are merged. A short trip's fence never reaches past it and costs nothing
  // extra; food's popular places are in the centre anyway, so food asks once.
  // Later pages follow the wide search's own chain, as before.
  const plan = searchPlan({ searchKm: searchRadiusKm(mode, minutes), categories: [category] });
  const nearToo = Boolean(start && plan.wideKm && page === 1);
  const nearBox = nearToo ? boxAround([start], { marginKm: NEAR_KM }) : null;

  const widePage = categoryPage({
    /**
     * The ring, not its size.
     *
     * Two searches from the same origin can reach a different set of cells and
     * happen to reach the same *number* of them — half an hour's drive and half
     * an hour on a train, most obviously — and the key was the count. A page
     * fetched and filtered for one ring was then handed to the other, dropping
     * places that were in reach and offering places that were not (Codex, 20
     * Sep 2026). The cells themselves are what the page is about.
     */
    ringKey,
    /**
     * A box the size of the journey, not the shape of the sectors.
     *
     * Drawn round the finder, the search spent most of its twenty on the
     * thirty-to-forty-minute hinterland and the exact pass put them back.
     * Drawn round the band's sectors, it collapsed at the small end: a
     * five-minute band is *one sector*, because sector centres are two to four
     * kilometres apart and a centre-to-centre time overstates every short
     * journey — which is the topology half of the finder's allowance, and
     * exactly what it exists to cover.
     *
     * So the box is neither. It is a rectangle round where the household
     * actually is, as wide as `boundKm` says this many minutes could possibly
     * reach in a straight line. Topology cannot distort it and the finder's
     * allowance is not in it. Whatever comes back, the exact pass judges each
     * place on its own point.
     */
    box: searchBox, cells: null,
    category, page, meter, householdId, cellAt: reach.cellAt,
  });
  // Asked together, not one after the other: the two are independent, and in
  // turn they put a second provider round trip on every cold first page
  // (Codex, 26 Sep 2026). Billed through the same meter as the wide one, never
  // added up afterwards — the meter's health lives on keys a copy leaves behind.
  const nearKey = `${ringKey}|near`;
  const [wideGot, nearGot] = await Promise.all([
    widePage,
    nearToo
      ? categoryPage({ ringKey: nearKey, box: nearBox, cells: null, category, page: 1, meter, householdId, cellAt: reach.cellAt })
      : null,
  ]);
  // A later page of the wide search can hand back a place the near search
  // already showed on page one, and the screen appends pages without looking
  // (Codex, 26 Sep 2026). Read from the pool, never bought again.
  const shownNear = page > 1 ? peek(pageKey(nearKey, category, 1)) : null;
  if (shownNear) {
    const seen = new Set(shownNear.venues.map(googleId).filter(Boolean));
    wideGot.venues = wideGot.venues.filter((v) => !seen.has(googleId(v)));
  }
  const got = nearGot
    ? {
      ...wideGot,
      venues: mergeWide(nearGot.venues, wideGot.venues),
      requests: (wideGot.requests ?? 0) + (nearGot.requests ?? 0),
      cached: Boolean(wideGot.cached && nearGot.cached),
      returned: (wideGot.returned ?? wideGot.venues.length) + (nearGot.returned ?? nearGot.venues.length),
      scored: (wideGot.scored ?? 0) + (nearGot.scored ?? 0),
      problem: wideGot.problem ?? nearGot.problem ?? null,
    }
    : wideGot;
  /**
   * The exact pass, which the browsing screens have never had.
   *
   * The matrix is a *finder* and is deliberately wide: ten minutes past the
   * band, because the estimator's error and a place's offset from its sector's
   * centre together have a p95 of 9.5 minutes, and hiding a place that is
   * inside the band is the worse harm (`domain/reach.js`, owner, 20 Sep 2026).
   * Its own note says the price of erring wide is that "on the browsing screens
   * there is no exact pass to rescue the second kind".
   *
   * This is that pass. A display search returns each place's own point, so the
   * journey can be worked out for the place rather than for the sector it
   * stands in — and a place further than the band was asked for is not shown.
   * It is fenced on exactly the number the card prints, so the screen agrees
   * with itself: no more spa in Chiswick, forty minutes away, on a thirty
   * minute ring (owner, 20 Sep 2026).
   */
  // One fence, in `domain/band.js`, measured from the point the card prints
  // from. Written here by hand it was written twice, and the second copy went
  // on using the finder's ring after the first was corrected (20 Sep 2026).


  // The fence is the ring, and the question was the category.
  //
  // Two goes at filtering by our own shelves both took the answer away: Sport
  // bought twenty and showed none, because a leisure centre shelves as Active
  // and a golf club as Outdoors, and keeping the unshelvable ones did not help
  // because these are shelved — just not here. The categories genuinely
  // overlap, and the search asked this category's own question ("sports
  // centres, swimming pools, golf courses and climbing walls"), so Google's
  // answer *is* this category's answer (owner, 20 Sep 2026: "Rank the 20
  // returned by Epic score where one exists, Google order otherwise").
  //
  // The shelves still travel on every item — they name the drawer and they
  // decide what the place page says — they simply no longer decide whether a
  // household may see it.
  // The fence, the scores and the order, for whatever venues are handed in:
  // one page's, or — for the page after it — the first page's again.
  const rank = async (venues) => {
    const mine = fenceToBand(venues, { from: start, minutes, mode });
    const refs = mine.map((v) => `${v.source}:${v.sourcePlaceId}`);
    const scores = refs.length
      ? (await query(
        `select t.venue_ref as venue_ref, coalesce(r.epic_score, s.epic_score) as epic
           from unnest($1::text[]) as t(venue_ref)
           left join place_records r on r.venue_ref = t.venue_ref
           left join lateral (select s2.epic_score from scout_places s2 where s2.venue_ref = t.venue_ref order by s2.last_seen desc limit 1) s on true`,
        [refs])).rows
      : [];
    const byRef = new Map(scores.map((r) => [r.venue_ref, r.epic == null ? null : Number(r.epic)]));
    return { mine, items: mine
      .map((v, i) => {
        const ref = `${v.source}:${v.sourcePlaceId}`;
        const p = shelvesForVenue(v, taught, tax.vocab);
        // Infrastructure gets no shelf and is not shown: the classifier's
        // verdict (domain/moods.js, travelOnly) is the fence, and this only obeys it.
        if (p.travel) return null;
        return {
          venueRef: ref, name: v.name, category: v.category,
          subcategory: p?.subcategory ?? null,
          // The category that asked the question comes first.
          //
          // These carried our computed shelves alone, and a screen that filters a
          // list by the category it is showing threw every one of them away the
          // moment they were appended — the count stayed at three however many
          // pages were bought (20 Sep 2026). The shelves still travel behind it:
          // they name the drawer, and the categories genuinely overlap.
          moods: [category, ...(p?.shelves ?? []).filter((m) => m !== category)],
          epicScore: byRef.get(ref) ?? null,
          // Their order, kept so a place nobody has scored still has somewhere to
          // sit — and so the two can be compared on the bench.
          theirRank: i + 1,
          outcode: v.outcode ?? null,
          lat: v.lat, lng: v.lng,
          // Rented, shown, never written down: the card draws them and the
          // database never sees them.
          rating: v.rating ?? null, ratingCount: v.ratingCount ?? null,
          priceLevel: v.priceLevel ?? null, openNow: v.openNow ?? null,
          // The reference and its credit, signed the way every other photo on
          // this screen is. The bytes are fetched for a tile in the viewport, a
          // row at a time, and never for a list — that is the card's job, and it
          // already knows how (data policy: "Photos only for tiles in the
          // viewport, a row at a time").
          photos: (v.photos ?? []).slice(0, 1),
          website: v.website ?? null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.epicScore != null && b.epicScore != null) return b.epicScore - a.epicScore;
        if (a.epicScore != null) return -1;
        if (b.epicScore != null) return 1;
        return a.theirRank - b.theirRank;
      }) };
    // Sorted as one list, the score would put the famous far places first again
    // and the cut would take the near ones back out; see `alternate`.
    // Cut to one page after taking turns, not before: two searches can merge to
    // forty, and a screen that re-sorts the whole pool by rating would undo the
    // turns and let the far places crowd the near ones out again (Codex, 26 Sep
    // 2026). Cut here, the twenty it re-sorts are already half near.
  };
  const isNear = (it) => kmBetween(start, it) <= NEAR_KM;
  const { mine, items } = await rank(got.venues);
  let shown = items;
  if (nearGot) {
    // Cut to one page after taking turns, not before: two searches can merge to
    // forty, and a screen that re-sorts the whole pool by rating would undo the
    // turns and let the far places crowd the near ones out again (Codex, 26 Sep
    // 2026). Cut here, the twenty it re-sorts are already half near.
    shown = alternate(items, isNear).slice(0, PAGE);
  } else if (page === 2 && plan.wideKm && start) {
    // What page one had to leave out when it was cut to twenty is already paid
    // for, and page two leads with it rather than losing it (Codex, 26 Sep
    // 2026). Page one is rebuilt from the two pooled pages exactly as it was
    // drawn — nothing is bought — and whatever fell past the cut goes first.
    const wide1 = peek(pageKey(ringKey, category, 1));
    const near1 = peek(pageKey(nearKey, category, 1));
    if (wide1 && near1) {
      const first = alternate((await rank(mergeWide(near1.venues, wide1.venues))).items, isNear);
      const overflow = first.slice(PAGE);
      const already = new Set(overflow.map((it) => it.venueRef));
      shown = [...overflow, ...items.filter((it) => !already.has(it.venueRef))];
    }
  }
  return {
    items: shown, nextPageToken: got.nextPageToken, requests: got.requests, cached: got.cached,
    problem: got.problem ?? null,
    // What the search returned, what survived the ring, and what survived the
    // shelves — three numbers, because a board that shows two of twenty should
    // be able to say which fence took the other eighteen.
    returned: got.returned ?? got.venues.length, inRing: got.venues.length, onShelf: shown.length,
    // How many the matrix offered that the exact pass then put back: the price
    // of a finder that errs wide, and the number to watch if it ever looks
    // like the band is doing nothing.
    pastTheBand: got.venues.length - mine.length,
    scored: got.scored ?? 0,
  };
}

inspire.get('/around', async (req, res, next) => {
  try {
    const started = Date.now();
    const household = await currentHousehold();
    const minutes = Math.min(90, Math.max(5, Math.trunc(Number(req.query.minutes)) || 30));
    const mode = travelMode(req.query.mode);
    const wanted = String(req.query.cat ?? '').trim();

    // Where the ring is drawn from: a postcode, or a point.
    const ring = await ringFrom(req.query, { minutes, mode });
    if (!ring) {
      return res.status(400).json({
        error: 'where_required',
        message: 'Search for a town or a postcode, or set your home address, and Epic will look around it.',
      });
    }

    // Free, and no provider: what the census found in these outcodes.
    ring.bandBox = boxAround(ring.bandPoints ?? ring.points);
    // Counted properly: one place once per category, box-tested, with the
    // straddlers beside it (owner, 24 Sep 2026). Not the outcode sum.
    const census = await censusForRing(ring, { mode, minutes });

    const taught = await shelfRules();
    const tax = await taxonomy();
    const meter = { google: 0 };
    const wantedCats = wanted ? [wanted] : Object.keys(ASKED);
    // Three was the cap when a page could only follow Google's own token, and
    // sixty places was the end of it. Paging walks the category's drawers now,
    // so the ceiling is the number of questions there are to ask — each one
    // bought only when somebody has reached the end of the last.
    const page = Math.min(12, Math.max(1, Math.trunc(Number(req.query.page)) || 1));
    // The whole board asks for its first page; one category asks for the page
    // the household has scrolled to.
    const shows = wanted ? Math.min(20, Math.max(1, Math.trunc(Number(req.query.shows)) || 20)) : 5;

    const categories = [];
    let requests = 0;
    const asked = await Promise.all(wantedCats.map(async (key) =>
      [key, await placesFor({ ring, category: key, page, meter, taught, tax, householdId: household.id, minutes, mode, from: ring.at })]));
    for (const [key, got] of asked) {
      requests += got.requests;
      categories.push({
        key,
        label: tax.vocab?.categories?.[key]?.label ?? key,
        // What the census says is here — the number the screen prints beside
        // the name, and the one thing on this board that never costs anything.
        // A floor: the straddlers are beside it, never inside it.
        count: census.counts[key] ?? 0,
        unresolved: census.unresolved[key] ?? 0,
        floor: (census.unresolved[key] ?? 0) > 0 || census.missing.length > 0 || Boolean(census.floors?.[key]),
        censused: census.missing.length === 0,
        items: got.items.slice(0, shows).map((it) => asCard(it, {
          centre: { lat: ring.at?.lat ?? it.lat, lng: ring.at?.lng ?? it.lng },
          origin: ring.at ?? it, mode, category: key,
        })),
        of: got.items.length,
        // Where the twenty went.
        sifted: { returned: got.returned, inRing: got.inRing, onShelf: got.onShelf, scored: got.scored },
        more: Boolean(got.nextPageToken),
        cached: got.cached,
        why: got.problem,
      });
    }

    /**
     * What it cost, written down.
     *
     * Every cache miss here is up to eight paid Google display searches, and
     * the route was reporting them in `spent` and never writing them to
     * `provider_calls` — so they were invisible to the spend ceiling, to the
     * supplier register and to every cost-per-household figure, while the
     * answer on screen said what they had cost (Codex, 20 Sep 2026).
     *
     * The meter goes in as an **object** rather than as JSON text, so the
     * outcome the adapter observed rides along with it (`sources/meter.js`)
     * and this provider's failures are counted like everybody else's.
     */
    if (meter.google) {
      await visitsRepo.recordProviderCall(household.id, 'google', 'inspire.around', meter).catch(() => null);
    }

    // Every outbound call attributed to a household, before the answer goes
    // out (Technical Constraints §11, and the data policy's own rule). The
    // purpose is a stable string and is added to, never renamed.
    if (requests) await visitsRepo.recordProviderCall(household.id, 'google', 'inspire.ring', meter).catch(() => null);

    res.json({
      ring: {
        where: ring.label, outcodes: ring.outcodes, cells: ring.cells.length,
        minutes, mode, box: ring.box, boxKm: boxKm(ring.box),
        // Which of the ring's outcodes the census has never been run in: the
        // difference between "nothing here" and "we have not looked".
        notCensused: census.missing,
      },
      categories,
      // What this answer cost, said plainly, because every screen that spends
      // says so (data policy, 19 Sep 2026).
      spent: { displaySearches: requests, google: meter.google ?? 0 },
      tookMs: Date.now() - started,
      attribution: ['Powered by Google'],
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/inspire/near?lat=&lng=&label=&locality=&from=lat,lng&mode=driving&live=1
 *
 * Things to do around a point, on shelves. `from` defaults to the household's
 * home; `mode` to how they usually travel.
 *
 * The answer says which pools are in it (`pools`) rather than leaving the screen
 * to infer it from a thin shelf. `live=1` adds the OpenStreetMap look-around and
 * is the only form that spends anything.
 */
inspire.get('/near', async (req, res, next) => {
  try {
    const started = Date.now();
    const household = await currentHousehold();
    const members = await loadMembers(household.id);
    const home = household.home_lat != null
      ? { label: household.home_label, lat: household.home_lat, lng: household.home_lng }
      : null;

    const centre = point(`${req.query.lat},${req.query.lng}`) ?? home;
    if (!centre) {
      return res.status(400).json({
        error: 'where_required',
        message: 'Search for a town, or set your home address in Household, and Epic will look around it.',
      });
    }
    // Where the family sets off from. "Where I am" hands over a fix; otherwise
    // it is home, and a household that has not set one measures from the middle
    // of the search — every card then reads 0 min, which is at least true.
    const given = point(req.query.from);
    const origin = given
      ? { ...given, label: null, how: 'given' }
      : home
        ? { ...home, how: 'home' }
        : { ...centre, label: null, how: 'centre' };
    // Normalised, not tested against the canonical spellings: the screens say
    // `drive` and `walk`, and an includes-check turned `walk` into a car.
    const mode = travelMode(req.query.mode);
    const label = String(req.query.label || '').trim() || household.home_label || null;
    const locality = req.query.locality ? String(req.query.locality) : null;

    // --- the ring, which is the pool now ------------------------------------
    //
    // The owner, 20 Sep 2026: "Retire Inspire's atlas and food-sweep pools and
    // the km-from-minutes conversion. The atlas stays as a source of images and
    // summaries for owned records, not as the pool the app searches."
    //
    // So this is the answer wherever the reachability matrix can draw a ring.
    // Everything below it — the atlas pool, the sweep's food, the look-around —
    // is what happens outside that: abroad, or in a country whose matrix has
    // not been built. It is kept for exactly that, and for nothing else.
    const minutes = Math.min(90, Math.max(5, Math.trunc(Number(req.query.minutes)) || 30));
    const ring = await ringFrom({ ...req.query, lat: centre.lat, lng: centre.lng, label }, { minutes, mode });
    if (ring) {
      ring.bandBox = boxAround(ring.bandPoints ?? ring.points);
      const census = await censusForRing(ring, { mode, minutes });
      const taught = await shelfRules();
      const tax = await taxonomy();
      const meter = { google: 0 };
      const moods = [];
      const items = [];
      let requests = 0;
      // All eight at once.
      //
      // One after another is eight round trips to Google in series — five and a
      // half seconds on a cold ring, on the one screen that opens when the app
      // does (owner, 20 Sep 2026: "there was a significant delay when I loaded
      // the screen"). They do not depend on each other, so they do not wait for
      // each other; a page's own next page still does, because the token comes
      // from the page before it.
      const asked = await Promise.all(Object.keys(ASKED).map(async (key) =>
        [key, await placesFor({ ring, category: key, page: 1, meter, taught, tax, householdId: household.id, minutes, mode, from: origin })]));
      for (const [key, got] of asked) {
        requests += got.requests;
        moods.push({
          key,
          label: tax.vocab?.categories?.[key]?.label ?? key,
          /**
           * The census count for the reach, and the page bought for display
           * beside it — never the one dressed as the other.
           *
           * This was the length of the list, under a rule of 20 Sep 2026 that
           * the owner has since rewritten (24 Sep 2026): "My 20 Sep rule was
           * about paid display, where showing 400 and rendering 20 is a lie.
           * The census count is free and permanent and is what should be
           * shown. The rule I should have written: never show the length of a
           * page as if it were a count. Show the census count for the reach,
           * then the five bought for display." So `count` is the census's,
           * counted once per place and box-tested, `unresolved` is the
           * straddlers beside it, and `shown` is what this board holds. A ring
           * covering most of London read Culture 19 the old way — Google's
           * page size — against 16,258.
           */
          count: census.counts[key] ?? 0,
          unresolved: census.unresolved[key] ?? 0,
          floor: (census.unresolved[key] ?? 0) > 0 || census.missing.length > 0 || Boolean(census.floors?.[key]),
          icon: tax.vocab?.categories?.[key]?.icon ?? null,
          // Food is a shelf again, not a door: it is bought the same way as
          // everything else now.
          isDoor: false,
          subcategories: [],
          shown: got.items.length,
          sifted: { returned: got.returned, inRing: got.inRing, scored: got.scored },
          more: Boolean(got.nextPageToken),
        });
        for (const it of got.items) {
          items.push(asCard(it, { centre, origin, mode, category: key }));
        }
      }
      const answer = {
        place: { label, lat: centre.lat, lng: centre.lng, locality },
        from: { label: origin.label ?? null, lat: origin.lat, lng: origin.lng, how: origin.how },
        mode, radiusKm: null,
        ring: {
          where: ring.label, minutes, cells: ring.cells.length,
          outcodes: ring.outcodes.length, notCensused: census.missing.length,
          box: boxKm(ring.box),
        },
        moods, items,
        pools: { atlas: false, live: false, ring: true, why: null, failed: false },
        spent: { displaySearches: requests },
        cached: requests === 0,
        tookMs: Date.now() - started,
        attribution: ['Powered by Google'],
      };
      if (requests) await visitsRepo.recordProviderCall(household.id, 'google', 'inspire.ring', meter).catch(() => null);
      // The home screen is a search, and what happens to each card afterwards
      // is the click stream Demand counts. A count-only caller is not drawing
      // anything and does not log one (the same rule the old pool kept).
      const counting = String(req.query.count ?? '') === '1';
      const searchId = counting ? null : await searchLog.noteSearch({
        householdId: household.id, accountId: req.account?.id ?? null, surface: 'inspire',
        ...(await searchLog.whereOf({ lat: centre.lat, lng: centre.lng, areaSlug: locality })),
        lat: centre.lat, lng: centre.lng, mode,
        asked: { party: members.length, minutes, ring: true },
        subject: null,
        shownTotal: items.length,
        shown: Object.entries(items.reduce((acc, i) => { const k = i.subcategory ?? 'unshelved'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).map(([subcategory, n]) => ({ subcategory, n })),
        sourcesQueried: ['google'],
        degraded: [],
      });
      if (searchId) await searchLog.noteShown(searchId, items.map((i, n) => ({ ref: i.venueRef, position: n + 1 })));
      // And into the index: a place a provider told us about is a place we have
      // seen, whether or not it fitted on the page.
      await placeIndex.noteSeen(items).catch(() => null);
      /**
       * What the ring cost, written down.
       *
       * The same omission `/around` had: this is up to eight paid display
       * searches per cache miss, reported in `spent` on screen and never
       * written to `provider_calls` — so it was invisible to the spend ceiling,
       * to the supplier register and to every cost-per-household figure
       * (Codex, 20 Sep 2026).
       *
       * `inspire.near` is its own purpose rather than `inspire.around`'s:
       * one draws the ring and the other buys inside it, and a purpose is the
       * only thing telling the two apart in the ledger. Purposes are stable
       * strings — added, never renamed.
       */
      if (meter.google) {
        await visitsRepo.recordProviderCall(household.id, 'google', 'inspire.near', meter).catch(() => null);
      }
      return res.json({ queryId: searchId, ...answer });
    }

    // The atlas alone unless somebody deliberately asks for more. `owned=1` is
    // kept as the older spelling of the same default so a client that still
    // sends it is not surprised.
    const asked = req.query.live === '1' || req.query.live === 'true';
    // How far a day out may be. Capped, because the query is a bounding box and
    // "everywhere" is not a search.
    const reach = Math.min(ATLAS_MAX_KM, Math.max(1, Number(req.query.km) || ATLAS_RADIUS_KM));
    // The sweep's answer is read first, because it decides whether anything is
    // spent: a town the sweep has not reached gets the look-around (owner,
    // 12 Sep 2026: "when I set my location to Bristol, you should be calling
    // the Google API… It should work either way"). Judged within the
    // look-around's own radius, so a swept Bath does not cover Bristol.
    const food = await foodNear({ lat: centre.lat, lng: centre.lng, km: reach, limit: FOOD_LIMIT });
    const liveWhy = asked ? 'asked' : needsLookAround(food, THINGS_RADIUS_KM) ? 'unswept' : null;
    const live = liveWhy != null;
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const { venues, cached, degraded } = live
      ? await thingsAround({ household, session: null, place: { ...centre, locality }, refresh })
      : { venues: [], cached: true, degraded: [] };
    const lookAround = lookAroundOutcome({ ran: live, why: liveWhy, degraded });

    // Around this place, and only around it. A source is free to answer with
    // whatever its index matched, and the fixture set ignores the point it was
    // given entirely, so the ring is enforced here rather than trusted.
    const around = venues
      .filter((v) => v.lat != null && v.lng != null && kmBetween(centre, v) <= THINGS_RADIUS_KM + 1)
      .sort((a, b) => weight(b) - weight(a) || kmBetween(centre, a) - kmBetween(centre, b));

    // What the back office has taught about which shelf a place belongs on.
    // One small read, cached in the process, and the only thing standing
    // between "Wikidata calls this a sports venue" and "this is a day out".
    const taught = await shelfRules();
    // Both levels, from the tables the back office writes.
    const tax = await taxonomy();

    const attendees = toAttendees(members);
    // A source states its credit either as a line or as { text, … }; the card only wants the line.
    const lines = Object.fromEntries(enabledSources({ includeOptIn: true }).map((s) => [s.key, typeof s.attribution === 'string' ? s.attribution : s.attribution?.text ?? null]));
    // The pictures we own for these places, in one statement rather than one a
    // card. A restaurant's picture is never a photograph of its food — it is
    // the mark it publishes, a Commons photograph of the building, or a
    // street-level frame of the front door (sources/placePicture.js). Anything
    // the ladder has found is here; anything it has not falls through to the
    // provider's photo and then to the card drawing its own identity.
    const ourPictures = await heroesForPlaces(around.map((v) => `${v.source}:${v.sourcePlaceId}`));

    // The attributes: the vocabulary with every drawer's defaults, and one read
    // for whatever these particular places say for themselves. One query for
    // the page, never one per place.
    // Every ref known at this point: the live pool and the swept food places.
    // The atlas is fetched further down and its refs are added to the same map
    // there, so the food pool is never left out (Codex, 14 Sep 2026).
    const everyRef = [
      ...around.map((v) => `${v.source}:${v.sourcePlaceId}`),
      ...(food ?? []).map((f) => f.venue_ref),
    ];
    const [attrVocab, own] = await Promise.all([
      placeAttributes.attributes(),
      placeAttributes.valuesForMany(everyRef),
    ]);

    let items = around.map((v) => {
      const p = shelvesForVenue(v, taught, tax.vocab);
      // Infrastructure gets no shelf and is not shown: the classifier's
      // verdict (domain/moods.js, travelOnly) is the fence, and this only obeys it.
      if (p.travel) return null;
      const ref = `${v.source}:${v.sourcePlaceId}`;
      return {
      venueRef: ref,
      source: v.source,
      name: v.name,
      category: v.category,
      moods: p.shelves, subcategory: p.subcategory,
      ...marks(p.subcategory, v.goodForChildren, own.get(ref), attrVocab, labelsOf(v)),
      experiences: v.experiences ?? [],
      cuisines: v.cuisines ?? [],
      rating: v.rating ?? null,
      ratingCount: v.ratingCount ?? null,
      priceLevel: v.priceLevel ?? null,
      goodForChildren: v.goodForChildren ?? null,
      photos: (v.photos ?? []).slice(0, 1),
      // Ours if we have one. A provider's photo still travels on `photos` and is
      // fetched at display time; this key is always present so the card has one
      // shape to draw rather than two.
      image: ownedImage(ourPictures.get(`${v.source}:${v.sourcePlaceId}`)),
      attribution: attributionOf(v, lines),
      lat: v.lat,
      lng: v.lng,
      // How far it is from the middle of the search, and how long the journey
      // to it would actually take from where the family sets off — two
      // different numbers, and the card wants the second.
      distanceKm: Number(kmBetween(centre, v).toFixed(1)),
      travelMinutes: estimateTravelMinutes(origin, v, mode),
      // Straight-line and a per-mode speed until a routing provider is paid for
      // (domain/travel.js). The screen says "about", because that is what it is.
      estimated: true,
      dwellMinutes: dwellFor(v, household, attendees).minutes,
      household: null,
      };
    }).filter(Boolean);

    // --- the second pool: what the county is actually known for -------------
    // Deduped against the first by name and nearness, not by identifier: the
    // same castle is `osm:way/123` in one pool and `wikidata:Q456` in the other
    // and no join exists between those. Two names that match within 250 m are
    // the same place — at that distance a real coincidence would have to be a
    // second Windsor Castle in the grounds of the first.
    let atlasCount = 0;
    const nameKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const already = items.map((i) => ({ key: nameKey(i.name), lat: i.lat, lng: i.lng }));
    const seen = (a) => already.some((b) => b.key === nameKey(a.name)
      && a.lat != null && kmBetween(a, b) < 0.25);

    /**
     * Somewhere to eat (Inspire rework, 7 Sep 2026).
     *
     * The note above still holds for the *activities* half: the atlas is
     * harvested from Wikidata and holds no restaurants, and a Food shelf made
     * of grey rectangles was the reason Food became a door into Places on
     * 5 Sep. The rework makes Food the other half of the tab instead, so it
     * needs a pool of its own — and there already is one. The postcode sweep
     * has read 2,600-odd places across a hundred areas, and everything it kept
     * is ours: open names and coordinates, cuisines and accolades from the
     * venue's own pages, and a *band* rather than a provider's rating.
     *
     * These carry `moods: ['food']` and nothing else, so they cannot surface on
     * an Activities shelf however the taxonomy is taught. The screen splits on
     * the same word.
     *
     * No rating and no price travels with them, because we do not hold either
     * as a number we are allowed to keep. The row draws what it has.
     */
    for (const f of food) {
      if (f.lat == null || f.lng == null) continue;
      if (seen(f)) continue;
      const cuisines = Array.isArray(f.cuisines) ? f.cuisines : [];
      items.push({
        venueRef: f.venue_ref,
        source: 'scout',
        name: f.name,
        /**
         * What kind of place, so the Food strip can offer more than one word.
         *
         * This was hard-coded 'restaurant' and the strip read back exactly one
         * category (owner, 8 Sep 2026). The sweep has always known — it filters
         * its candidates on this very set — it simply had nowhere to write it
         * until migration 070. Falls back to a restaurant because that is what
         * the sweep goes looking for, so an unresearched place is not stranded
         * outside every category on the strip.
         */
        category: FOOD_CATEGORIES.has(f.category) ? f.category : 'restaurant',
        moods: ['food'],
        subcategory: f.cuisine_group ?? null,
        // Indoors unless somebody has said otherwise about this place or its
        // drawer: a beer garden and a food market are not (14 Sep 2026).
        ...(() => {
          // Its drawer, not its cuisine group: a cuisine is not one of our 59,
          // so asking by it would inherit nothing at all.
          const drawer = FOOD_DRAWER[FOOD_CATEGORIES.has(f.category) ? f.category : 'restaurant'] ?? null;
          // A swept place keeps no provider words, so what the sweep wrote down
          // for itself answers instead. `secondary` is exactly that, resolved
          // at sweep time from the same table the words list edits.
          //
          // Not `cuisine_group`: that is a deliberately coarse bucket for the
          // menu queue, in which Pakistani, Bangladeshi and Sri Lankan are all
          // "Indian" (Codex, 14 Sep 2026). Where a place was swept before this
          // existed, its own `cuisines` are read instead — the first one that
          // is a cuisine we know by name.
          const said = f.secondary && Object.keys(f.secondary).length ? f.secondary : null;
          const alsoTrue = said ?? fromCuisines(f.cuisines, attrVocab);
          const m = marks(drawer, null, own.get(f.venue_ref), attrVocab, [], alsoTrue);
          return { ...m, indoor: m.indoor ?? true };
        })(),
        atlasCategory: null,
        experiences: [],
        cuisines: f.cuisine_group ? [f.cuisine_group, ...cuisines.filter((c) => c !== f.cuisine_group)] : cuisines,
        // The band is a judgement of ours and travels; the figure it was made
        // from is the provider's and never does.
        rating: null, ratingCount: null, priceLevel: null, goodForChildren: null,
        standing: f.crowd_band ?? null,
        accolades: Array.isArray(f.accolades) ? f.accolades : [],
        chain: Boolean(f.chain),
        photos: [],
        image: ownedImage(ourPictures.get(f.venue_ref)),
        summary: null, heritage: null,
        website: f.website ?? null, wikipediaUrl: null,
        region: f.locality_name ?? null,
        /**
         * Who actually supplied this row, rather than a hopeful constant.
         *
         * This said "OpenStreetMap contributors, ODbL" for every swept place,
         * and around Henley all 150 of them are keyed on a Google identifier —
         * so the open map was being credited for names it had never held
         * (Codex, 8 Sep 2026). `from_sources` is written by the sweep now and
         * backfilled from the identifier for rows swept before it existed.
         */
        attribution: creditFor(f.from_sources, f.venue_ref, lines),
        lat: f.lat, lng: f.lng,
        distanceKm: Number(f.km.toFixed(1)),
        travelMinutes: estimateTravelMinutes(origin, f, mode),
        estimated: true,
        // A meal out, at this household's pace. The atlas's attractions carry a
        // dwell worked out per place; the sweep does not hold one, and ninety
        // minutes is the honest default for sitting down to eat.
        dwellMinutes: 90,
        household: null,
      });
    }

    // Twice the OSM radius, because an attraction worth driving to is worth
    // showing from further away than a playground is. It is therefore the outer
    // edge of the whole answer, which is what `radiusKm` has to report.
    const atlas = await publishedNear({
      lat: centre.lat, lng: centre.lng, km: reach, limit: ATLAS_LIMIT,
      // Not any more. A photograph is preferred in the ordering, but requiring
      // one hid Virginia Water Lake — the largest park a mile from the owner's
      // house — because nobody has put a Commons picture of it online. A card
      // with no photograph draws its own category icon; a home screen with no
      // park next door just looks wrong (owner, 7 Sep 2026).
      illustratedOnly: false,
    });
    // The atlas refs, into the same map the rest of the answer reads from.
    for (const [ref, v] of await placeAttributes.valuesForMany(
      atlas.map((a) => (a.osm_ref ? `osm:${a.osm_ref}` : `wikidata:${a.wikidata_id}`)))) own.set(ref, v);
    for (const a of atlas) {
      if (a.lat == null || a.lng == null) continue;
      // The box is generous at its corners; this is the honest ring.
      if (kmBetween(centre, a) > reach) continue;
      if (seen(a)) continue;
      const ref = a.osm_ref ? `osm:${a.osm_ref}` : `wikidata:${a.wikidata_id}`;
      const shelf = shelvesForAtlas({ ref, category: a.category, kinds: a.kinds ?? [], pinned: Boolean(a.pinned) }, taught, tax.vocab);
      // Infrastructure gets no shelf and is not shown: the classifier's
      // verdict (domain/moods.js, fencedBy) is the fence, and this only obeys it.
      if (shelf.travel) continue;
      items.push({
        // Wikidata's own identifier where there is no OpenStreetMap one, which
        // is most of the time. It is CC0, it outlives every provider we might
        // use, and it is the identifier this place already has.
        venueRef: ref,
        source: 'atlas',
        name: a.name,
        category: 'attraction',
        moods: shelf.shelves,
        subcategory: shelf.subcategory,
        ...marks(shelf.subcategory, null, own.get(ref), attrVocab),
        // What the atlas calls this place — heritage, outdoors, family, museum,
        // arts, animals, active, landmark. Its own field rather than smuggled
        // into `experiences`, which is a closed vocabulary that voice is
        // interpreted against (domain/concepts.js): putting a word in there
        // that is not one of its terms would make the set quietly no longer
        // closed, which is the sort of thing that breaks somewhere else months
        // later. The screen's "kind of thing" filter reads this.
        atlasCategory: a.category,
        experiences: [], cuisines: [],
        rating: null, ratingCount: null, priceLevel: null, goodForChildren: null,
        photos: [],
        // The picture, and the licence it is shown under. `credit` is not
        // decoration: for everything but CC0 and public domain, showing the
        // photograph without it is the licence broken (L17).
        image: a.image_id ? {
          id: a.image_id, source: 'wikimedia', lqip: a.lqip, credit: a.credit_line,
          licence: a.licence, licenceUrl: a.licence_url, sourceUrl: a.source_page_url,
          creditRequired: a.attribution_required,
        } : null,
        summary: a.summary,
        heritage: a.heritage,
        website: a.website,
        wikipediaUrl: a.wikipedia_url,
        outcode: a.outcode ?? null,
        region: a.region_name,
        attribution: [
          ...(a.image_id && a.attribution_required && a.credit_line ? [a.credit_line] : []),
          ...(a.summary ? ['Wikipedia, CC BY-SA 4.0'] : []),
          'Wikidata, CC0',
        ],
        lat: a.lat, lng: a.lng,
        distanceKm: Number(kmBetween(centre, a).toFixed(1)),
        travelMinutes: estimateTravelMinutes(origin, a, mode),
        estimated: true,
        /*
         * How long to allow, from what kind of place this is.
         *
         * This used to pass `{ category: 'attraction', experiences: [] }` — a
         * stub — so `dwellAllowance` had nothing to narrow or lengthen and
         * every attraction in the country came back as the household's typical
         * activity, two and a half hours. Thorpe Park and a parish church read
         * the same (owner, 7 Sep 2026: "Thorpe Park allows 2.5 hours, which is
         * nonsense… are you just making this up?").
         *
         * The shelf the place is already on is the answer: the taxonomy says a
         * theme park is five hours and a church is thirty minutes, and it says
         * it in a table the back office can edit. Where it has no opinion the
         * household's own pace still applies, which is the right default for a
         * kind nobody has thought about yet.
         */
        dwellMinutes: dwellFor({
          category: 'attraction',
          experiences: [],
          dwellHint: tax.subByKey.get(shelf.subcategory)?.typical_minutes ?? null,
        }, household, attendees).minutes,
        household: null,
      });
      atlasCount += 1;
    }

    // Two places called the same thing read as one place shown twice, which is
    // the same bug from the household's side even when it is not one. Renamed
    // from the Wikipedia article, which is already disambiguated, and only
    // where something else in this answer shares the name.
    distinguish(items, { url: (i) => i.wikipediaUrl, area: (i) => i.outcode });

    // Anything that is part of somewhere else goes, before anything is counted
    // or drawn. The owner, 14 Sep 2026: "I've seen multiple times activities
    // that actually exist in Thorpe Park being listed as separate activities on
    // the Inspire tab, and we absolutely have to stop that happening." Amity
    // Beach is Thorpe Park; only Thorpe Park is offered.
    const { childToParent } = await placeParts.parts();
    // The parent takes what its children knew first, then the children go.
    placeParts.rollUp(items, childToParent);
    // An atlas place that turned out to be part of another is not an atlas
    // place this answer shows, so it cannot justify the wider radius. Only the
    // atlas ones count here: a dropped food place says nothing about reach.
    atlasCount -= items.filter((i) => i.source === 'atlas' && childToParent.has(i.venueRef)).length;
    items = placeParts.withoutParts(items, childToParent);

    // The heart on each card: whether this household has already kept, been to
    // or made a special of the place. One query for the lot.
    const status = await householdStatus(household.id, items.map((i) => i.venueRef));
    for (const item of items) item.household = status[item.venueRef] ?? null;

    const counts = Object.fromEntries(tax.active.categories.map((m) => [m.key, items.filter((i) => i.moods.includes(m.key)).length]));

    // The home screen is a search too, and the one people make most. Written
    // down from the first day, because none of it can be backfilled and an
    // Inspire that showed nothing for a town is the coverage hole that matters
    // most — it is the first thing anybody sees.
    //
    // But a *count* is not a search. Setting up voice asks this endpoint only
    // to say "about 240 places within an hour's drive", and draws none of them;
    // every change of range or mode asked again, and each one was going into
    // the log as a search where everything was shown and nothing was clicked —
    // which is exactly the shape of a failure (Codex, 18 Sep 2026). A caller
    // that is not going to draw the answer says so.
    const counting = String(req.query.count ?? '') === '1';
    const searchId = counting ? null : await searchLog.noteSearch({
      householdId: household.id, accountId: req.account?.id ?? null, surface: 'inspire',
      ...(await searchLog.whereOf({ lat: centre.lat, lng: centre.lng, areaSlug: locality })),
      lat: centre.lat, lng: centre.lng, mode,
      asked: { party: members.length, locality: Boolean(locality) },
      subject: null,
      shownTotal: items.length,
      shown: Object.entries(items.reduce((acc, i) => { const k = i.subcategory ?? 'unshelved'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).map(([subcategory, n]) => ({ subcategory, n })),
      sourcesQueried: lookAround.live ? ['atlas', 'live'] : ['atlas'],
      degraded: lookAround.failed ? ['live'] : [],
    });
    // All of them, not the first sixty: the replay is built from these rows,
    // and a card the household could tap has to be in it (Codex, 17 Sep 2026).
    if (searchId) await searchLog.noteShown(searchId, items.map((i, n) => ({ ref: i.venueRef, position: n + 1 })));
    // And into the index: every place any source has ever seen. Even a count-only
    // request, because seeing a place is seeing it (placeIndex.noteSeen).
    await placeIndex.noteSeen(items);

    res.json({
      queryId: searchId,
      place: { label, ...centre, locality },
      from: origin,
      mode,
      // The furthest anything in this answer can be, not the radius of one of
      // the two searches behind it. The screen prints this in "N places within
      // X km", and the atlas half reaches twice as far as the look-around — so
      // reporting 5 while showing Windsor Castle at 9.7 would be a plain
      // untruth on the screen.
      radiusKm: atlasCount ? reach : THINGS_RADIUS_KM,
      // What is actually in this answer. Said outright, so a screen never has to
      // work out from an empty shelf whether a pool was absent or merely quiet.
      // `why` says whether the look-around was asked for or ran because the
      // sweep has not reached this town; `failed` that a source refused, so
      // an empty Food tab is "could not look" rather than "there is nowhere".
      pools: { atlas: true, live: lookAround.live, why: lookAround.why, failed: lookAround.failed },
      // The chips, from the table rather than from a list in the bundle, each
      // with its drawers and how many places are in each. A category added or
      // renamed in the back office is on the home screen at the next refresh.
      moods: tax.active.categories.map((m) => ({
        key: m.key, label: m.label, icon: m.icon, isDoor: m.is_door,
        count: counts[m.key],
        // A drawer listed in this cabinet as well as its home belongs in the
        // list, or picking Fun would show skate parks with no drawer to put
        // them in and they would all fall to "Everything else" (14 Sep 2026).
        subcategories: tax.active.subcategories
          .filter((sc) => sc.category_key === m.key || (sc.also_in ?? []).includes(m.key))
          // A parent counts for the drawers its children were in as well as its
          // own: hiding Amity Beach must not empty the Water parks drawer
          // (Codex, 14 Sep 2026).
          .map((sc) => ({ key: sc.key, label: sc.label, count: items.filter((i) => i.subcategory === sc.key || (i.contains ?? []).includes(sc.key)).length }))
          .filter((sc) => sc.count > 0),
      })),
      items,
      cached: Boolean(cached),
      tookMs: Date.now() - started,
      attribution: [...new Set(items.flatMap((i) => i.attribution))],
    });
  } catch (err) {
    next(err);
  }
});

export default inspire;
