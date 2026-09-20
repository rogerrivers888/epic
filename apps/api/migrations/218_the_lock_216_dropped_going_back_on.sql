-- The row lock migration 216 dropped, going back on.
--
-- 216 extended the value-shape trigger for the new `scale` kind by rewriting
-- `attribute_value_kind()` — and rewrote it from **migration 132's** text,
-- which was already a version behind. Migration 135 had added `for share` to
-- the definition read, closing the window where a value write and a
-- definition change each read the other's "before" and both commit. Writing
-- 132's body forward over 135's silently reopened it (Codex, 20 Sep 2026).
--
-- The lesson worth keeping, because it will happen again: a `create or replace`
-- of a function somebody else has since amended is a *revert* wearing the
-- clothes of an addition, and nothing in the schema will tell you. The fix is
-- to start from the live definition, not from the migration that first wrote
-- it. `pg_get_functiondef` is how you find the live one.
--
-- Everything else here is 216's, unchanged: the scale checks and the ends.
-- 135's lock and 216's scale, in one body, which is now the live one.
create or replace function attribute_value_kind() returns trigger language plpgsql as $$
declare k text; nm text; opts text[]; lo integer; hi integer;
begin
  select kind, label, options, range_min, range_max
    into k, nm, opts, lo, hi
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
  if k = 'scale' and new.level is null then
    raise exception '% is a scale — it needs a number on it.', nm using errcode = '22023';
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
  if k <> 'scale' and new.level is not null then
    raise exception '% is not a scale.', nm using errcode = '22023';
  end if;
  if k = 'range' and new.from_value is not null and new.to_value is not null and new.from_value > new.to_value then
    raise exception '% runs from the smaller number to the larger one.', nm using errcode = '22023';
  end if;
  if k = 'scale' and lo is not null and new.level < lo then
    raise exception '% runs from % upwards.', nm, lo using errcode = '22023';
  end if;
  if k = 'scale' and hi is not null and new.level > hi then
    raise exception '% runs up to %.', nm, hi using errcode = '22023';
  end if;
  return new;
end $$;
