-- Putting the household's own places in the drawers.
--
-- Migration 054 filed the atlas: a hundred and thirteen rules at `kind` scope,
-- keyed by Wikidata type, which is the only signal the harvested attractions
-- carry. A place the household saved from a map search carries no Wikidata type
-- at all, so none of those rules ever fired for it, and every attraction in
-- Places said the same word.
--
-- The owner, 7 Sep 2026: "In the attractions I'm seeing 'any kind of
-- attraction' or 'attractions'. That doesn't really make sense… Windsor Great
-- Park is not supposed to be an attraction. It's supposed to be like a walk or
-- something. I think we've got a subcategory for that." We do — `trails`, and
-- `parks` beside it — and this is what connects them to a place somebody saved.
--
-- So these are the same rules again at `experience` scope, over the closed
-- experience vocabulary in `domain/concepts.js`: the words a search already
-- returns and `sources/own.js` already researches. A row can now say "Parks &
-- commons" or "Theme parks & rides" where it used to say "Attractions".
--
-- **Nothing here moves a place between categories.** A rule that names a drawer
-- names the cabinet with it (`domain/moods.js`), so seeding one carelessly
-- would quietly re-shelve every zoo in the country. Every row below was checked
-- against the weights the same experience already carries in `BY_EXPERIENCE`,
-- and only the ones that agree are here: `zoo` was Fun and its drawer is in Fun,
-- `park` was Outdoors and `parks` is in Outdoors. The experiences that disagree
-- are deliberately left out rather than reconciled in a migration —
--
--   • `climbing`, `ice-skating`, `cycling`, `boat-trip` — the weights say
--     Adrenaline or Outdoors and the obvious drawer is under Active. Which is
--     right is a judgement about days out, not a data fix.
--   • `live-music` — the weights say Culture and migration 053 put the drawer
--     under Fun. That disagreement is 053's on purpose and is the owner's to
--     settle, not a side effect of naming a row.
--   • `swimming` — one word for a lido and for a leisure-centre pool, and the
--     drawers are in two different cabinets. Naming either would be wrong half
--     the time; the row says "Swimming", which is true both times.
--   • `mini-golf`, `escape-room`, `festival`, `history`, `shopping` — no drawer
--     says what they are, and "Days out" says less than the experience does.
--
-- All of it is teachable in the back office afterwards, per place or per
-- experience, which is where those five and the four above belong.

insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded) values
  -- --- Culture ---------------------------------------------------------------
  ('experience', 'museum',      'a museum',            '{}', 'museums',        'A museum.', 'Roam', true),
  ('experience', 'art-gallery', 'an art gallery',      '{}', 'galleries',      'A gallery.', 'Roam', true),
  ('experience', 'castle',      'a castle',            '{}', 'castles',        'A castle, a fort, or the ruins of one.', 'Roam', true),
  ('experience', 'theatre',     'a theatre',           '{}', 'theatre',        'The building you buy a seat in.', 'Roam', true),

  -- --- Fun -------------------------------------------------------------------
  ('experience', 'theme-park',  'a theme park',        '{}', 'theme-parks',    'A day of rides. The owner''s own example of what a row should say.', 'Roam', true),
  ('experience', 'zoo',         'a zoo',               '{}', 'zoos-wildlife',  'Animals you go and see.', 'Roam', true),
  ('experience', 'aquarium',    'an aquarium',         '{}', 'zoos-wildlife',  'Animals you go and see.', 'Roam', true),
  ('experience', 'farm',        'a farm you can visit', '{}', 'zoos-wildlife', 'Animals you go and see.', 'Roam', true),
  ('experience', 'playground',  'a playground',        '{}', 'play',           'Somewhere for them to run about.', 'Roam', true),
  ('experience', 'trampoline',  'a trampoline park',   '{}', 'play',           'Somewhere for them to run about, indoors.', 'Roam', true),
  ('experience', 'cinema',      'a cinema',            '{}', 'cinema-bowling', 'An afternoon indoors.', 'Roam', true),
  ('experience', 'bowling',     'a bowling alley',     '{}', 'cinema-bowling', 'An afternoon indoors.', 'Roam', true),
  ('experience', 'arcade',      'an arcade',           '{}', 'cinema-bowling', 'An afternoon indoors.', 'Roam', true),
  ('experience', 'comedy',      'comedy',              '{}', 'live-music',     'A night out. The drawer is "Live music & comedy".', 'Roam', true),

  -- --- Sport -----------------------------------------------------------------
  ('experience', 'sports-game', 'watching sport',      '{}', 'arenas',         'Somewhere a fixture happens. Which sport is a rule about the ground.', 'Roam', true),

  -- --- Relaxing --------------------------------------------------------------
  ('experience', 'market',      'a market',            '{}', 'markets',        'A wander and a rummage.', 'Roam', true),
  ('experience', 'bookshop',    'a bookshop',          '{}', 'browsing',       'A browse.', 'Roam', true),

  -- --- Outdoors --------------------------------------------------------------
  ('experience', 'park',        'a park',              '{}', 'parks',          'A park or a common. A formal garden you pay to walk round is Relaxing.', 'Roam', true),
  ('experience', 'walk',        'a walk',              '{}', 'trails',         'A walk. Windsor Great Park is the case that made the point.', 'Roam', true),
  ('experience', 'beach',       'a beach',             '{}', 'coast',          'The seaside.', 'Roam', true),
  ('experience', 'viewpoint',   'a viewpoint',         '{}', 'viewpoints',     'The thing you go and look out from.', 'Roam', true)
on conflict (scope, subject) do nothing;
