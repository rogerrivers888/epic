-- The SL5 pilot (owner, 29 Sep 2026): "Top 20 places in every category within
-- 30 min of SL5 0JD, plus the earlier reference places … buy Google details,
-- crawl the venue website, check OpenStreetMap, Wikipedia, Wikidata, verify
-- facts, and fill standard facts." The same runner is the sign-up pre-warm
-- when it is told not to pay (desk/pilot.js).
--
-- A run is written down place by place so a deploy loses nothing: a run that
-- was going when the process died reads as interrupted, and starting it again
-- picks up at the first place not done. What a place row keeps is counts and
-- fact keys — never a review, a summary or any other rented text (data policy,
-- C30): the review text is read in memory by Spot and dropped.

create table if not exists pilot_runs (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households(id) on delete set null,
  session_id    uuid,
  where_label   text,
  cell          text not null,
  mode          text not null default 'driving',
  minutes       integer not null,
  paid          boolean not null,
  state         text not null default 'running'
                check (state in ('running', 'waiting', 'done', 'failed')),
  -- Why a run stopped short: a paid gate refusal ("waiting for a paid
  -- grant"), a household cap, the day's ceiling, Google switched off.
  waiting_why   text,
  started_by    text,
  places        integer not null default 0,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists pilot_runs_open_idx on pilot_runs (household_id, cell, paid) where state in ('running', 'waiting');

create table if not exists pilot_places (
  run_id       uuid not null references pilot_runs(id) on delete cascade,
  venue_ref    text not null,
  position     integer not null,
  -- Every category the place was picked for (ring categories, or 'reference').
  categories   text[] not null default '{}',
  picked_for   text not null check (picked_for in ('ring', 'reference')),
  rank         integer,
  state        text not null default 'pending' check (state in ('pending', 'done', 'failed')),
  -- Counts and fact keys only: detail bought or not, research outcome,
  -- suggestions raised, and the place's fact states after the pass.
  outcome      jsonb,
  done_at      timestamptz,
  primary key (run_id, venue_ref)
);
create index if not exists pilot_places_pending_idx on pilot_places (run_id, position) where state = 'pending';
