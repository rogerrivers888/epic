-- The deep reference set (owner, 25 Sep 2026): twenty places a category,
-- researched exhaustively rather than sampled — every fact the owned sources
-- hold, kept for good with its provenance. It is the corpus the extractor
-- needs, the fixture every screen is built against, and the first end-to-end
-- test of the chain. Two small things the schema did not have for it.
--
-- The hygiene rating. The Food Standards Agency's register is open data under
-- the Open Government Licence, so a place's rating, the date it was given and
-- the register's own id may be kept for good beside the other owned facts.
-- Facts land in place_facts with their licence as ever; these are the columns
-- the composed record carries them in.
alter table place_records
  add column if not exists fsa_rating   text,
  add column if not exists fsa_rated_at date,
  add column if not exists fsa_id       text;

-- Why a place is in the set. The sample sweep's `tier` says top or mid-tail;
-- the reference set picks on purpose — a dense area, a thin one, a chain, a
-- small venue, a place where the sources are likely to disagree — and the
-- reason is written beside the place so the set can be read as a design
-- rather than a list.
alter table research_sweep_places
  add column if not exists picked_for text;
