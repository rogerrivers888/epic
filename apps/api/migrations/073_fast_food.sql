-- A takeaway is not a restaurant.
--
-- The owner, 5 Sep 2026: "I don't really want fast food appearing in
-- restaurants, or maybe it returns a takeaway category also, or something like
-- that that might signify fast food."
--
-- It does, three times over, and Roam was throwing all three away:
--
--   • Google types a chicken shop `fast_food_restaurant` — a primary type in
--     its own right. Roam read it into `styles` and then never looked at it.
--   • Google types the counter kinds separately too: `meal_takeaway` and
--     `meal_delivery` say how the food leaves the building. Both were mapped
--     straight to `restaurant`, which is the actual leak.
--   • OpenStreetMap has said `amenity=fast_food` since the beginning, and Roam
--     was filing that as a restaurant as well.
--
-- So `takeaway` is now its own venue category alongside restaurant, cafe, pub
-- and bar, and this is the drawer it lands in. Nothing is hidden: a takeaway is
-- still Food, still searchable, still on the Places tab. It is simply told
-- apart from somewhere you book a table, which is all he asked for — and if he
-- later wants them gone from a search rather than merely separated, that is a
-- filter on top of this rather than a different shape.
insert into shelf_subcategories (category_key, key, label, blurb, position, typical_minutes, seeded) values
  -- Twenty minutes: the whole point of it is that you are not sitting down.
  -- Migration 067 gave every drawer a time so that nothing wears the household's
  -- default by accident; a new drawer has to bring its own.
  ('food', 'fast-food', 'Fast food & takeaways',
   'Eaten standing up, or in the car. Google says so three ways — fast_food_restaurant, meal_takeaway, meal_delivery — and OpenStreetMap says amenity=fast_food.',
   50, 20, true)
on conflict (key) do nothing;
