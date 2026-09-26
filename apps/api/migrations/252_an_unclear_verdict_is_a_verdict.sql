-- An unclear verdict is a verdict, and is written down.
--
-- The classifier's prompt says of a word it cannot call: "an unclear word
-- simply waits and is looked at again." Again *when a later harvest raises its
-- count* (brief §5.2) — not on the very next call. But an unclear answer wrote
-- nothing, and the pen is read most-seen first, so the same four hundred words
-- the model had just declined came back at the top of the next tranche and
-- were bought again: 416 of 480 held, then 461 of 480, at six model calls a
-- tranche, for ever (26 Sep 2026, caught after two tranches).
--
-- `classified_seen` is how many places the word had been seen on when it was
-- last called. A word is re-asked only when that number has risen since —
-- which is exactly the reconsideration the brief describes, made into a
-- column rather than a hope.
alter table harvest_candidates add column if not exists classified_seen integer;

comment on column harvest_candidates.classified_seen is
  'places_seen at the moment the classifier last called this word, including "unclear". Re-asked only when places_seen has risen past it.';
