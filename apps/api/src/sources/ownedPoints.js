/**
 * Owned points: the one permanent position a place may have, and where it
 * came from (owner, C59, 30 Sep 2026).
 *
 * "Tables reference the owned point instead of copying Google's … the true
 * source is recorded per point, not guessed from the ID prefix." A point is
 * owned when it comes from a source we may keep for good — Wikidata (CC0), the
 * FSA register, Historic England and Ordnance Survey (OGL), OpenStreetMap
 * (ODbL) or a household's own pin — and it is written here once, with its
 * licence. A rented point (Google's, and the other licensed providers') is
 * never written to a table that keeps it: migration 307's trigger turns it
 * into the owned point, a census box, or nothing, whoever writes it.
 *
 * These lists are the same as the database's own (epic_owned_sources,
 * epic_rented_sources in migration 307), and test/ownedPoints.test.js holds
 * the two to each other.
 */

import { query, pool } from '../db.js';

export const OWNED_SOURCES = ['osm', 'atlas', 'wikidata', 'own', 'household', 'fsa', 'historic-england', 'os-open-names', 'fixtures'];
export const RENTED_SOURCES = ['google', 'tripadvisor', 'yelp', 'foursquare', 'liteapi', 'ticketmaster', 'seatgeek', 'predicthq', 'datathistle'];

/** What each owned source is licensed under, written beside every point. */
export const LICENCES = {
  wikidata: 'CC0-1.0',
  fsa: 'OGL-UK-3.0',
  'historic-england': 'OGL-UK-3.0',
  'os-open-names': 'OGL-UK-3.0',
  osm: 'ODbL-1.0',
  household: "the household's own",
};

/**
 * The name an owned source itself holds for the place a point was matched to,
 * as SQL over an `owned_points` row aliased `o` — read from our own copy of
 * that source, the live load first and any held load after. Shared by the
 * display resolver (an owned name, sources/displayNames.js) and the name-check
 * (sources/nameCheck.js). Null where the source holds no name we can read, so
 * the caller says nothing rather than guessing.
 */
export const OWNED_POINT_NAME = (o = 'o') => `(case ${o}.source
  when 'fsa' then (select f.name from fsa_establishments f
                    where ${o}.source_ref ~ '^[0-9]+$' and f.fhrsid = ${o}.source_ref::bigint
                    order by (f.load_id = (select live_load from owned_source_loads where source = 'fsa')) desc limit 1)
  when 'historic-england' then (select h.name from heritage_entries h
                    where split_part(${o}.source_ref, ':', 2) ~ '^[0-9]+$'
                      and h.list_entry = split_part(${o}.source_ref, ':', 2)::bigint and h.layer = split_part(${o}.source_ref, ':', 1)
                    order by (h.load_id = (select live_load from owned_source_loads where source = 'historic-england')) desc limit 1)
  when 'os-open-names' then (select n.name from os_names n where n.id = ${o}.source_ref
                    order by (n.load_id = (select live_load from owned_source_loads where source = 'os-open-names')) desc limit 1)
  when 'osm' then (select x.name from osm_features x where x.ref = ${o}.source_ref)
  end)`;

/**
 * One place's owned point, held still for the rest of the transaction: taken
 * by recordOwnedPoint and by the name-check's setAside, so a check and a write
 * on the same place happen one after the other, never across each other.
 */
export async function lockPlace(client, ref) {
  await client.query(`select pg_advisory_xact_lock(hashtext('owned-point:' || $1))`, [ref]);
}

/** Whose a reference's own point is, read off the reference: the fallback when nothing says. */
export function pointSourceOfRef(ref) {
  const prefix = String(ref ?? '').split(':')[0];
  if (!prefix) return null;
  return prefix === 'photo' ? 'household' : prefix;
}

export const isOwned = (source) => OWNED_SOURCES.includes(source);

/** The owned point for a place, or null. */
export async function ownedPoint(ref, client = { query }) {
  const { rows: [r] } = await client.query('select * from owned_points where venue_ref = $1', [ref]);
  return r ?? null;
}

/**
 * Write a place's owned point down for good, and let everything that refers
 * to the place pick it up: the index takes it as its position with its true
 * source, and a saved, shortlisted, planned or visited copy of the place is
 * touched so the trigger puts the owned point where a census box or nothing
 * was. A point already held from an earlier source is replaced only by a
 * better one, in the owner's order (Wikidata → FSA → Historic England → OS →
 * OSM), or by the same source correcting itself.
 */
export const ORDER = ['wikidata', 'fsa', 'historic-england', 'os-open-names', 'osm', 'household'];

export async function recordOwnedPoint(args, client = null) {
  if (client) return recordIn(args, client);
  // One transaction, so the owned point, the index and every copy move together
  // or not at all (Codex, 30 Sep 2026).
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await recordIn(args, c);
    await c.query('commit');
    return out;
  } catch (err) {
    await c.query('rollback').catch(() => null);
    throw err;
  } finally { c.release(); }
}

async function recordIn({ ref, lat, lng, source, sourceRef = null, method, distanceM = null }, client) {
  if (!ref || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return { written: false, why: 'no point' };
  if (!LICENCES[source]) throw new Error(`not an owned source: ${source}`);
  // A match a live name has already doubted is never written back, by the
  // weekly re-match or anything else: this is the one door every owned point
  // comes through (owner, 1 Oct 2026; sources/nameCheck.js). The place is
  // locked first, the same lock setAside takes, so a match being set aside
  // while this runs cannot slip back in behind it (Codex, 2 Oct 2026).
  await lockPlace(client, ref);
  const { rows: [doubted] } = await client.query(
    'select 1 from owned_point_suspects where venue_ref = $1 and source = $2 and source_ref = $3',
    [ref, source, String(sourceRef ?? '')]);
  if (doubted) return { written: false, why: 'set aside: a live name disagreed with this match' };
  const { rows: [kept] } = await client.query(
    `insert into owned_points (venue_ref, lat, lng, source, source_ref, licence, method, distance_m)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (venue_ref) do update
        set lat = excluded.lat, lng = excluded.lng, source = excluded.source, source_ref = excluded.source_ref,
            licence = excluded.licence, method = excluded.method, distance_m = excluded.distance_m, matched_at = now()
      where array_position($9::text[], excluded.source) <= array_position($9::text[], owned_points.source)
     returning lat, lng, source`,
    [ref, Number(lat), Number(lng), source, sourceRef, LICENCES[source], method, distanceM, ORDER]);
  if (!kept) return { written: false, why: 'a better source already holds it' };
  // What is passed on is the row that won, read back, not the arguments.
  ({ lat, lng, source } = kept);
  // Into the index, whether or not it knew the place yet (Codex, 30 Sep 2026).
  await client.query(
    `insert into place_index (venue_ref, lat, lng, coords_from, coords_at)
     values ($1, $2, $3, $4, now())
     on conflict (venue_ref) do update
        set lat = excluded.lat, lng = excluded.lng, coords_from = excluded.coords_from, coords_at = now(),
            -- A new position is a new cell and a new ring: back to the settler.
            cell = case when place_index.lat is distinct from excluded.lat or place_index.lng is distinct from excluded.lng then null else place_index.cell end,
            placed_at = case when place_index.lat is distinct from excluded.lat or place_index.lng is distinct from excluded.lng then null else place_index.placed_at end,
            last_seen = now()`, [ref, Number(lat), Number(lng), source]);
  // Every copy goes back through the trigger, which gives each the owned
  // point as it now stands — whatever it held before (Codex, 30 Sep 2026).
  for (const table of ['household_places', 'trip_shortlist', 'trip_stops', 'visits', 'scout_places', 'place_records']) {
    await client.query(`update ${table} set point_from = null where venue_ref = $1`, [ref]);
  }
  // And the atlas row itself, keyed by its reference or its own id.
  await client.query(
    `update attractions set point_from = null
      where venue_ref = $1
         -- An activity-sweep row keyed on its Google reference (Codex).
         or external_ref = $1
         or id = (case when $1 like 'atlas:%' then epic_try_uuid(substr($1, 7)) end)`, [ref]);
  return { written: true };
}
