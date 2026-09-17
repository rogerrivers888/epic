-- Owned means we hold a fact of our own, not that we made a row.
--
-- `ensureRecord()` makes an empty `place_records` row the moment a household
-- touches a place, so the research has somewhere to write. Calling that owned
-- counted every place we had merely *noticed* as one we had researched: Collect
-- then skipped it as not worth a paid call, the free window stayed shut on it
-- for a year, and coverage said a county was in better shape than it was
-- (Codex, 17 Sep 2026).
--
-- The rule is now the same in three places — `noteOwned`, the rebuild, and
-- here: any one fact of our own is enough, and none is not.

update place_index pi
   set ownership = 'identified', placed_at = null
 where pi.ownership = 'owned'
   and exists (select 1 from place_records r where r.venue_ref = pi.venue_ref)
   -- Not owned through any other route: an atlas row with a summary of its own
   -- is genuinely ours to keep, and a household's claim is its own answer.
   and not exists (
     select 1 from attractions a
      where (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref)
        and a.state <> 'rejected'
        and coalesce(a.summary, a.website, a.wikipedia_url) is not null)
   and not exists (
     select 1 from place_records r
      where r.venue_ref = pi.venue_ref
        and (coalesce(r.summary, r.website, r.opening_hours, r.price_range, r.address, r.phone) is not null
             or r.accessibility <> '{}'::jsonb
             or r.curated_at is not null));

-- A place a household claimed is claimed, not identified.
update place_index pi
   set ownership = 'claimed'
 where pi.ownership = 'identified'
   and exists (select 1 from household_places hp where hp.venue_ref = pi.venue_ref);
