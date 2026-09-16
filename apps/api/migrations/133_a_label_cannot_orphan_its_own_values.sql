-- Changing a label must not leave a value behind that no longer fits it.
--
-- Migration 132 put the shape rule on the three value tables, which stops a bad
-- value going in. It does not stop the *definition* moving under values that
-- are already there: change a yes/no to a range, or drop a choice off a
-- one-of's list, and every existing row is suddenly the wrong shape with no
-- trigger firing (Codex, 16 Sep 2026). `saveAttribute` counts values before a
-- kind change, but nothing guarded the options.
--
-- Anything already stored wrong is reported here rather than quietly deleted: a
-- value somebody set is theirs, and the right answer to a bad one is to look at
-- it. (There were none when this ran.)
do $$
declare bad int;
begin
  select count(*) into bad
    from (
      select v.attribute_key, a.kind, a.options, v.yesno, v.from_value, v.to_value, v.choice
        from place_attribute_values v join place_attributes a on a.key = v.attribute_key
      union all
      select d.attribute_key, a.kind, a.options, d.yesno, d.from_value, d.to_value, d.choice
        from shelf_subcategory_attributes d join place_attributes a on a.key = d.attribute_key
      union all
      select c.attribute_key, a.kind, a.options, c.yesno, c.from_value, c.to_value, c.choice
        from taxonomy_label_carries c join place_attributes a on a.key = c.attribute_key
    ) x
   where (kind = 'yesno' and yesno is null)
      or (kind = 'range' and from_value is null and to_value is null)
      or (kind = 'oneof' and (choice is null or not (choice = any(coalesce(options, '{}'::text[])))))
      or (kind <> 'yesno' and yesno is not null)
      or (kind <> 'range' and (from_value is not null or to_value is not null))
      or (kind <> 'oneof' and choice is not null);
  if bad > 0 then
    raise warning '% stored values do not fit their label any more. Look at them.', bad;
  end if;
end $$;

create or replace function place_attribute_still_fits() returns trigger language plpgsql as $$
declare bad int;
begin
  if new.kind = old.kind and new.options is not distinct from old.options then
    return new;
  end if;
  select count(*) into bad
    from (
      select v.yesno, v.from_value, v.to_value, v.choice from place_attribute_values v where v.attribute_key = new.key
      union all
      select d.yesno, d.from_value, d.to_value, d.choice from shelf_subcategory_attributes d where d.attribute_key = new.key
      union all
      select c.yesno, c.from_value, c.to_value, c.choice from taxonomy_label_carries c where c.attribute_key = new.key
      union all
      select b.yesno, b.from_value, b.to_value, b.choice from attribute_brings b where b.brings_key = new.key
    ) x
   where (new.kind = 'yesno' and yesno is null)
      or (new.kind = 'range' and from_value is null and to_value is null)
      or (new.kind = 'oneof' and (choice is null or not (choice = any(coalesce(new.options, '{}'::text[])))))
      or (new.kind <> 'yesno' and yesno is not null)
      or (new.kind <> 'range' and (from_value is not null or to_value is not null))
      or (new.kind <> 'oneof' and choice is not null);
  if bad > 0 then
    raise exception '% values already say something %s could not hold. Clear them first.', bad, new.label
      using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists place_attributes_still_fits on place_attributes;
create trigger place_attributes_still_fits
  before update on place_attributes
  for each row execute function place_attribute_still_fits();
