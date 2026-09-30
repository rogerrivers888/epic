-- Three owned sources of points, held on our own disk (owner, C59 step 3, 30
-- Sep 2026: "Add FSA coordinates (OGL), a Historic England client (OGL) and
-- OS Open Names/Open UPRN (OGL). Record the source and licence per point").
--
-- Each is a published open dataset, loaded whole and refreshed weekly, so a
-- place is matched against it without asking anybody: the FSA food hygiene
-- register (every food business, with its point), the National Heritage List
-- for England (listed buildings, scheduled monuments, parks and gardens,
-- battlefields, World Heritage Sites) and OS Open Names (named natural and
-- landscape features — hills, woods, lakes, beaches). OS Open UPRN is not
-- loaded: it holds a number and a point and nothing else, so no place can be
-- matched to it without already knowing its UPRN, which no free source gives.

-- Each load is written beside the last, keyed by its load, and becomes the
-- live one only once it is whole: a load that fails part-way never touches the
-- rows the matcher is reading (Codex, 30 Sep 2026).
create table if not exists fsa_establishments (
  fhrsid          bigint not null,
  name            text not null,
  business_type   text,
  business_type_id integer,
  postcode        text,
  authority       text,
  lat             double precision not null,
  lng             double precision not null,
  load_id         uuid not null,
  primary key (fhrsid, load_id)
);
create index if not exists fsa_establishments_lat_lng on fsa_establishments (load_id, lat, lng);

create table if not exists heritage_entries (
  list_entry  bigint not null,
  layer       text not null,        -- 'listed-building', 'scheduled-monument', 'park-garden', 'battlefield', 'world-heritage'
  name        text not null,
  grade       text,
  lat         double precision not null,
  lng         double precision not null,
  load_id     uuid not null,
  primary key (list_entry, layer, load_id)
);
create index if not exists heritage_entries_lat_lng on heritage_entries (load_id, lat, lng);

create table if not exists os_names (
  id          text not null,        -- OS's own identifier, e.g. 'osgb4000000074568954'
  name        text not null,
  type        text not null,        -- 'landform', 'hydrography', 'landcover', 'other'
  local_type  text,                 -- 'Hill Or Mountain', 'Woodland Or Forest', ...
  lat         double precision not null,
  lng         double precision not null,
  load_id     uuid not null,
  primary key (id, load_id)
);
create index if not exists os_names_lat_lng on os_names (load_id, lat, lng);

-- One row per source: when it was last loaded, how much, and whether it worked.
create table if not exists owned_source_loads (
  source       text primary key check (source in ('fsa', 'historic-england', 'os-open-names')),
  state        text not null default 'never' check (state in ('never', 'loading', 'done', 'failed')),
  load_id      uuid,                -- the load being written, or the last one written
  live_load    uuid,                -- the load the matcher reads: the last one that arrived whole
  rows         integer,
  licence      text not null,
  url          text,
  problem      text,
  started_at   timestamptz,
  finished_at  timestamptz,
  started_by   text
);
insert into owned_source_loads (source, licence) values
  ('fsa', 'OGL-UK-3.0'), ('historic-england', 'OGL-UK-3.0'), ('os-open-names', 'OGL-UK-3.0')
on conflict (source) do nothing;

-- A match run over the places we hold: the one-off backfill, and each weekly
-- re-match. Written as it goes, so a deploy mid-run resumes from `after`.
create table if not exists owned_point_runs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('backfill', 'weekly')),
  state        text not null default 'running' check (state in ('running', 'done', 'failed')),
  after        text,                -- the last reference looked at, for resuming
  looked       integer not null default 0,
  matched      integer not null default 0,
  by_source    jsonb not null default '{}'::jsonb,
  no_key       integer not null default 0,   -- places with nothing to match on: no name and no point
  problem      text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  started_by   text
);

-- The match run reads every copy of a place by its reference; these tables are
-- keyed on something else first.
create index if not exists scout_places_venue_ref_idx on scout_places (venue_ref);
create index if not exists household_places_venue_ref_idx on household_places (venue_ref);
create index if not exists trip_shortlist_venue_ref_idx on trip_shortlist (venue_ref);
create index if not exists trip_stops_venue_ref_idx on trip_stops (venue_ref);
create index if not exists visits_venue_ref_idx on visits (venue_ref);
