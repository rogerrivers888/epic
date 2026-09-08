-- Which sources a swept place actually came from.
--
-- The sweep already knows: a candidate carries `from: ['osm']`, `['google']`,
-- or both, and the twin-matching step pushes 'google' onto an OpenStreetMap row
-- when the two are the same restaurant. That array was never written down, and
-- once it is lost the row cannot say where its name came from.
--
-- What that cost, found 8 Sep 2026 by a Codex review and then measured against
-- production: every one of the 150 food rows the home screen serves around
-- Henley is keyed on a Google identifier, and every one is credited to
-- "OpenStreetMap contributors, ODbL" — including the ones OpenStreetMap has
-- never heard of, whose name came from Google. Crediting one source for another
-- source's work is wrong whichever way the licence runs, and it cannot be
-- corrected by reading the row, because the row does not know.
--
-- Existing rows are backfilled from the only evidence left, which is the shape
-- of the identifier. That is honest rather than complete: a `google:` row that
-- OpenStreetMap also contributed to will under-credit OSM until the next sweep
-- writes the truth. Under-crediting the open source we are allowed to use is
-- the safe direction to be wrong in.

alter table scout_places add column if not exists from_sources jsonb not null default '[]';

comment on column scout_places.from_sources is
  'Which sources contributed this row: ["osm"], ["google"], or both. Decides what the device is told to credit.';

update scout_places
   set from_sources = case
         when venue_ref like 'google:%' then '["google"]'::jsonb
         when venue_ref like 'osm:%'    then '["osm"]'::jsonb
         else '[]'::jsonb end
 where from_sources = '[]'::jsonb;
