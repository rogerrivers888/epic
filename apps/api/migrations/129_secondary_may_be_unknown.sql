-- Null means nobody looked.
--
-- `secondary` was not null by default, so a sweep that never saw a word and one
-- that saw words carrying nothing wrote the same thing, and there was no way to
-- tell "we have not asked" from "we asked and the answer is none" (Codex,
-- 14 Sep 2026). Only the second should clear what an earlier sweep found.
alter table scout_places alter column secondary drop not null;
alter table scout_places alter column secondary drop default;
update scout_places set secondary = null where secondary = '{}'::jsonb;
