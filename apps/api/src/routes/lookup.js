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
import { searchCached } from '../sources/cache.js';
import { geocode, providerCalls as geocodeCalls } from '../sources/geocode.js';
import { searchAreas, providerCalls as areaCalls } from '../sources/areas.js';
import { whySourceFailed, sourceName } from '../sources/why.js';
import { travelMode } from '../domain/travel.js';
import { shelvesForAtlas, shelvesForVenue } from '../domain/moods.js';
import { fold, kindOf, reachKm, tally, total, withinReach, RING_CAP_KM } from '../domain/lookup.js';
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

/** The rented sources a look-around asks: places, not events, and never the scout, which reads the web for money. */
const rentedSources = () => enabledSources().filter((s) => !s.events && s.key !== 'scout');

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
    sources: rented.map((s) => s.key), deadlineMs: null,
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

  const kept = withinReach(all, centre, mode, minutes);
  const keys = [...rented.map((s) => s.key), ...OWNED.map((o) => o.key)];
  const returned = tally(all, keys);
  const inReach = tally(kept, keys);
  const failed = new Map((r.degraded ?? []).map((d) => [d.source, d]));

  return {
    place, mode, minutes, radiusKm, capped, estimated: true,
    // Distinct places, before and inside the fence: the "Everything" row.
    totals: { returned: total(all), kept: total(kept) },
    sources: [
      ...rented.map((s) => ({
        key: s.key, label: s.label, layer: 'rented', note: null,
        returned: returned[s.key], kept: inReach[s.key],
        failed: failed.has(s.key)
          ? { why: whySourceFailed(s.key, failed.get(s.key).error), error: failed.get(s.key).error, slow: Boolean(failed.get(s.key).slow) }
          : null,
      })),
      ...OWNED.map((o) => ({
        key: o.key, label: o.label, layer: 'owned', note: o.note, returned: returned[o.key], kept: inReach[o.key],
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

export default router;
