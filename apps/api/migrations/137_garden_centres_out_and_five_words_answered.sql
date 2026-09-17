-- Garden centres come out; markets stay; five words get an answer.
--
-- The owner, 17 Sep 2026: "Garden centres and food shops should be removed, but
-- markets should stay in."
--
-- Garden centres: `garden_center` was the last substantial word with nothing
-- said about it, at 24 sightings. Out.
--
-- Markets stay, which is what 125 already did: `market`, `flea_market` and
-- `farmers_market` keep their drawers.
--
-- Food shops were already out and have been since 125 -- grocery and
-- supermarket, butcher, greengrocer, health food, sweet shop, off-licence, tea
-- shop and the rest are all `aside`. What is still in is anywhere you *eat*: a
-- bakery, an ice cream shop, a deli, a coffee shop. 125 said so in as many
-- words, and nothing here changes it. The three that sit closest to the line --
-- a chocolate shop, a cake shop and a deli -- are named back to the owner
-- rather than decided here.
--
-- `garden` and `botanical_garden` are not garden centres. They are gardens you
-- visit and they stay in Gardens & arboretums.
update taxonomy_labels
   set decision = 'aside', points_at = null, updated_at = now()
 where namespace = 'google' and key = 'garden_center';

delete from shelf_rules where subject in ('google:garden_center', 'garden_center');

-- Five words nobody had answered, each with one obvious home. Left alone:
-- adventure_sports_center, chocolate_factory, fishing_charter,
-- indoor_golf_course, ski_resort and winery, which are real choices about where
-- a kind of day out belongs rather than obvious ones.
insert into taxonomy_labels (namespace, key, label, points_at, updated_at)
values ('google', 'dog_park',   'Dog park',   'parks',     now()),
       ('google', 'landmark',   'Landmark',   'landmarks', now()),
       ('google', 'cafeteria',  'Cafeteria',  'cafes',     now()),
       ('google', 'salad_shop', 'Salad shop', 'fast-food', now())
    on conflict (namespace, key) do update
       set points_at = excluded.points_at, decision = null, updated_at = now();

-- A word points at one of ours, and a rule files the place. Both, or the drawer
-- never fills.
insert into shelf_rules (scope, subject, subject_label, subcategory, labels, weights, taught_by, reason)
values ('labels', 'google:dog_park',   'Dog park',   'parks',     array['google:dog_park'],   '{}'::jsonb, 'Epic', 'A dog park is a park.'),
       ('labels', 'google:landmark',   'Landmark',   'landmarks', array['google:landmark'],   '{}'::jsonb, 'Epic', 'A landmark is a landmark.'),
       ('labels', 'google:cafeteria',  'Cafeteria',  'cafes',     array['google:cafeteria'],  '{}'::jsonb, 'Epic', 'A cafeteria is somewhere you eat.'),
       ('labels', 'google:salad_shop', 'Salad shop', 'fast-food', array['google:salad_shop'], '{}'::jsonb, 'Epic', 'Lunch, over a counter.')
    on conflict (scope, subject) do update
       set subcategory = excluded.subcategory, updated_at = now();
