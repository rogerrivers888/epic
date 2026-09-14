-- A brought value has to be a value its target's kind can hold.
--
-- Migration 114 carried every old `comes_with` across as a plain yes, including
-- ones pointing at a range or a one-of, which is a shape those controls cannot
-- draw (Codex, 14 Sep 2026). There were none in practice; this refuses to leave
-- one behind, and the database enforces it from here on.

delete from attribute_brings b
 using place_attributes a
 where a.key = b.brings_key
   and a.kind <> 'yesno'
   and b.yesno is not null
   and b.from_value is null and b.to_value is null and b.choice is null;

create or replace function attribute_brings_kind() returns trigger language plpgsql as $$
declare k text;
begin
  select kind into k from place_attributes where key = new.brings_key;
  if k = 'yesno' and new.yesno is null then
    raise exception '% is a yes or no, so it has to be brought as one.', new.brings_key using errcode = '22023';
  end if;
  if k = 'range' and new.from_value is null and new.to_value is null then
    raise exception '% is a range, so it has to be brought with a from and a to.', new.brings_key using errcode = '22023';
  end if;
  if k = 'oneof' and new.choice is null then
    raise exception '% is one of a list, so it has to be brought as one of them.', new.brings_key using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists attribute_brings_kind_check on attribute_brings;
create trigger attribute_brings_kind_check
  before insert or update on attribute_brings
  for each row execute function attribute_brings_kind();
