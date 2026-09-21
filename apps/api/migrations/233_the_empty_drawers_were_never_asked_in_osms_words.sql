-- The five empty drawers were never asked about in OpenStreetMap's words.
--
-- The brief, section 4: "Climbing & bouldering · Rowing, paddling & sailing ·
-- Flying & skydiving · Water skiing & wakeboarding · High ropes & zip lines.
-- These are mapping gaps, not absences. Work the not-sure queue against them
-- specifically: rock climbing gym, climbing wall, adventure park, ropes course,
-- skydiving centre, airfield, wakeboard park and similar."
--
-- Swept, and the premise needed correcting before it could be carried out.
-- There is no unanswered queue to work: three Google words remain unanswered in
-- the whole vocabulary and none of them is a sport. **Google has no word for any
-- of these five.** No climbing gym, no kayaking, no skydiving, no ropes course,
-- no scenic drive. The drawers are not waiting on a decision nobody made; they
-- are waiting on a vocabulary nobody asked.
--
-- The words exist in OpenStreetMap and Wikidata, and **not one of the 25 OSM
-- sport tags we hold is mapped to anything at all** — archery, athletics,
-- bowls, cricket, cycling, equestrian, football, golf, gymnastics, horse
-- racing, ice skating, karting, laser tag, skateboard and the rest all land
-- nowhere. That is the real gap and it is much larger than five drawers; this
-- migration closes only the part section 4 asked for and the rest is reported.
--
-- Rules are written in the provider's word at `labels` scope, the same shape a
-- Google word uses, so one drawer can be filled from several vocabularies.
insert into shelf_rules (scope, subject, subject_label, subcategory, labels, weights, taught_by, reason)
values
  ('labels', 'osm:sport=climbing',  'Climbing',  'climbing',    array['osm:sport=climbing'],  '{}'::jsonb, 'Epic',
   'OpenStreetMap says climbing. Google has no word for it, which is why this drawer was empty.'),
  ('labels', 'osm:leisure=climbing', 'Climbing', 'climbing',    array['osm:leisure=climbing'], '{}'::jsonb, 'Epic',
   'The leisure tag for a climbing place, as distinct from the sport played there.'),
  ('labels', 'osm:sport=canoe',     'Canoe',     'paddling',    array['osm:sport=canoe'],     '{}'::jsonb, 'Epic',
   'Canoeing is paddling. Rowing, paddling & sailing had no word in any vocabulary until now.'),
  ('labels', 'osm:sport=water_ski', 'Water ski', 'watersports', array['osm:sport=water_ski'], '{}'::jsonb, 'Epic',
   'Water skiing, in the drawer named after it.')
    on conflict (scope, subject) do update
       set subcategory = excluded.subcategory, labels = excluded.labels, updated_at = now();

-- Wikidata's own words for two of them. `rowing and canoeing venue` is named in
-- the brief itself, under the Days out retirement.
insert into shelf_rules (scope, subject, subject_label, subcategory, labels, weights, taught_by, reason)
values
  ('kind', 'Q2137251',  'rowing and canoeing venue', 'paddling', array['wikidata:Q2137251'],  '{}'::jsonb, 'Epic',
   'Named in section 4: rowing and canoeing venue goes to Rowing, paddling & sailing.'),
  ('kind', 'Q109882149', 'climbing gym',             'climbing', array['wikidata:Q109882149'], '{}'::jsonb, 'Epic',
   'A climbing gym was filing under Stadiums & arenas, which is where a thing goes when nobody has said what it is.')
    on conflict (scope, subject) do update
       set subcategory = excluded.subcategory, labels = excluded.labels, updated_at = now();

-- Flying & skydiving, High ropes & zip lines and Scenic drives & rides get
-- nothing here, and saying so is the point: no vocabulary we hold has a word
-- for them. They cannot be filled by mapping and need either an OSM tag we do
-- not harvest — aeroway=aerodrome, attraction=zip_line — or places filed by
-- hand. Left empty and honest rather than filled with something close.
