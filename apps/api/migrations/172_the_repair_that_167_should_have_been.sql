-- The repair 167 meant to make, with the two holes it left.
--
-- A new file rather than an edit: 167 has run in production, and
-- `schema_migrations` keys on the filename, so an edit of it is a change that
-- never happens where it matters (Codex, 18 Sep 2026).
--
-- Two holes. First, 167 only demoted a place that had a `place_records` row —
-- and a harvested place whose summary was the reason it read "owned" commonly
-- has no record at all, which is exactly the row that needed demoting. Second,
-- it restored "claimed" from `household_places` alone, and a suggested
-- shortlist item or a trip's own base is held only in `place_claims`.
update place_index pi
   set ownership = 'identified', placed_at = null
 where pi.ownership = 'owned'
   and not exists (
     select 1 from attractions a
      where (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref)
        and a.state <> 'hidden'
        and coalesce(a.summary, a.website, a.wikipedia_url) is not null)
   and not exists (
     select 1 from place_records r
      where r.venue_ref = pi.venue_ref
        and (coalesce(r.summary, r.website, r.opening_hours, r.price_range, r.address, r.postcode, r.phone) is not null
             or r.accessibility <> '{}'::jsonb
             or r.curated_at is not null))
   and not exists (
     select 1 from scout_places sp
      where sp.venue_ref = pi.venue_ref and coalesce(sp.website, sp.name) is not null);

-- And everything a household holds, both ways it can hold one.
update place_index pi
   set ownership = 'claimed'
 where pi.ownership = 'identified'
   and (exists (select 1 from household_places hp where hp.venue_ref = pi.venue_ref)
     or exists (select 1 from place_claims pc where pc.venue_ref = pi.venue_ref));
