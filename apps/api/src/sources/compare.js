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

export const PAIRS = [
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
export async function detailFor(provider, id, householdId) {
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

export const blank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** The rows: the pairs first, then what only one column has, each cell carrying which key it came from. */
export function lineUp(fields) {
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

