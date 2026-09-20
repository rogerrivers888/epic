-- The free count the census is measured against.
--
-- The big census brief, 20 Sep 2026, §4: "Cross-checks in the same pass. OSM
-- counts via Overpass and FHRS counts for food, per box and subcategory,
-- stored beside the census count. A subcategory well below its ground count is
-- a query gap, fixed by widening the fan-out at no cost — and that is a finding
-- the audit wants."
--
-- **Per box, and that is the whole point.** `area_counts.osm_count` and
-- `fhrs_count` have existed since the census did and have never been filled,
-- because nothing could fill them honestly: an outcode is an irregular shape
-- and the free sources answer about a rectangle or a circle. The census asks
-- Google inside a tile, so the check has to be asked of the same tile, and the
-- outcode number is then a roll-up of tiles rather than a second measurement
-- of a different shape.
--
-- Counts, never content. The Food Standards Agency register is open data and
-- OpenStreetMap is ODbL, so either could be kept — but neither is a source Epic
-- shows a household (CLAUDE.md: free data is "a check on Google, not a second
-- source of discovery or opinion", and in the back office only). So the
-- establishments and the map elements are counted in memory and thrown away,
-- and what is written down is a number, its source, the box it was counted in
-- and the day it was counted.

create table if not exists ground_counts (
  -- The tile this was counted in. Text rather than a foreign key: a grid key
  -- names a square of the world (`0.08x0.12/643/-2`), and a check of a square
  -- outlives any census_tiles row that happens to reference it — the same
  -- reason tiles outlive runs in 215.
  grid_key      text not null,
  -- 'osm' or 'fhrs'. Purposes are stable strings: add, never rename.
  source        text not null,
  -- The Epic subcategory this is the ground count *for*. Never a source's own
  -- word: `amenity=restaurant` is how the count was got, not what it means.
  subcategory   text not null,
  places        integer not null,
  -- How it was asked, kept so a count that reads wrong can be explained without
  -- re-running it. The Overpass selectors, or the FHRS business type ids.
  asked         text,
  -- Why this number is not the whole truth — every free count has a caveat and
  -- an uncaveated one would be read as a target. "Counts a crag as well as a
  -- climbing wall", "a club mapped twice is counted twice".
  caveat        text,
  problem       text,
  counted_at    timestamptz not null default now(),
  primary key (grid_key, source, subcategory)
);

create index if not exists ground_counts_sub_idx on ground_counts (subcategory, source);
create index if not exists ground_counts_at_idx on ground_counts (counted_at);

-- When the free sources were last asked about an area, beside when Google was.
-- `osm_at` and `fhrs_at` already exist on area_counts (the census's own
-- migration); this is the same fact for a tile, so the sweep knows what it has
-- done without reading every ground_counts row.
alter table census_tiles add column if not exists osm_at  timestamptz;
alter table census_tiles add column if not exists fhrs_at timestamptz;
