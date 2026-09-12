/**
 * How much of each source we actually hold, and how often each one is asked.
 *
 * The catalogue (sources/catalogue.js) says what a provider could give us and
 * what the code reads; this is the other half — the numbers. Owned facts are
 * counted from place_facts, which records every fact with its source, so the
 * count is by field and by provider rather than by row. Volume is provider_calls,
 * the ledger every outbound call is written to (Technical Constraints §2).
 *
 * Nothing here reads a provider's content: the queries count rows, average a
 * confidence and take the oldest date.
 */

import { query } from '../db.js';

/** place_facts.field → the master field in the catalogue. */
const FACT_FIELDS = {
  name: 'name', category: 'category', lat: 'lat_lng', lng: 'lat_lng', address: 'address', postcode: 'postcode', website: 'website',
  phone: 'phone', email: 'email', booking_url: 'booking_url', menu_url: 'menu_url', menu_label: 'menu_url', opening_hours: 'hours_regular',
  price_range: 'price_range', cuisines: 'cuisine', experiences: 'experiences', dietary_options: 'diets', accessibility: 'wheelchair',
  socials: 'socials', good_for_children: 'good_for_children', summary: 'description', summary_source: null, image_url: 'photo_ref',
  osm_ref: 'osm_ref', wikidata_id: 'wikidata_id', wikipedia_url: 'wikipedia',
};

/** place_facts.source → the provider in the catalogue. */
const FACT_SOURCES = { osm: 'osm', nominatim: 'nominatim', site: 'site', wikipedia: 'wikipedia', wikidata: 'wikidata', wikivoyage: 'wikivoyage' };

/** image_assets.source → the provider in the catalogue. */
const IMAGE_SOURCES = { wikimedia: 'commons', commons: 'commons', kartaview: 'kartaview', mapillary: 'mapillary', logo: 'site' };

/**
 * Owned facts by provider and master field: how many places hold it, out of
 * how many owned places, how sure the source was, and how old the oldest is.
 */
export async function ownedFacts() {
  const { rows: [{ places, done }] } = await query(
    `select count(*)::int as places, count(*) filter (where enrich_state = 'done')::int as done from place_records`,
  );
  const { rows } = await query(
    `select source, field, count(distinct venue_ref)::int as held, count(*)::int as facts,
            round(avg(confidence)::numeric, 2)::float as confidence,
            min(fetched_at) as oldest, max(fetched_at) as newest
       from place_facts
      where expires_at is null
      group by source, field`,
  );
  const byCell = new Map();
  for (const r of rows) {
    const provider = FACT_SOURCES[r.source];
    const field = FACT_FIELDS[r.field];
    if (!provider || !field) continue;
    const key = `${provider}:${field}`;
    const cur = byCell.get(key);
    if (!cur) {
      byCell.set(key, { provider, field, held: r.held, facts: r.facts, confidence: r.confidence, oldest: r.oldest, newest: r.newest });
    } else {
      // lat and lng both map to coordinates: one row, the larger count.
      cur.held = Math.max(cur.held, r.held);
      cur.facts += r.facts;
      cur.oldest = cur.oldest < r.oldest ? cur.oldest : r.oldest;
      cur.newest = cur.newest > r.newest ? cur.newest : r.newest;
    }
  }
  const facts = [...byCell.values()].map((c) => ({ ...c, of: places, coverage: places ? Math.round((c.held / places) * 100) : null }));
  return { places, done, facts };
}

/** The library the harvest built, by provider: attractions, pictures, areas, stations. */
export async function ownedLibrary() {
  const [attractions, images, localities, stops, stations] = await Promise.all([
    query(`select coalesce(source, 'wikidata') as source, count(*)::int as n, count(*) filter (where summary is not null)::int as with_summary,
                  count(*) filter (where website is not null)::int as with_website from attractions group by 1`),
    query(`select source, count(*)::int as n, count(*) filter (where may_store)::int as storable, min(fetched_at) as oldest from image_assets group by source`),
    query(`select kind, count(*)::int as n from localities group by kind`),
    query(`select count(*)::int as n, count(distinct network)::int as networks from transit_stops`),
    query(`select count(*) filter (where station is not null)::int as with_station, count(*) filter (where postcode is not null)::int as with_postcode, count(*)::int as n from household_places`),
  ]);
  const imagesByProvider = {};
  for (const r of images.rows) {
    const p = IMAGE_SOURCES[r.source] ?? r.source;
    const cur = imagesByProvider[p] ?? { n: 0, storable: 0, oldest: null };
    cur.n += r.n; cur.storable += r.storable;
    cur.oldest = cur.oldest && cur.oldest < r.oldest ? cur.oldest : r.oldest;
    imagesByProvider[p] = cur;
  }
  return {
    attractions: attractions.rows,
    images: imagesByProvider,
    localities: Object.fromEntries(localities.rows.map((r) => [r.kind, r.n])),
    transitStops: stops.rows[0],
    householdPlaces: stations.rows[0],
  };
}

/**
 * How often each provider token has been asked: all time and in the last 30
 * days. A search row names every source it asked joined with '+', so each
 * token in it counts once for its own provider.
 */
export async function callVolume() {
  const { rows } = await query(
    `select token, count(*)::int as all_time,
            count(*) filter (where created_at >= now() - interval '30 days')::int as days30,
            max(created_at) as last
       from provider_calls, unnest(string_to_array(provider, '+')) as token
      group by token`,
  );
  return Object.fromEntries(rows.map((r) => [r.token, { all: r.all_time, days30: r.days30, last: r.last }]));
}
