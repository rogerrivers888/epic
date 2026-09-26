-- "Not in Epic" is a list, never a delete (A5; owner, 26 Sep 2026).
--
-- The day-out test (C26) can find that a place passes no drawer at all: a
-- yoga studio tagged as a sports centre, a members-only club. Until now a
-- place off every shelf simply had no subcategory — the same state as a place
-- not yet filed — and nothing said why, or what it had been, or how to put it
-- back. The owner's rule is that leaving Epic is reversible and recorded.
--
-- So a place that leaves keeps its row and everything on it, its subcategory
-- is set aside here so every list that keys on `subcategory is not null` drops
-- it without a reader changing, and the reason and the moment are written
-- beside it. Restoring is putting `not_in_epic_before` back and clearing the
-- three columns. Nothing is deleted by the test, ever.

alter table place_index add column if not exists not_in_epic_at     timestamptz;
alter table place_index add column if not exists not_in_epic_reason text;
alter table place_index add column if not exists not_in_epic_before text;

create index if not exists place_index_not_in_epic on place_index (not_in_epic_at desc) where not_in_epic_at is not null;

comment on column place_index.not_in_epic_at is
  'When the place left Epic (the day-out test, or a hand). Reversible: the subcategory it held is in not_in_epic_before. Never a delete.';
