-- Cuisine is not a question about a museum.
--
-- The owner, 16 Sep 2026: "Cuisine and dining relates to restaurants. It should
-- only appear if it's food and drink."
--
-- Filtering a column out once it is empty was not enough: a label that could
-- never apply here should not be offerable here either. A label with no
-- categories named belongs everywhere, which is what Indoors and Step free are.
alter table place_attributes
  add column if not exists only_in text[] not null default '{}';

comment on column place_attributes.only_in is
  'The categories this label is a question for. Empty means all of them.';

update place_attributes set only_in = array['food'] where key in ('cuisine', 'dining');
