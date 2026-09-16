-- The shape rule belongs to the database, not to whoever happens to write.
--
-- `attribute_brings` has had this since migration 115. The three tables that
-- hold the same kind of value did not, so the rule lived in application code —
-- and Codex found the hole that always leaves: validating up front, then
-- writing inside a transaction, lets somebody change a label's kind in between
-- and the wrong shape is committed (16 Sep 2026). A trigger closes it for every
-- writer, in a transaction or out of one, for good.
create or replace function attribute_value_kind() returns trigger language plpgsql as $$
declare k text; nm text; opts text[];
begin
  select kind, label, options into k, nm, opts from place_attributes where key = new.attribute_key;
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
  -- And one of *its* list: a choice nothing offers can never be matched.
  if k = 'oneof' and not (new.choice = any(coalesce(opts, '{}'::text[]))) then
    raise exception '% is not one of %''s choices.', new.choice, nm using errcode = '22023';
  end if;
  -- And nothing of the shapes it is not.
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

drop trigger if exists place_attribute_values_kind on place_attribute_values;
create trigger place_attribute_values_kind
  before insert or update on place_attribute_values
  for each row execute function attribute_value_kind();

drop trigger if exists shelf_subcategory_attributes_kind on shelf_subcategory_attributes;
create trigger shelf_subcategory_attributes_kind
  before insert or update on shelf_subcategory_attributes
  for each row execute function attribute_value_kind();

drop trigger if exists taxonomy_label_carries_kind on taxonomy_label_carries;
create trigger taxonomy_label_carries_kind
  before insert or update on taxonomy_label_carries
  for each row execute function attribute_value_kind();
