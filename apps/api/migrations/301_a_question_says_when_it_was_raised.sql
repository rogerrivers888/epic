-- When a closed-check question was raised (decision C57, round four; Codex,
-- 29 Sep 2026).
--
-- A family's visit settles a place in review only if it came after the
-- evidence that made it a question. Where that evidence names no year, the
-- measure was `decided_at` — but `decided_at` moves only when the status or
-- confirmation changes, so an `unknown` row that *became* a question later
-- kept its older date, and a visit before the question counted as after it.
--
-- `review_since` is set when `review` turns true and cleared when it turns
-- false (repositories/placeStatus.js `propose`). Rows already in review take
-- `decided_at`, the best date there is for them.
--
-- A follow-on, never an edit: migration 298 has run on production.

alter table place_status add column if not exists review_since timestamptz;
update place_status set review_since = decided_at where review and review_since is null;
