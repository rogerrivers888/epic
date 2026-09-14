-- Migration 116 tightened the rule for future writes and left anything already
-- admitted alone (Codex, 14 Sep 2026). Nothing was, but this refuses to pass
-- over one, and keeps a one-of honest when its own list of choices changes.

-- A value carrying fields from two kinds at once: keep the one its kind wants.
update attribute_brings b set yesno = null
  from place_attributes a
 where a.key = b.brings_key and a.kind <> 'yesno' and b.yesno is not null;
update attribute_brings b set from_value = null, to_value = null
  from place_attributes a
 where a.key = b.brings_key and a.kind <> 'range' and (b.from_value is not null or b.to_value is not null);
update attribute_brings b set choice = null
  from place_attributes a
 where a.key = b.brings_key and a.kind <> 'oneof' and b.choice is not null;

-- And anything left saying nothing at all, or naming a choice off its own list.
delete from attribute_brings b using place_attributes a
 where a.key = b.brings_key
   and (b.yesno is null and b.from_value is null and b.to_value is null and b.choice is null);
delete from attribute_brings b using place_attributes a
 where a.key = b.brings_key and a.kind = 'oneof'
   and not (b.choice = any(coalesce(a.options, '{}')));

-- Changing an attribute's list of choices must not leave a brought value
-- naming one that has gone.
create or replace function place_attributes_options_guard() returns trigger language plpgsql as $$
declare gone text;
begin
  if tg_op = 'UPDATE' and new.kind = 'oneof' and new.options is distinct from old.options then
    select string_agg(distinct b.choice, ', ') into gone
      from attribute_brings b
     where b.brings_key = new.key and not (b.choice = any(coalesce(new.options, '{}')));
    if gone is not null then
      raise exception 'Another label brings % as %, so that choice cannot be taken away.', new.key, gone
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists place_attributes_options on place_attributes;
create trigger place_attributes_options
  before update on place_attributes
  for each row execute function place_attributes_options_guard();
