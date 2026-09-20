-- A sweep is dated from when it started, not from when it finished.
--
-- 220 gave a tile the moment its current sweep began, and backfilled the tiles
-- already censused from `censused_at`. That is the moment the sweep *ended*, so
-- every place those tiles found was last seen before the tile's own start — by
-- forty-six milliseconds in Ascot's case, and by twenty minutes in central
-- London's. The counts then read nought, and the roll-up to outcodes silently
-- skipped the district altogether (20 Sep 2026).
--
-- The slices know: `census_slices.ran_at` is written per question asked, so the
-- first one is when the sweep started. Where there are no slices to go on the
-- tile keeps its end date, which is late but never excludes everything.
update census_tiles t
   set started_at = least(
         coalesce((select min(s.ran_at) from census_slices s where s.area_slug = t.grid_key), t.started_at),
         coalesce((select min(p.last_seen) from place_subcategories p where p.area_slug = t.grid_key), t.started_at),
         t.started_at)
 where t.started_at is not null;
