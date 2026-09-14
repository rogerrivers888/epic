-- A brought value is one shape, not two.
--
-- Migration 115 checked that the expected field was present but not that the
-- others were absent, so a range carrying a stray `yesno` passed and then read
-- back as a yes, because that is the first thing `valueOf` looks at (Codex,
-- 14 Sep 2026). And a one-of could be brought as a choice that is not on its
-- own list.

create or replace function attribute_brings_kind() returns trigger language plpgsql as $$
declare k text; opts text[];
begin
  select kind, options into k, opts from place_attributes where key = new.brings_key;
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
      raise exception '% is not one of the choices %s offers.', new.choice, new.brings_key using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
