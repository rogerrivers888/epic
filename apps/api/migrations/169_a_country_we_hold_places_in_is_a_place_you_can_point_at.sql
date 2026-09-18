-- Every country we hold places in, not only Great Britain.
--
-- Migration 145 made the country level and seeded one row, because Britain was
-- all there was. The index files a place under `lower(country_code)` whatever
-- that code is, and the country picker lists `localities` of kind 'country' —
-- so a place a household saved in Portugal got an area row of `pt` that no
-- screen could ever reach (Codex, 18 Sep 2026).
--
-- Derived from the index rather than seeded from a list, so it is right for
-- whatever is actually in there. The name is the code until something knows
-- better; `settleNew()` fills it in from the app's own list on the next pass.
insert into localities (slug, name, kind, country_code, nation)
select distinct lower(pi.country_code), upper(pi.country_code), 'country', upper(pi.country_code), null
  from place_index pi
 where pi.country_code is not null
   and not exists (select 1 from localities l where l.slug = lower(pi.country_code))
on conflict (slug) do nothing;
