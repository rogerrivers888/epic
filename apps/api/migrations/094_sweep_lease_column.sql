-- The lease column, in a migration of its own.
--
-- It was added by editing 093 after 093 had already run on production. The
-- runner keys `schema_migrations` on the filename, so it skipped the edited
-- file, the column was never created, and every sweep died on
-- `column "sweep_lease" does not exist` (Codex, 13 September 2026).
--
-- An applied migration is history and cannot be amended. Anything that has to
-- change afterwards is a new file.
alter table scout_areas add column if not exists sweep_lease uuid;
