-- How long a place is actually worth.
--
-- Every attraction on the home screen said "allow 2h 30m" — Thorpe Park, a
-- parish church and a viewpoint alike (owner, 7 Sep 2026: "Thorpe Park allows
-- 2.5 hours, which is nonsense… are you just making this up?").
--
-- It was not invented, but it was not about the place either. The atlas branch
-- of `/api/inspire/near` passed a stub — `{ category: 'attraction',
-- experiences: [] }` — so nothing in `dwellAllowance` had anything to narrow or
-- lengthen and every place in the country fell through to the household's own
-- typical activity time, which is 150 minutes. One number, worn by everything.
--
-- The fix needs somewhere to say how long each *kind* of place takes, and the
-- kinds already live in a table the back office writes (migration 053). So it
-- goes here rather than into a constant in the bundle: whether a zoo is half a
-- day is a judgement, judgements are argued with, and arguing with this one
-- should not need a deploy.
--
-- Null means "no opinion", and the household's own pace still applies — which
-- is the right answer for a kind nobody has thought about yet, and for every
-- kind added after today.

alter table shelf_subcategories add column if not exists typical_minutes integer;

comment on column shelf_subcategories.typical_minutes is
  'How long this kind of place is worth, in minutes. Null = fall back to the household''s own pace.';

-- Every drawer in the taxonomy as it stands, so nothing is left wearing the
-- default by accident. These are opening-hours-and-common-sense numbers — how
-- long a family is actually inside — not anybody's data:
--   a day out          300  you arrive when it opens and leave when it shuts
--   most of a day      240  a zoo, a race meeting, a round of golf
--   an afternoon   150–180  a match, a show, a lido
--   a couple of hours  120  a museum, a trail, a swim
--   an hour and a half  90  a garden, a park, a country house you walk round
--   a look          30–45   a viewpoint, a village church, a monument
update shelf_subcategories set typical_minutes = v.minutes from (values
  -- fun
  ('theme-parks',     300), ('zoos-wildlife',   240), ('days-out',        240),
  ('lidos',           180), ('live-music',      180), ('cinema-bowling',  150),
  ('play',            120),
  -- sport
  ('racecourses',     240), ('golf',            240), ('football',        150),
  ('rugby-cricket',   180), ('arenas',          180), ('racquet-clubs',   120),
  -- adrenaline
  ('circuits',        180), ('watersports',     150), ('ropes',           150),
  ('off-road',        150), ('flying',          120), ('karting',          90),
  -- activity
  ('climbing',        120), ('cycling',         120), ('paddling',        120),
  ('athletics',       120), ('pools',            90), ('skating',          90),
  -- culture
  ('theatre',         150), ('castles',         150), ('museums',         120),
  ('historic-houses', 120), ('galleries',        90), ('ancient-sites',    45),
  ('churches',         30), ('landmarks',        30),
  -- outdoors
  ('coast',           150), ('hills',           150), ('trails',          120),
  ('water',           120), ('parks',            90), ('woodland',         90),
  ('nature',           90), ('caves-falls',      90), ('viewpoints',       30),
  -- relaxing
  ('spas',            180), ('gardens',          90), ('scenic',           60),
  ('browsing',         60), ('markets',          60),
  -- food
  ('restaurants',      90), ('pubs-bars',        90), ('food-markets',     60),
  ('cafes',            45)
) as v(key, minutes)
where shelf_subcategories.key = v.key;
