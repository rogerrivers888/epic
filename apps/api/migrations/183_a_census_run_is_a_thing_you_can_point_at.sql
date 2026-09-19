-- A census run is a thing you can point at.
--
-- Migration 182 gave a slice its box, its question and whether Google cut it
-- off, but nothing said *which run it belonged to*. Slices are append-only, so
-- the area board's "saturated" count summed every saturated slice ever recorded
-- for that subcategory: a later, cleaner census could not clear an earlier
-- one's saturation, and two runs over the same ground made the number climb on
-- its own (Codex, 19 Sep 2026).
--
-- A run id also gives the thing a partial census most needs — a way to say
-- "these subcategories finished and those were never reached" — so a run that
-- stopped at its ceiling can be resumed instead of being mistaken for a
-- complete one that happened to find nothing.
--
-- 182 has already run, so this is its own file rather than an edit to it: the
-- ledger of applied migrations keys on the filename, and an edited migration is
-- skipped where it has already been seen.

alter table census_slices add column if not exists run_id uuid;
create index if not exists census_slices_run_idx on census_slices (run_id, subcategory);

-- Which run last *finished* this subcategory here, and how much of it ran.
-- A row only appears when the subcategory was carried all the way through, so
-- an area whose census stopped half way has rows for the part that completed
-- and nothing at all for the rest — which is what lets the next run pick it up.
alter table area_counts add column if not exists run_id     uuid;
alter table area_counts add column if not exists complete   boolean not null default true;
