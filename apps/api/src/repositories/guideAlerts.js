/**
 * "Tell me when" on the subcategory guides (migration 372): who asked to hear
 * when a subcategory starts near them, and where the demand is.
 *
 * All SQL lives in `repositories/`; every value is a parameter.
 */

import { query } from '../db.js';

/**
 * One person, one subcategory, one place. Returns the new row, or null when the
 * same ask was already there — which the route answers exactly like a first one.
 */
export async function addAlert(a) {
  const { rows } = await query(
    `insert into guide_alerts
       (email, subcategory, place_typed, place_name, county, region, country, lat, lng, place_source,
        within_miles, locale, consent_wording, page_url, referrer,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid)
     values (lower($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
     on conflict (lower(email), subcategory, lower(place_typed)) do nothing
     returning id, email, subcategory, place_name, created_at`,
    [a.email, a.subcategory, a.placeTyped, a.place?.name ?? null, a.place?.county ?? null, a.place?.region ?? null,
      a.place?.country ?? null, a.place?.lat ?? null, a.place?.lng ?? null, a.place?.source ?? null,
      a.within, a.locale, a.consentWording, a.pageUrl ?? null, a.referrer ?? null,
      a.utmSource ?? null, a.utmMedium ?? null, a.utmCampaign ?? null, a.utmTerm ?? null, a.utmContent ?? null,
      a.gclid ?? null, a.fbclid ?? null],
  );
  return rows[0] ?? null;
}

/**
 * The demand, for the back office: how many people want each subcategory near
 * each place ("38 people want pottery near Reading"), counted in people, not
 * rows, and never counting anybody who has unsubscribed. A place that could not
 * be looked up is counted under the words as typed and says so (`resolved`
 * false), rather than being folded into somewhere it may not be.
 */
export async function demandByPlace() {
  const { rows } = await query(
    `select subcategory,
            coalesce(place_name, initcap(trim(place_typed))) as place,
            county,
            place_name is not null as resolved,
            count(distinct lower(email))::int as people
       from guide_alerts
      where unsubscribed_at is null
      group by 1, 2, 3, 4
      order by people desc, subcategory, place`,
  );
  return rows;
}
