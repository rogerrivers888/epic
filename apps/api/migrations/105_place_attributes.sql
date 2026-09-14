-- Attributes: what a place is like, and when it suits you.
--
-- The owner, 14 Sep 2026: "I'm also not entirely clear how I then add the
-- attributes, like rainy day, and also kids is a big category, for example.
-- Actually, there's a very big difference between what a 5-year-old can do and
-- what a 12-year-old can do. I feel like we need the ability to create these
-- attributes."
--
-- Epic already had two, `indoor` and `for_kids`, as columns on
-- `shelf_subcategories` — which meant a new one needed a migration and a
-- deploy. This is the same idea with the list opened up: he names an attribute
-- and picks its kind, and the controls follow.
--
-- A value is held at two levels and read narrowest first, the way every other
-- answer in the taxonomy is read: the place if it says anything, else the
-- subcategory it is in, else nothing is known. A water park is the case that
-- needs both — some are indoor centres and some are outdoor lidos.
--
-- `kind` is how it is asked and answered:
--   'yesno'  — yes, no, or left open
--   'range'  — a from and a to, which is how ages are said
--   'oneof'  — one of `options`

create table if not exists place_attributes (
  key         text primary key,
  label       text not null,
  kind        text not null default 'yesno' check (kind in ('yesno', 'range', 'oneof')),
  blurb       text,
  options     text[] not null default '{}',
  -- For a range: the bounds the controls offer, and what the numbers are called.
  range_min   integer,
  range_max   integer,
  unit        text,
  position    integer not null default 100,
  active      boolean not null default true,
  seeded      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The default for every place in a drawer.
create table if not exists shelf_subcategory_attributes (
  subcategory_key text not null references shelf_subcategories (key) on delete cascade,
  attribute_key   text not null references place_attributes (key) on delete cascade,
  yesno           boolean,
  from_value      integer,
  to_value        integer,
  choice          text,
  updated_at      timestamptz not null default now(),
  primary key (subcategory_key, attribute_key)
);

-- What one place says, where it differs from its drawer.
create table if not exists place_attribute_values (
  venue_ref     text not null,
  attribute_key text not null references place_attributes (key) on delete cascade,
  yesno         boolean,
  from_value    integer,
  to_value      integer,
  choice        text,
  -- Why it was changed, which is what the model is shown next time.
  reason        text,
  set_by        text,
  updated_at    timestamptz not null default now(),
  primary key (venue_ref, attribute_key)
);

create index if not exists place_attribute_values_attr on place_attribute_values (attribute_key);

-- The three he asked for by name, plus the two that were already columns so
-- they read the same way as the rest from here on.
insert into place_attributes (key, label, kind, blurb, range_min, range_max, unit, position, seeded) values
  ('indoor',      'Indoors',       'yesno', 'Under cover, whatever the weather.', null, null, null, 10, true),
  ('rainy-day',   'Rainy day',     'yesno', 'Worth doing when it is pouring.', null, null, null, 20, true),
  ('kid-friendly','Kid friendly',  'yesno', 'Children are welcome and catered for. Not the same as which ages it suits.', null, null, null, 30, true),
  ('suits-ages',  'Suits ages',    'range', 'The ages this really works for. A soft play is 1 to 7; a skate park is 8 to 17.', 0, 99, 'years', 40, true),
  ('step-free',   'Step free',     'yesno', 'Reachable and usable without steps.', null, null, null, 50, true)
on conflict (key) do nothing;

-- Carry the two old columns over, so nothing he has already set is lost.
insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno)
select key, 'indoor', indoor from shelf_subcategories where indoor is not null
on conflict do nothing;

insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno)
select key, 'kid-friendly', for_kids from shelf_subcategories where for_kids is not null
on conflict do nothing;

-- Indoors is the honest seed for "rainy day": if it is under cover, it works in
-- the rain. He can part the two wherever they differ.
insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno)
select key, 'rainy-day', indoor from shelf_subcategories where indoor is not null
on conflict do nothing;
