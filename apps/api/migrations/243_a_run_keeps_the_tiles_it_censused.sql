-- A run keeps the tiles it censused.
--
-- `census_tiles.run_id` names the run that last claimed a square, which is what
-- the working loop needs and the wrong thing to report from. Tiles outlive runs
-- on purpose — "censused in the last 30 days" is a question about the ground —
-- so the next run over overlapping country takes them on, and every earlier
-- run's report loses the ground it covered. The London run has 211 finished
-- tiles; a census of the south coast next week would quietly move them out of
-- its report and leave it saying it did rather less than it did.
--
-- Membership is its own fact and belongs in its own row. A tile can be in
-- several runs over its life, each run keeps what it covered, and the counters
-- on the tile stay what they are: the ground's, not any one run's.
create table if not exists census_run_tiles (
  run_id    uuid not null references census_runs(id) on delete cascade,
  grid_key  text not null references census_tiles(grid_key) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (run_id, grid_key)
);

create index if not exists census_run_tiles_tile_idx on census_run_tiles (grid_key);

-- What the runs so far covered, from the only record there is of it. Every tile
-- a run last claimed was a tile it was given, and no run has yet handed its
-- ground to another — so this is exact today and could not be reconstructed
-- after the first time it is not.
insert into census_run_tiles (run_id, grid_key, added_at)
select t.run_id, t.grid_key, coalesce(t.started_at, t.censused_at, now())
  from census_tiles t
 where t.run_id is not null
    on conflict do nothing;
