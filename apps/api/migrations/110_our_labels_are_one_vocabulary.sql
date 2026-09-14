-- Our labels are one vocabulary, enforced by the database.
--
-- A primary label is a subcategory's name; a secondary label is an attribute's.
-- Both are reached as `epic:<key>`, so the two may never share a key or a rule
-- written against it would mean whichever row came back first.
--
-- Checking before writing was not enough (Codex, 14 Sep 2026): the adopt path
-- inserts straight into `shelf_subcategories` and never saw the check, and two
-- requests could both pass a check before either wrote. A primary key on a
-- table both sides must claim makes it atomic and catches every path,
-- including any written later.

create table if not exists epic_label_keys (
  key  text primary key,
  kind text not null check (kind in ('primary', 'secondary'))
);

insert into epic_label_keys (key, kind) select key, 'primary' from shelf_subcategories on conflict do nothing;
insert into epic_label_keys (key, kind) select key, 'secondary' from place_attributes on conflict do nothing;

create or replace function epic_label_key_claim() returns trigger language plpgsql as $$
declare want text := case tg_table_name when 'shelf_subcategories' then 'primary' else 'secondary' end;
begin
  if tg_op = 'DELETE' then
    delete from epic_label_keys where key = old.key and kind = want;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    delete from epic_label_keys where key = old.key and kind = want;
  end if;
  insert into epic_label_keys (key, kind) values (new.key, want)
    on conflict (key) do update set kind = excluded.kind
    where epic_label_keys.kind = excluded.kind;
  if not exists (select 1 from epic_label_keys where key = new.key and kind = want) then
    raise exception '% is already one of our labels. Pick another name.', new.key
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists shelf_subcategories_label_key on shelf_subcategories;
create trigger shelf_subcategories_label_key
  after insert or update or delete on shelf_subcategories
  for each row execute function epic_label_key_claim();

drop trigger if exists place_attributes_label_key on place_attributes;
create trigger place_attributes_label_key
  after insert or update or delete on place_attributes
  for each row execute function epic_label_key_claim();
