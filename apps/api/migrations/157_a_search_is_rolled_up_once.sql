-- When a search was folded into the monthly totals.
--
-- The rollup counted every row before the cutoff and wrote the month's totals.
-- A cutoff in the middle of a month therefore rolled that month's early rows,
-- dropped them, and then — on the next run — saw only what was left. Replacing
-- the totals threw away the part already rolled, permanently, because the rows
-- behind it were gone; adding them would double-count a run made twice without
-- dropping (Codex, 17 Sep 2026).
--
-- Neither is right without knowing which rows have already been counted. This
-- is that: a search is rolled up exactly once, whatever order the runs are made
-- in and whether or not they drop.

alter table searches add column if not exists rolled_at timestamptz;
create index if not exists searches_unrolled_idx on searches (at) where rolled_at is null;
