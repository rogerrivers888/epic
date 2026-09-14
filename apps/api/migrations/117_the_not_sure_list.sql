-- Places the labels could not settle, and the runs that answered them.
--
-- The handoff, BO10, and the owner, 14 Sep 2026: "where there are exceptions,
-- they should be named, and I should have lookups for 'not sure'. We'll be able
-- to bulk say, 'Anthropic, go look and find this, and get the answers.'"
--
-- A place goes on this list with the reason it could not be settled, never
-- quietly filed wrong. A run reads a batch of them, comes back with a suggested
-- primary label and the sentence it relied on, and nothing is applied until he
-- approves it.

create table if not exists not_sure (
  venue_ref   text primary key,
  name        text,
  -- What we do know: the words it carries and where they would put it.
  words       text[] not null default '{}',
  would_be    text,
  -- Why the words did not settle it, in a sentence.
  reason      text not null,
  -- 'waiting' until a run looks at it, then 'answered' until he decides.
  state       text not null default 'waiting' check (state in ('waiting', 'answered', 'settled', 'dropped')),
  -- What a run came back with, and what it relied on.
  said        text,
  because     text,
  source      text,
  looked_at   timestamptz,
  settled_as  text,
  settled_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists not_sure_state on not_sure (state, updated_at desc);

create table if not exists not_sure_runs (
  id          uuid primary key default gen_random_uuid(),
  asked_for   integer not null default 0,
  looked_at   integer not null default 0,
  answered    integer not null default 0,
  cost_pence  integer,
  note        text,
  by          text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
