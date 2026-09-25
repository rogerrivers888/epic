-- Two things the owner decided on 25 Sep 2026, after the first feature pass.
--
-- ---------------------------------------------------------------------------
-- 1. The evidence quote is stored.
--
-- The feature pass kept a candidate only when the model's quote was found in
-- the corpus and our own count found the feature on two or more places. Both
-- were gates: the quote was checked and thrown away. So every candidate could
-- be *certified* as evidenced and none could be *read* — and "a candidate I
-- can certify but not read is one I cannot approve, and approving is the only
-- human step in the pipeline" (owner).
--
-- The quote is allowed here because of where it comes from. The feature pass
-- reads owned text — place_records, the atlas, the venue's own page, OSM,
-- Wikipedia — and owned text may be kept. A quote from a Google review summary
-- may not: that text lives in memory for the length of a harvest and never
-- reaches a column, a log or a debug field. `recordCandidates` enforces the
-- distinction — a quote arriving with a rented source is dropped, not stored —
-- and this comment is the rule it enforces.
--
-- Cleared with `examples` on promote or ignore, for the same reason: once the
-- word has been decided the link back to a place has done its job.
alter table harvest_candidates
  add column if not exists evidence     text,
  add column if not exists evidence_ref text,
  add column if not exists evidence_at  timestamptz;

comment on column harvest_candidates.evidence is
  'A short quote from an owned source, so a reviewer can read why the word was raised. Never from rented text. Cleared on promote or ignore.';

-- ---------------------------------------------------------------------------
-- 2. A research sweep that survives a deploy.
--
-- The owner's exception to "no paid research pass per place in V1": one sweep,
-- twenty places a drawer, to build the vocabulary that is then asked of
-- hundreds of thousands of places for free. It is paid — one Place Details
-- request to turn a census ID into a name and a point, and sometimes a second
-- to find their page — so it goes through the collection ceiling like Collect
-- does, shows its price before the click, and refuses to start without the
-- request count its own estimate reported.
--
-- It is also long: seven hundred places, each a visit to the open map, the
-- encyclopedias and the venue's own page with a per-domain delay. The feature
-- pass that ran before this lived inside one HTTP request and was killed
-- thirty-two drawers in by a peer's push redeploying the service. So the sweep
-- is a row and a list, not a request: what has been done is written as it is
-- done, an interrupted one is picked up at boot, and a place in the air when
-- the process died is asked again rather than counted.
create table if not exists research_sweeps (
  id            uuid primary key default gen_random_uuid(),
  subcategories jsonb       not null default '[]'::jsonb,
  params        jsonb       not null default '{}'::jsonb,
  household_id  uuid,
  started_by    text,
  state         text        not null default 'running'
                check (state in ('running', 'done', 'failed')),
  problem       text,
  places        integer     not null default 0,
  spent_usd     numeric(10,6) not null default 0,
  funnel        jsonb,
  started_at    timestamptz not null default now(),
  touched_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists research_sweeps_going on research_sweeps (touched_at) where state = 'running';

create table if not exists research_sweep_places (
  sweep_id      uuid not null references research_sweeps (id) on delete cascade,
  venue_ref     text not null,
  subcategory   text not null,
  -- Where in the drawer's ranking it was taken from: the twelve at the top,
  -- or the eight from the middle of the tail.
  tier          text not null check (tier in ('top', 'mid')),
  state         text not null default 'pending'
                check (state in ('pending', 'asking', 'done', 'failed')),
  -- What the research came back with: its state, which sources matched,
  -- whether there is now a description to read. Never the text itself.
  outcome       jsonb,
  cost_usd      numeric(10,6) not null default 0,
  attempted_at  timestamptz,
  primary key (sweep_id, venue_ref)
);
create index if not exists research_sweep_places_todo on research_sweep_places (sweep_id, state);
