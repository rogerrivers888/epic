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

import { query } from '../db.js';

export const OWNED_SOURCES = ['osm', 'atlas', 'wikidata', 'own', 'household', 'fsa', 'historic-england', 'os-open-names', 'fixtures'];
export const RENTED_SOURCES = ['google', 'tripadvisor', 'yelp', 'foursquare'];

/** What each owned source is licensed under, written beside every point. */
export const LICENCES = {
  wikidata: 'CC0-1.0',
  fsa: 'OGL-UK-3.0',
  'historic-england': 'OGL-UK-3.0',
  'os-open-names': 'OGL-UK-3.0',
  osm: 'ODbL-1.0',
  household: "the household's own",
};

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

export async function recordOwnedPoint({ ref, lat, lng, source, sourceRef = null, method, distanceM = null }, client = { query }) {
  if (!ref || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return { written: false, why: 'no point' };
  if (!LICENCES[source]) throw new Error(`not an owned source: ${source}`);
  const { rows: [kept] } = await client.query(
    `insert into owned_points (venue_ref, lat, lng, source, source_ref, licence, method, distance_m)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (venue_ref) do update
        set lat = excluded.lat, lng = excluded.lng, source = excluded.source, source_ref = excluded.source_ref,
            licence = excluded.licence, method = excluded.method, distance_m = excluded.distance_m, matched_at = now()
      where array_position($9::text[], excluded.source) <= array_position($9::text[], owned_points.source)
     returning venue_ref`,
    [ref, Number(lat), Number(lng), source, sourceRef, LICENCES[source], method, distanceM, ORDER]);
  if (!kept) return { written: false, why: 'a better source already holds it' };
  await client.query(
    `update place_index
        set lat = $2, lng = $3, coords_from = $4, coords_at = now(),
            -- A new position is a new cell and a new ring: back to the settler.
            cell = case when lat is distinct from $2 or lng is distinct from $3 then null else cell end,
            placed_at = case when lat is distinct from $2 or lng is distinct from $3 then null else placed_at end
      where venue_ref = $1`, [ref, Number(lat), Number(lng), source]);
  // Touched, not rewritten: the trigger decides, the same as for any write.
  for (const table of ['household_places', 'trip_shortlist', 'trip_stops', 'visits']) {
    await client.query(
      `update ${table} set point_from = point_from
        where venue_ref = $1 and (point_from is null or point_from = 'census-box' or not (point_from = any($2::text[])))`,
      [ref, OWNED_SOURCES]);
  }
  return { written: true };
}
