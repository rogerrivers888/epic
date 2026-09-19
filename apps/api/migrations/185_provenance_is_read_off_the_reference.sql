-- Provenance is read off the reference, not assumed.
--
-- Migration 184's backfill split existing coordinates two ways: a `google:` ref
-- was marked as Google's and *everything else* as OpenStreetMap's. The expiry
-- sweep deliberately leaves OSM alone, because ODbL lets us keep a point — so
-- that backfill quietly granted permanent retention to every licensed
-- provider's coordinates that is not Google's. A `tripadvisor:` place would
-- have kept its point for ever under a rule written to throw it away after
-- thirty days (Codex, 19 Sep 2026).
--
-- The reference already says whose the point is, and it is the only thing that
-- does. `osm:`, `atlas:` and `own:` are ours to keep — the open map, our own
-- harvest, our own research. Anything else is rented and gets the clock. A
-- prefix nobody has taught us about is treated as rented, because assuming we
-- may keep a stranger's data is the expensive mistake and assuming we may not
-- costs one display search.
--
-- 184 has already run, so this corrects it in its own file rather than editing
-- it: the ledger of applied migrations keys on the filename.

update place_index
   set coords_from = case
         when venue_ref like 'osm:%'   then 'osm'
         when venue_ref like 'atlas:%' then 'atlas'
         when venue_ref like 'own:%'   then 'own'
         else split_part(venue_ref, ':', 1)
       end
 where lat is not null;

-- And a date for anything that has a point and somehow no clock, so the sweep
-- can see it. A null here would read as "never had one" and be skipped, which
-- is the one outcome that keeps a rented point for ever.
update place_index
   set coords_at = coalesce(indexed_at, first_seen, now())
 where lat is not null and coords_at is null;
