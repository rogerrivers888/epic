/**
 * Ours beside theirs, field by field.
 *
 * Lifted out of routes/lookup.js unchanged when the place index arrived
 * (17 Sep 2026), because two screens now ask the same question and a second
 * copy of the field map would be a second thing to keep in step. Lookup asks it
 * of a place in a ring it has just searched; Places asks it of a row in the
 * index, which is the whole reason the index exists.
 *
 * Nothing here is written down. A provider's detail is held in memory for a few
 * hours so flipping between places does not bill twice, and then it is gone.
 */

import { googleSource } from './google.js';
import { tripadvisorSource } from './tripadvisor.js';
import * as visitsRepo from '../repositories/visits.js';
import { spotInBackground } from './reviewSpotting.js';

// The nine the board always draws, in BO2h's own order, then everything else.
//
// A hole is a finding. Drawing a row only where somebody held the fact meant
// the four facts the design shows *missing* — an address nobody has, hours
// nobody has, the picture we do not own, the shelf nothing has filed it under —
// simply were not on the screen, so the board could not be read for what is
// absent, which is the one thing it is for (18 Sep 2026, the separate audit).
export const PAIRS = [
  ['name', 'name', 'name'], ['address', 'address', 'address'], ['opening_hours', 'openingHours', 'openingHours'],
  ['website', 'website', 'website'], ['summary', 'summary', 'ta_description'], ['image_url', 'photos', null],
  ['count_band', 'ratingCount', 'ratingCount'], [null, null, 'ta_awards'], ['category', 'category', 'category'],
  ['lat', 'lat', 'lat'], ['lng', 'lng', 'lng'],
  ['phone', 'phone', 'ta_phone'], ['price_range', 'priceLevel', 'priceLevel'],
  ['cuisines', 'cuisines', 'cuisines'], ['experiences', 'experiences', 'experiences'], ['dietary_options', 'dietaryOptions', null],
  ['good_for_children', 'goodForChildren', 'goodForChildren'],
  ['booking_url', 'reservable', null], ['menu_url', null, null], ['menu_label', null, null], ['email', null, 'ta_email'], ['socials', null, null],
  ['accessibility', 'accessibilityOptions', null], ['postcode', null, null], ['osm_ref', null, null], ['wikidata_id', null, null], ['wikipedia_url', null, null],
  ['curation', null, null], ['crowd_band', 'rating', 'rating'], ['epic_score', null, 'ta_ranking_data'],
  [null, 'aiSummary', null], [null, 'reviewSummary', null], [null, 'reviews', 'reviews'], [null, 'openNow', null], [null, 'mapsUrl', 'externalUrl'], [null, 'menuForChildren', null],
  // Google's amenity, access and parking facts (owner, 28 Sep 2026). Our side
  // holds none of these yet, so the rows read as a hole on our column and a
  // value on Google's — which is the comparison's whole point.
  [null, 'primaryType', null], [null, 'parking', null], [null, 'dogsAllowed', null],
  [null, 'outdoorSeating', null], [null, 'restroom', null], [null, 'dineIn', null], [null, 'takeout', null], [null, 'delivery', null], [null, 'goodForGroups', null],
  [null, null, 'ta_subratings'], [null, null, 'ta_trip_types'], [null, null, 'ta_review_rating_count'], [null, null, 'labels'],
];

/** The rows drawn whether or not anybody holds them (BO2h's nine facts). */
export const ALWAYS = new Set([
  'name', 'address', 'opening_hours', 'website', 'summary', 'image_url', 'count_band', 'ta_awards', 'category',
]);
export const COLS = ['ours', 'google', 'tripadvisor'];
export const OUR_LABEL = { own: 'Owned record', atlas: 'The atlas', sweep: 'The sweep' };
const details = new Map();
const DETAIL_TTL_MS = 6 * 3600_000;
// Two opens of the same place before the first has answered share one call.
const detailsInFlight = new Map();

/**
 * One detail call for this identifier at this provider, whatever is asking.
 * The ledger is written whether or not the provider answered: a call that
 * timed out after it reached them was still a call (Codex, 12 Sep 2026).
 */
/**
 * Is this one already held?
 *
 * Asked before the ceiling is, because showing a detail we already have costs
 * nothing — and refusing it when the month is spent hides a column fetched
 * minutes earlier (Codex, 17 Sep 2026).
 */
export function detailHeld(provider, id) {
  const key = `${provider}:${id}`;
  // One already on its way counts as held: `detailFor` joins it rather than
  // asking again, so no call goes out for the second caller. Left out, two
  // requests about the same place at once both claimed the money and both
  // counted a call — and near a ceiling the second was refused for spending
  // that was never going to happen (Codex, 18 Sep 2026, the same rule the
  // search cache got two rounds ago).
  if (detailsInFlight.has(key)) return true;
  const held = details.get(key);
  return Boolean(held) && Date.now() - held.at < DETAIL_TTL_MS;
}

// The (place, detail) pairs review-spotting has already seen, so a detail served
// from the six-hour cache is still spotted for a ref that fetched it later — but
// only once per (place, detail), not on every read. The fresh-fetch path warmed
// the cache without a ref (demand.js) or for a different ref, so without this a
// later compare with a real ref would return the cache and never spot it (Codex,
// 2 Oct 2026). Bounded like the detail cache.
const spotted = new Set();
function maybeSpot(provider, id, venueRef, detail) {
  if (provider !== 'google' || !venueRef || !detail) return;
  const k = `${provider}:${id}:${venueRef}`;
  if (spotted.has(k)) return;
  spotted.add(k);
  while (spotted.size > 2000) spotted.delete(spotted.keys().next().value);
  spotInBackground({ venueRef, detail });
}

export async function detailFor(provider, id, householdId, { venueRef = null } = {}) {
  const key = `${provider}:${id}`;
  const held = details.get(key);
  if (held && Date.now() - held.at < DETAIL_TTL_MS) { maybeSpot(provider, id, venueRef, held.detail); return held.detail; }
  if (detailsInFlight.has(key)) return detailsInFlight.get(key).then((d) => { maybeSpot(provider, id, venueRef, d); return d; });
  const run = (async () => {
    const meter = {};
    try {
      const raw = provider === 'google' ? await googleSource.get(id, { meter }) : await tripadvisorSource.get(id, { meter });
      // A photo is a signed proxy reference here, not a picture: what the
      // comparison wants is that there are three and who took them.
      const detail = { ...raw, photos: (raw.photos ?? []).map((ph) => ({ attribution: ph.attribution ?? null })) };
      details.set(key, { at: Date.now(), detail });
      while (details.size > 300) details.delete(details.keys().next().value);
      // Review-spotting (C30/C61): the reviews are in memory now, for free, on a
      // search the back office asked for. Spot the concrete features and queue
      // them in the background — it never blocks or breaks this fetch.
      maybeSpot(provider, id, venueRef, detail);
      return detail;
    } finally {
      // Which place it was about: the provider's own reference is the one
      // this call was made against, and it is what the History tab asks by.
      if (Object.keys(meter).length) await visitsRepo.recordProviderCall(householdId, provider, 'admin.lookup.compare', meter, `${provider}:${id}`).catch(() => null);
      detailsInFlight.delete(key);
    }
  })();
  detailsInFlight.set(key, run);
  return run;
}

export const blank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * The held detail for this identifier, if one is still in memory — without
 * asking anybody.
 *
 * The subcategory summary (BO, 28 Sep 2026) counts Google's field coverage
 * across a drawer's places, but only for the ones already opened: "Compare
 * calls only for places I've opened, unless I press Compare all." So it reads
 * the same six-hour cache `detailFor` fills, and never itself triggers a paid
 * call. `null` where nothing is held — a can't-speak state, not an empty place.
 */
export function cachedDetail(provider, id) {
  const held = details.get(`${provider}:${id}`);
  return held && Date.now() - held.at < DETAIL_TTL_MS ? held.detail : null;
}

/**
 * Per field, how many of these places we hold a value for and how many Google
 * does — the subcategory summary's arithmetic, kept here beside `PAIRS` so the
 * two cannot drift.
 *
 * `places` is `[{ ours, google }]`, each a fields object or `null` (`google`
 * null where that place has not been compared). A field is counted from the
 * same paired keys `lineUp` aligns on, so "address" means the same column on
 * both sides. Pure: no database, no provider, so it is unit-tested directly.
 */
export function coverageByField(places) {
  const out = [];
  for (const trio of PAIRS) {
    const [ourKey, googleKey] = trio;
    if (!ourKey && !googleKey) continue; // a Tripadvisor-only row has nothing to compare here
    const key = trio.find(Boolean);
    let ours = 0;
    let google = 0;
    for (const p of places) {
      if (ourKey && p.ours && ourKey in p.ours && !blank(p.ours[ourKey])) ours += 1;
      if (googleKey && p.google && googleKey in p.google && !blank(p.google[googleKey])) google += 1;
    }
    out.push({ key, ourKey: ourKey ?? null, googleKey: googleKey ?? null, ours, google });
  }
  return out;
}

/** The rows: the pairs first, then what only one column has, each cell carrying which key it came from. */
export function lineUp(fields) {
  const rows = [];
  const used = { ours: new Set(), google: new Set(), tripadvisor: new Set() };
  for (const trio of PAIRS) {
    const keys = Object.fromEntries(COLS.map((c, n) => [c, trio[n]]));
    const present = COLS.some((c) => keys[c] && fields[c] && keys[c] in fields[c])
      || trio.some((k) => k && ALWAYS.has(k));
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

