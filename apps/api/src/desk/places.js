/**
 * What the back office may print about a place: owned facts only.
 *
 * A name comes from our own record or the atlas (Wikipedia, Wikidata, Commons
 * — open sources we may keep), never from Google. A place in neither has a
 * reference and nothing else we are allowed to show, and says so.
 */

import { query } from '../db.js';

/** Name, area (county · country), town, postcode, image and sentence, by ref. */
export async function describe(refs) {
  const list = [...new Set((refs ?? []).filter(Boolean))];
  if (!list.length) return new Map();
  const { rows } = await query(
    `select r.ref,
            coalesce(pr.name, a.name) as name,
            pr.postcode,
            coalesce(pr.image_url, null) as image_url,
            coalesce(pr.summary, a.summary) as summary,
            pi.country_code,
            (select l.name from place_areas pa join localities l on l.slug = pa.area_slug
              where pa.venue_ref = r.ref and l.kind = 'county' limit 1) as county,
            (select l.name from place_areas pa join localities l on l.slug = pa.area_slug
              where pa.venue_ref = r.ref and l.kind in ('town', 'city', 'village') limit 1) as town,
            (select l.slug from place_areas pa join localities l on l.slug = pa.area_slug
              where pa.venue_ref = r.ref and l.kind = 'county' limit 1) as county_slug
       from unnest($1::text[]) as r(ref)
       left join place_records pr on pr.venue_ref = r.ref
       left join lateral (
         select name, summary from attractions x
          where x.venue_ref = r.ref or 'atlas:' || x.id::text = r.ref
          order by x.last_seen desc limit 1) a on true
       left join place_index pi on pi.venue_ref = r.ref`, [list]);
  const COUNTRY = { GB: 'United Kingdom', IE: 'Ireland' };
  return new Map(rows.map((r) => [r.ref, {
    ref: r.ref,
    name: r.name ?? null,
    postcode: r.postcode ?? null,
    image: r.image_url ?? null,
    sentence: r.summary ?? null,
    county: r.county ?? null,
    countySlug: r.county_slug ?? null,
    town: r.town ?? null,
    country: COUNTRY[r.country_code] ?? r.country_code ?? null,
    countryCode: r.country_code ?? null,
    area: [r.county, COUNTRY[r.country_code] ?? r.country_code].filter(Boolean).join(', ') || null,
  }]));
}

/** The words the screens use for our own sources. */
export const SOURCE_WORD = {
  site: 'Venue website',
  osm: 'OpenStreetMap',
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
  fsa: 'Hygiene register',
  families: 'Families',
  person: 'A person',
};
