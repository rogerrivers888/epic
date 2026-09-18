-- The last of the retirement repair.
--
-- 172 kept a place "owned" where `scout_places` held a name, and the rebuild
-- files a swept place as *identified*: the sweep keeps the place, not the
-- research. So a retired attraction with a sweep row stayed counted as
-- researched and Collect went on skipping it (Codex, 18 Sep 2026).
--
-- A new file rather than an edit of 172, which has run here.
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
             or r.curated_at is not null));

update place_index pi
   set ownership = 'claimed'
 where pi.ownership = 'identified'
   and (exists (select 1 from household_places hp where hp.venue_ref = pi.venue_ref)
     or exists (select 1 from place_claims pc where pc.venue_ref = pi.venue_ref));
