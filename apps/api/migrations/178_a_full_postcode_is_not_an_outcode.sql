-- "SL4 1DE" was being filed under "SL41".
--
-- The outward code is everything before the space. The rebuild stripped the
-- space first and then matched `[A-Z]{1,2}[0-9][0-9A-Z]?`, which then ate the
-- first digit of the incode — so every place whose postcode we hold in full
-- went into an outcode that does not exist, and was missing from the board for
-- the one it is actually in (found in the invariant check, 18 Sep 2026).
--
-- The rows themselves are derived and the next rebuild writes them correctly.
-- This clears the wrong ones now, because a board that is wrong until somebody
-- presses Rebuild is wrong.
delete from place_areas pa
 where not exists (select 1 from localities l where l.slug = pa.area_slug);

-- And the outcode each of those places actually belongs to, so nothing waits.
insert into place_areas (venue_ref, area_slug)
select r.venue_ref,
       lower(case when position(' ' in btrim(r.postcode)) > 0
                  then split_part(btrim(upper(r.postcode)), ' ', 1)
                  else left(upper(btrim(r.postcode)), greatest(0, length(btrim(r.postcode)) - 3)) end)
  from place_records r
 where r.postcode is not null
   and exists (
     select 1 from localities l
      where l.slug = lower(case when position(' ' in btrim(r.postcode)) > 0
                                then split_part(btrim(upper(r.postcode)), ' ', 1)
                                else left(upper(btrim(r.postcode)), greatest(0, length(btrim(r.postcode)) - 3)) end))
   and exists (select 1 from place_index pi where pi.venue_ref = r.venue_ref)
on conflict do nothing;
