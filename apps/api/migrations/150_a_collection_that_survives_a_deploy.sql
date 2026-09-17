-- Collect is a run, so it is written down like one.
--
-- It used to answer the request and then do the work in a detached promise. A
-- restart or a deploy halfway through lost whatever was left, silently: no row
-- said a collection had been going, so the Runs board could not report it,
-- resume it, or even tell anybody it had stopped (Codex, 17 Sep 2026).
--
-- The places still to ask about are held in the row, so a resumed run picks up
-- where it stopped rather than paying for the ones already done.

create table if not exists collect_runs (
  id            uuid primary key default gen_random_uuid(),
  where_label   text,
  scope         jsonb       not null default '{}'::jsonb,
  sources       jsonb       not null default '[]'::jsonb,
  -- What is left, per source. A place leaves its list when it has been asked.
  todo          jsonb       not null default '{}'::jsonb,
  done          jsonb       not null default '{}'::jsonb,
  refused       jsonb       not null default '[]'::jsonb,
  spent_pence   integer     not null default 0,
  state         text        not null default 'running'
                check (state in ('running', 'done', 'failed')),
  problem       text,
  started_by    text,
  started_at    timestamptz not null default now(),
  -- Touched after every chunk, which is how a stranded run is told from a slow
  -- one without a timer that a deploy would take with it.
  touched_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists collect_runs_going_idx on collect_runs (touched_at) where state = 'running';
