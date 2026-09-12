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
import { googleRefFor } from '../sources/providerMatch.js';
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
 * Side by side: what we own for a place, and what Google has for it.
 *
 * Owner, 12 Sep 2026: "When I click on something that's owned… what I would
 * like to see is the data that's owned on one side, and then the Google data
 * on the other. You should call the Google API, ask it for the data for this
 * record… so I can just compare and see how rich our data is and where the
 * holes in our data are."
 *
 * Ours is the owned record when there is one, else the atlas row or the
 * sweep row. Google's is one Place Details call for this record — by its own
 * identifier when we hold one, otherwise matched by name and distance the way
 * the atlas matches (`googleRefFor`, which remembers the join and never the
 * content). The detail is held in memory for a few hours so flipping between
 * places does not bill twice, and it is never written down: rented.
 *
 * The rows pair the fields that mean the same thing under two names, then
 * list what only one side has. A blank cell is a hole, and the point.
 */
const PAIRS = [
  ['name', 'name'], ['category', 'category'], ['address', 'address'], ['lat', 'lat'], ['lng', 'lng'],
  ['website', 'website'], ['phone', 'phone'], ['opening_hours', 'openingHours'], ['price_range', 'priceLevel'],
  ['cuisines', 'cuisines'], ['experiences', 'experiences'], ['dietary_options', 'dietaryOptions'],
  ['good_for_children', 'goodForChildren'], ['summary', 'summary'], ['image_url', 'photos'],
  ['booking_url', 'reservable'], ['menu_url', null], ['menu_label', null], ['email', null], ['socials', null],
  ['accessibility', null], ['postcode', null], ['osm_ref', null], ['wikidata_id', null], ['wikipedia_url', null],
  [null, 'rating'], [null, 'ratingCount'], [null, 'reviews'], [null, 'openNow'], [null, 'mapsUrl'], [null, 'menuForChildren'],
];
const OUR_LABEL = { own: 'Owned record', atlas: 'The atlas', sweep: 'The sweep' };
const details = new Map();
const DETAIL_TTL_MS = 6 * 3600_000;
// Two opens of the same place before the first has answered share one call.
const detailsInFlight = new Map();

/**
 * One Place Details call for this identifier, whatever is asking. The ledger
 * is written whether or not Google answered: a call that timed out after it
 * reached Google was still a call (Codex, 12 Sep 2026).
 */
async function detailFor(id, householdId) {
  const held = details.get(id);
  if (held && Date.now() - held.at < DETAIL_TTL_MS) return held.detail;
  if (detailsInFlight.has(id)) return detailsInFlight.get(id);
  const run = (async () => {
    const meter = {};
    try {
      const raw = await googleSource.get(id, { meter });
      // A photo is a signed proxy reference here, not a picture: what the
      // comparison wants is that there are three and who took them.
      const detail = { ...raw, photos: (raw.photos ?? []).map((ph) => ({ attribution: ph.attribution ?? null })) };
      details.set(id, { at: Date.now(), detail });
      while (details.size > 300) details.delete(details.keys().next().value);
      return detail;
    } finally {
      if (Object.keys(meter).length) await visitsRepo.recordProviderCall(householdId, 'google', 'admin.lookup.compare', meter).catch(() => null);
      detailsInFlight.delete(id);
    }
  })();
  detailsInFlight.set(id, run);
  return run;
}

function pairUp(ours, theirs) {
  const rows = [];
  const usedO = new Set();
  const usedT = new Set();
  for (const [o, t] of PAIRS) {
    if ((o && ours && o in ours) || (t && theirs && t in theirs)) {
      rows.push({ key: o ?? t, theirKey: t, ourKey: o, ours: o && ours ? ours[o] : undefined, theirs: t && theirs ? theirs[t] : undefined, paired: Boolean(o && t) });
      if (o) usedO.add(o);
      if (t) usedT.add(t);
    }
  }
  for (const k of Object.keys(ours ?? {})) if (!usedO.has(k)) rows.push({ key: k, ourKey: k, theirKey: null, ours: ours[k], theirs: undefined, paired: false });
  for (const k of Object.keys(theirs ?? {})) if (!usedT.has(k)) rows.push({ key: k, ourKey: null, theirKey: k, ours: undefined, theirs: theirs[k], paired: false });
  return rows;
}

const blank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

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

    // Theirs: by identifier when we hold one, else the atlas's own match.
    let theirs = { id: null, how: 'none', fields: null, why: null };
    if (!googleSource.enabled()) {
      theirs = { id: null, how: 'off', fields: null, why: 'Google is not switched on here.' };
    } else {
      let id = ref.startsWith('google:') ? ref.slice('google:'.length) : records.find((r) => r.source === 'google')?.fields?.sourcePlaceId ?? null;
      let how = id ? 'id' : 'none';
      let unreachable = null;
      if (!id) {
        // A miss is "Google has no such place"; a failure is "Google could not
        // be asked", and the two must not read the same (Codex, 12 Sep 2026).
        try {
          id = await googleRefFor({ venueRef: ref, name: item.name, lat: item.lat, lng: item.lng, householdId: household.id, strict: true });
          how = id ? 'matched' : 'none';
        } catch (err) { unreachable = whySourceFailed('google', err); }
      }
      if (unreachable) {
        theirs = { id: null, how: 'none', fields: null, why: unreachable };
      } else if (id) {
        try {
          theirs = { id, how, fields: await detailFor(id, household.id), why: null };
        } catch (err) {
          theirs = { id, how, fields: null, why: whySourceFailed('google', err) };
        }
      } else {
        theirs.why = 'Nothing at Google reads as this place: no name near enough, close enough.';
      }
    }

    const rows = pairUp(mine?.fields ?? null, theirs.fields);
    res.json({
      place: out.place, mode: out.mode, minutes: out.minutes,
      item: summary,
      ours: mine ? { source: mine.source, label: OUR_LABEL[mine.source] ?? mine.source, fields: mine.fields } : { source: null, label: null, fields: null },
      theirs,
      rows,
      filled: {
        ours: rows.filter((r) => r.ourKey && !blank(r.ours)).length,
        theirs: rows.filter((r) => r.theirKey && !blank(r.theirs)).length,
        oursOf: rows.filter((r) => r.ourKey).length,
        theirsOf: rows.filter((r) => r.theirKey).length,
      },
    });
  } catch (err) { next(err); }
});

export default router;
