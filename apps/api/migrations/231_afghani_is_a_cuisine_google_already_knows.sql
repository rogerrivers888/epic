-- Afghani is a cuisine, and Google already knows it.
--
-- The brief, section 4: "Restaurants carries 117 rules, every one of them
-- 'X restaurant'. Do not discard the word. Each mapping must also set a cuisine
-- label on the places it brings in… That is a Google-maintained cuisine
-- vocabulary acquired for nothing."
--
-- Audited against production before writing anything: 105 of the 117 already
-- carry a cuisine and 8 carry a *dining style* instead, which is the right
-- split — Fine dining, Bistro, Buffet, Steakhouse, Diner, Family and Breakfast
-- & brunch are how you eat, not what is cooked. All 71 cuisine options are in
-- use and none is orphaned. So the vocabulary was already seeded, and this
-- closes the one real hole in it rather than re-seeding anything.
--
-- Left carrying nothing, deliberately: `restaurant`, the generic word, which
-- should say nothing beyond where it sends a place; `bar_and_grill`, which
-- migration 127 decoupled from steakhouse on purpose; and `chicken_restaurant`,
-- because chicken is a dish rather than a cuisine and inventing a "Chicken"
-- cuisine to hold it would put a speciality in a vocabulary of nationalities.
--
-- This file was parked and rewritten. Two faults in the first draft, both found
-- by epic-fe on 21 Sep 2026 and both worth stating, because each was caught by
-- a different test and neither alone would have shown both:
--
--   * `taxonomy_label_carries` has no `label` column — it is keyed
--     (namespace, key, attribute_key). That failed on an *empty* database.
--   * The insert said `on conflict do update`. A migration whose whole purpose
--     is adding one missing row cannot add anything with that clause; it can
--     only overwrite the 105 that already have answers, including any a person
--     set by hand. That failed on a *seeded* database. It is `do nothing`, and
--     the rule behind it is that a migration which only needs to add should be
--     incapable of overwriting.
update place_attributes
   set options = options || array['Afghani'],
       updated_at = now()
 where key = 'cuisine'
   and not ('Afghani' = any(options));

insert into taxonomy_label_carries (namespace, key, attribute_key, choice)
values ('google', 'afghani_restaurant', 'cuisine', 'Afghani')
    on conflict (namespace, key, attribute_key) do nothing;
