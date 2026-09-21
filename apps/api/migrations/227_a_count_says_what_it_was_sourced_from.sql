-- A count says what it was sourced from.
--
-- Owner, 21 September 2026: "The nine drawers with no Table A type: add a text
-- query for each before the run, but mark the slice as text-sourced. On the
-- board, a text-sourced count carries that label, and a place found only by a
-- text query is filed under that drawer with found_by = text, so I can open
-- twenty in the Places tab and judge precision before trusting the number."
--
-- Three ways a question can be asked, and they are not equally trustworthy:
--
--   type   an includedType Google guarantees every answer carries. The census.
--   words  words narrowing a real type — the five with no Google word.
--   text   words and nothing else — the nine with no typed form at all.
--
-- The last is the one that has to be visible. A text search for "cave" returns
-- anything Google ranks for the word, and on the IDs Only mask there is no
-- types field to check the answer against, so nothing in the data can tell a
-- limestone cavern from a cocktail bar called The Cave. That is exactly why it
-- is labelled at every level it travels through rather than argued about: the
-- slice, the surfacing, the place and the count each say so, and a person
-- opens twenty and decides.
--
-- This is not the fallback Codex stopped in September. That one rephrased a
-- type Google had rejected into a text query and counted the answer as that
-- type, inventing membership where nobody could see it. Here there was never a
-- type to fall back from, and nothing is hidden.
alter table census_slices add column if not exists sourced text not null default 'type';
alter table place_subcategories add column if not exists sourced text;
-- 'type', 'words', 'text' — or 'mixed' where a drawer's count is made of more
-- than one kind, which is itself the thing to know about that number.
alter table area_counts add column if not exists sourced text;
alter table area_counts add column if not exists text_count integer;
