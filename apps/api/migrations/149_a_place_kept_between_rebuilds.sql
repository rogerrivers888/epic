-- When a place was last *placed*, as distinct from when it was last scored.
--
-- `noteMany` writes the index row the moment a place is kept, and that is all
-- it writes: no area, no cell, no shelf, no score. Every board in Places reads
-- through `place_areas`, so until something derives those, a newly swept or
-- claimed place is in the index and on no screen — and it stayed that way
-- until an administrator thought to press Rebuild (Codex, 17 Sep 2026).
--
-- `indexed_at` could not be the marker: it defaults to now(), so a brand new
-- row already looks done. This one has no default, which is the point — null
-- means nobody has placed it yet, and `settleNew()` works through them on the
-- hour.

alter table place_index add column if not exists placed_at timestamptz;
create index if not exists place_index_unplaced_idx on place_index (placed_at) where placed_at is null;

-- Everything already in the index was placed by the last full rebuild.
update place_index set placed_at = coalesce(indexed_at, now()) where placed_at is null;
