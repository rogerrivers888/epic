-- Curation, and a second provider beside Google (owner, 12 Sep 2026).
--
-- "I want to start training the AI to be able to curate its own information
-- on those particular locations which are highly rated. That way, we then own
-- the data, and we can come up with that blended rating."
--
-- Two things change.
--
-- provider_matches held one match per place, and that match was Google's.
-- Tripadvisor now sits beside it for the same place, so the key is the pair.
-- Nothing rented is added: still only the provider's identifier.
--
-- place_records grows the curated account — our own words, written from the
-- venue's own pages and the open encyclopedias, ours to keep — and the crowd
-- bands the sweep already keeps for restaurants, so an activity keeps its
-- standing after the signal goes. A band is a word, never the figure.

alter table provider_matches drop constraint if exists provider_matches_pkey;
alter table provider_matches add primary key (venue_ref, source);

alter table place_records add column if not exists curation      jsonb;
alter table place_records add column if not exists curated_at    timestamptz;
alter table place_records add column if not exists curated_from  jsonb not null default '[]';
alter table place_records add column if not exists curated_model text;
alter table place_records add column if not exists crowd_band    text;
alter table place_records add column if not exists count_band    text;
alter table place_records add column if not exists epic_score    real;
alter table place_records add column if not exists banded_at     timestamptz;
