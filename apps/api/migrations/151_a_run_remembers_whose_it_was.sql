-- Which household a collection run was started for.
--
-- A resumed run used to be picked up with `currentHousehold()`, which outside a
-- request deliberately answers with the founding household. Every provider call
-- and every piece of research after a deploy was then attributed to the wrong
-- one — and attribution in `provider_calls` is the thing that makes spend
-- answerable at all (Codex, 17 Sep 2026).

alter table collect_runs add column if not exists household_id uuid references households(id) on delete set null;
