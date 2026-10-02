-- An area belongs to a country (markets step 6; owner, 2 Oct 2026). The US-census
-- prerequisite migration 300 deferred: before any non-GB census, two markets whose
-- area slugs coincide must not be able to overwrite or mix with each other.
--
-- Two halves.
--
-- 1. A non-GB area's slug carries its country: an Irish routing key W12 is `ie-w12`,
--    a London outcode is `w12`. GB slugs are unchanged, so nothing live moves and the
--    ~60 lookups that join on the slug alone stay correct without an edit (owner:
--    "country prefix for non-GB, as you recommend"). The rule is held here as a check
--    on `localities` — a country's own row is its code (`ie`), every other non-GB
--    row starts `<code>-`.
--
-- 2. `area_counts` keys on (country_code, area_slug, category, subcategory), and the
--    column loses its 'GB' default: a writer that forgets the country now fails
--    instead of filing another market's counts under GB (markets.md step 6, parts 1
--    and 2). Every writer and read in the code names the country.
--
-- Read on production first (2 Oct 2026, /api/admin/desk/markets/area-key-check):
-- 0 non-GB localities, 0 unprefixed, 0 non-GB places; 89,538 area_counts rows, all
-- GB. So this migration renames nothing and re-keys GB rows only.

-- Stop and name, never rename (owner: "the migration stopping and naming an
-- unprefixed non-GB area rather than renaming it quietly is the right failure mode").
do $$
declare bad text;
begin
  select string_agg(slug || ' (' || country_code || ', ' || kind || ')', ', ' order by slug) into bad
    from localities
   where upper(country_code) <> 'GB'
     and slug <> lower(country_code)
     and slug not like lower(country_code) || '-%';
  if bad is not null then
    raise exception 'non-GB areas without their country prefix — rename them by hand first: %', bad;
  end if;
end $$;

alter table localities add constraint localities_slug_names_its_country
  check (upper(country_code) = 'GB'
         or slug = lower(country_code)
         or slug like lower(country_code) || '-%');

alter table area_counts drop constraint area_counts_pkey;
alter table area_counts add primary key (country_code, area_slug, category, subcategory);
alter table area_counts alter column country_code drop default;
