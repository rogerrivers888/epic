-- A corrected postcode is a fact of our own, and two migrations said it was not.
--
-- Migrations 156 and 161 listed the facts that make a `place_records` row ours
-- — a summary, a website, the hours, a price band, a street, a telephone
-- number, step-free, a curation — and left the postcode out. The runtime
-- definition (`OWNED_FACTS` in domain/placeIndex.js) includes it, because an
-- administrator correcting an outcode is doing research. So a place whose only
-- fact was a postcode was demoted to "identified" and had its `own` source row
-- deleted, and stayed that way until somebody ran a full rebuild (Codex, 17 Sep
-- 2026).
--
-- This puts those two back. The list is the runtime one, and it is the last
-- time it is written out in SQL by hand: everything that asks now reads
-- `ownedRecordSql()`.

update place_index pi
   set ownership = 'owned'
 where pi.ownership <> 'owned'
   and exists (
     select 1 from place_records r
      where r.venue_ref = pi.venue_ref
        and coalesce(r.summary, r.website, r.opening_hours, r.price_range,
                     r.address, r.postcode, r.phone) is not null);

insert into place_index_sources (venue_ref, source, source_place_id, first_seen, last_seen)
select r.venue_ref, 'own', r.venue_ref, r.first_owned, r.updated_at
  from place_records r
 where coalesce(r.summary, r.website, r.opening_hours, r.price_range,
                r.address, r.postcode, r.phone) is not null
    or r.accessibility <> '{}'::jsonb
    or r.curated_at is not null
on conflict (venue_ref, source) do nothing;
