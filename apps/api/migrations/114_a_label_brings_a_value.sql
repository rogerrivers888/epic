-- What a label brings with it carries a value, not just a name.
--
-- The canvas shows "Splash pad · comes with · Free · Suits ages 0 to 7". Suits
-- ages is a range, so bringing it as a bare yes would be a value its own kind
-- cannot hold (Codex, 14 Sep 2026). A brought label is stored the same way a
-- drawer's default is, because it is the same kind of statement.
--
-- And only an affirmative label brings anything: "not a splash pad" must not
-- hand out free.

create table if not exists attribute_brings (
  attribute_key text not null references place_attributes (key) on delete cascade,
  brings_key    text not null references place_attributes (key) on delete cascade,
  yesno         boolean,
  from_value    integer,
  to_value      integer,
  choice        text,
  created_at    timestamptz not null default now(),
  primary key (attribute_key, brings_key),
  check (attribute_key <> brings_key)
);

insert into attribute_brings (attribute_key, brings_key, yesno)
select a.key, b, true
  from place_attributes a, unnest(a.comes_with) as b
 where exists (select 1 from place_attributes x where x.key = b)
on conflict do nothing;

alter table place_attributes drop column if exists comes_with;
