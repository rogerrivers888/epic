-- One row per place a review-spotted feature was seen at (C30/C61, Codex 2 Oct 2026).
--
-- `harvest_candidates` merges a repeated candidate with `greatest(...)`, which is
-- right for the feature harvest (it submits a drawer's whole sample at once) but
-- cannot count review-spotting, which sees one place at a time: `greatest(1, 1)`
-- is always 1. So the honest "how many places mention it" the review queue shows
-- is a `count(distinct venue_ref)` over these rows, not a column on the shared
-- candidate (writing it there would overwrite the feature harvest's own counts).
--
-- One row per (feature, place): re-spotting the same place updates its polarity
-- rather than counting it twice. `venue_ref` references `place_index` and cascades
-- on delete, so a retired place takes its sightings with it. The subcategory is
-- NOT stored — it is derived by joining `place_index` at read time, so a place
-- moved to another drawer is counted in its current one, not two (Codex, 2 Oct).
create table if not exists review_sightings (
  norm        text not null,
  venue_ref   text not null references place_index(venue_ref) on delete cascade,
  raw         text,
  asserts     integer not null default 0,
  denies      integer not null default 0,
  asks        integer not null default 0,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (norm, venue_ref)
);

-- The aggregate read is per feature; index it that way.
create index if not exists review_sightings_norm on review_sightings (norm);
