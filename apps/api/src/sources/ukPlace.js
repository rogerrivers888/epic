// Where somebody means, from what they typed into "City, county or postcode"
// (the subcategory guides' Tell me when form, 3 Oct 2026).
//
// The brief says town and county "via OS/ONS, never Google", and postcodes.io
// publishes both: the ONS postcode directory (a full postcode or an outward
// code) and Ordnance Survey Open Names (a city, town or village). Free, no key,
// open data under the OGL, so what it answers may be kept with the sign-up.
//
// A county is not a place Open Names knows — "Dorset" finds nothing, and "Isle
// of Wight" finds a hamlet in Surrey — so the counties are a fixed list, matched
// first. A place name is accepted only on an exact match, the biggest kind of
// settlement winning. Anything else is not a guess: it answers null, and the
// sign-up keeps the words as typed (the can't-speak rule).

import { userAgent } from '../origins.js';
import * as providerCalls from '../repositories/providerCalls.js';

const API = 'https://api.postcodes.io';
const UA = userAgent('guide alerts');

/** England's ceremonial counties, Wales's preserved counties, Northern Ireland's six and Scotland's council areas. */
export const COUNTIES = [
  'Bedfordshire', 'Berkshire', 'Bristol', 'Buckinghamshire', 'Cambridgeshire', 'Cheshire', 'City of London', 'Cornwall',
  'County Durham', 'Cumbria', 'Derbyshire', 'Devon', 'Dorset', 'East Riding of Yorkshire', 'East Sussex', 'Essex',
  'Gloucestershire', 'Greater London', 'Greater Manchester', 'Hampshire', 'Herefordshire', 'Hertfordshire', 'Isle of Wight',
  'Kent', 'Lancashire', 'Leicestershire', 'Lincolnshire', 'Merseyside', 'Norfolk', 'North Yorkshire', 'Northamptonshire',
  'Northumberland', 'Nottinghamshire', 'Oxfordshire', 'Rutland', 'Shropshire', 'Somerset', 'South Yorkshire',
  'Staffordshire', 'Suffolk', 'Surrey', 'Tyne and Wear', 'Warwickshire', 'West Midlands', 'West Sussex', 'West Yorkshire',
  'Wiltshire', 'Worcestershire',
  'Clwyd', 'Dyfed', 'Gwent', 'Gwynedd', 'Mid Glamorgan', 'Powys', 'South Glamorgan', 'West Glamorgan',
  'County Antrim', 'County Armagh', 'County Down', 'County Fermanagh', 'County Londonderry', 'County Tyrone',
  'Aberdeenshire', 'Angus', 'Argyll and Bute', 'Clackmannanshire', 'Dumfries and Galloway', 'East Ayrshire',
  'East Dunbartonshire', 'East Lothian', 'East Renfrewshire', 'Falkirk', 'Fife', 'Highland', 'Inverclyde', 'Midlothian',
  'Moray', 'North Ayrshire', 'North Lanarkshire', 'Orkney', 'Perth and Kinross', 'Renfrewshire', 'Scottish Borders',
  'Shetland', 'South Ayrshire', 'South Lanarkshire', 'Stirling', 'West Dunbartonshire', 'West Lothian', 'Western Isles',
];
const COUNTY_BY_KEY = new Map(COUNTIES.map((c) => [c.toLowerCase(), c]));
/** What people also type: "Co. Durham", "Durham county", "the Isle of Wight", "Yorkshire" is not one place. */
const COUNTY_ALIASES = new Map([
  ['co durham', 'County Durham'], ['durham county', 'County Durham'], ['the isle of wight', 'Isle of Wight'], ['iow', 'Isle of Wight'],
  ['london', null], ['co antrim', 'County Antrim'], ['co down', 'County Down'], ['co armagh', 'County Armagh'],
  ['co fermanagh', 'County Fermanagh'], ['co londonderry', 'County Londonderry'], ['co tyrone', 'County Tyrone'],
]);

const FULL_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/;
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/;
/** Open Names' kinds of place, biggest first: an exact "Bath" is the city, not Bath Street. */
const KIND_RANK = ['City', 'Town', 'Village', 'Hamlet', 'Suburban Area', 'Other Settlement'];

/** "  isle of  wight " → "isle of wight"; punctuation that is not part of a name dropped. */
export const keyOf = (s) => String(s ?? '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

async function ask(path, fetchImpl) {
  const res = await fetchImpl(`${API}${path}`, { signal: AbortSignal.timeout(4000), headers: { 'user-agent': UA, accept: 'application/json' } });
  // Written down whether it answered or not: it is a call we made (CLAUDE.md › provider_calls).
  await providerCalls.record(null, 'postcodes', 'guide-alert.place', { requests: 1 }).catch(() => null);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`postcodes.io ${res.status}`);
  return (await res.json())?.result ?? null;
}

const first = (v) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Where `typed` is, or null when it cannot be told. Never throws: a lookup that
 * fails is the same answer as one that finds nothing — the words as typed.
 * Returns `{ name, county, region, country, lat, lng, source }`.
 */
export async function placeOf(typed, { fetchImpl = fetch } = {}) {
  const raw = String(typed ?? '').trim();
  if (!raw) return null;
  const key = keyOf(raw);
  const alias = COUNTY_ALIASES.get(key);
  const county = alias !== undefined ? alias : COUNTY_BY_KEY.get(key) ?? COUNTY_BY_KEY.get(key.replace(/^county /, '')) ?? null;
  if (county) return { name: county, county, region: null, country: null, lat: null, lng: null, source: 'county' };
  try {
    const upper = raw.toUpperCase().replace(/\s+/g, '');
    const full = FULL_POSTCODE.exec(upper);
    if (full) {
      const r = await ask(`/postcodes/${encodeURIComponent(`${full[1]} ${full[2]}`)}`, fetchImpl);
      if (!r) return null;
      return { name: r.admin_district ?? null, county: r.admin_county ?? r.admin_district ?? null, region: r.region ?? null, country: r.country ?? null, lat: r.latitude ?? null, lng: r.longitude ?? null, source: 'ons-postcode' };
    }
    if (OUTCODE.test(upper)) {
      const r = await ask(`/outcodes/${encodeURIComponent(upper)}`, fetchImpl);
      if (!r) return null;
      return { name: upper, county: first(r.admin_county) ?? first(r.admin_district), region: null, country: first(r.country), lat: r.latitude ?? null, lng: r.longitude ?? null, source: 'ons-outcode' };
    }
    const found = await ask(`/places?q=${encodeURIComponent(raw)}&limit=20`, fetchImpl);
    const exact = (found ?? [])
      .filter((p) => keyOf(p.name_1) === key || (p.name_2 && keyOf(p.name_2) === key))
      .sort((a, b) => rank(a.local_type) - rank(b.local_type));
    const p = exact[0];
    if (!p) return null;
    return { id: p.code ?? null, name: p.name_1, county: p.county_unitary ?? null, region: p.region ?? null, country: p.country ?? null, lat: p.latitude ?? null, lng: p.longitude ?? null, source: 'os-open-names' };
  } catch (err) {
    console.error(`epic-api: guide alert — place not looked up: ${err.message}`);
    return null;
  }
}

const rank = (t) => { const i = KIND_RANK.indexOf(t); return i < 0 ? KIND_RANK.length : i; };

/**
 * One spelling for one place, so an ask is one ask however it was typed: a
 * postcode is `pc:RG1 1AA` whether or not it had a space (and whether or not
 * the lookup answered), an outward code `oc:RG1`, a county `county:Dorset`, an
 * Open Names place its OS id; only what could not be told falls back to the
 * words, lowercased with the spaces closed up.
 */
export function placeKeyOf(typed, place) {
  const compact = String(typed ?? '').toUpperCase().replace(/\s+/g, '');
  const full = FULL_POSTCODE.exec(compact);
  if (full) return `pc:${full[1]} ${full[2]}`;
  if (OUTCODE.test(compact)) return `oc:${compact}`;
  if (place?.source === 'county') return `county:${place.county}`;
  if (place?.source === 'os-open-names' && place.id) return `os:${place.id}`;
  return `typed:${keyOf(typed)}`;
}
