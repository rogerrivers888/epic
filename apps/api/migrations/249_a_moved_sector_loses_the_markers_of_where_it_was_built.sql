-- A sector moved by 248 loses the build markers of where it was built from.
--
-- 248 dropped the reach markers of sectors whose ONS centre was more than a
-- quarter of a kilometre from the cell's *latest* position. The matrix was not
-- built from the latest position: it was built from `built_lat`/`built_lng`
-- on the marker, which may already have drifted, and a marker with no build
-- coordinates at all is stale by definition — both exactly as `noteCell`
-- reads them. A marker kept by 248's test can therefore sit on travel rows
-- worked out from a point the sector no longer occupies, and `reach.refresh`
-- would skip it for ever (Codex, 25 Sep 2026).
--
-- A new migration rather than an edit to 248, which has run: "never edit a
-- committed migration … it goes in a new 249_*.sql instead" (owner, 25 Sep
-- 2026, via epic-53).

delete from cell_builds b
 using geo_cells g
 where b.from_cell = g.code
   and g.source = 'onspd-2026-08'
   and (b.built_lat is null or b.built_lng is null
        or sqrt(((b.built_lat - g.lat) * 111320) ^ 2 + ((b.built_lng - g.lng) * 70000) ^ 2) > 250);
