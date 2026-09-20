-- A tile says when this census of it began.
--
-- `place_subcategories` keeps a surfacing after the question stops finding it,
-- on purpose: "this used to be here" is a fact worth keeping, and a drawer that
-- quietly loses a place is a drawer nobody can audit. But the tile's own place
-- count was a distinct count of *every* surfacing filed against the tile, ever
-- — so re-censusing ground made its number go up even where Google returned
-- fewer places than last time, and `refreshProgress` published that inflated
-- figure as the run's total (Codex, 20 Sep 2026).
--
-- A count of what is there now needs a "now" to count from. This is it: the
-- moment the current sweep of this tile started. A resumed tile keeps its
-- start, because a tile answered over three passes of the loop is still one
-- census of it; a tile that comes round again after the freshness window gets
-- a new one, and everything the last census found falls out of the count
-- unless this one finds it too.
alter table census_tiles add column if not exists started_at timestamptz;

-- The tiles already censused, dated from what they actually did. Without this
-- every existing tile reads as never started and counts nothing at all, which
-- is the opposite error.
update census_tiles set started_at = censused_at where started_at is null and censused_at is not null;
