-- One row per place a review-spotted feature was seen at (C30/C61, Codex 2 Oct 2026).
--
-- `harvest_candidates` merges a repeated candidate with `greatest(...)`, which is
-- right for the feature harvest (it submits a drawer's whole sample at once) but
-- wrong for review-spotting, which sees one place at a time: `greatest(1, 1)` is
-- always 1, so every review-spotted feature would read "seen at 1 place, 100%"
-- however many places mentioned it. The real count is kept here instead — one row
-- per (subcategory, feature, place), so re-spotting the same place updates its
-- polarity rather than counting it twice, and `places_seen` on the candidate is a
-- `count(distinct venue_ref)` over these rows, the honest "how many places mention
-- it" the review queue shows.
create table if not exists review_sightings (
  subcategory text not null references shelf_subcategories(key) on delete cascade,
  norm        text not null,
  venue_ref   text not null,
  asserts     integer not null default 0,
  denies      integer not null default 0,
  asks        integer not null default 0,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (subcategory, norm, venue_ref)
);

-- The aggregate read is per (subcategory, norm); index it that way.
create index if not exists review_sightings_feature on review_sightings (subcategory, norm);
