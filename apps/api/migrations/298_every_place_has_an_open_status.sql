-- Every place has an open status (decision C57, owner, 29 Sep 2026).
--
-- "A closed place is being listed: Windsor Safari Park (closed 1992, now
-- Legoland Windsor; its own 'What it is' text says so)." The Wikidata harvest
-- never asked whether a place had ended.
--
-- One row per place, keyed by the same ref every place table already uses:
-- `place_index.venue_ref`, `place_records.venue_ref`, and for an atlas row
-- `coalesce(attractions.venue_ref, 'atlas:' || attractions.id)`. The Wikidata
-- id rides along so a closed atlas place stays closed when a re-harvest makes
-- it a new row — "kept, so they're never re-added".
--
-- The absence of a row is `unknown` and confirmed: nobody has looked.
--
-- `applied` is the owner's OK (item 4: "Report first … and wait for my OK
-- before applying"). A check writes what it would do with applied = false, and
-- nothing is hidden from a family until a person applies it. A row that comes
-- to hide *more* than it did goes back to applied = false; one that hides less
-- keeps its flag, because showing a place again needs nobody's OK.
--
-- Google's business status is read in memory only; what is kept is our flag
-- and `source = 'google'`, never Google's words.

create table if not exists place_status (
  venue_ref       text primary key,
  wikidata_id     text,
  status          text not null default 'unknown'
                  check (status in ('open', 'temporarily_closed', 'permanently_closed', 'unknown')),
  -- Item 3: something current (a Google id, an OpenStreetMap match, a website,
  -- a census sighting) says it exists. False only for an atlas place known to
  -- Wikidata/Wikipedia alone.
  confirmed       boolean not null default true,
  confirmed_by    text check (confirmed_by in ('google', 'osm', 'website', 'census', 'person')),
  reason          text,
  source          text check (source in ('wikidata', 'osm', 'wikipedia', 'listing', 'google', 'person')),
  -- A quote (Wikipedia is CC BY-SA, a quote is fine), a property and value
  -- ("Q8024695 P576 = 1992"), or a tag ("disused:amenity=pub"). Never
  -- Google's text.
  evidence        text,
  successor_ref   text,
  successor_name  text,
  -- An unsure reading ("X was a …" and nothing else) is flagged for a person,
  -- never closed.
  review          boolean not null default false,
  decided_at      timestamptz not null default now(),
  checked_at      timestamptz not null default now(),
  applied         boolean not null default false,
  applied_at      timestamptz,
  applied_by      text,
  check_id        uuid
);

-- The only rows a family read ever has to find: applied and hiding. Small, so
-- every `not exists` against it is an index probe.
create index if not exists place_status_hidden_idx on place_status (venue_ref)
  where applied and (status in ('temporarily_closed', 'permanently_closed') or not confirmed);
create index if not exists place_status_hidden_wikidata_idx on place_status (wikidata_id)
  where wikidata_id is not null and applied and (status in ('temporarily_closed', 'permanently_closed') or not confirmed);
create index if not exists place_status_review_idx on place_status (review) where review;

-- One row per run of the check, so the report can say which run it is reading
-- and a deploy mid-run is visible as a run that never finished.
create table if not exists closed_checks (
  id           uuid primary key default gen_random_uuid(),
  state        text not null default 'running' check (state in ('running', 'done', 'failed')),
  dry_run      boolean not null default true,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  started_by   text,
  counts       jsonb not null default '{}',
  error        text
);
