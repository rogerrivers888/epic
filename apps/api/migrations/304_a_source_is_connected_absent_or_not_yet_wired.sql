-- A source is connected, absent, or not yet wired (Markets design v2.2, owner
-- 29 Sep 2026). A market's owned sources read in three states, and they mean
-- different things:
--   connected     — plain, answering here.
--   absent        — does not exist in this country (FSA in Portugal); grey,
--                   final, no action, and NOT counted against the market.
--   notConnected  — exists here but nobody has wired it up yet (the Portugal
--                   OSM extract is not loaded); amber, with a Connect action.
--
-- Migration 300 seeded the state as 'here'; the design's word is 'connected'.
-- And every groundwork market's OpenStreetMap extract is not loaded yet, so it
-- is notConnected, not connected — which is what makes Portugal read "3 of 4",
-- out of the sources that can exist there. A follow-on, never an edit to 300.

-- here → connected, everywhere.
update markets
   set sources = (
     select jsonb_agg(case when s->>'state' = 'here'
                           then jsonb_set(s, '{state}', '"connected"')
                           else s end)
       from jsonb_array_elements(sources) s),
       updated_at = now()
 where sources @> '[{"state":"here"}]';

-- Groundwork markets: the OSM extract is not loaded yet. Only groundwork — GB
-- is a soft launch with its extract loaded, and stays connected.
update markets
   set sources = (
     select jsonb_agg(case when s->>'id' = 'osm'
                           then jsonb_set(jsonb_set(s, '{state}', '"notConnected"'), '{note}', '"extract not loaded yet"')
                           else s end)
       from jsonb_array_elements(sources) s),
       updated_at = now()
 where status = 'groundwork'
   and sources @> '[{"id":"osm"}]';
