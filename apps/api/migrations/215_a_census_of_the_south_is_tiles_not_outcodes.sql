-- A census of the south is tiles, not outcodes.
--
-- The big census brief, 20 Sep 2026, §4: "Tile, do not iterate outcodes.
-- Outcodes are irregular and overlapping; tiles are clean, split predictably on
-- saturation and deduplicate naturally on place ID. Map results back to
-- outcodes afterwards for reporting."
--
-- The overlap is not a detail. The thirty-nine-outcode ring was censused by
-- drawing an eight-kilometre box around each outcode's centre, and those boxes
-- cover the same ground three and four times over — which is most of why the
-- brief's own estimate for London and the home counties came out at 1.1 million
-- requests. The same region on a fixed grid, keeping only the tiles a postcode
-- sector actually falls in, is 390 tiles.
--
-- Two tables. A **run** is a person deciding to census a region, with the
-- ceiling and the pace they chose; a **tile** is a square of the grid and is
-- the unit of work, of coverage and of resumption. Tiles outlive runs on
-- purpose: "skip anything censused in the last 30 days" is a question about the
-- ground, not about the run that last covered it.

create table if not exists census_runs (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  -- The postcode areas the region is made of, and the grid it is cut on. Both
  -- are written down because a count means nothing without knowing what was
  -- covered, and neither can be recovered from the tiles alone once somebody
  -- changes the default.
  areas         text[] not null default '{}',
  tile_lat      numeric not null,
  tile_lng      numeric not null,
  -- running · paused (its ceiling, resumable) · stopped (a person) ·
  -- refused (the provider) · done
  state         text not null default 'running',
  -- The guard that actually bounds a run. Essentials requests are free, which
  -- is exactly the condition under which a runaway goes unnoticed: nothing in
  -- the ledger would complain (sources/census.js).
  max_requests  integer not null default 250000,
  -- Requests a second, paced rather than budgeted. The ring census achieved
  -- about five a second serially; this is a rate question, not a cost one.
  rate_per_sec  numeric not null default 5,
  fresh_days    integer not null default 30,
  stop_requested boolean not null default false,
  requests      integer not null default 0,
  slices        integer not null default 0,
  places        integer not null default 0,
  saturated     integer not null default 0,
  tiles_total   integer not null default 0,
  tiles_done    integer not null default 0,
  problem       text,
  started_at    timestamptz not null default now(),
  started_by    text,
  -- A heartbeat, so a run whose process died mid-tile can be told apart from
  -- one that is simply slow. The harvest learned this the hard way: a job that
  -- gets a single resume attempt will sooner or later spend it inside somebody
  -- else's deploy (server.js).
  last_seen_at  timestamptz not null default now(),
  finished_at   timestamptz
);

create table if not exists census_tiles (
  id            uuid primary key default gen_random_uuid(),
  -- The grid square itself: step and indices, so the same square is the same
  -- row whoever asks for it and two runs over the same ground cannot both do
  -- it. A different step is a different grid and a different key, which is
  -- honest — the tiles are not comparable.
  grid_key      text not null unique,
  min_lat       double precision not null,
  min_lng       double precision not null,
  max_lat       double precision not null,
  max_lng       double precision not null,
  -- Which outcodes have a postcode sector inside this tile. This is how a tile
  -- census is reported by outcode afterwards, and it is stored rather than
  -- recomputed because the sector table moves.
  outcodes      text[] not null default '{}',
  state         text not null default 'todo',
  -- The checkpoint the brief asks for: per tile, per subcategory. A tile
  -- interrupted half way through its drawers resumes at the next one rather
  -- than paying for the ones already done.
  done_subcategories text[] not null default '{}',
  requests      integer not null default 0,
  slices        integer not null default 0,
  places        integer not null default 0,
  -- Slices still cut off at the depth limit. A tile with any of these is a
  -- floor, not a count, and every number drawn from it has to say so.
  saturated     integer not null default 0,
  problem       text,
  censused_at   timestamptz,
  -- Held by the process currently working it, so two instances of the API
  -- cannot take the same tile. Cleared when the tile finishes or is released.
  claimed_at    timestamptz,
  claimed_by    text,
  run_id        uuid references census_runs(id) on delete set null
);

create index if not exists census_tiles_state_idx on census_tiles (state, censused_at);
create index if not exists census_tiles_run_idx on census_tiles (run_id);
create index if not exists census_tiles_outcodes_idx on census_tiles using gin (outcodes);

-- Coverage, on the counts themselves.
--
-- §5: "A count of 2,400 for a subcategory means nothing without knowing what
-- was covered… every count shown anywhere is labelled with its coverage."
-- `tiles` and `tiles_saturated` say how much ground the number is drawn from
-- and how much of that ground was cut off; `unresolved` is the places whose
-- slice box straddles the edge of the area, which are neither in nor out and
-- must never be silently dropped (owner, 20 Sep 2026: "Do not discard them.
-- Resolve them, then count them").
alter table area_counts add column if not exists tiles           integer;
alter table area_counts add column if not exists tiles_saturated integer;
alter table area_counts add column if not exists unresolved      integer;
