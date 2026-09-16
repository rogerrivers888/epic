-- A label and its values, serialised.
--
-- 132 refuses a value that does not fit its label; 133 refuses a label change
-- that would orphan values. Between them was a window: a value write reads the
-- definition, a definition change reads the values, and two transactions doing
-- both at once can each see the other's "before" and both commit (Codex,
-- 16 Sep 2026).
--
-- Both sides now read the label row *with a lock*: a value write takes it for
-- share, a definition change takes it for update. Either the change waits for
-- the value, or the value waits for the change, and whichever goes second sees
-- the other. The lock is one row, held for the length of one small statement.
create or replace function attribute_value_kind() returns trigger language plpgsql as $$
declare k text; nm text; opts text[];
begin
  select kind, label, options into k, nm, opts
    from place_attributes where key = new.attribute_key for share;
  if k is null then
    raise exception '% is not one of our secondary labels.', new.attribute_key using errcode = '22023';
  end if;
  if k = 'yesno' and new.yesno is null then
    raise exception '% is a yes or no.', nm using errcode = '22023';
  end if;
  if k = 'range' and new.from_value is null and new.to_value is null then
    raise exception '% is a range — it needs a number at one end at least.', nm using errcode = '22023';
  end if;
  if k = 'oneof' and new.choice is null then
    raise exception '% is one of a list.', nm using errcode = '22023';
  end if;
  if k = 'oneof' and not (new.choice = any(coalesce(opts, '{}'::text[]))) then
    raise exception '% is not one of %''s choices.', new.choice, nm using errcode = '22023';
  end if;
  if k <> 'yesno' and new.yesno is not null then
    raise exception '% is not a yes or no.', nm using errcode = '22023';
  end if;
  if k <> 'range' and (new.from_value is not null or new.to_value is not null) then
    raise exception '% is not a range.', nm using errcode = '22023';
  end if;
  if k <> 'oneof' and new.choice is not null then
    raise exception '% is not one of a list.', nm using errcode = '22023';
  end if;
  if k = 'range' and new.from_value is not null and new.to_value is not null and new.from_value > new.to_value then
    raise exception '% runs from the smaller number to the larger one.', nm using errcode = '22023';
  end if;
  return new;
end $$;

create or replace function place_attribute_still_fits() returns trigger language plpgsql as $$
declare bad int;
begin
  if new.kind = old.kind and new.options is not distinct from old.options then
    return new;
  end if;
  -- Held for the length of this check, so a value being written for the old
  -- definition is either counted here or waits for the new one.
  perform 1 from place_attributes where key = new.key for update;
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
