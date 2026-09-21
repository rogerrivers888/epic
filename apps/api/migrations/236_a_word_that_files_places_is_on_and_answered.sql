-- A word that files places is switched on, and it has an answer on a fresh
-- database as well as on this one.
--
-- Two faults in migration 234, both found by Codex and neither visible here,
-- because this installation already held the rows 234 assumed.
--
-- **The answers never reached a fresh installation.** 234 set `points_at` with
-- an `update`, and on a database built only from migrations there is nothing
-- there to update: the published Google vocabulary is written at boot by
-- `ensureTaxonomyReady()`, long after every migration has run, and an OSM
-- label does not exist until something has been seen carrying it. So the
-- update matched nothing, boot then created the Google row with `points_at`
-- null, and `undecidedGoogle()` left it out of the not-sure queue because its
-- shelf rule already existed. A new deployment would have filed places into
-- Flying and High ropes while calling both words undecided, with nothing on
-- any screen to say so.
--
-- **Clearing `aside` left three words switched off.** Answering a word `aside`
-- switches it off as well as answering it, so 234 clearing only `decision`
-- left `airstrip`, `heliport` and `aircraft_rental_service` mapped *and*
-- inactive. Every consumer that filters on `active` — the taxonomy audit
-- included — would have gone on skipping them. That is the same contradiction
-- 234 set out to fix, in a new place: the two fields have to move together.
--
-- Written as its own migration rather than as a correction to 234, because 234
-- is published and a migration that has run is never edited — `schema_migrations`
-- keys on the filename, so the edit is skipped and the deployment that needed
-- it never gets it.

insert into taxonomy_labels (namespace, key, label, points_at, decision, active, seeded)
values
  ('google', 'adventure_sports_center', 'Adventure sports center', 'ropes',  null, true, true),
  ('osm',    'leisure=adventure_park',  'Adventure park',          'ropes',  null, true, true),
  ('google', 'airstrip',                'Airstrip',                'flying', null, true, true),
  ('google', 'heliport',                'Heliport',                'flying', null, true, true),
  ('google', 'aircraft_rental_service', 'Aircraft rental service', 'flying', null, true, true)
    on conflict (namespace, key) do update
       set points_at  = excluded.points_at,
           decision   = null,
           active     = true,
           updated_at = now();
