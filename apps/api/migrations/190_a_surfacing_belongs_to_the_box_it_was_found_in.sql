-- A surfacing belongs to the box it was found in.
--
-- `place_subcategories` records that a question surfaced a place, and not
-- *where* it was asked. That was survivable while the census also stored a
-- coordinate, because a place could be located afterwards — but the census is
-- IDs Only now (owner, 19 Sep 2026) and a place has no position at all until a
-- display search returns it. So there is nothing linking a surfacing to an
-- area, and a rebuild of the board's counts gave every outcode the same
-- figures: SL5, GU14 and GU15 each read 1,240, which is all three added up.
--
-- The box is the missing key. It is known at the moment the slice runs and
-- nowhere afterwards, so it is recorded then. The primary key grows with it,
-- because the same place genuinely is surfaced under the same drawer in two
-- overlapping outcodes and both are true.
--
-- This also makes `area_counts` rebuildable from the record rather than only
-- writable at census time, which is what a derived table has to be.

alter table place_subcategories add column if not exists area_slug text;

-- The existing rows came from SL5 and the two outcodes that ran before the
-- daily cap stopped the ring. Which is which is not recoverable — the slices
-- know their box but not which places they returned — so they are left null
-- and the three areas are re-censused. A null here reads as "before we
-- recorded this", not as an area.
create index if not exists place_subcategories_area_idx on place_subcategories (area_slug, subcategory);

-- The primary key has to admit the same place twice under one drawer in two
-- boxes. Rebuilt rather than altered: a primary key cannot be extended in
-- place, and the old one has to go first.
alter table place_subcategories drop constraint if exists place_subcategories_pkey;
create unique index if not exists place_subcategories_key
  on place_subcategories (venue_ref, subcategory, coalesce(area_slug, ''));

-- And the counts that were rebuilt wrong are removed rather than corrected.
-- A board that says nothing has been censused here is honest; one that says
-- 1,240 when it means 257 is not, and there is no arithmetic that recovers the
-- right number from what is stored.
delete from area_counts where area_slug in ('sl5', 'gu14', 'gu15');
