-- The `own` source row goes with the ownership it stood for.
--
-- Migration 156 corrected the places that had been called owned because
-- `ensureRecord()` had made them an empty row. It left their
-- `place_index_sources` row for `own` behind — and that row's `last_seen` is
-- exactly what the twelve-month free-collection window reads, so the places it
-- had just reclassified as unresearched were still shut out of Collect for up
-- to a year (Codex, 17 Sep 2026).
--
-- The same set, in the same words: a record with no fact of ours is not a
-- source that has seen anything.

delete from place_index_sources src
 where src.source = 'own'
   and exists (
     select 1 from place_records r
      where r.venue_ref = src.venue_ref
        and coalesce(r.summary, r.website, r.opening_hours, r.price_range, r.address, r.phone) is null
        and r.accessibility = '{}'::jsonb
        and r.curated_at is null);
