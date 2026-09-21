-- A gymnastics club is not soft play.
--
-- The owner, 21 Sep 2026: "Gymnastics: take it out of Play & soft play now.
-- Most are member clubs with weekly classes, and a parent tapping soft play and
-- getting one is a bad result. Exclude it; venues selling open drop-in sessions
-- can be filed by hand."
--
-- 235 filed `osm:sport=gymnastics` under Play & soft play on the reasoning that
-- soft play and gymnastics are the same visit for a family. They are not: one
-- is a place you turn up at on a wet Tuesday, the other is a club you join in
-- September. The failure mode is a parent tapping Play & soft play on a
-- Saturday morning and being sent to a club that will not let them in.
--
-- Excluded rather than moved, because there is no drawer for a members' club
-- and inventing one would be a drawer nobody browses. A gym selling open
-- drop-in sessions is a real day out and can be filed by hand, one place at a
-- time, which is what the place scope is for.
delete from shelf_rules where subject = 'osm:sport=gymnastics';

update taxonomy_labels
   set decision = 'aside', points_at = null, active = false, updated_at = now()
 where namespace = 'osm' and key = 'sport=gymnastics';

-- Archery stays where 235 put it, and this says why so nobody moves it twice.
-- The owner, same message: "leave it under Adventure sports for now. Revisit
-- once the census gives counts — there's probably a 'Have a go' subcategory
-- later (archery, axe throwing, clay shooting)."
