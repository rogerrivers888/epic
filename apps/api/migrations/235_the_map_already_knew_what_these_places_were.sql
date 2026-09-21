-- OpenStreetMap already knew what these places were; nobody had asked it.
--
-- The owner, 21 Sep 2026: "Yes, map all 20 OSM sport tags to their drawers. But
-- the OSM mapping is for the census cross-check and back office only;
-- households see Google."
--
-- Not one OSM sport or leisure tag was mapped to anything, and every one of
-- them has a drawer that has existed for weeks. Worth saying what this cannot
-- do: none of it reaches a household. OSM is the free count the census is
-- measured against and the back office reads it; the app is served from Google.
-- A tag mapped here changes what the cross-check can see and changes nothing
-- anybody browses.
--
-- Left unmapped on purpose, because a guess here would be a silent one:
--   * `sport=pool`, `sport=billiards`, `sport=10pin` -- a pool table in a pub is
--     not a day out, and the tag cannot tell a venue from a fixture.
--   * `sport=soccer` unnamed -- used for pitches and for clubs alike.
--   * the multi-value tags (`sport=ice_skating;ice_hockey;climbing`,
--     `sport=water_sports;water_ski;swimming`) -- one place, several sports, and
--     a rule filing it by the first word would be wrong as often as right. They
--     need the combination scope, which is a decision rather than a sweep.
--   * `leisure=outdoor_seating`, `leisure=common`, `leisure=dance`,
--     `leisure=fitness_centre` -- furniture, a land type, a class, and a gym,
--     which 125 already put out.
--
-- Joined against the drawers rather than listed straight in, so a database that
-- does not have one of these subcategories skips that rule instead of refusing
-- the whole migration. Environments are at different points -- this failed
-- first against a local copy holding fewer drawers than production, and a
-- foreign key is a poor way to find that out.
insert into shelf_rules (scope, subject, subject_label, subcategory, labels, weights, taught_by, reason)
select 'labels', v.subject, v.subject_label, v.subcategory, array[v.subject], '{}'::jsonb, 'Epic', v.reason
  from (values
    ('osm:sport=football', 'Football', 'football', 'The map says football.'),
    ('osm:sport=cricket', 'Cricket', 'rugby-cricket', 'The map says cricket.'),
    ('osm:sport=horse_racing', 'Horse racing', 'racecourses', 'A racecourse is where horse racing happens.'),
    ('osm:sport=golf', 'Golf', 'golf', 'The map says golf.'),
    ('osm:leisure=golf_course', 'Golf course', 'golf', 'The course itself, as distinct from the sport played on it.'),
    ('osm:sport=athletics', 'Athletics', 'athletics', 'The map says athletics.'),
    ('osm:sport=cycling', 'Cycling', 'cycling', 'The map says cycling.'),
    ('osm:sport=skateboard', 'Skateboard', 'skateboard-park', 'The map says skateboarding.'),
    ('osm:sport=karting', 'Karting', 'karting', 'The map says karting.'),
    ('osm:sport=motor', 'Motor', 'circuits', 'Motorsport, which is what a circuit is for.'),
    ('osm:sport=ice_skating', 'Ice skating', 'skating', 'The map says ice skating.'),
    ('osm:leisure=ice_rink', 'Ice rink', 'skating', 'The rink itself.'),
    ('osm:sport=equestrian', 'Equestrian', 'off-road', 'Riding is the nearest drawer we have; there is no stables drawer yet.'),
    ('osm:sport=archery', 'Archery', 'adventure-sports-center', 'An activity-centre thing rather than a drawer of its own.'),
    ('osm:sport=laser_tag', 'Laser tag', 'paintball-lasertag', 'Named in the drawer.'),
    ('osm:sport=gymnastics', 'Gymnastics', 'play', 'Soft play and gymnastics clubs are the same visit for a family.'),
    ('osm:sport=bowls', 'Bowls', 'parks', 'A bowling green is a thing in a park.'),
    ('osm:leisure=swimming_pool', 'Swimming pool', 'pools', 'The map says swimming pool.'),
    ('osm:leisure=sports_centre', 'Sports centre', 'pools', 'Pools & leisure centres is the drawer a leisure centre belongs in.'),
    ('osm:leisure=water_park', 'Water park', 'water-park', 'The map says water park.'),
    ('osm:leisure=miniature_golf', 'Miniature golf', 'miniature-golf-course', 'Crazy golf, as the map says it.'),
    ('osm:leisure=marina', 'Marina', 'marina', 'The map says marina.'),
    ('osm:leisure=adventure_park', 'Adventure park', 'ropes', 'An adventure park is high ropes and zip lines; the drawer had no word at all.'),
    ('osm:leisure=amusement_arcade', 'Amusement arcade', 'cinema-bowling', 'Named in the drawer.'),
    ('osm:leisure=escape_game', 'Escape game', 'play', 'An indoor thing you book and do together.'),
    ('osm:leisure=horse_riding', 'Horse riding', 'off-road', 'With equestrian, and for the same reason.'),
    ('osm:leisure=bird_hide', 'Bird hide', 'nature', 'A hide is a thing on a nature reserve.'),
    ('osm:leisure=fishing', 'Fishing', 'fishing-charter', 'The only fishing drawer there is.'),
    ('osm:leisure=dog_park', 'Dog park', 'parks', 'A dog park is a park, as the Google word already says.')
  ) as v(subject, subject_label, subcategory, reason)
  join shelf_subcategories s on s.key = v.subcategory
    on conflict (scope, subject) do update
       set subcategory = excluded.subcategory, labels = excluded.labels, updated_at = now();

-- Scenic drives & rides is retired.
--
-- The owner, 21 Sep 2026: "retire scenic drives, it's an editorial grouping,
-- not a place type." It is. A scenic drive is a route somebody wrote about, and
-- the places along it are viewpoints, hills and heritage railways that have
-- drawers already. Switched off rather than deleted, so anything filed there
-- keeps its row and switching it back on is one tap.
update shelf_subcategories set active = false, updated_at = now() where key = 'scenic';
