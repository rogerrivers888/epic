-- The same demotion as 156, with the state that actually exists.
--
-- 156 kept a place "owned" where an attraction held a summary or a website of
-- its own, and excluded the retired ones with `state <> 'rejected'` — a state
-- `attractions` has never used. The vocabulary is candidate, published, hidden
-- (repositories/library.js sets the last one), so the guard excluded nothing and
-- a retired attraction went on making its place look researched (Codex, 18 Sep
-- 2026).
--
-- A new file rather than an edit of 156: `schema_migrations` keys on the
-- filename, so editing one that has run is a change that never happens where it
-- matters most.
update place_index pi
   set ownership = 'identified', placed_at = null
 where pi.ownership = 'owned'
   and exists (select 1 from place_records r where r.venue_ref = pi.venue_ref)
   and not exists (
     select 1 from attractions a
      where (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref)
        and a.state <> 'hidden'
        and coalesce(a.summary, a.website, a.wikipedia_url) is not null)
   and not exists (
     select 1 from place_records r
      where r.venue_ref = pi.venue_ref
        and (coalesce(r.summary, r.website, r.opening_hours, r.price_range, r.address, r.phone) is not null
             or r.accessibility <> '{}'::jsonb
             or r.curated_at is not null));

-- And a place a household claimed is claimed, not identified — the same second
-- half 156 has, because the first half above may have just demoted one.
update place_index pi
   set ownership = 'claimed'
 where pi.ownership = 'identified'
   and exists (select 1 from household_places hp where hp.venue_ref = pi.venue_ref);
