-- A drawer can be shown in more than one cabinet, while a place still has one.
--
-- The owner, 14 Sep 2026: "someone just goes straight to the category (sport,
-- or let's say straight to the category fun) and would be well up for doing a
-- skate park, but doesn't see the skate park because it's in sport… I think we
-- definitely want to solve for that problem."
--
-- His other constraint has not moved: "I don't want any duplication between
-- categories." Both hold because the multiplicity is on the *subcategory*, not
-- on the place. A skate park still has exactly one subcategory and one home
-- category; Skateboard park is simply listed under Fun and Outdoors as well as
-- its home in Sport. Where several categories are drawn at once, the screen
-- gives each place to one lane — its home if that lane is on screen — so
-- nothing is ever drawn twice.

create table if not exists shelf_subcategory_categories (
  subcategory_key text not null references shelf_subcategories (key) on delete cascade,
  category_key    text not null references shelf_categories (key) on delete cascade,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  primary key (subcategory_key, category_key)
);

create index if not exists shelf_subcategory_categories_cat
  on shelf_subcategory_categories (category_key, position);
