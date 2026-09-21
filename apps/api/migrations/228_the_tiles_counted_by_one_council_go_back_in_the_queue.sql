-- The tiles counted by one council go back in the queue.
--
-- 226 taught a tile which councils it is waiting on; this puts back the ones
-- counted before it knew. Every register count taken by the old sweep was
-- dated after a single authority, so any tile that shares a boundary is
-- holding part of its kitchens and saying it is finished.
--
-- The count itself is kept — it is real, and 219 makes the missing councils add
-- to it rather than replace it. Only the date goes, which is what puts the tile
-- back in front of the sweep. A tile that genuinely had one council will be
-- asked at its five points, find one, and be dated again within the hour.
--
-- Not an edit to 226: that file has already run where it has run, and an edited
-- migration is skipped by the ledger that keys on its name (CLAUDE.md).
update census_tiles
   set fhrs_at = null
 where fhrs_at is not null
   and fhrs_authorities is null;
