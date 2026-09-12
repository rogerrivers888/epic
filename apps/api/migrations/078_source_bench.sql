-- The correctness bench: is a kept fact right?
--
-- Owner, 12 Sep 2026: "I would like the option to run correctness at any
-- time… I can say what I want to run it on… When I do run the correctness, it
-- should show me the data, what it's running it on, what it's returned, and
-- then I can make my decisions on a piece-by-piece basis."
--
-- A run takes a sample of owned places, asks a rented source (Google) for the
-- same fields at that moment, and compares. Like bench_runs (055), what is
-- kept is the verdict and nothing of theirs: each row holds our value, whether
-- the two agreed, and the owner's own decision about it. The rented value is in
-- the response of the run that fetched it and nowhere else (Technical
-- Constraints §4 — Google display fields are not retained).

create table if not exists source_bench_runs (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,                       -- the owned source under test: 'osm' | 'site' | 'nominatim' | 'wikipedia' | 'wikidata'
  against     text not null default 'google',      -- the rented source it was checked against
  fields      jsonb not null default '[]',         -- master field keys asked for
  sample      integer not null default 0,          -- places asked for
  compared    integer not null default 0,          -- place × field pairs both sides had a value for
  agreed      integer not null default 0,
  differed    integer not null default 0,
  unknown     integer not null default 0,          -- pairs the rule could not judge (free text, different shapes)
  -- One row per place × field: { venueRef, name, field, ours, verdict, note, decision }.
  -- `decision` is the owner's: 'ours' | 'theirs' | 'both' | null. `theirs` is never here.
  rows        jsonb not null default '[]',
  calls       integer not null default 0,
  cost_cents  integer not null default 0,
  ran_by      text,
  ran_at      timestamptz not null default now()
);
create index if not exists source_bench_runs_provider_idx on source_bench_runs (provider, ran_at desc);
