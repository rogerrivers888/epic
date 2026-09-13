-- A minimum only exists when money does (Codex, 13 Sep 2026). Rows that were
-- free before the money axis existed could still carry one, and a held
-- booking would be cancelled for missing it. Its own file, because 084 has
-- already been applied on development databases and the runner records files.
update host_offers set min_count = null where money = 'free';
