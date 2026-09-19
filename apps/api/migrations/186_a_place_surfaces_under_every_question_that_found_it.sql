-- A place surfaces under every question that found it.
--
-- The SL5 census found 256 places and Google returned 475. A place was filed
-- under the *first* subcategory whose question surfaced it, and the plan runs
-- alphabetically — so `sport/golf` returned two courses in Ascot and recorded
-- nought, because `outdoors` had already claimed them. Golf reading zero in
-- Ascot is plainly false, and the one job of the area board is to be compared
-- against OpenStreetMap and the hygiene register (owner, 19 Sep 2026).
--
-- Two different questions were being answered by one column:
--
--   · **What shelf does this place live on?** One answer per place, because a
--     place appears on one shelf and the shelving rule says so.
--     `place_index.subcategory` stays exactly as it is.
--   · **How many golf courses are there here?** Every question that surfaced
--     it, because a golf course in a wood is both. That is this table.
--
-- The board shows both, and the gap between them *is* the overlap — which is
-- the thing worth looking at, and was invisible while one number stood for both.

create table if not exists place_subcategories (
  venue_ref    text not null references place_index(venue_ref) on delete cascade,
  category     text not null,
  subcategory  text not null,
  -- The Google type whose query surfaced it here, and where it came in that
  -- answer. Ours: a derivation from a question we chose to ask.
  found_by     text,
  found_rank   integer,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  primary key (venue_ref, subcategory)
);
create index if not exists place_subcategories_sub_idx on place_subcategories (subcategory);
create index if not exists place_subcategories_cat_idx on place_subcategories (category, subcategory);

-- The board's second number. `census_count` is what is *filed* here — one per
-- place, the shelving answer. `surfaced_count` is how many places this
-- question actually found, which is the answer to "how many are there".
alter table area_counts add column if not exists surfaced_count integer;
