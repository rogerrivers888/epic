-- A run remembers what it found, and a later run cannot make it forget.
--
-- A surfacing row is one per place per drawer per tile, and it moves: a later
-- census that finds the same place on the same tile updates `last_seen` rather
-- than adding a row, on purpose, so the board reads what is there now. Which
-- means a finished run's place count — counted from surfacings between its
-- start and its finish — went *down* the day the ground was swept again, the
-- mirror image of the growth fixed the day before (Codex, via epic-4e, 24 Sep
-- 2026). A report that changes after the fact is not a report, whichever way
-- it moves.
--
-- So a run keeps its own record of what it found: one row per run per place per
-- drawer, written when the run finds it and never touched again. The surfacing
-- table goes on answering "what is here now"; this answers "what did that run
-- find", and the two are allowed to differ, which is the point.
create table if not exists census_run_surfacings (
  run_id       uuid not null references census_runs(id) on delete cascade,
  venue_ref    text not null,
  subcategory  text not null,
  grid_key     text not null,
  sourced      text not null default 'type',
  seen_at      timestamptz not null default now(),
  primary key (run_id, venue_ref, subcategory)
);
create index if not exists census_run_surfacings_run_idx on census_run_surfacings (run_id, grid_key);

-- The runs so far, from the only record there is. Exact today: no tile has
-- been swept twice, so a surfacing's last_seen inside a run's hours is the
-- moment that run found it. After the first re-sweep this could not be
-- reconstructed, which is why it is written down from here on.
insert into census_run_surfacings (run_id, venue_ref, subcategory, grid_key, sourced, seen_at)
select r.id, ps.venue_ref, ps.subcategory, ps.area_slug, coalesce(ps.sourced, 'type'), ps.last_seen
  from census_runs r
  join census_run_tiles m on m.run_id = r.id
  join place_subcategories ps on ps.area_slug = m.grid_key
 where ps.last_seen >= r.started_at
   and ps.last_seen <= coalesce(r.finished_at, now())
    on conflict do nothing;
