-- Fill in any claim the registry is missing.
--
-- Migration 111 refuses to run where a name is both a subcategory and a
-- secondary label, and tells the operator to rename one of the pair. Doing so
-- releases the winner's claim and leaves the other row unclaimed, so the check
-- would pass over a registry that is not complete and a later subcategory could
-- take the attribute's name back (Codex, 14 Sep 2026).
--
-- Idempotent, and safe to leave in the sequence: where nothing is missing it
-- does nothing.

insert into epic_label_keys (key, kind) select key, 'primary' from shelf_subcategories on conflict do nothing;
insert into epic_label_keys (key, kind) select key, 'secondary' from place_attributes on conflict do nothing;

do $$
declare missing text;
begin
  select string_agg(key, ', ') into missing from (
    select key from shelf_subcategories except select key from epic_label_keys
    union all
    select key from place_attributes except select key from epic_label_keys
  ) m;
  if missing is not null then
    raise exception 'These labels still have no claim on their name: %.', missing;
  end if;
end $$;
