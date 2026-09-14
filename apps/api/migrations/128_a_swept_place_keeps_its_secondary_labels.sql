-- What the sweep worked out, kept.
--
-- A swept place holds no provider words: licensed content is rented, and
-- Google's type list is Google's. That was fine until a word started carrying a
-- second label, because the fine dining and the Italian went out with the
-- types and there was nothing left to read them from (Codex, 14 Sep 2026).
--
-- So the sweep writes down its *own* answer. `secondary` is Epic's annotation
-- of a place — the labels our own table said those words carry — and not a copy
-- of what the provider called it. One mechanism: whatever Roger maps a word to
-- carry, a place swept afterwards keeps.
alter table scout_places
  add column if not exists secondary jsonb not null default '{}'::jsonb;

comment on column scout_places.secondary is
  'Epic''s own secondary labels for this place, resolved at sweep time from taxonomy_label_carries. Not provider content.';
