-- The open map is read from our own copy (back-office handover 5.3, "The
-- local OSM extract replaces live Overpass"; owner, 28 Sep 2026: "Start Phase
-- 2 with the local OSM extract").
--
-- Live Overpass is somebody else's machine, run for free, and on any given day
-- one or two of its mirrors refuse or hang (sources/overpass.js, measured 5
-- Sep 2026): 119 of the 123 failures in the paid sweep of 25 Sep were
-- Overpass timeouts. A Geofabrik extract, read into this table, answers the
-- same questions the researcher asks — one element by id, named places near a
-- point, places of a kind near a point — from our own database, in
-- milliseconds, every time.
--
-- ODbL: OpenStreetMap data may be kept for good with attribution. Only named
-- places of the kinds a day out or its reachability needs are kept, never
-- roads or houses.

create table if not exists osm_features (
  ref         text primary key,            -- 'node/123', 'way/45', 'relation/6'
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  tags        jsonb not null,
  region      text not null,               -- the extract it came from: 'great-britain', 'ireland-and-northern-ireland'
  load_id     uuid not null
);
create index if not exists osm_features_lat_lng on osm_features (lat, lng);
create index if not exists osm_features_region on osm_features (region, load_id);

-- One row per extract: where it came from, when, what it held, and whether the
-- load finished. The researcher reads the local table only for a point inside
-- a finished extract's box; anywhere else it still asks Overpass.
create table if not exists osm_extracts (
  region       text primary key,
  url          text not null,
  load_id      uuid,
  state        text not null default 'never' check (state in ('never','downloading','reading','done','failed')),
  features     integer,
  bytes        bigint,
  min_lat      double precision,
  max_lat      double precision,
  min_lng      double precision,
  max_lng      double precision,
  problem      text,
  started_at   timestamptz,
  finished_at  timestamptz,
  started_by   text
);
