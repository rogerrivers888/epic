-- A surfacing remembers which run found it.
--
-- The board shows a drawer's gap — surfaced above filed — and now says whose
-- shelf the surplus went to. The two numbers came from different places:
-- `area_counts.surfaced_count` is the latest completed run, and the "lives on"
-- breakdown was every surfacing ever recorded. `place_subcategories` keeps a
-- row after a later census stops finding the place, deliberately, so that "this
-- used to be here" stays legible — which means after a re-census the board
-- could read "+1" beside "on museums 10" (Codex, 20 Sep 2026).
--
-- A number and its explanation have to come from the same run or the
-- explanation is about a different census than the one on screen.
--
-- Backfilled from `last_seen` against the slices: a surfacing whose last sight
-- of a place is at or after that area's latest clean run belongs to it. Rows
-- older than any run keep a null, which reads as "before we recorded this"
-- rather than as a run.

alter table place_subcategories add column if not exists run_id uuid;
create index if not exists place_subcategories_run_idx on place_subcategories (run_id);

update place_subcategories ps
   set run_id = latest.run_id
  from (
    select cs.area_slug, cs.subcategory, cs.run_id, max(cs.ran_at) as ran_at
      from census_slices cs
     where cs.problem is null
     group by cs.area_slug, cs.subcategory, cs.run_id
  ) latest
 where ps.run_id is null
   and ps.area_slug = latest.area_slug
   and ps.subcategory = latest.subcategory
   and ps.last_seen >= latest.ran_at - interval '1 hour';
