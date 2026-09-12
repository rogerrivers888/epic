/**
 * Lookup — what every source has for one place, and what each record holds.
 *
 * Owner, 12 Sep 2026: "I want to be able to enter a place, for example, my
 * home, Sunningdale… set the driving distance as 30 minutes… see activities
 * and food and drink… see the numbers by provider… click on any one of those
 * numbers to view the actual data… click on one of those activities to then
 * see the actual data that we get… literally the fields that we get for that
 * data and the data that's actually returned in those fields."
 *
 * Two reads. `GET /api/admin/lookup` resolves the place, runs the same
 * fan-out every screen runs — through the same cache, so a second look at the
 * same ring costs nothing — lays our own three pools beside it (the atlas,
 * the postcode sweep and the owned records), fences the lot on travel time,
 * and answers with every place and which sources carry it. The screen makes
 * the numbers from that. `GET /api/admin/lookup/place` is one of those places
 * opened: the provider records exactly as they arrived, one per source, and
 * the resolved row Epic made of them.
 *
 * Behind the admin door with the rest of the back office, and `view_library`
 * to read: this is the atlas's own inspection glass, not a household screen.
 * Every fetch is attributed in `provider_calls` like any other search; a hit
 * on the cache bills nobody.
 */

import express from 'express';
import { requires } from '../access.js';
import { enabledSources, recordsOf } from '../sources/index.js';
import { googleSource } from '../sources/google.js';
import { tripadvisorSource } from '../sources/tripadvisor.js';
import { googleMatchFor, tripadvisorMatchFor, matchesFor } from '../sources/providerMatch.js';
import { curate, band } from '../sources/curate.js';
import { claimPlace, enrich } from '../sources/own.js';
import { crowdBand, countBand, score } from '../domain/scoring.js';
import { recordFor } from '../repositories/ownedPlaces.js';
import * as providerCalls from '../repositories/providerCalls.js';
import { searchCached } from '../sources/cache.js';
import { geocode, providerCalls as geocodeCalls } from '../sources/geocode.js';
import { searchAreas, providerCalls as areaCalls } from '../sources/areas.js';
import { whySourceFailed, sourceName } from '../sources/why.js';
import { travelMode } from '../domain/travel.js';
import { shelvesForAtlas, shelvesForVenue } from '../domain/moods.js';
import { fold, kindOf, priorityOf, reachKm, tally, total, withinReach, RING_CAP_KM } from '../domain/lookup.js';
import { rules as shelfRules } from '../repositories/shelfRules.js';
import { taxonomy } from '../repositories/shelfTaxonomy.js';
import { publishedNear } from '../repositories/library.js';
import { foodNear } from '../repositories/scout.js';
import { recordsNear } from '../repositories/ownedPlaces.js';
import * as visitsRepo from '../repositories/visits.js';
import { currentHousehold } from './household.js';

export const router = express.Router();

const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });

/** The three pools that are ours, as the screen names them beside the rented sources. */
const OWNED = [
  { key: 'atlas', label: 'The atlas', note: 'Attractions by county, researched from Wikidata and Wikipedia' },
  { key: 'sweep', label: 'The sweep', note: 'The postcode sweep’s restaurants, cafés and pubs' },
  { key: 'own', label: 'Owned records', note: 'Places a household has claimed, researched from the open web' },
];

/** How many of one owned pool a ring may hold before the answer has to say it was cut. */
const POOL_LIMIT = 5000;

/** The pools that are ours, by key. */
const OWNED_KEYS = new Set(['atlas', 'sweep', 'own']);

/**
 * Google's two figures for a place we asked about by name, held in memory
 * for a few hours so the list can be ranked — never written down, because
 * they are rented. The band is what may be kept, and `curate` keeps it.
 */
const figures = new Map();
const FIGURES_TTL_MS = 6 * 3600_000;
const holdFigures = (ref, f) => { if (f && (f.rating != null || f.ratingCount != null)) figures.set(ref, { ...f, at: Date.now() }); };
const heldFigures = (ref) => { const f = figures.get(ref); return f && Date.now() - f.at < FIGURES_TTL_MS ? f : null; };

/** The owner's ceiling for Tripadvisor on this screen: locations billed, this month, for populating a ring. */
const TRIPADVISOR_CAP = Number(process.env.EPIC_LOOKUP_TRIPADVISOR_CAP || 120);
const tripadvisorUsed = (householdId) => providerCalls.unitsOfPurpose(householdId, 'tripadvisor', 'admin.lookup.%', 'tripadvisor');

/**
 * The rented place sources: not events, and never the scout, which reads the
 * web for money. Every one that has a key is *listed*, so nothing is silently
 * absent — but an opt-in source (Tripadvisor bills per place returned) is not
 * *asked* here: enabling a paid source is the owner's call, not a screen's,
 * and the row says "not asked" rather than 0.
 */
const rentedSources = () => enabledSources({ includeOptIn: true }).filter((s) => !s.events && s.key !== 'scout');
const asked = (s) => !s.optIn;

/** "51.39,-0.63" → a point, or null. */
function point(text) {
  const m = /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/.exec(String(text || ''));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Where the owner means.
 *
 * A pair of coordinates is taken as it is. A word goes to the area typeahead
 * first — "Sunningdale" is a village, and Photon knows it as one — and then,
 * for a postcode or a street, to Nominatim, which knows those. Both are
 * biased to the household's home so the Berkshire Sunningdale beats the one
 * in Harare. Each real request out is written to the ledger.
 */
async function whereIs(q, household) {
  const given = point(q);
  if (given) return { label: q.trim(), where: null, ...given, how: 'point' };
  const home = household.home_lat != null ? { lat: household.home_lat, lng: household.home_lng } : null;
  const before = { osm: geocodeCalls(), photon: areaCalls() };
  let hit = null;
  let how = null;
  try {
    [hit] = await searchAreas(q, { limit: 1, near: home });
    how = 'area';
  } catch { hit = null; }
  if (!hit) {
    try { [hit] = await geocode(q, { limit: 1, near: home }); how = 'address'; } catch { hit = null; }
  }
  const made = [
    areaCalls() > before.photon ? 'photon' : null,
    geocodeCalls() > before.osm ? 'osm-nominatim' : null,
  ].filter(Boolean);
  for (const provider of made) await visitsRepo.recordProviderCall(household.id, provider, 'admin.lookup.where');
  if (!hit) return null;
  return {
    label: hit.label ?? hit.name ?? q,
    where: hit.where ?? hit.formatted ?? hit.displayName ?? null,
    kind: hit.kindWord ?? hit.kind ?? null,
    lat: hit.lat, lng: hit.lng, how,
  };
}

/** The request's three settings, checked. */
function settingsOf(query) {
  const q = String(query.q ?? '').trim();
  if (!q) throw bad('Say where to look: a town, a postcode or "lat,lng".', 'q_required');
  const minutes = Math.min(180, Math.max(5, Math.round(Number(query.minutes) || 30)));
  const mode = travelMode(query.mode);
  return { q, minutes, mode };
}

/** What a resolved venue is on the screen: which half, which shelf, which drawer. */
function itemOfVenue(v, taught, tax) {
  const filed = shelvesForVenue(v, taught, tax.vocab);
  return {
    ref: `${v.source}:${v.sourcePlaceId}`,
    name: v.name,
    kind: kindOf(v.category),
    category: v.category,
    shelf: filed.category ?? filed.shelves?.[0] ?? null,
    subcategory: filed.subcategory ?? null,
    sources: [...(v.contributingSources ?? [v.source])],
    lat: v.lat, lng: v.lng,
    rating: v.rating ?? null,
    ratingCount: v.ratingCount ?? null,
    website: v.website ?? null,
    records: recordsOf(v).map((r) => ({ source: r.source, fields: r })),
    resolved: v,
  };
}

function itemOfAtlas(a, taught, tax) {
  const ref = a.osm_ref ? `osm:${a.osm_ref}` : `wikidata:${a.wikidata_id}`;
  const shelf = shelvesForAtlas({ ref, category: a.category, kinds: a.kinds ?? [] }, taught, tax.vocab);
  return {
    ref, name: a.name, kind: 'activities', category: 'attraction',
    shelf: shelf.category ?? shelf.shelves?.[0] ?? null, subcategory: shelf.subcategory ?? null,
    sources: ['atlas'], lat: a.lat, lng: a.lng, rating: null, ratingCount: null, website: a.website ?? null,
    records: [{ source: 'atlas', fields: a }],
    resolved: null,
  };
}

function itemOfSweep(f) {
  return {
    ref: f.venue_ref, name: f.name, kind: 'food',
    category: EATING_OF_SWEEP.has(f.category) ? f.category : 'restaurant',
    shelf: 'food', subcategory: f.cuisine_group ?? null,
    sources: ['sweep'], lat: f.lat, lng: f.lng, rating: null, ratingCount: null, website: f.website ?? null,
    records: [{ source: 'sweep', fields: f }],
    resolved: null,
  };
}
const EATING_OF_SWEEP = new Set(['restaurant', 'cafe', 'pub', 'bar', 'bakery', 'takeaway']);

function itemOfRecord(r, taught, tax) {
  const [source, ...rest] = String(r.venue_ref).split(':');
  const category = r.category ?? 'attraction';
  const filed = shelvesForVenue({ source, sourcePlaceId: rest.join(':'), category, experiences: r.experiences ?? [], styles: [] }, taught, tax.vocab);
  return {
    ref: r.venue_ref, name: r.name, kind: kindOf(category), category,
    shelf: filed.category ?? filed.shelves?.[0] ?? null, subcategory: filed.subcategory ?? null,
    sources: ['own'], lat: r.lat, lng: r.lng, rating: null, ratingCount: null, website: r.website ?? null,
    records: [{ source: 'own', fields: r }],
    resolved: null,
  };
}

/**
 * The whole look: the place, the ring, every source's answer, ours folded in,
 * and the fence. Both endpoints run it; the second is a cache hit on the
 * search and a few milliseconds on our own tables.
 */
async function runLookup({ q, minutes, mode }, household) {
  const started = Date.now();
  const place = await whereIs(q, household);
  if (!place) throw Object.assign(new Error(`Nowhere called "${q}" could be found.`), { status: 404, code: 'not_found' });
  const centre = { lat: place.lat, lng: place.lng };
  const radiusKm = reachKm(mode, minutes, { at: centre });
  // The minutes reach further than any source will answer: said, not hidden.
  const capped = radiusKm >= RING_CAP_KM && reachKm(mode, minutes, { at: centre, cap: 1000 }) > RING_CAP_KM;

  const rented = rentedSources();
  // No deadline: this is somebody looking at what the sources hold, not a
  // screen waiting on a spinner, so OpenStreetMap is waited for properly.
  const r = await searchCached({
    center: centre, radiusKm, categories: [], query: '', includeEvents: false,
    sources: rented.filter(asked).map((s) => s.key), deadlineMs: null,
  });
  if (r.fetched) await visitsRepo.recordProviderCall(household.id, r.sourcesQueried.join('+') || 'none', 'admin.lookup', r.units);

  // Our own pools are read whole, up to a ceiling no ring in Britain reaches
  // today — and if one ever does, the answer says the pool was cut rather
  // than letting a screen built to measure volume report a gap that is only
  // a page size (Codex, 12 Sep 2026).
  const [taught, tax, atlas, sweep, own] = await Promise.all([
    shelfRules(), taxonomy(),
    publishedNear({ lat: centre.lat, lng: centre.lng, km: radiusKm, limit: POOL_LIMIT }),
    foodNear({ lat: centre.lat, lng: centre.lng, km: radiusKm, limit: POOL_LIMIT }),
    recordsNear(centre.lat, centre.lng, radiusKm, POOL_LIMIT),
  ]);
  const truncated = { atlas: atlas.length >= POOL_LIMIT, sweep: sweep.length >= POOL_LIMIT, own: own.length >= POOL_LIMIT };

  // The rented answer first, ours folded into it: a place the sweep keeps
  // that Google also returned is one place carrying both.
  const all = [];
  for (const v of r.venues) if (v.lat != null && v.lng != null && v.name) fold(all, itemOfVenue(v, taught, tax));
  for (const a of atlas) if (a.lat != null && a.lng != null) fold(all, itemOfAtlas(a, taught, tax));
  for (const f of sweep) if (f.lat != null && f.lng != null) fold(all, itemOfSweep(f));
  for (const o of own) fold(all, itemOfRecord(o, taught, tax));

  // What the joins already hold: a place matched to Google or Tripadvisor by
  // name carries that source too, so the columns say who *knows* a place and
  // not only who happened to return it in this search. And the figures held
  // from a ranking run go back on their places, so the list can be ordered.
  const refs = all.map((i) => i.ref);
  const [atGoogle, atTripadvisor] = await Promise.all([matchesFor(refs, 'google'), matchesFor(refs, 'tripadvisor')]);
  for (const i of all) {
    if (atGoogle.has(i.ref) && !i.sources.includes('google')) i.sources.push('google');
    if (atTripadvisor.has(i.ref) && !i.sources.includes('tripadvisor')) i.sources.push('tripadvisor');
    const f = heldFigures(i.ref);
    if (f && i.rating == null) { i.rating = f.rating; i.ratingCount = f.ratingCount; }
    i.owned = i.sources.some((k) => OWNED_KEYS.has(k));
    i.curated = Boolean(i.records.find((r) => r.source === 'own')?.fields?.curation);
    i.priority = priorityOf(i.rating, i.ratingCount);
  }
  const kept = withinReach(all, centre, mode, minutes);
  const keys = [...rented.map((s) => s.key), ...OWNED.map((o) => o.key)];
  const returned = tally(all, keys);
  const inReach = tally(kept, keys);
  const failed = new Map((r.degraded ?? []).map((d) => [d.source, d]));

  return {
    place, mode, minutes, radiusKm, capped, estimated: true,
    tripadvisor: { cap: TRIPADVISOR_CAP, used: await tripadvisorUsed(household.id) },
    // Distinct places, before and inside the fence: the "Everything" row.
    totals: { returned: total(all), kept: total(kept) },
    sources: [
      ...rented.map((s) => {
        // A source's own reach may be narrower than the ring (OpenStreetMap
        // stops at 25 km), and a thin count from it is then not a gap in the
        // data but a ring it was never asked about — said per source.
        // The reach the source was asked for. OpenStreetMap may answer from
        // less: its adapter halves the ring and tries again when Overpass
        // times out, and which ring finally answered is not reported back
        // through the fan-out — so its note says so rather than this
        // figure pretending to be exact.
        const reach = s.maxRadiusKm != null ? Math.min(radiusKm, s.maxRadiusKm) : radiusKm;
        return {
          key: s.key, label: s.label, layer: 'rented', note: null,
          asked: asked(s), reachKm: reach, capped: reach < radiusKm,
          returned: returned[s.key], kept: inReach[s.key],
          failed: failed.has(s.key)
            ? { why: whySourceFailed(s.key, failed.get(s.key).error), error: failed.get(s.key).error, slow: Boolean(failed.get(s.key).slow) }
            : null,
        };
      }),
      ...OWNED.map((o) => ({
        key: o.key, label: o.label, layer: 'owned', note: o.note,
        asked: true, reachKm: radiusKm, capped: false,
        returned: returned[o.key], kept: inReach[o.key],
        failed: truncated[o.key] ? { why: `${o.label} holds more than ${POOL_LIMIT.toLocaleString()} places in this ring; only the nearest ${POOL_LIMIT.toLocaleString()} were read.`, error: 'pool_truncated', slow: false } : null,
      })),
    ],
    taxonomy: {
      categories: tax.active.categories.map((c) => ({ key: c.key, label: c.label })),
      subcategories: tax.active.subcategories.map((s) => ({ key: s.key, label: s.label, category: s.category_key })),
    },
    items: kept,
    cached: Boolean(r.cached),
    fetchedAt: r.fetchedAt ?? null,
    tookMs: Date.now() - started,
  };
}

/** The list: everything within reach, and which sources carry each place. Records stay behind. */
router.get('/', requires('view_library'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const out = await runLookup(settingsOf(req.query), household);
    res.json({
      ...out,
      items: out.items.map(({ records, resolved, ...item }) => ({ ...item, recordCount: records.length })),
    });
  } catch (err) { next(err); }
});

/**
 * One place opened: each provider's record exactly as it arrived, and the row
 * Epic resolved from them. Same three settings as the list, so the search is
 * the same search and the cache answers it.
 */
router.get('/place', requires('view_library'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.', 'ref_required');
    const out = await runLookup(settingsOf(req.query), household);
    const item = out.items.find((i) => i.ref === ref);
    if (!item) return res.status(404).json({ error: 'not_found', message: 'That place is not in this search any more — the ring may have moved.' });
    const { records, resolved, ...summary } = item;
    res.json({
      place: out.place, mode: out.mode, minutes: out.minutes,
      item: summary,
      records: records.map((r) => ({ source: r.source, label: OWNED.find((o) => o.key === r.source)?.label ?? sourceName(r.source), fields: r.fields })),
      resolved,
    });
  } catch (err) { next(err); }
});

/**
 * Side by side: what we own for a place, what Google has for it, and what
 * Tripadvisor has when we hold its join.
 *
 * Owner, 12 Sep 2026: "When I click on something that's owned… what I would
 * like to see is the data that's owned on one side, and then the Google data
 * on the other. You should call the Google API, ask it for the data for this
 * record… so I can just compare and see how rich our data is and where the
 * holes in our data are." And later the same day: "I'd like to try out
 * TripAdvisor as well, just to see how rich we can get this data."
 *
 * Ours is the owned record when there is one, else the atlas row or the
 * sweep row. Google's is one Place Details call for this record — by its own
 * identifier when we hold one, otherwise matched by name and distance the way
 * the atlas matches (`googleRefFor`, which remembers the join and never the
 * content). Tripadvisor's is its detail plus three reviews, only for a place
 * a ranking run has already joined (two billed locations a view). Every
 * detail is held in memory for a few hours so flipping between places does
 * not bill twice, and none of it is written down: rented.
 *
 * The rows line up the fields that mean the same thing under three names,
 * then list what only one column has. A blank cell is a hole, and the point.
 */
const PAIRS = [
  ['name', 'name', 'name'], ['category', 'category', 'category'], ['address', 'address', 'address'], ['lat', 'lat', 'lat'], ['lng', 'lng', 'lng'],
  ['website', 'website', 'website'], ['phone', 'phone', 'ta_phone'], ['opening_hours', 'openingHours', 'openingHours'], ['price_range', 'priceLevel', 'priceLevel'],
  ['cuisines', 'cuisines', 'cuisines'], ['experiences', 'experiences', 'experiences'], ['dietary_options', 'dietaryOptions', null],
  ['good_for_children', 'goodForChildren', 'goodForChildren'], ['summary', 'summary', 'ta_description'], ['image_url', 'photos', null],
  ['booking_url', 'reservable', null], ['menu_url', null, null], ['menu_label', null, null], ['email', null, 'ta_email'], ['socials', null, null],
  ['accessibility', null, null], ['postcode', null, null], ['osm_ref', null, null], ['wikidata_id', null, null], ['wikipedia_url', null, null],
  ['curation', null, null], ['crowd_band', 'rating', 'rating'], ['count_band', 'ratingCount', 'ratingCount'], ['epic_score', null, 'ta_ranking_data'],
  [null, 'aiSummary', null], [null, 'reviewSummary', null], [null, 'reviews', 'reviews'], [null, 'openNow', null], [null, 'mapsUrl', 'externalUrl'], [null, 'menuForChildren', null],
  [null, null, 'ta_awards'], [null, null, 'ta_subratings'], [null, null, 'ta_trip_types'], [null, null, 'ta_review_rating_count'], [null, null, 'labels'],
];
const COLS = ['ours', 'google', 'tripadvisor'];
const OUR_LABEL = { own: 'Owned record', atlas: 'The atlas', sweep: 'The sweep' };
const details = new Map();
const DETAIL_TTL_MS = 6 * 3600_000;
// Two opens of the same place before the first has answered share one call.
const detailsInFlight = new Map();

/**
 * One detail call for this identifier at this provider, whatever is asking.
 * The ledger is written whether or not the provider answered: a call that
 * timed out after it reached them was still a call (Codex, 12 Sep 2026).
 */
async function detailFor(provider, id, householdId) {
  const key = `${provider}:${id}`;
  const held = details.get(key);
  if (held && Date.now() - held.at < DETAIL_TTL_MS) return held.detail;
  if (detailsInFlight.has(key)) return detailsInFlight.get(key);
  const run = (async () => {
    const meter = {};
    try {
      const raw = provider === 'google' ? await googleSource.get(id, { meter }) : await tripadvisorSource.get(id, { meter });
      // A photo is a signed proxy reference here, not a picture: what the
      // comparison wants is that there are three and who took them.
      const detail = { ...raw, photos: (raw.photos ?? []).map((ph) => ({ attribution: ph.attribution ?? null })) };
      details.set(key, { at: Date.now(), detail });
      while (details.size > 300) details.delete(details.keys().next().value);
      return detail;
    } finally {
      if (Object.keys(meter).length) await visitsRepo.recordProviderCall(householdId, provider, 'admin.lookup.compare', meter).catch(() => null);
      detailsInFlight.delete(key);
    }
  })();
  detailsInFlight.set(key, run);
  return run;
}

const blank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** The rows: the pairs first, then what only one column has, each cell carrying which key it came from. */
function lineUp(fields) {
  const rows = [];
  const used = { ours: new Set(), google: new Set(), tripadvisor: new Set() };
  for (const trio of PAIRS) {
    const keys = Object.fromEntries(COLS.map((c, n) => [c, trio[n]]));
    const present = COLS.some((c) => keys[c] && fields[c] && keys[c] in fields[c]);
    if (!present) continue;
    const cells = {};
    for (const c of COLS) { if (keys[c] && fields[c] && keys[c] in fields[c]) cells[c] = fields[c][keys[c]]; if (keys[c]) used[c].add(keys[c]); }
    rows.push({ key: trio.find(Boolean), keys, cells });
  }
  for (const c of COLS) {
    for (const k of Object.keys(fields[c] ?? {})) {
      if (used[c].has(k)) continue;
      rows.push({ key: k, keys: { [c]: k }, cells: { [c]: fields[c][k] } });
    }
  }
  return rows;
}

router.get('/compare', requires('view_library'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.', 'ref_required');
    const out = await runLookup(settingsOf(req.query), household);
    const item = out.items.find((i) => i.ref === ref);
    if (!item) return res.status(404).json({ error: 'not_found', message: 'That place is not in this search any more — the ring may have moved.' });
    const { records, resolved, ...summary } = item;

    // Ours: the owned record first, because it is the one researched from the
    // open web; the atlas or the sweep if that is all we hold.
    const mine = ['own', 'atlas', 'sweep'].map((k) => records.find((r) => r.source === k)).find(Boolean) ?? null;
    const columns = [{ key: 'ours', label: mine ? OUR_LABEL[mine.source] ?? mine.source : 'Ours', note: mine ? null : 'nothing owned for this place yet', fields: mine?.fields ?? null }];

    // Google: by identifier when we hold one, else the atlas's own match.
    let google = { key: 'google', label: 'Google', note: null, fields: null, id: null, how: 'none' };
    if (!googleSource.enabled()) {
      google.note = 'Google is not switched on here.';
    } else {
      let id = ref.startsWith('google:') ? ref.slice('google:'.length) : records.find((r) => r.source === 'google')?.fields?.sourcePlaceId ?? null;
      let how = id ? 'by its Google identifier' : null;
      let unreachable = null;
      if (!id) {
        // A miss is "Google has no such place"; a failure is "Google could not
        // be asked", and the two must not read the same (Codex, 12 Sep 2026).
        try {
          const m = await googleMatchFor({ venueRef: ref, name: item.name, lat: item.lat, lng: item.lng, householdId: household.id, strict: true });
          id = m?.id ?? null;
          if (m && !m.held) holdFigures(ref, m);
          how = id ? 'matched by name and distance' : null;
        } catch (err) {
          // Only the provider's own failure is said in plain words; anything
          // else — the database refusing the remembered match — is a fault of
          // ours and reaches the error handler (Codex, 12 Sep 2026).
          if (err?.provider !== 'google') throw err;
          unreachable = whySourceFailed('google', err);
        }
      }
      if (unreachable) google.note = unreachable;
      else if (id) {
        try { google = { ...google, id, how, fields: await detailFor('google', id, household.id), note: `${how} · fetched live` }; }
        catch (err) { google = { ...google, id, how, note: whySourceFailed('google', err) }; }
      } else google.note = 'Nothing at Google reads as this place: no name near enough, close enough.';
    }
    columns.push(google);

    // Tripadvisor: only where a ranking run has already made the join. A view
    // is two billed locations, so it is not made on the off-chance.
    let ta = { key: 'tripadvisor', label: 'Tripadvisor', note: null, fields: null, id: null, how: 'none' };
    if (!tripadvisorSource.enabled()) ta.note = 'Tripadvisor is not switched on here.';
    else {
      const id = ref.startsWith('tripadvisor:') ? ref.slice('tripadvisor:'.length) : (await matchesFor([ref], 'tripadvisor')).get(ref) ?? null;
      if (!id) ta.note = 'Not joined yet — run "Ask Tripadvisor" on the not-owned list to match it by name.';
      else {
        try { ta = { ...ta, id, how: 'matched by name and distance', fields: await detailFor('tripadvisor', id, household.id), note: 'matched by name and distance · fetched live · two locations billed a view' }; }
        catch (err) { ta = { ...ta, id, note: whySourceFailed('tripadvisor', err) }; }
      }
    }
    columns.push(ta);

    const rows = lineUp(Object.fromEntries(columns.map((c) => [c.key, c.fields])));
    for (const c of columns) {
      c.of = rows.filter((r) => r.keys[c.key]).length;
      c.filled = rows.filter((r) => r.keys[c.key] && !blank(r.cells[c.key])).length;
    }
    res.json({ place: out.place, mode: out.mode, minutes: out.minutes, item: summary, columns, rows });
  } catch (err) { next(err); }
});

/**
 * The runs that make the not-owned list rankable, one page at a time so a
 * request never outlives the proxy. The screen calls again while `remaining`
 * is above nought.
 */
const notOwnedOf = (out, kind) => out.items.filter((i) => i.kind === kind && !i.owned);

/**
 * POST /rate — Google's rating and count for the not-owned places that have
 * none: one name search each, or the cheap two-field detail where we already
 * hold the identifier. The figures are held in memory for the ranking and
 * never written; the identifier is remembered (owner, 12 Sep 2026: "using
 * those two numbers, the number of stars and the number of reviews, we can
 * prioritise").
 */
router.post('/rate', requires('view_library'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const settings = settingsOf(req.body ?? {});
    const kind = req.body?.kind === 'food' ? 'food' : 'activities';
    const limit = Math.min(60, Math.max(1, Number(req.body?.limit) || 30));
    if (!googleSource.enabled()) return res.status(409).json({ error: 'google_off', message: 'Google is not switched on here.' });
    const out = await runLookup(settings, household);
    const wanting = notOwnedOf(out, kind).filter((i) => i.rating == null).sort((a, b) => a.distanceKm - b.distanceKm);
    const page = wanting.slice(0, limit);
    let rated = 0; let matched = 0; let missed = 0; let failed = 0;
    for (const i of page) {
      try {
        const m = await googleMatchFor({ venueRef: i.ref, name: i.name, lat: i.lat, lng: i.lng, householdId: household.id, strict: true });
        if (!m) { missed += 1; continue; }
        matched += 1;
        let f = m.held ? null : m;
        if (!f) {
          const meter = {};
          try { f = await googleSource.rating(m.id, { meter }); }
          finally { if (Object.keys(meter).length) await visitsRepo.recordProviderCall(household.id, 'google', 'admin.lookup.rate', meter).catch(() => null); }
        }
        if (f && (f.rating != null || f.ratingCount != null)) { holdFigures(i.ref, f); rated += 1; }
      } catch (err) {
        if (err?.provider !== 'google') throw err;
        failed += 1;
      }
    }
    res.json({ kind, looked: page.length, matched, rated, missed, failed, remaining: Math.max(0, wanting.length - page.length) });
  } catch (err) { next(err); }
});

/**
 * POST /tripadvisor — join the not-owned places to Tripadvisor by name, best
 * first, under the owner's cap for the month (12 Sep 2026: "make sure you
 * don't use more than 120 of the TripAdvisor calls just to populate the
 * Sunningdale data"). Every location Terra returns is billed and counted,
 * and the run stops before the next lookup could pass the cap.
 */
router.post('/tripadvisor', requires('view_library'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const settings = settingsOf(req.body ?? {});
    const kind = req.body?.kind === 'food' ? 'food' : 'activities';
    const limit = Math.min(40, Math.max(1, Number(req.body?.limit) || 20));
    if (!tripadvisorSource.enabled()) return res.status(409).json({ error: 'tripadvisor_off', message: 'Tripadvisor is not switched on here.' });
    const out = await runLookup(settings, household);
    let used = await tripadvisorUsed(household.id);
    const joined = await matchesFor(notOwnedOf(out, kind).map((i) => i.ref), 'tripadvisor');
    const wanting = notOwnedOf(out, kind).filter((i) => !joined.has(i.ref) && !i.sources.includes('tripadvisor')).sort((a, b) => b.priority - a.priority);
    const page = wanting.slice(0, limit);
    let matched = 0; let missed = 0; let looked = 0; let stopped = false;
    for (const i of page) {
      // A lookup may return two locations; never start one the cap cannot pay for.
      if (used + 2 > TRIPADVISOR_CAP) { stopped = true; break; }
      const meter = {};
      try {
        const m = await tripadvisorMatchFor({ venueRef: i.ref, name: i.name, lat: i.lat, lng: i.lng, category: i.category, locality: out.place.label, meter });
        looked += 1;
        if (m) matched += 1; else missed += 1;
      } catch (err) {
        if (err?.provider !== 'tripadvisor') throw err;
        return res.status(502).json({ error: 'tripadvisor_failed', message: whySourceFailed('tripadvisor', err), looked, matched, missed, used, cap: TRIPADVISOR_CAP });
      } finally {
        const n = meter.tripadvisor || 0;
        if (n) { await visitsRepo.recordProviderCall(household.id, 'tripadvisor', 'admin.lookup.tripadvisor', meter).catch(() => null); used += n; }
      }
    }
    res.json({ kind, looked, matched, missed, used, cap: TRIPADVISOR_CAP, stopped, remaining: stopped ? 0 : Math.max(0, wanting.length - page.length) });
  } catch (err) { next(err); }
});

/**
 * POST /curate — claim the place, research it from the open web (the existing
 * researcher), then read its own pages and write our account of it; and keep
 * the crowd as bands, so it holds its standing without the signal. One call
 * to Claude; a spent budget comes back as plain words with the raw line
 * beside them, because the back office is where the raw words belong.
 */
router.post('/curate', requires('view_library'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const settings = settingsOf(req.body ?? {});
    const ref = String(req.body?.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.', 'ref_required');
    const out = await runLookup(settings, household);
    const item = out.items.find((i) => i.ref === ref);
    if (!item) return res.status(404).json({ error: 'not_found', message: 'That place is not in this search any more — the ring may have moved.' });

    await claimPlace(household.id, ref, 'curated', { name: item.name, lat: item.lat, lng: item.lng, website: item.website ?? null, category: item.category });
    await enrich(ref, { householdId: household.id, seed: { name: item.name, lat: item.lat, lng: item.lng, website: item.website ?? null, category: item.category }, force: true, replace: false });
    let record = await recordFor(ref);
    const website = record?.website ?? item.website ?? null;

    // The crowd, as words. From the figures this search already holds; else
    // the cheap two-field detail, if Google knows the place.
    let f = item.rating != null ? { rating: item.rating, ratingCount: item.ratingCount } : heldFigures(ref);
    if (!f && googleSource.enabled()) {
      try {
        const m = await googleMatchFor({ venueRef: ref, name: item.name, lat: item.lat, lng: item.lng, householdId: household.id });
        if (m && !m.held) f = m;
        else if (m) { const meter = {}; try { f = await googleSource.rating(m.id, { meter }); } finally { if (Object.keys(meter).length) await visitsRepo.recordProviderCall(household.id, 'google', 'admin.lookup.rate', meter).catch(() => null); } }
        if (f) holdFigures(ref, f);
      } catch { f = null; }
    }

    let curation = null; let why = null; let detail = null;
    try {
      const meta = {};
      curation = await curate({ venueRef: ref, name: item.name, website, summary: record?.summary ?? null, householdId: household.id, meta });
      curation.costUsd = meta.costUsd ?? null;
    } catch (err) {
      if (err?.code === 'model_budget_reached' || err?.code === 'spend_bound') { why = err.message; detail = err.detail ?? null; }
      else if (err?.code === 'no_website' || err?.code === 'site_unreadable') why = err.message;
      else throw err;
    }
    if (f) {
      const crowd = crowdBand(f.rating, f.ratingCount);
      const count = countBand(f.ratingCount);
      const { epicScore } = score({ crowd, count, accolades: [], website, summary: curation?.curation?.what ?? record?.summary ?? null, openingHours: record?.opening_hours ?? null });
      await band(ref, { crowd, count, epicScore });
    }
    record = await recordFor(ref);
    res.status(why ? 202 : 200).json({ ref, curation, banded: Boolean(f), record, why, detail });
  } catch (err) { next(err); }
});

export default router;
