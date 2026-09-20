-- A row says how many calls it watched, not just whether they all worked.
--
-- Migration 203 gave a call an outcome. It did not say how many calls a row is
-- about — and one row is often several: a search hands a single meter to every
-- adapter and writes one row for the whole search, with `failed` counting how
-- many of its requests fell over.
--
-- So a failure rate computed over *rows* is wrong in the worst direction: a
-- search of eight Google requests with one failure read as **100% failed**,
-- and two failures in one row read as 200% (Codex, 20 Sep 2026).
--
-- `watched` is the denominator: how many calls this row actually observed.
-- Null where nothing was observed, exactly like `ok`, so an uninstrumented
-- adapter still reads as "not watched" rather than as a division by nought.

alter table provider_calls add column if not exists watched integer;

-- Every row already written under 203 observed exactly one call — the two
-- instrumented adapters were the token-billed Claude path and Google's own
-- funnel, and both record one row per request at the point this ran.
update provider_calls set watched = 1 where ok is not null and watched is null;
