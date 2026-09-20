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
async function fhrsPage(path) {
  const res = await fetch(`${FHRS_ROOT}${path}`, { headers: FHRS_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`FHRS ${res.status}`);
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
 * Which authority a box is in, at the cost of one row.
 *
 * Asked of the register rather than worked out from our own district table,
 * because the id needed is the register's own and the two lists disagree about
 * boundaries — a tile is assigned to whichever authority the nearest inspected
 * kitchen belongs to, which is the register's own answer to the question.
 */
export async function fhrsAuthorityFor(box) {
  const lat = (box.minLat + box.maxLat) / 2;
  const lng = (box.minLng + box.maxLng) / 2;
  const data = await fhrsPage(`/Establishments?longitude=${lng}&latitude=${lat}&maxDistanceLimit=3&pageSize=1`);
  const first = data.establishments?.[0];
  return first ? { code: String(first.LocalAuthorityCode), name: first.LocalAuthorityName } : null;
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
export async function noteGround({ gridKey, source, counts, asked = {}, problem = null }) {
  const keys = Object.keys(counts);
  if (!keys.length) return { written: 0 };
  const caveats = source === 'osm' ? OSM_GROUND : FHRS_GROUND;
  const values = keys.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4}::int,$${i * 6 + 5},$${i * 6 + 6})`).join(',');
  const params = keys.flatMap((key) => [
    gridKey, source, key, counts[key], asked[key] ?? null, caveats[key]?.caveat ?? null,
  ]);
  await query(
    `insert into ground_counts (grid_key, source, subcategory, places, asked, caveat)
     values ${values}
     on conflict (grid_key, source, subcategory) do update
        set places = excluded.places, asked = excluded.asked, caveat = excluded.caveat,
            counted_at = now(), problem = null`,
    params,
  );
  if (problem) {
    await query('update ground_counts set problem = $3 where grid_key = $1 and source = $2', [gridKey, source, problem]);
  }
  await query(
    `update census_tiles set ${source === 'osm' ? 'osm_at' : 'fhrs_at'} = now() where grid_key = $1`, [gridKey],
  );
  return { written: keys.length };
}

/** How the count was asked, in the words the source itself uses. */
const askedOsm = () => Object.fromEntries(Object.entries(OSM_GROUND).map(([k, v]) => [k, v.selectors.join(' ')]));
const askedFhrs = () => Object.fromEntries(Object.entries(FHRS_GROUND)
  .map(([k, v]) => [k, v.types.map((t) => FHRS_TYPE_NAMES[t] ?? t).join(', ')]));

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
export async function sweepOsm({ limit = 25, staleDays = 30, msBudget = 50_000 } = {}) {
  const began = Date.now();
  const { rows: tiles } = await query(
    `select grid_key, min_lat, min_lng, max_lat, max_lng
       from census_tiles
      where state = 'done'
        and (osm_at is null or osm_at < now() - ($2 || ' days')::interval)
      order by censused_at desc nulls last
      limit $1`, [limit, String(staleDays)]);
  let done = 0; let requests = 0; const problems = [];
  for (const t of tiles) {
    if (Date.now() - began > msBudget) break;
    const box = { minLat: Number(t.min_lat), minLng: Number(t.min_lng), maxLat: Number(t.max_lat), maxLng: Number(t.max_lng) };
    const out = await osmCountsForBox(box);
    requests += out.requests;
    await noteGround({ gridKey: t.grid_key, source: 'osm', counts: out.counts, asked: askedOsm(), problem: out.problems[0] ?? null });
    if (out.problems.length) problems.push(...out.problems.slice(0, 2));
    done += 1;
  }
  return { tiles: done, requests, problems, left: Math.max(0, tiles.length - done) };
}

/**
 * The register check, one authority at a time.
 *
 * An authority is downloaded once and every censused tile inside it is counted
 * from that download, which is why this is not a per-tile sweep: the rows are
 * the same rows, and asking for them once per tile would be asking a free
 * government service for the same twenty thousand kitchens four hundred times.
 */
export async function sweepFhrs({ authorities = 2, staleDays = 30, msBudget = 50_000 } = {}) {
  const began = Date.now();
  const { rows: tiles } = await query(
    `select grid_key, min_lat, min_lng, max_lat, max_lng
       from census_tiles
      where state = 'done'
        and (fhrs_at is null or fhrs_at < now() - ($1 || ' days')::interval)
      order by censused_at desc nulls last
      limit 2000`, [String(staleDays)]);
  if (!tiles.length) return { authorities: 0, tiles: 0, requests: 0, problems: [] };

  const byCode = await fhrsAuthorities().catch(() => new Map());
  let requests = 1;
  const problems = [];
  const counted = new Set();
  let authoritiesDone = 0;

  while (authoritiesDone < authorities && Date.now() - began < msBudget) {
    const next = tiles.find((t) => !counted.has(t.grid_key));
    if (!next) break;
    const box = (t) => ({ minLat: Number(t.min_lat), minLng: Number(t.min_lng), maxLat: Number(t.max_lat), maxLng: Number(t.max_lng) });
    let where;
    try {
      where = await fhrsAuthorityFor(box(next));
      requests += 1;
    } catch (err) {
      problems.push(`${next.grid_key}: ${err.message}`);
      counted.add(next.grid_key);
      continue;
    }
    const authority = where && byCode.get(where.code);
    if (!authority) {
      // No inspected kitchen within three miles of the middle of the tile. That
      // is a real answer about the ground — nought of ours here — and it is
      // written as one rather than left as "never checked".
      await noteGround({
        gridKey: next.grid_key, source: 'fhrs',
        counts: Object.fromEntries(Object.keys(FHRS_GROUND).map((k) => [k, 0])),
        asked: askedFhrs(),
      });
      counted.add(next.grid_key);
      continue;
    }
    let points;
    try {
      ({ points } = await fhrsPoints(authority.id));
    } catch (err) {
      problems.push(`${authority.name}: ${err.message}`);
      counted.add(next.grid_key);
      continue;
    }
    // Every tile this download can answer for, not only the one that found it.
    for (const t of tiles) {
      if (counted.has(t.grid_key)) continue;
      const counts = fhrsCountsInBox(points, box(t));
      const any = Object.values(counts).some((n) => n > 0);
      // A tile with nothing of this authority's in it is a tile this download
      // cannot speak for — it belongs to a neighbour, and saying nought would
      // be this authority answering for ground it does not cover.
      if (!any) continue;
      await noteGround({ gridKey: t.grid_key, source: 'fhrs', counts, asked: askedFhrs() });
      counted.add(t.grid_key);
    }
    counted.add(next.grid_key);
    authoritiesDone += 1;
  }
  return { authorities: authoritiesDone, tiles: counted.size, requests, problems };
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
            count(*)::int as tiles, max(g.counted_at) as counted_at
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
