-- Two more things a drawer knows about the places in it: whether they are
-- indoors, and whether they are for children.
--
-- Owner, 9 Sep 2026, after asking Inspire for "somewhere for a rainy afternoon
-- with the kids" and being shown gardens and arboretums: "When it's rainy, you
-- want to do something indoors… we need to create a curated list of kids'
-- activities that are indoors." The atlas knows what a place is (its drawer);
-- it did not know whether the drawer keeps the rain off. Now it does, per
-- drawer, and the back office can change either mark.
--
-- Three values, on purpose: true, false, and null for "it depends" — a zoo
-- has an aquarium, a castle has rooms. A null drawer is neither offered as
-- indoors nor hidden from an indoor list; the place's own words decide.

alter table shelf_subcategories add column if not exists indoor boolean;
alter table shelf_subcategories add column if not exists for_kids boolean;

update shelf_subcategories set indoor = true where key in (
  'pools', 'climbing', 'skating', 'museums', 'galleries', 'theatre', 'play', 'cinema-bowling', 'live-music',
  'spas', 'browsing', 'churches', 'arenas', 'restaurants', 'pubs-bars', 'cafes', 'fast-food'
) and indoor is null;

update shelf_subcategories set indoor = false where key in (
  'cycling', 'paddling', 'athletics', 'circuits', 'flying', 'watersports', 'off-road', 'ancient-sites', 'landmarks',
  'theme-parks', 'lidos', 'parks', 'woodland', 'coast', 'water', 'hills', 'nature', 'viewpoints', 'trails', 'caves-falls',
  'gardens', 'scenic', 'football', 'rugby-cricket', 'racecourses', 'golf', 'racquet-clubs', 'food-markets'
) and indoor is null;

update shelf_subcategories set for_kids = true where key in (
  'pools', 'climbing', 'skating', 'play', 'cinema-bowling', 'theme-parks', 'zoos-wildlife', 'lidos', 'days-out',
  'museums', 'parks', 'woodland', 'coast', 'ropes', 'caves-falls', 'nature'
) and for_kids is null;

update shelf_subcategories set for_kids = false where key in (
  'spas', 'browsing', 'markets', 'churches', 'ancient-sites', 'racecourses', 'golf', 'flying', 'racquet-clubs', 'scenic'
) and for_kids is null;
