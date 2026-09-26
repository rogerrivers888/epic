-- A run can keep to the night and to a share of the day, and a tile is
-- planned for the district its postcodes say.
--
-- Owner, 26 Sep 2026, on the follow-up pass over the outer ring: "It must
-- never take the whole 75,000 daily cap — households' own searches share it.
-- Propose a daily share that leaves real headroom, run it overnight across
-- as many nights as that takes … Build it paused; I press start." So a run
-- may carry its own share of a day's requests (night_share) and the hours it
-- is allowed to work (window_from/window_to, UTC), beside the project-wide
-- daily_cap it already had.
--
-- And: "does the loose tile tagging affect the 'N of M tiles' progress shown
-- for a district? If yes, fix the tagging so each tile is planned for the
-- district its postcode says." It did — a tile counted toward a district's
-- progress by the sector that planned it, not by the ground inside it. Every
-- censused tile is tagged here with the districts whose postcodes fall inside
-- it, where the postcode table has them; a tile with no postcode inside (the
-- sea, a park) keeps the tags it had.

alter table census_runs add column if not exists night_share integer;
alter table census_runs add column if not exists window_from smallint;
alter table census_runs add column if not exists window_to   smallint;

update census_tiles t
   set outcodes = coalesce(
     (select array_agg(distinct p.outcode order by p.outcode) from postcodes p
       where p.lat >= t.min_lat and p.lat < t.max_lat and p.lng >= t.min_lng and p.lng < t.max_lng),
     t.outcodes)
 where exists (select 1 from postcodes limit 1);
