-- Migration 110 backfilled with `on conflict do nothing`, so a database that
-- already held the same key as both a subcategory and a secondary label would
-- have kept both rows while only one claimed the name — recorded as a success
-- while label resolution stayed ambiguous (Codex, 14 Sep 2026).
--
-- There are none here. This refuses to pass quietly anywhere that has one.

do $$
declare clash text;
begin
  select string_agg(s.key, ', ') into clash
    from shelf_subcategories s join place_attributes a on a.key = s.key;
  if clash is not null then
    raise exception 'These names are both a subcategory and a secondary label: %. Rename one of each pair before this migration can run.', clash;
  end if;
end $$;
