-- What a collection run was in the middle of asking about.
--
-- The worker took a chunk off the list *after* the calls came back. A deploy or
-- a crash in between therefore left every one of those places on `todo`, and
-- the resumed run asked — and paid — for all of them again (Codex, 17 Sep
-- 2026).
--
-- The chunk moves here before the first call goes out. A run that comes back to
-- find something in `asking` cannot know whether those calls were billed, and
-- the safe direction is not to pay twice: a place we did not ask about is a gap
-- somebody can see on the board, and a place we paid for twice is invisible.

alter table collect_runs add column if not exists asking jsonb not null default '{}'::jsonb;
