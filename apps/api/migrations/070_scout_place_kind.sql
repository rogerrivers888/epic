-- What kind of place it is, on the sweep's own row.
--
-- The Food half of Inspire could only ever say "Restaurants" (owner, 8 Sep
-- 2026: "you've got just Restaurants instead of all the different types of
-- places: bakeries, bars, etc."). Not because we did not know — `scoutArea.js`
-- already reads a category for every candidate and filters on it — but because
-- `scout_places` had nowhere to put it, so it was computed and dropped, and
-- `routes/inspire.js` hard-coded 'restaurant' for the lot.
--
-- One of: restaurant | cafe | pub | bar | bakery. Nothing licensed: it is the
-- kind of establishment, which the open map states as an amenity tag and which
-- is a fact about the place rather than anybody's content about it.
alter table scout_places add column if not exists category text;

-- Everything already swept, from the research we have already done.
--
-- `place_records.category` comes from OpenStreetMap (sources/osm.js), so this
-- backfills the places that have been matched to the open map and leaves the
-- rest null — and `foodNear` reads the owned record anyway, so a place
-- researched tomorrow sharpens without waiting six months for a re-sweep.
update scout_places p
   set category = r.category
  from place_records r
 where r.venue_ref = p.venue_ref
   and p.category is null
   and r.category in ('restaurant', 'cafe', 'pub', 'bar', 'bakery');
