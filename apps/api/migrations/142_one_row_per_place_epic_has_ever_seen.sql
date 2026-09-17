-- One row per place Epic has ever seen, anywhere.
--
-- Owner, 17 Sep 2026: "It feels like, from one screen, I may be able to do all
-- of this, but just putting different lenses on this… Our big problem in this
-- business is data."
--
-- Five back-office screens each sat on a different table — the atlas harvest,
-- the postcode sweep, the coverage lens over the two of them, the same lens at
-- close range, and a Lookup that stored nothing at all. So a question as plain
-- as "how many places do we know about in Berkshire" had five answers and none
-- of them was the whole one. This is the index that makes it one question.
--
-- What it holds is identifiers and our own derivations. CLAUDE.md: licensed
-- place content is rented — we store identifiers and household-generated
-- annotations only. So there is deliberately **no name column here**, and no
-- hours, rating, review, photograph or description. The index's job is to count
-- and to locate; the names on screen come from where they are already
-- legitimately held (OpenStreetMap, Wikipedia, our own record), and a Google-only
-- ref is fetched at display or shown as the bare ref. A nameless row in the back
-- office *is* the finding: it means Google is the only source that has ever seen
-- that place.

create table if not exists place_index (
  venue_ref     text primary key,          -- 'google:ChIJ…' | 'osm:way/118204471' | 'atlas:<uuid>'
  lat           double precision,
  lng           double precision,
  country_code  text not null default 'GB',
  -- The cell the place sits in, so a ring is a join against `reach` rather than
  -- a distance calculation (migration 139).
  cell          text,
  -- Our derivations. Never a provider's word for what something is.
  category      text,                      -- shelf_categories.key
  subcategory   text,                      -- shelf_subcategories.key
  derived_by    text,                      -- 'rule:<id>' | 'hand' | 'provider-type' | 'harvest' | 'sweep'
  -- identified: a source has returned it and we hold nothing of our own.
  -- owned:      we hold our own research on it (place_records, attractions).
  -- claimed:    a household has claimed it — shortlisted, saved, been.
  ownership     text not null default 'identified',
  -- Weighted completeness over the facts *that kind of place* needs, 0–100, and
  -- whether it clears its own bar. Both are recomputed from scratch, never
  -- adjusted: the same rule as `score()` in domain/scoring.js.
  data_score    real,
  ready         boolean not null default false,
  -- The working, so a figure on screen can always be taken apart: which facts
  -- were wanted, which are held, and what each was worth.
  score_parts   jsonb not null default '{}'::jsonb,
  -- The staleness lens. Completeness on its own never shows hours we last
  -- checked fourteen months ago.
  oldest_fact   timestamptz,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  indexed_at    timestamptz not null default now()
);
create index if not exists place_index_cat_idx    on place_index (category, subcategory);
create index if not exists place_index_cell_idx   on place_index (cell) where cell is not null;
create index if not exists place_index_ready_idx  on place_index (ready, data_score);
create index if not exists place_index_stale_idx  on place_index (oldest_fact nulls first);
create index if not exists place_index_country_idx on place_index (country_code);

-- Which sources have ever returned this place, and what each calls it.
--
-- The source lens is built entirely out of this table: "which providers have
-- seen the places here", "places a single source has ever returned", and
-- "places only Google has returned, so we hold no name for them". A source that
-- was never asked has no row, which is a different fact from a source that was
-- asked and found nothing — `asked_at` with a null `source_place_id` is that
-- second case, and the two must stay visibly different on screen.
create table if not exists place_index_sources (
  venue_ref       text not null references place_index(venue_ref) on delete cascade,
  source          text not null,            -- google | osm | atlas | sweep | tripadvisor | own | household
  source_place_id text,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  primary key (venue_ref, source)
);
create index if not exists place_index_sources_source_idx on place_index_sources (source);

-- A place belongs to its country, its county, its town and its outcode at once.
--
-- This is the reason every level of the Places screen works the same way: each
-- of those is one indexed lookup rather than a different column and a different
-- query. It is also what lets a second country in without a rewrite — an
-- outcode does not nest under a county here any more than a French department
-- nests under an English one.
create table if not exists place_areas (
  venue_ref  text not null references place_index(venue_ref) on delete cascade,
  area_slug  text not null,
  primary key (venue_ref, area_slug)
);
create index if not exists place_areas_area_idx on place_areas (area_slug);

-- The rollups every level above the final list reads.
--
-- Selecting a country must not become a count over millions of rows at page
-- load, so the counts are kept and refreshed rather than computed on the way in.
-- A null category/subcategory/source/ownership means "all of them", so one table
-- answers the country level and the subcategory level alike.
create table if not exists area_stats (
  area_slug    text not null,
  category     text not null default '',      -- '' = every category
  subcategory  text not null default '',      -- '' = every subcategory
  source       text not null default '',      -- '' = any source
  ownership    text not null default '',      -- '' = any ownership
  places       integer not null default 0,
  owned        integer not null default 0,
  identified   integer not null default 0,
  ready        integer not null default 0,
  avg_score    real,
  refreshed_at timestamptz not null default now(),
  primary key (area_slug, category, subcategory, source, ownership)
);
create index if not exists area_stats_refreshed_idx on area_stats (refreshed_at);

-- What counts as ready, per kind of place.
--
-- Owner's rule, and the whole reason this table exists rather than a constant in
-- the code: "a restaurant is not ready without a menu; a playground never has
-- one and must not be marked down for it." The bar is composed in the back
-- office (BO2k), stated before it saves, and every place it affects is scored
-- again from scratch afterwards.
--
-- `weight` is what the fact is worth. The score is that weight as a share of the
-- weights this kind of place is actually judged on, so a playground with all
-- three of its facts scores 100 exactly as a restaurant with all four does.
create table if not exists ready_bars (
  subcategory_key text not null,
  fact            text not null,             -- picture | what_it_is | hours | menu | prices | step_free
  weight          integer not null default 0,
  required        boolean not null default false,
  set_by          text,
  set_at          timestamptz not null default now(),
  primary key (subcategory_key, fact)
);
