-- A coordinate is rented for thirty days.
--
-- The data policy's census is IDs Only (owner, 19 Sep 2026): Google's Essentials
-- tier is the id and nothing else, and `places.location` and `places.types` are
-- Pro fields that bill. So the census no longer learns where anything is.
--
-- A point arrives later, the first time a place is actually returned to a
-- household by a display search — a call being made anyway, for a place
-- somebody is looking at. Google's terms allow a coordinate to be held for 30
-- days and no longer, which until now nothing enforced: `place_index.lat/lng`
-- were written once and kept for ever, with no record of when.
--
-- `coords_at` is that record, and `coords_from` is why it may be kept: a point
-- that came from Google expires, and one that came from OpenStreetMap does not,
-- because ODbL lets us keep it. Where the "Not on Google" by-name lookup
-- matches an OSM place, OSM's own coordinates become the reachability fallback
-- for that place and simply never expire.

alter table place_index add column if not exists coords_at   timestamptz;
-- 'google' expires at 30 days · 'osm' is ours to keep · 'atlas', 'own' the same.
alter table place_index add column if not exists coords_from text;

-- The expiry lens: the oldest rented coordinates, so a sweeper can find them.
create index if not exists place_index_coords_expiry_idx
  on place_index (coords_at) where coords_from = 'google';

-- Everything already here was written before the census stopped asking for a
-- point, so it came from a search or a sweep that did ask. Dated now rather
-- than left null: a null would read as "never had one" and the expiry sweep
-- would skip exactly the rows that need it. Marked as Google's, which is the
-- conservative reading — an OSM place will be re-marked as its own when the
-- residual pass runs, and being re-asked is cheaper than keeping something we
-- should not have.
update place_index
   set coords_at = coalesce(coords_at, indexed_at, first_seen, now()),
       coords_from = coalesce(coords_from, case when venue_ref like 'google:%' then 'google' else 'osm' end)
 where lat is not null and coords_at is null;
