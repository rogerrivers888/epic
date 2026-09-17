-- The monthly totals remember the conversions too.
--
-- `search_rollups` kept the searches, the empty ones and the two middle faults
-- and dropped `tripped` — the third of the three outcomes, and the only one
-- that says anything went right. So switching retention on would have thrown
-- away every conversion older than the window, permanently, because the log
-- cannot be backfilled (Codex, 17 Sep 2026).

alter table search_rollups add column if not exists tripped integer not null default 0;
