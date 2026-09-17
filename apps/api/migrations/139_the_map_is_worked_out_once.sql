-- The map, worked out once.
--
-- Owner, 17 Sep 2026: "instead of having to do map distance calculations every
-- time someone does a search, we will already hold and know instantly which
-- activities are within their particular area."
--
-- So: a table of cells, and a table of how long it takes to get from each cell
-- to every other one within an hour and a half. Both are built once and read
-- for ever. A search stops being a calculation over every place and becomes a
-- lookup of the cells it can reach.
--
-- The cell's code carries its scheme — `sector:SL4 1`, `outcode:SL4` — because
-- a postcode sector is a British idea and the countries after this one have
-- their own. A grid square or an H3 hexagon drops into the same column with no
-- migration, and `reach` never learns what any of them mean.

create table if not exists geo_cells (
  code          text primary key,              -- 'sector:SL4 1'
  scheme        text not null,                 -- sector | outcode | grid | h3
  label         text not null,                 -- 'SL4 1' — what a person would say
  country_code  text not null default 'GB',
  -- The district a sector sits in, so the two schemes can be read together.
  outcode       text,
  lat           double precision not null,
  lng           double precision not null,
  -- A sector's centre is the mean of the postcodes we have seen inside it, so
  -- it improves as more places are indexed. `points` is how many made it.
  points        integer not null default 1,
  places        integer not null default 0,
  source        text not null,
  first_seen    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists geo_cells_scheme_idx  on geo_cells (country_code, scheme);
create index if not exists geo_cells_outcode_idx on geo_cells (outcode);
-- Snapping a coordinate to its nearest cell is the one query that cannot use
-- the primary key, and it runs on every search that does not start at a postcode.
create index if not exists geo_cells_at_idx on geo_cells (lat, lng);

-- How long it takes to get from one cell to another.
--
-- `method` says how the number was arrived at: `estimate` is this repository's
-- own straight-line model (domain/travel.js), `osrm` is a real route over the
-- road network. The column exists so the two can sit side by side while the
-- matrix is upgraded a region at a time, and so a screen can say which it is
-- looking at rather than implying a precision it has not got.
create table if not exists reach (
  from_cell text     not null references geo_cells(code) on delete cascade,
  to_cell   text     not null references geo_cells(code) on delete cascade,
  mode      text     not null default 'driving',
  minutes   smallint not null,
  km        real     not null,
  method    text     not null default 'estimate',
  primary key (from_cell, to_cell, mode)
);
-- The whole point of the table: "every cell within 30 minutes of this one",
-- answered from the index without reading a row that is further away.
create index if not exists reach_from_idx on reach (from_cell, mode, minutes) include (to_cell, km);

-- One build of the matrix, so a run that stopped halfway can be told from an
-- area that is genuinely thin — the same distinction the sweep makes.
create table if not exists reach_runs (
  id           uuid primary key default gen_random_uuid(),
  scheme       text not null,
  mode         text not null,
  method       text not null,
  cap_minutes  smallint not null,
  cells        integer not null default 0,
  pairs        bigint  not null default 0,
  state        text not null default 'running',   -- running | done | failed
  why          text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- Which cell each place sits in.
--
-- Keyed on `venue_ref` rather than held as a column on each of the three place
-- tables, because that is the shape the place index will want and because a
-- join table can be rebuilt without touching a row anybody else is reading. An
-- attraction with no venue_ref of its own is keyed `atlas:<id>`.
--
-- `postcode` is kept beside the cell: it comes from ONS through postcodes.io,
-- which is Open Government Licence and ours to hold, and without it a wrong
-- cell can never be explained.
--
-- `cell` is nullable on purpose. A place in the sea, outside the United Kingdom
-- or two miles from the nearest postcode gets a row with no cell and is never
-- asked about again. Without that the stamping pass asks ONS about the same
-- unplaceable thousand on every run: the first real pass spent 905 requests to
-- place 496 places, because the ones it could not place came back every time.
-- `why` says which it was, so a bad batch can be told from a genuinely
-- unplaceable one.
create table if not exists place_cells (
  venue_ref  text primary key,
  cell       text references geo_cells(code) on delete cascade,
  postcode   text,
  lat        double precision,
  lng        double precision,
  why        text,
  at         timestamptz not null default now()
);
create index if not exists place_cells_cell_idx on place_cells (cell);
