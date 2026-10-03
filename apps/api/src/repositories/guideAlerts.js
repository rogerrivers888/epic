/**
 * "Tell me when" on the subcategory guides (migration 372): who asked to hear
 * when a subcategory starts near them, and where the demand is.
 *
 * All SQL lives in `repositories/`; every value is a parameter.
 */

import { query } from '../db.js';

/**
 * One person, one subcategory, one place (`placeKey`, sources/ukPlace.js). A
 * second ask for the same place is the person's latest word: its radius,
 * consent and wording replace the first's, a place looked up this time fills
 * one that could not be told last time (a failed lookup never erases a good
 * one), and an unsubscribed ask is live again. The route answers both alike.
 */
export async function addAlert(a) {
  const { rows } = await query(
    `insert into guide_alerts
       (email, subcategory, place_typed, place_name, county, region, country, lat, lng, place_source,
        within_miles, locale, consent_wording, page_url, referrer,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, place_key)
     values (lower($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
     on conflict (lower(email), subcategory, place_key) do update set
       within_miles = excluded.within_miles,
       locale = excluded.locale,
       consent_wording = excluded.consent_wording,
       place_typed = case when excluded.place_name is not null or guide_alerts.place_name is null then excluded.place_typed else guide_alerts.place_typed end,
       place_name = coalesce(excluded.place_name, guide_alerts.place_name),
       county = case when excluded.place_name is not null then excluded.county else guide_alerts.county end,
       region = case when excluded.place_name is not null then excluded.region else guide_alerts.region end,
       country = case when excluded.place_name is not null then excluded.country else guide_alerts.country end,
       lat = case when excluded.place_name is not null then excluded.lat else guide_alerts.lat end,
       lng = case when excluded.place_name is not null then excluded.lng else guide_alerts.lng end,
       place_source = coalesce(excluded.place_source, guide_alerts.place_source),
       unsubscribed_at = null,
       updated_at = now()
     returning id, email, subcategory, place_name, created_at`,
    [a.email, a.subcategory, a.placeTyped, a.place?.name ?? null, a.place?.county ?? null, a.place?.region ?? null,
      a.place?.country ?? null, a.place?.lat ?? null, a.place?.lng ?? null, a.place?.source ?? null,
      a.within, a.locale, a.consentWording, a.pageUrl ?? null, a.referrer ?? null,
      a.utmSource ?? null, a.utmMedium ?? null, a.utmCampaign ?? null, a.utmTerm ?? null, a.utmContent ?? null,
      a.gclid ?? null, a.fbclid ?? null, a.placeKey],
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
