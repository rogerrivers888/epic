-- A hand of places to settle, taken in a different order each time.
--
-- The hourly pass takes five thousand rows waiting to be placed, in no order at
-- all. A row that cannot be placed — the postcode service is down, or the point
-- is somewhere nobody answers about — stays waiting, and the next hour takes the
-- same five thousand: past that number, the places behind them are never
-- reached, so they are never shelved, never scored and never counted (Codex,
-- 18 Sep 2026).
--
-- One column: when we last tried. Oldest attempt first, never-tried first of
-- all, so a blocked row goes to the back of the queue rather than holding the
-- front of it.
alter table place_index add column if not exists settle_tried_at timestamptz;
create index if not exists place_index_unsettled_idx
  on place_index (settle_tried_at nulls first) where placed_at is null;
