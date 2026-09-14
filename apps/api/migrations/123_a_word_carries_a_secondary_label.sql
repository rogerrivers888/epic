-- A provider's word carries more than where a place lives.
--
-- The owner, 14 Sep 2026: "Is the type of restaurant like French restaurants or
-- fine dining, for example? I see a fine dining restaurant, but no label for
-- fine dining. It's just mapped to food and drinks, restaurants."
--
-- He is right, and it is the largest thing the model was missing. 112 of
-- Google's words end in `restaurant` and every one of them lands in the single
-- drawer Restaurants: italian, korean, fine_dining, family, breakfast. The
-- primary label is correct — a place has one home and its home is Restaurants —
-- but everything else the word said was thrown on the floor. Fine dining is on
-- 28 real places, including the Fat Duck and the Waterside Inn, and the screen
-- told him the word "adds nothing on its own" because nothing was ever looking
-- for a second label.
--
-- `points_at` says where the word sends a place. This says what else it tells us.
create table if not exists taxonomy_label_carries (
  namespace     text not null,
  key           text not null,
  attribute_key text not null references place_attributes (key) on delete cascade,
  -- The same value shape a brought label uses, so one resolver reads both.
  yesno         boolean,
  from_value    integer,
  to_value      integer,
  choice        text,
  seeded        boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (namespace, key, attribute_key)
);

create index if not exists taxonomy_label_carries_attr_idx
  on taxonomy_label_carries (attribute_key);

-- The two secondary labels the food words were carrying all along.
insert into place_attributes (key, label, kind, blurb, options, position, seeded)
values
  ('cuisine', 'Cuisine', 'oneof',
   'What a place cooks. A place has one home — Restaurants — and this says what kind.',
   array['African','American','Argentinian','Asian','Australian','Austrian','Bangladeshi','Basque','Bavarian',
         'Belgian','Brazilian','British','Burmese','Cajun','Cambodian','Cantonese','Caribbean','Chilean',
         'Chinese','Colombian','Croatian','Cuban','Czech','Danish','Dutch','Eastern European','Ethiopian',
         'European','Filipino','French','Fusion','German','Greek','Hawaiian','Hungarian','Indian','Indonesian',
         'Irish','Israeli','Italian','Japanese','Korean','Latin American','Lebanese','Malaysian','Mediterranean',
         'Mexican','Middle Eastern','Mongolian','Moroccan','Pakistani','Persian','Peruvian','Polish','Portuguese',
         'Romanian','Russian','Scandinavian','Seafood','South American','Spanish','Sri Lankan','Swiss','Taiwanese',
         'Thai','Tibetan','Turkish','Ukrainian','Vegan','Vegetarian','Vietnamese']::text[],
   20, true),
  ('dining', 'Dining style', 'oneof',
   'How you eat there, which is a different question from what they cook.',
   array['Fine dining','Bistro','Brasserie','Family','Buffet','Breakfast & brunch','Steakhouse',
         'Gastropub','Diner','Takeaway','Street food']::text[],
   21, true)
on conflict (key) do nothing;
