-- attribute_brings joins the lock.
--
-- 115 and 116 already refuse a brought value in the wrong shape; what that
-- check did not have is 135's lock, so a brought value and a change to the
-- label it brings could still pass each other (Codex, 16 Sep 2026). The same
-- one-row "for share" read closes it here.
--
-- The message about choices carried the same "%s" slip 134 fixed elsewhere,
-- printing "Cuisines offers" rather than "Cuisine offers". Fixed in passing.
create or replace function attribute_brings_kind() returns trigger language plpgsql as $$
declare k text; opts text[];
begin
  select kind, options into k, opts from place_attributes where key = new.brings_key for share;
  if k = 'yesno' then
    if new.yesno is null then
      raise exception '% is a yes or no, so it has to be brought as one.', new.brings_key using errcode = '22023';
    end if;
    if new.from_value is not null or new.to_value is not null or new.choice is not null then
      raise exception '% is a yes or no, so it cannot be brought with a range or a choice.', new.brings_key using errcode = '22023';
    end if;
  elsif k = 'range' then
    if new.from_value is null and new.to_value is null then
      raise exception '% is a range, so it has to be brought with a from and a to.', new.brings_key using errcode = '22023';
    end if;
    if new.yesno is not null or new.choice is not null then
      raise exception '% is a range, so it cannot also be brought as a yes or a choice.', new.brings_key using errcode = '22023';
    end if;
    if new.from_value is not null and new.to_value is not null and new.from_value > new.to_value then
      raise exception 'A range runs from the smaller number to the larger one.' using errcode = '22023';
    end if;
  elsif k = 'oneof' then
    if new.choice is null then
      raise exception '% is one of a list, so it has to be brought as one of them.', new.brings_key using errcode = '22023';
    end if;
    if new.yesno is not null or new.from_value is not null or new.to_value is not null then
      raise exception '% is one of a list, so it cannot also be brought as a yes or a range.', new.brings_key using errcode = '22023';
    end if;
    if not (new.choice = any(coalesce(opts, '{}'))) then
      raise exception '% is not one of the choices % offers.', new.choice, new.brings_key using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- A second trigger written before 115 was found; one check is enough.
drop trigger if exists brought_value_kind on attribute_brings;
drop function if exists brought_value_kind();
