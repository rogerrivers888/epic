/**
 * The free count the census is measured against.
 *
 * The census can tell you it found eleven climbing walls in a tile. It cannot
 * tell you whether there are eleven. Google answers the question it was asked —
 * one Text Search per type, split until nothing is cut off — and a drawer whose
 * question is too narrow comes back small and *looks settled*. The brief's §4
 * is the check on that: "OSM counts via Overpass and FHRS counts for food, per
 * box and subcategory, stored beside the census count. A subcategory well below
 * its ground count is a query gap, fixed by widening the fan-out at no cost."
 *
 * **Per box, and never per outcode.** The free sources answer about a rectangle
 * (Overpass) or a circle (the hygiene register); an outcode is an irregular
 * shape that is neither. Asking the same tile the census asked is what makes
 * the two numbers comparable at all, and the outcode figure is then a sum of
 * tiles rather than a second measurement of a different shape. `area_counts`
 * has had `osm_count` and `fhrs_count` since the census did and they have never
 * been filled, which is why.
 *
 * **Counts, never content.** The Food Standards Agency register is open
 * government data and OpenStreetMap is ODbL, so either could be kept — but
 * neither is a source Epic shows a household. CLAUDE.md is explicit: free data
 * is "a check on Google, not a second source of discovery or opinion", in the
 * back office only. So establishments and map elements are counted in memory
 * and thrown away, and what is written down is a number, how it was asked, the
 * box it was asked about and the day.
 *
 * **Every free count has a caveat, and it is stored with the number.** OSM
 * counts a crag beside a climbing wall and a club mapped as both a node and a
 * way twice; the register lists every kitchen inspected, which includes school
 * canteens and care homes. A ground count presented without its caveat reads as
 * a target, and the first thing anybody would do with it is widen a query until
 * it matched — which is how a census gets taught to count pitches as grounds.
 */

import { query } from '../db.js';
import { overpassQuery } from './overpass.js';
import * as providerCalls from '../repositories/providerCalls.js';

/**
 * What the open map calls each of our drawers.
 *
 * Deliberately code and not `shelf_rules`. The Google plan is read from the
 * rules table because it *is* the mapping — a taxonomy change there re-maps the
 * census for free — but this is not a mapping, it is a second opinion on one.
 * Teaching `osm:sport=climbing` as a rule would also change where OSM-sourced
 * places are filed across the whole app, which is a bigger decision than "how
 * shall we check Google's climbing count", and not one a cross-check gets to
 * make on its own.
 *
 * `selectors` are Overpass tag filters, applied to nodes, ways and relations.
 * `caveat` is the sentence that travels with every number the selector
 * produces. A subcategory with no entry has no free ground count, which is a
 * fact about the open map and is reported as one — never as nought.
 */
export const OSM_GROUND = {
  // — activity ------------------------------------------------------------
  athletics: { selectors: ['["leisure"="track"]["sport"~"athletics|running"]'], caveat: 'Running tracks only; a club with no track of its own is not on the map as one.' },
  climbing: { selectors: ['["sport"~"climbing"]'], caveat: 'Counts outdoor crags and boulders as well as walls, so it runs high in hill country and about right in a town.' },
  cycling: { selectors: ['["leisure"="track"]["sport"="cycling"]', '["sport"="cycling"]["leisure"]'], caveat: 'Velodromes and bike parks; the open map keeps trails as routes, which are not places.' },
  paddling: { selectors: ['["sport"~"sailing|rowing|canoe|kayak|paddle"]'], caveat: 'A sailing club mapped as both a building and a marina berth counts twice.' },
  pools: { selectors: ['["leisure"~"swimming_pool|sports_centre"]'], caveat: 'Includes hotel and school pools where somebody has mapped them, and every leisure centre whether or not it has a pool.' },
  skating: { selectors: ['["leisure"="ice_rink"]'], caveat: 'Seasonal rinks are mapped in winter and unmapped again, so the count moves with the year.' },

  // — adrenaline ----------------------------------------------------------
  circuits: { selectors: ['["highway"="raceway"]', '["leisure"="track"]["sport"~"motor|karting"]'], caveat: 'A circuit mapped as both a way and an area counts twice.' },
  flying: { selectors: ['["aeroway"="aerodrome"]', '["sport"~"parachuting|skydiving|gliding|free_flying"]'], caveat: 'Every airfield, including the ones you cannot buy a flight at.' },
  karting: { selectors: ['["sport"="karting"]'], caveat: 'Indoor karting is often mapped as a building with no sport tag at all.' },
  'off-road': { selectors: ['["sport"~"motocross|4x4|quad"]'], caveat: 'Green lanes and rights of way are routes, not places, and are not counted.' },
  'paintball-center': { selectors: ['["sport"~"paintball|laser_tag"]'], caveat: 'Woodland sites are often mapped only as the car park.' },
  ropes: { selectors: ['["attraction"="zip_line"]', '["sport"="climbing_adventure"]', '["leisure"="adventure_park"]'], caveat: 'A park with six zip lines may be mapped as six.' },
  watersports: { selectors: ['["sport"~"water_ski|waterski|wakeboard"]'], caveat: 'Thinly mapped: the open map rarely distinguishes a wake park from a lake.' },

  // — culture -------------------------------------------------------------
  'ancient-sites': { selectors: ['["historic"~"archaeological_site|megalith|hillfort|tomb"]'], caveat: 'Includes sites with nothing to see and no access.' },
  castles: { selectors: ['["historic"~"castle|fort"]'], caveat: 'Includes earthworks and mottes with no standing stone.' },
  churches: { selectors: ['["amenity"="place_of_worship"]'], caveat: 'Every place of worship of every faith, open or not; the drawer is narrower than the tag.' },
  'cultural-center': { selectors: ['["amenity"~"arts_centre|community_centre"]'], caveat: 'Village halls are community centres too.' },
  galleries: { selectors: ['["tourism"="gallery"]'], caveat: 'Commercial galleries and public ones are the same tag.' },
  'historic-houses': { selectors: ['["historic"~"manor|house|palace"]'], caveat: 'Many are mapped only as an attraction, and some are private homes.' },
  landmarks: { selectors: ['["historic"~"memorial|monument"]', '["tourism"="artwork"]'], caveat: 'Counts every war memorial and bench plaque, so it runs very high.' },
  museums: { selectors: ['["tourism"="museum"]'], caveat: 'Includes one-room village museums open two days a year.' },
  theatre: { selectors: ['["amenity"~"theatre|music_venue"]'], caveat: 'A theatre inside a school or a community centre is usually mapped as the building.' },

  // — food ----------------------------------------------------------------
  cafes: { selectors: ['["amenity"~"cafe|ice_cream"]', '["shop"="bakery"]'], caveat: 'A bakery that seats nobody is still a bakery here.' },
  'fast-food': { selectors: ['["amenity"="fast_food"]'], caveat: 'The open map draws the line between fast food and a restaurant differently from Google.' },
  'food-markets': { selectors: ['["amenity"~"marketplace|food_court"]'], caveat: 'A market square with no market on it is mapped the same as one with.' },
  'pubs-bars': { selectors: ['["amenity"~"pub|bar|biergarten"]'], caveat: 'Closed pubs stay on the map for a long time.' },
  restaurants: { selectors: ['["amenity"="restaurant"]'], caveat: 'Hotel restaurants are usually inside the hotel and not mapped separately.' },

  // — fun -----------------------------------------------------------------
  'cinema-bowling': { selectors: ['["amenity"="cinema"]', '["leisure"~"bowling_alley|amusement_arcade"]'], caveat: 'Arcades inside a larger venue are rarely mapped.' },
  lidos: { selectors: ['["leisure"="swimming_area"]', '["leisure"="swimming_pool"]["location"="outdoor"]'], caveat: 'Wild swimming spots carry the same tag as a built lido.' },
  'live-music': { selectors: ['["amenity"~"music_venue|nightclub"]'], caveat: 'A pub with a stage is a pub on the open map.' },
  'miniature-golf-course': { selectors: ['["leisure"="miniature_golf"]'], caveat: 'Each hole is sometimes mapped separately.' },
  play: { selectors: ['["leisure"="playground"]'], caveat: 'Counts every set of swings in every park, which is the thing it is a check on.' },
  'theme-parks': { selectors: ['["tourism"="theme_park"]'], caveat: 'A park and its rides may both be tagged.' },
  'water-park': { selectors: ['["leisure"="water_park"]'], caveat: 'Splash pads in parks carry the same tag.' },
  'zoos-wildlife': { selectors: ['["tourism"~"zoo|aquarium"]', '["attraction"="animal"]'], caveat: 'An enclosure inside a zoo is sometimes tagged as a zoo.' },

  // — outdoors ------------------------------------------------------------
  'barbecue-area': { selectors: ['["amenity"="bbq"]'], caveat: 'One grill in a park is one of these.' },
  'caves-falls': { selectors: ['["natural"~"cave_entrance|waterfall"]', '["waterway"="waterfall"]'], caveat: 'Every cave entrance, including ones nobody may enter.' },
  coast: { selectors: ['["natural"="beach"]'], caveat: 'A long beach mapped in sections counts once per section.' },
  hills: { selectors: ['["natural"="peak"]'], caveat: 'Every named high point, including ones with no path to them.' },
  marina: { selectors: ['["leisure"="marina"]'], caveat: 'Moorings and marinas are the same tag.' },
  nature: { selectors: ['["leisure"="nature_reserve"]'], caveat: 'Includes reserves with no public access.' },
  parks: { selectors: ['["leisure"~"park|common"]'], caveat: 'Every green square in a housing estate is a park here.' },
  trails: { selectors: ['["route"="hiking"]'], caveat: 'Routes, not places — the one entry here that counts a line rather than a point.' },
  viewpoints: { selectors: ['["tourism"="viewpoint"]'], caveat: 'A viewpoint is a tag anybody can add to a bend in a road.' },
  water: { selectors: ['["natural"="water"]["water"~"lake|reservoir|pond"]'], caveat: 'Counts farm ponds as well as lakes.' },
  woodland: { selectors: ['["natural"="wood"]', '["landuse"="forest"]'], caveat: 'A forest mapped in compartments counts once per compartment, so this runs very high.' },

  // — relaxing ------------------------------------------------------------
  gardens: { selectors: ['["leisure"="garden"]["name"]'], caveat: 'Named gardens only; an unnamed garden is somebody’s back lawn.' },
  library: { selectors: ['["amenity"="library"]'], caveat: 'Includes university and school libraries.' },
  markets: { selectors: ['["amenity"="marketplace"]', '["shop"="antiques"]'], caveat: 'Shares the marketplace tag with street food, so the two overlap on purpose.' },
  spas: { selectors: ['["leisure"="spa"]', '["amenity"~"spa|public_bath"]', '["shop"="massage"]'], caveat: 'Hotel spas are usually inside the hotel and not mapped separately.' },

  // — sport ---------------------------------------------------------------
  arenas: { selectors: ['["leisure"="stadium"]'], caveat: 'A stadium and its stands are sometimes mapped separately.' },
  football: { selectors: ['["leisure"="stadium"]["sport"~"soccer|football"]', '["club"="football"]'], caveat: 'Grounds, not pitches: every park pitch carries `leisure=pitch` and is deliberately left out.' },
  golf: { selectors: ['["leisure"="golf_course"]'], caveat: 'Driving ranges carry their own tag and are not counted.' },
  racecourses: { selectors: ['["leisure"="track"]["sport"~"horse_racing|greyhound_racing"]'], caveat: 'The track and the course are sometimes two objects.' },
  'racquet-clubs': { selectors: ['["leisure"="sports_centre"]["sport"~"tennis|squash|badminton"]', '["club"="tennis"]'], caveat: 'Clubs, not courts: a park with six courts is not six clubs.' },
  'rugby-cricket': { selectors: ['["leisure"="pitch"]["sport"~"rugby|cricket"]', '["club"~"rugby|cricket"]'], caveat: 'Counts pitches, because that is how the open map records a village ground — so it runs well above the number of clubs.' },
  'skateboard-park': { selectors: ['["leisure"="skatepark"]', '["sport"="skateboard"]'], caveat: 'A few ramps in a park carry the same tag as a built park.' },
  'ski-resort': { selectors: ['["landuse"="winter_sports"]'], caveat: 'Dry slopes are usually tagged as a piste rather than a resort.' },
};

/**
 * Which of the register's business types stand for which of our food drawers.
 *
 * The Food Standards Agency inspects kitchens, not days out, so its vocabulary
 * is fifteen words wide and five of them are ours. The rest — hospitals, school
 * canteens, importers, distributors — are a real part of its count and no part
 * of ours, which is exactly why the count has to be asked by type rather than
 * taken whole. A tile's register total is not a number Epic has any use for.
 *
 * Ids from `/BusinessTypes/basic`, checked 20 Sep 2026.
 */
export const FHRS_GROUND = {
  restaurants: { types: [1], caveat: 'The register files restaurants, cafés and canteens as one type, so this is the ceiling for both of ours.' },
  cafes: { types: [1], caveat: 'Shares its type with restaurants: the register does not tell a café from a restaurant.' },
  'fast-food': { types: [7843, 7846], caveat: 'Takeaways and sandwich shops, plus mobile caterers, which Google mostly does not list at all.' },
  'pubs-bars': { types: [7844], caveat: 'Pubs, bars and nightclubs are one type, and a hotel bar is filed under the hotel.' },
  'food-markets': { types: [7846, 7841], caveat: 'Mobile caterers and other catering premises: the nearest the register comes to a street food stall.' },
};

/** The register's own name for the ids above, for the row that explains itself. */
const FHRS_TYPE_NAMES = {
  1: 'Restaurant/Cafe/Canteen', 7841: 'Other catering premises', 7843: 'Takeaway/sandwich shop',
  7844: 'Pub/bar/nightclub', 7846: 'Mobile caterer',
};

const FHRS_ROOT = 'https://api.ratings.food.gov.uk';
const FHRS_HEADERS = {
  'x-api-version': '2',
  accept: 'application/json',
  'user-agent': 'Epic/0.1 (+https://github.com/rogerrivers888/epic)',
};

/** Overpass will answer about several questions in one request; this many. */
const SELECTORS_PER_QUERY = Number(process.env.EPIC_GROUND_OSM_CHUNK || 12);

/**
 * Count, in one request, how many things the open map has of each kind in a
 * box.
 *
 * `out count` is the whole reason this is affordable. Asking for the elements
 * and counting them here would move tens of thousands of objects across for a
 * London tile — the answer wanted is a number, and Overpass will do the
 * counting on its own machine if you ask it to. Several counts travel in one
 * query, each as its own output statement, and come back in the order they were
 * asked.
 *
 * Nothing is stored from the response but the numbers. There is nothing else in
 * it: a count has no name, no tags and no position.
 *
 * `ask` is the mirror-picking Overpass client, and a parameter so the tests can
 * hold the order of the answers — a module namespace cannot be stubbed the way
 * `googleSource.censusSlice` can, and reading three counts back in the wrong
 * order would put the climbing number on the marinas.
 */
export async function osmCountsForBox(box, { subcategories = null, chunk = SELECTORS_PER_QUERY, timeoutMs = 120_000, ask = overpassQuery } = {}) {
  // In the order the caller asked, so the answers line up with the questions
  // the way a reader would expect. A drawer with no entry here is dropped
  // rather than counted as nought: the open map having no word for it is a
  // fact about the map, not a measurement of the ground.
  const wanted = subcategories
    ? subcategories.filter((key) => OSM_GROUND[key]).map((key) => [key, OSM_GROUND[key]])
    : Object.entries(OSM_GROUND);
  if (!wanted.length) return { counts: {}, requests: 0, problems: [] };
  const bbox = `(${box.minLat},${box.minLng},${box.maxLat},${box.maxLng})`;

  const counts = {};
  const problems = [];
  let requests = 0;
  for (let i = 0; i < wanted.length; i += chunk) {
    const batch = wanted.slice(i, i + chunk);
    const body = `[out:json][timeout:90];\n${batch.map(([key, { selectors }], n) => {
      const parts = selectors.map((s) => `nwr${s}${bbox};`).join('');
      // Named after the drawer so a query that fails can be read by a person.
      return `(${parts})->.s${n};\n.s${n} out count;`;
    }).join('\n')}`;
    try {
      const data = await ask(body, { timeoutMs });
      requests += 1;
      // One `count` element per output statement, in order. Overpass answers
      // with nodes/ways/relations separately and a total; the total is the
      // count of objects, which is what a ground check wants — the caveat on
      // each entry says where that over-counts.
      const els = (data.elements || []).filter((e) => e.type === 'count');
      batch.forEach(([key], n) => {
        const t = els[n]?.tags ?? {};
        counts[key] = Number(t.total ?? 0);
      });
    } catch (err) {
      requests += 1;
      problems.push(`${batch.map(([k]) => k).join(', ')}: ${String(err.message).slice(0, 120)}`);
    }
  }
  await providerCalls.record(null, 'osm-overpass', 'ground.osm', { 'osm-overpass': requests }).catch(() => null);
  return { counts, requests, problems };
}

/**
 * One page of the hygiene register, as a promise of rows rather than of a page.
 *
 * The register is asked by local authority rather than by box, and that is a
 * decision about politeness rather than about shape. A 9 km tile in central
 * London holds twenty thousand inspected kitchens: asked as a geographic search
 * that is a hundred pages *per tile*, against a free government API, for four
 * hundred tiles. Asked by authority it is the same rows once — fifty or so
 * authorities cover London and the home counties — and every tile in them is
 * counted from the same download.
 */
/**
 * How long to leave between two questions to the register, and how long to
 * leave it alone once it has said no.
 *
 * The register is a free government service with no key and no published rate
 * limit, and it answered 403 the first time a sweep asked it six times in a few
 * seconds (21 Sep 2026). So the calls are spaced, and a refusal buys it ten
 * minutes off rather than being retried — the same rule `sources/overpass.js`
 * keeps for the map mirrors, and for the same reason: there is nobody waiting
 * on a ground count, and being rude to a service that costs nothing is how it
 * stops costing nothing.
 */
const FHRS_PAUSE_MS = Number(process.env.EPIC_FHRS_PAUSE_MS || 400);
const FHRS_COOL_OFF_MS = 10 * 60_000;
let fhrsNextAt = 0;
let fhrsRestingUntil = 0;

/** Is the register having its ten minutes? */
export const fhrsResting = () => fhrsRestingUntil > Date.now();

async function fhrsPage(path) {
  if (fhrsResting()) {
    throw Object.assign(new Error('the register is resting after a refusal'), { resting: true });
  }
  const wait = fhrsNextAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  fhrsNextAt = Date.now() + FHRS_PAUSE_MS;
  const res = await fetch(`${FHRS_ROOT}${path}`, { headers: FHRS_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    // 403 and 429 are both "you are asking too often" from this service; a 5xx
    // is it being unwell. Either way the answer is to stop asking, not to ask
    // again — a pass that retried through a refusal would turn one rude minute
    // into an hour of them.
    if ([403, 429, 503].includes(res.status)) fhrsRestingUntil = Date.now() + FHRS_COOL_OFF_MS;
    throw Object.assign(new Error(`FHRS ${res.status}`), { status: res.status });
  }
  return res.json();
}

/** Every authority the register knows, by the code an establishment carries. */
export async function fhrsAuthorities() {
  const data = await fhrsPage('/Authorities/basic');
  const byCode = new Map();
  for (const a of data.authorities ?? []) {
    byCode.set(String(a.LocalAuthorityIdCode), { id: a.LocalAuthorityId, name: a.Name, establishments: a.EstablishmentCount });
  }
  return byCode;
}

/**
 * Which councils a tile is in — all of them, not the one in the middle.
 *
 * Asked of the register rather than worked out from our own district table,
 * because the id needed is the register's own and the two lists disagree about
 * boundaries; the register's answer to "whose kitchen is nearest this point" is
 * the register's own boundary.
 *
 * **Five points, because the middle only ever names one.** A tile is 8.9 by 8.3
 * kilometres and most London boroughs are smaller than that, so a tile counted
 * from its middle alone holds one borough's kitchens and reads as a whole-tile
 * number — and an understated ground count does not read as an error, it reads
 * as a census that has found everything there is (Codex, 21 Sep 2026). The four
 * corners and the middle catch every council with a real share of the tile; a
 * sliver of a third touching only the middle of an edge is possible, and the
 * caveat on the count says so.
 */
export async function fhrsAuthoritiesFor(box) {
  const points = [
    [(box.minLat + box.maxLat) / 2, (box.minLng + box.maxLng) / 2],
    [box.minLat, box.minLng], [box.minLat, box.maxLng],
    [box.maxLat, box.minLng], [box.maxLat, box.maxLng],
  ];
  const found = new Map();
  let requests = 0;
  for (const [lat, lng] of points) {
    // A mile, not three: a corner asked with a wide radius answers with the
    // council on the other side of the tile and puts a borough on the list that
    // has nothing in it — which would leave the tile waiting for a contributor
    // that can never contribute.
    const data = await fhrsPage(`/Establishments?longitude=${lng}&latitude=${lat}&maxDistanceLimit=1&pageSize=1`);
    requests += 1;
    const first = data.establishments?.[0];
    if (first) found.set(String(first.LocalAuthorityCode), { code: String(first.LocalAuthorityCode), name: first.LocalAuthorityName });
  }
  await providerCalls.record(null, 'fhrs', 'ground.fhrs.where', { fhrs: requests }).catch(() => null);
  return [...found.values()];
}

/** Which councils have already been counted into a tile. */
export async function contributorsTo(gridKey, source = 'fhrs', drawers = null, { staleDays = null, asked = null } = {}) {
  // Only what is still within the window, when there is one.
  //
  // The question the settling asked was *whether* a council had answered and
  // never *when*, so a tile whose numbers were a month old looked complete:
  // nothing was downloaded, `fhrs_at` was stamped again with today's date, and
  // month-old figures were presented as this week's (owner, 21 Sep 2026). The
  // comment below this one already said the answer — "what it already holds is
  // exactly what is being refreshed, so it counts as having nothing" — but
  // nothing here could tell the difference between an old row and a new one.
  //
  // Worse than a gap, because the comparison this feeds is the one that says
  // which drawers the census is short on: a stale ground count does not read as
  // missing, it reads as agreement.
  const params = [gridKey, source];
  if (staleDays != null) params.push(String(staleDays));
  const askedAt = asked ? params.push(asked) : null;
  const { rows } = await query(
    `select contributor, subcategory from ground_counts
      where grid_key = $1 and source = $2
        ${staleDays == null ? '' : "and counted_at > now() - ($3 || ' days')::interval"}
        ${askedAt ? `and asked = any($${askedAt}::text[])` : ''}`,
    params);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.contributor)) by.set(r.contributor, new Set());
    by.get(r.contributor).add(r.subcategory);
  }
  // A council counts as having contributed only when it has answered for every
  // drawer being asked about. Otherwise a drawer added after the sweep would be
  // invisible: every council would already be "in", the tile would settle, and
  // the new drawer would have no ground count until the tile went stale a month
  // later (epic-71, 21 Sep 2026).
  const wanted = drawers ?? Object.keys(FHRS_GROUND);
  return new Set([...by].filter(([, has]) => wanted.every((d) => has.has(d))).map(([who]) => who));
}

/**
 * Every inspected kitchen in one authority, as points and types and nothing
 * else.
 *
 * The name, the address and the rating are read and dropped: they are the
 * register's content, we are counting, and a hygiene rating is not a thing Epic
 * has any business holding an opinion about.
 */
export async function fhrsPoints(authorityId, { pageSize = 200, maxPages = 200, onPage = null } = {}) {
  const points = [];
  let requests = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fhrsPage(`/Establishments?localAuthorityId=${authorityId}&pageSize=${pageSize}&pageNumber=${page}`);
    requests += 1;
    const rows = data.establishments ?? [];
    for (const e of rows) {
      const lat = Number(e.geocode?.latitude);
      const lng = Number(e.geocode?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      points.push({ lat, lng, type: Number(e.BusinessTypeID) });
    }
    onPage?.({ page, rows: rows.length, total: data.meta?.totalCount ?? null });
    if (!rows.length || points.length >= (data.meta?.totalCount ?? 0)) break;
    if (rows.length < pageSize) break;
  }
  await providerCalls.record(null, 'fhrs', 'ground.fhrs', { fhrs: requests }).catch(() => null);
  return { points, requests };
}

/** How many of each drawer's business types fall inside a box. */
export function fhrsCountsInBox(points, box) {
  const inside = points.filter((p) => p.lat >= box.minLat && p.lat <= box.maxLat && p.lng >= box.minLng && p.lng <= box.maxLng);
  const counts = {};
  for (const [key, { types }] of Object.entries(FHRS_GROUND)) {
    counts[key] = inside.filter((p) => types.includes(p.type)).length;
  }
  return counts;
}

/**
 * Write what a free source found, beside what Google found.
 *
 * `on conflict` rather than an insert: a tile counted again is the same fact
 * measured later, and the point of re-counting is to move the number.
 */
export async function noteGround({ gridKey, source, counts, asked = {}, problem = null, from = null }) {
  const keys = Object.keys(counts);
  if (!keys.length) return { written: 0 };
  const caveats = source === 'osm' ? OSM_GROUND : FHRS_GROUND;
  // Who counted. The open map has one counter — Overpass answers about the
  // rectangle itself — and the register has one per council that shares the
  // tile (migration 230).
  const counter = String(from ?? 'box');
  const values = keys.map((_, i) => `($${i * 7 + 1},$${i * 7 + 2},$${i * 7 + 3},$${i * 7 + 4}::int,$${i * 7 + 5},$${i * 7 + 6},$${i * 7 + 7})`).join(',');
  const params = keys.flatMap((key) => [
    gridKey, source, key, counts[key], asked[key] ?? null, caveats[key]?.caveat ?? null, counter,
  ]);
  // **A counter replaces its own row and nobody else's.** That is what makes a
  // re-count the same operation as a first count: the tile's number is the sum
  // of its counters, so Southwark counted again moves Southwark's row and
  // leaves Lambeth's alone. Held as one total it could only ever be added to,
  // and adding again would double it — which is how the first version of this
  // could never refresh (Codex, 21 Sep 2026).
  await query(
    `insert into ground_counts (grid_key, source, subcategory, places, asked, caveat, contributor)
     values ${values}
     on conflict (grid_key, source, subcategory, contributor) do update
        set places = excluded.places, asked = excluded.asked, caveat = excluded.caveat,
            counted_at = now(), problem = null`,
    params,
  );
  if (problem) {
    await query('update ground_counts set problem = $3 where grid_key = $1 and source = $2', [gridKey, source, problem]);
  }
  // The open map is done the moment it answers: Overpass was asked about this
  // box and no other machine has anything to add. The register is not — a tile
  // is dated by `sweepFhrs` only once every council that shares it has
  // contributed, because dating it on the first one is precisely how a boundary
  // tile ended up holding half its kitchens (Codex, 21 Sep 2026).
  if (source === 'osm') {
    await query('update census_tiles set osm_at = now() where grid_key = $1', [gridKey]);
  }
  return { written: keys.length };
}

/**
 * How the count was asked, in the words the source itself uses.
 *
 * Exported because it is now part of the question, not only a note on the row:
 * a count taken with one set of selectors is not an answer to another set, so
 * the sweep compares what a row says it asked against what it would ask now. A
 * test that writes a ground row by hand has to write the same thing, or it is
 * describing a row the sweep would never have written.
 */
export const askedOsm = () => Object.fromEntries(Object.entries(OSM_GROUND).map(([k, v]) => [k, v.selectors.join(' ')]));
export const askedFhrs = () => Object.fromEntries(Object.entries(FHRS_GROUND)
  .map(([k, v]) => [k, v.types.map((t) => FHRS_TYPE_NAMES[t] ?? t).join(', ')]));

/**
 * Which drawers a tile still owes a ground count for.
 *
 * **The question is per drawer, not per tile** (epic-71, 21 Sep 2026). A tile
 * asked "have you been counted?" is a tile that answers yes for ever, and the
 * taxonomy is being rewritten underneath this: Landmarks & monuments was split
 * into two drawers in an afternoon. A drawer created after a tile was counted
 * has no row here, and a tile-level date made it invisible until the whole tile
 * went stale a month later.
 *
 * Asked this way a re-opened tile needs no special handling, a split that makes
 * two drawers out of one gets both counted, and a drawer whose rules changed
 * without the tile changing is picked up too.
 */
async function owedBy(source, subcategories, asked, { staleDays, limit }) {
  const { rows } = await query(
    `select t.grid_key, t.min_lat, t.min_lng, t.max_lat, t.max_lng, t.fhrs_authorities,
            array(select w.sub
                    from unnest($2::text[], $4::text[]) as w(sub, asked)
                   where not exists (
                     select 1 from ground_counts g
                      where g.grid_key = t.grid_key and g.source = $3
                        and g.subcategory = w.sub
                        and g.counted_at > now() - ($1 || ' days')::interval
                        -- And counted by asking what we would ask now. The
                        -- selectors are ours and they change: a count taken by
                        -- one set of tags is not an answer to a different set,
                        -- and no date can tell those apart. The selectors are
                        -- stored on the row for exactly this, so it is free.
                        and g.asked is not distinct from w.asked)) as owed
       from census_tiles t
      where t.state = 'done'
      order by t.censused_at desc nulls last`,
    [String(staleDays), subcategories, source, asked]);
  return rows.filter((r) => r.owed.length).slice(0, limit);
}

/**
 * The same question for the register, where a tile has more than one counter.
 *
 * A tile owes the register a count when a drawer has no fresh row *from one of
 * its councils*. Asked per drawer alone it would drop out the moment the first
 * council answered for all five — which is the fault 226 was written to stop,
 * coming back in through the selection instead of through the settling.
 *
 * A tile whose councils have never been asked owes by definition: it has to be
 * probed before anything is known about what it is short of.
 */
async function owedFhrs(drawers, asked, { staleDays, limit = 2000 }) {
  const { rows } = await query(
    `select t.grid_key, t.min_lat, t.min_lng, t.max_lat, t.max_lng, t.fhrs_authorities
       from census_tiles t
      where t.state = 'done'
        and (t.fhrs_authorities is null
             or exists (
               select 1
                 from unnest(t.fhrs_authorities) c,
                      unnest($2::text[], $4::text[]) as w(sub, asked)
                where not exists (
                  select 1 from ground_counts g
                   where g.grid_key = t.grid_key and g.source = 'fhrs'
                     and g.subcategory = w.sub and g.contributor = c
                     and g.counted_at > now() - ($1 || ' days')::interval
                     -- The business types this drawer stands for, as they are
                     -- now. Changing which of the register's fifteen words a
                     -- drawer claims changes the number it should have.
                     and g.asked is not distinct from w.asked)))
      order by t.censused_at desc nulls last
      limit $3`, [String(staleDays), drawers, limit, asked]);
  return rows;
}

/**
 * The open-map check, over tiles the census has already done.
 *
 * Deliberately *after* Google rather than in the same pass, though the brief
 * asks for one pass: a tile the census has not finished has no number to be
 * checked against, and a free source that runs ahead of the paid one produces
 * exactly the misleading comparison this exists to prevent. The pass is
 * time-boxed like every other loop in this API, so a deploy costs at most the
 * tile in flight.
 */
export async function sweepOsm({ limit = 25, staleDays = 30, msBudget = 50_000, ask = overpassQuery } = {}) {
  const began = Date.now();
  // Only drawers the open map has a word for, and only the ones this tile is
  // actually short of — a tile that gained one new drawer costs one question,
  // not fifty.
  const { rows: active } = await query('select key from shelf_subcategories where active');
  const checkable = active.map((r) => r.key).filter((k) => OSM_GROUND[k]);
  const words = askedOsm();
  const tiles = await owedBy('osm', checkable, checkable.map((k) => words[k]), { staleDays, limit });

  let done = 0; let requests = 0; let drawers = 0; const problems = [];
  for (const t of tiles) {
    if (Date.now() - began > msBudget) break;
    const box = { minLat: Number(t.min_lat), minLng: Number(t.min_lng), maxLat: Number(t.max_lat), maxLng: Number(t.max_lng) };
    const out = await osmCountsForBox(box, { subcategories: t.owed, ask });
    requests += out.requests;
    drawers += Object.keys(out.counts).length;
    await noteGround({ gridKey: t.grid_key, source: 'osm', counts: out.counts, asked: askedOsm(), problem: out.problems[0] ?? null });
    if (out.problems.length) problems.push(...out.problems.slice(0, 2));
    done += 1;
  }
  return { tiles: done, drawers, requests, problems, left: Math.max(0, tiles.length - done) };
}

/**
 * The three questions the register is asked, in one object.
 *
 * A seam rather than three imports, so the sweep can be driven end to end in a
 * test. The fault Codex found — a boundary tile dated after one of its two
 * councils — is a fault in the *loop*, not in any one call, and a test that
 * could only reach the calls would have gone on passing through it.
 */
const REGISTER = { authorities: fhrsAuthorities, councilsFor: fhrsAuthoritiesFor, points: fhrsPoints };

/**
 * The register check, one authority at a time.
 *
 * An authority is downloaded once and every censused tile inside it is counted
 * from that download, which is why this is not a per-tile sweep: the rows are
 * the same rows, and asking for them once per tile would be asking a free
 * government service for the same twenty thousand kitchens four hundred times.
 *
 * A tile is counted by each of the councils that share it and is only dated
 * when all of them have been. Until then it stays in the sweep, holding a
 * partial count that says which councils it is made of — which is honest, where
 * a dated tile holding one borough of two is not.
 */
export async function sweepFhrs({ authorities = 2, staleDays = 30, msBudget = 50_000, register = REGISTER } = {}) {
  const began = Date.now();
  // The same per-drawer question the open map is asked. A tile is in this list
  // because some food drawer of it has no count, or has one a month old.
  const drawers = Object.keys(FHRS_GROUND);
  const askedNow = askedFhrs();
  const tiles = await owedFhrs(drawers, drawers.map((d) => askedNow[d]), { staleDays });
  if (!tiles.length) return { authorities: 0, tiles: 0, requests: 0, problems: [] };

  // The register's own list of councils. Empty is not fatal — the probe names
  // the council either way — but without the numeric id nothing can be
  // downloaded, so a pass that cannot get it says so rather than working
  // through every tile finding no id.
  let byCode;
  try {
    byCode = await register.authorities();
  } catch (err) {
    return { authorities: 0, tiles: 0, requests: 1, problems: [`the register would not list its councils: ${err.message}`] };
  }
  let requests = 1;
  const problems = [];
  const boxOf = (t) => ({ minLat: Number(t.min_lat), minLng: Number(t.min_lng), maxLat: Number(t.max_lat), maxLng: Number(t.max_lng) });

  // What each tile is waiting on, and what it already has. Both are read once
  // and kept here: the pass adds to them as it goes, and a tile is only dated
  // when it is waiting on nothing.
  const waiting = new Map();
  const have = new Map();
  for (const t of tiles) {
    waiting.set(t.grid_key, t.fhrs_authorities ? new Set(t.fhrs_authorities) : null);
    // A tile is only in this list because it has never been counted or because
    // its count is a month old. In the second case what it already holds is
    // exactly what is being refreshed, so it counts as having nothing: every
    // council is asked again and each replaces its own row. Treating the old
    // contributors as present is what made a stale tile re-date itself without
    // re-counting anything, so a ground count could never change after its
    // first sweep (Codex, 21 Sep 2026).
    // A tile owing a drawer because its count is a month old is being
    // refreshed, and the councils that took the old one have to be asked again;
    // each replaces its own row, so re-counting is safe. A tile owing a drawer
    // because the drawer is new keeps the councils that have answered for the
    // rest — `contributorsTo` only counts a council in when it has answered for
    // every drawer being asked.
    // Counted recently *and* by asking what we would ask now. A council whose
    // rows were written against a different set of business types has not
    // answered the question being asked, any more than a council that never
    // answered at all.
    have.set(t.grid_key, await contributorsTo(t.grid_key, 'fhrs', drawers, { staleDays, asked: drawers.map((d) => askedNow[d]) }));
  }

  /** Every council with a real share of this tile, asked once and written down. */
  const councilsFor = async (t) => {
    const known = waiting.get(t.grid_key);
    if (known) return known;
    const found = await register.councilsFor(boxOf(t));
    requests += 5;
    const codes = new Set(found.map((f) => f.code));
    for (const f of found) if (!byCode.has(f.code)) byCode.set(f.code, { id: null, name: f.name });
    await query('update census_tiles set fhrs_authorities = $2 where grid_key = $1', [t.grid_key, [...codes]]);
    waiting.set(t.grid_key, codes);
    return codes;
  };

  /** Nothing left to wait for: date it, and it drops out of the next sweep. */
  const settle = async (gridKey) => {
    const want = waiting.get(gridKey);
    const got = have.get(gridKey) ?? new Set();
    if (!want || [...want].some((c) => !got.has(c))) return false;
    await query(`update census_tiles set fhrs_at = now() where grid_key = $1`, [gridKey]);
    return true;
  };

  let done = 0;
  const settled = new Set();
  const attempted = new Set();

  while (done < authorities && Date.now() - began < msBudget) {
    // A tile still waiting on a council nobody has downloaded this pass.
    let next = null; let code = null;
    for (const t of tiles) {
      if (settled.has(t.grid_key)) continue;
      let want;
      try {
        want = await councilsFor(t);
      } catch (err) {
        // Asking which councils a tile is in is the one call that happens per
        // tile, so it is where a refusal is met first. It ends the pass with
        // the reason on the record; the loop comes round again in five minutes
        // and the register will have finished resting.
        problems.push(`${t.grid_key}: ${err.message}`);
        return { authorities: done, tiles: settled.size, waiting: tiles.length - settled.size, requests, problems };
      }
      if (Date.now() - began > msBudget) break;
      if (!want.size) {
        // Not one inspected kitchen within a mile of any of its five points.
        // That is a real answer about the ground — nought of ours here — and it
        // is written as one rather than left as "never checked".
        await noteGround({
          gridKey: t.grid_key, source: 'fhrs',
          counts: Object.fromEntries(Object.keys(FHRS_GROUND).map((k) => [k, 0])),
          asked: askedFhrs(), from: 'no council within a mile',
        });
        await query(`update census_tiles set fhrs_at = now() where grid_key = $1`, [t.grid_key]);
        settled.add(t.grid_key);
        continue;
      }
      const got = have.get(t.grid_key) ?? new Set();
      const missing = [...want].find((c) => !got.has(c) && !attempted.has(c));
      if (missing) { next = t; code = missing; break; }
      if (await settle(t.grid_key)) settled.add(t.grid_key);
    }
    if (!next) break;

    const authority = byCode.get(code);
    attempted.add(code);
    if (!authority?.id) {
      problems.push(`no register id for authority ${authority?.name ?? code}`);
      continue;
    }
    let points;
    try {
      ({ points } = await register.points(authority.id));
    } catch (err) {
      problems.push(`${authority.name}: ${err.message}`);
      continue;
    }
    done += 1;

    // Every tile this download can speak for, which is every tile that named
    // this council — including one it turns out to have no kitchens in. A
    // council that contributes nought has still contributed, and a tile that
    // did not record that would wait for it for ever.
    for (const t of tiles) {
      const want = waiting.get(t.grid_key);
      if (!want?.has(code)) continue;
      if ((have.get(t.grid_key) ?? new Set()).has(code)) continue;
      await noteGround({
        gridKey: t.grid_key, source: 'fhrs',
        counts: fhrsCountsInBox(points, boxOf(t)), asked: askedFhrs(), from: code,
      });
      have.get(t.grid_key).add(code);
      if (await settle(t.grid_key)) settled.add(t.grid_key);
    }
  }

  return { authorities: done, tiles: settled.size, waiting: tiles.length - settled.size, requests, problems };
}

/**
 * The ground count for an area, from the tiles it is made of.
 *
 * Summed over tiles rather than measured again, so it is the same arithmetic as
 * the census count beside it and the two are comparable by construction. A
 * subcategory nobody has checked gets a null, which reads as "nobody has
 * looked" — never as nought, which would make every unchecked drawer look
 * perfectly covered.
 */
export async function groundForArea(areaSlug) {
  const { rows } = await query(
    `select g.subcategory, g.source, sum(g.places)::int as places,
            -- Tiles, not rows: a tile shared by two councils has a row for each
            -- of them (migration 230), and counting rows would report twice the
            -- ground it was drawn from.
            count(distinct g.grid_key)::int as tiles, max(g.counted_at) as counted_at
       from ground_counts g
       join census_tiles t on t.grid_key = g.grid_key
      where upper($1) = any(t.outcodes)
      group by 1, 2`, [areaSlug]);
  const out = {};
  for (const r of rows) {
    out[r.subcategory] ??= { osm: null, fhrs: null, osmAt: null, fhrsAt: null, tiles: 0 };
    out[r.subcategory][r.source] = r.places;
    out[r.subcategory][r.source === 'osm' ? 'osmAt' : 'fhrsAt'] = r.counted_at;
    out[r.subcategory].tiles = Math.max(out[r.subcategory].tiles, r.tiles);
  }
  return out;
}

/**
 * Put the free counts onto the board's own rows.
 *
 * `area_counts.osm_count` and `fhrs_count` are where every screen already looks
 * for this, and they have been null since the table was made. Filled from the
 * tiles, never by a second measurement — see `groundForArea`.
 */
export async function rollUpGround(areaSlug) {
  const ground = await groundForArea(areaSlug);
  let written = 0;
  for (const [subcategory, g] of Object.entries(ground)) {
    const { rowCount } = await query(
      `update area_counts
          set osm_count = coalesce($3, osm_count), osm_at = coalesce($4, osm_at),
              fhrs_count = coalesce($5, fhrs_count), fhrs_at = coalesce($6, fhrs_at)
        where area_slug = $1 and subcategory = $2`,
      [areaSlug, subcategory, g.osm, g.osmAt, g.fhrs, g.fhrsAt]);
    written += rowCount;
  }
  return { written };
}
