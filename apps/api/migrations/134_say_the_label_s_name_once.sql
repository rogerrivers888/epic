-- A format slip in 133's message: `%s` inside a message whose placeholder is
-- `%` printed the label and then a stray "s" — "Indoorss could not hold".
-- 133 has run, so it is not edited (README › never edit a migration that has
-- run); the function is replaced instead.
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
    raise exception '% values already say something % could not hold. Clear them first.', bad, new.label
      using errcode = '22023';
  end if;
  return new;
end $$;
