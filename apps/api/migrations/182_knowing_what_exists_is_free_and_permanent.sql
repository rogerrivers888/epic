-- Knowing what exists is free and permanent.
--
-- The data policy of 19 September 2026 (`Supporting docs/Data policy`) turns
-- five sentences into law, and this migration is the second of them: *knowing
-- what exists is free and permanent*. Everything else in the policy depends on
-- it, because ranking from what we own is only possible once we own a complete
-- list of what there is.
--
-- Google cannot count. Every query returns its top 20 and pages to a hard stop
-- at 60, so a count is built by slicing: one query per Google place type inside
-- each Epic subcategory, restricted to a box; a slice that returns a full 60 is
-- saturated and is split — into four tiles, or into finer types — until every
-- slice comes back under the ceiling. The union of the ids is the census.
--
-- The whole of it runs on Google's Essentials mask (`id,location,types`), which
-- is the free tier. `sources/google.js` now meters that tier separately and
-- `domain/providerPrices.js` prices it at nought, so the first-run instruction
-- — report the census cost from the ledger and expect nought — can actually be
-- answered. Before this it would have reported the Enterprise rate for every
-- slice.
--
-- **Nothing here is rented content.** Per the policy: the Google place ID and
-- the TripAdvisor location ID are identifiers and are kept indefinitely;
-- coordinates are kept 30 days; a name, a rating, a review, an opening time or
-- a photograph is never written to any of these tables. What is stored beside
-- an id is *ours* — which slice found it, what rank it came back at, which of
-- Epic's own subcategories we filed it under, and a score we derived.

-- ---------------------------------------------------------------------------
-- What the census learned about a place.
--
-- These sit on `place_index` rather than in a table of their own because they
-- are facts about the place, not about the run: the run is below. A place can
-- be re-censused many times and these are simply overwritten with what the
-- latest slice said.
alter table place_index add column if not exists censused_at   timestamptz;
-- Google's own words for what it is. Kept because the mapping from a provider's
-- type to an Epic subcategory is a rule we own and re-run for free: a taxonomy
-- change re-maps from this column rather than re-asking Google. A type is a
-- label, not content — the same standing as an identifier.
alter table place_index add column if not exists google_types  text[];
-- Which slice surfaced it, and where it came in. Ours, and the raw material of
-- "is the fan-out wide enough": a subcategory whose census count sits well
-- below OSM's has a query gap, and this is the column that shows which query.
alter table place_index add column if not exists found_by      text;
alter table place_index add column if not exists found_rank    integer;
alter table place_index add column if not exists slice         text;
-- An open-map place that no Google search by name would return. The residual
-- the policy puts a 5% threshold on, and back-office-only until it clears it.
alter table place_index add column if not exists not_on_google boolean;
alter table place_index add column if not exists checked_on_google_at timestamptz;

create index if not exists place_index_censused_idx on place_index (censused_at nulls first);
create index if not exists place_index_found_by_idx on place_index (found_by) where found_by is not null;
create index if not exists place_index_residual_idx on place_index (not_on_google) where not_on_google;

-- ---------------------------------------------------------------------------
-- The runs themselves, so a count can always be taken apart.
--
-- One row per slice attempted. A slice that returned its 60-place ceiling is
-- `saturated` and will have been split; keeping the saturated row as well as
-- its children is the point, because "we asked and the answer was cut off" is
-- the single most important thing to be able to see when a count looks wrong.
create table if not exists census_slices (
  id            uuid primary key default gen_random_uuid(),
  -- The box asked about. An outcode where there is one, and always the corners,
  -- because a 30-minute ring is not a postcode and the policy keys reachability
  -- on points rather than postcodes.
  area_slug     text,
  outcode       text,
  min_lat       double precision not null,
  min_lng       double precision not null,
  max_lat       double precision not null,
  max_lng       double precision not null,
  -- What was asked, in Epic's words and in Google's.
  category      text,
  subcategory   text,
  google_type   text,
  query         text,
  -- What came back. `returned` at the ceiling is what `saturated` means.
  returned      integer not null default 0,
  new_ids       integer not null default 0,
  saturated     boolean not null default false,
  -- The slice this one was split out of, so a saturated slice and its four
  -- tiles read as one tree rather than five unrelated rows.
  parent_id     uuid references census_slices(id) on delete set null,
  depth         integer not null default 0,
  requests      integer not null default 1,
  ran_at        timestamptz not null default now(),
  problem       text
);
create index if not exists census_slices_area_idx on census_slices (area_slug, ran_at desc);
create index if not exists census_slices_sub_idx  on census_slices (subcategory, ran_at desc);
create index if not exists census_slices_sat_idx  on census_slices (saturated, ran_at desc) where saturated;

-- ---------------------------------------------------------------------------
-- The area board's numbers, so it can draw without calling anybody.
--
-- The policy is explicit that the back office's area board "cannot trigger a
-- paid call" and shows "the same numbers on every visit until the census
-- re-runs". That is only true if the counts are written down when the census
-- runs rather than computed from a provider on each view.
--
-- `osm_count` and `fhrs_count` are the free ground truth the census is measured
-- against — the open map, and for food the Food Standards Agency's hygiene
-- register. Both are ours to keep (ODbL and OGL).
create table if not exists area_counts (
  area_slug     text not null,
  category      text not null,
  subcategory   text not null,
  census_count  integer not null default 0,
  osm_count     integer,
  fhrs_count    integer,
  residual      integer,                     -- on the map, not on Google
  scored_count  integer not null default 0,  -- how many carry an Epic score
  saturated     integer not null default 0,  -- slices still cut off at 60
  censused_at   timestamptz,
  osm_at        timestamptz,
  fhrs_at       timestamptz,
  primary key (area_slug, category, subcategory)
);

-- ---------------------------------------------------------------------------
-- The Epic score: the one opinion in this schema that is ours.
--
-- The policy's correction, in its own words: "The Epic score must be a
-- genuinely derived number — both providers' ratings and counts plus Epic's own
-- signals (visits, household ratings, Google rank, review recency), banded or
-- scaled to 0–100 — not a stored copy of Google's 4.6."
--
-- So `parts` holds the *working* — the weights and the normalised contributions
-- — and deliberately not the inputs. A row here must never be reversible into
-- "Google said 4.6 and Tripadvisor said 4.0"; that is the thing neither licence
-- permits us to keep. What survives is a number of ours and the date we made it.
create table if not exists epic_scores (
  venue_ref     text primary key references place_index(venue_ref) on delete cascade,
  score         real not null,               -- 0-100, ours
  band          text,                        -- the word a screen shows when a number would be false precision
  -- The working: { "weights": {...}, "contributions": {...} }. Never a
  -- provider's raw rating or review count.
  parts         jsonb not null default '{}'::jsonb,
  -- Which opinions were available when it was made, as booleans rather than
  -- values, so "scored without Tripadvisor" is legible without storing theirs.
  had_google    boolean not null default false,
  had_tripadvisor boolean not null default false,
  had_household boolean not null default false,
  scored_at     timestamptz not null default now()
);
-- The refresh lens: the policy rebuilds a score when it is more than 90 days
-- old, off the back of a display search that was being bought anyway.
create index if not exists epic_scores_stale_idx on epic_scores (scored_at);
create index if not exists epic_scores_score_idx on epic_scores (score desc);

-- ---------------------------------------------------------------------------
-- One place at two providers.
--
-- An identifier and nothing else, which is what makes it storable: the policy
-- keeps "the Google place ID, the TripAdvisor location ID, and the mapping
-- between them: indefinite".
--
-- `matched_how` and `matched_m` are ours and exist so a wrong match can be
-- found and undone — the same reason `place_records.matched` exists. The policy
-- says the match fails closed: a candidate further than 150m or whose
-- normalised name does not agree is not a match, and `missing` records that we
-- looked and there was nothing, which is a different fact from never having
-- looked and must not cost a second call to rediscover.
create table if not exists provider_ids (
  venue_ref     text not null references place_index(venue_ref) on delete cascade,
  provider      text not null,               -- 'tripadvisor'
  provider_id   text,                        -- null with `missing` true: asked, nothing there
  missing       boolean not null default false,
  matched_how   text,                        -- 'name+latlng'
  matched_m     real,                        -- metres between the two points
  asked_at      timestamptz not null default now(),
  primary key (venue_ref, provider)
);
create index if not exists provider_ids_provider_idx on provider_ids (provider, provider_id) where provider_id is not null;
