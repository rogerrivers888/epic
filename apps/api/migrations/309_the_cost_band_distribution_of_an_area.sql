-- The cost-band distribution of an area (owner, 1 Oct 2026). Google's price
-- level for every place the census found in an area, measured once, so the
-- drawer's four-step scale can be judged against real coverage rather than
-- against central London's best-in-the-world 18-of-20. SL5 — Sunningdale's
-- gardens, farm parks and heritage — is close to Google's worst; the number is
-- the point.
--
-- A run spends through the session that started it (a granted agent session),
-- resumable across a deploy, and records per place one of three things: a price
-- level, or that Google holds the place but gives no price, or that the id would
-- not resolve at all — a stale id, which is a different problem from a coverage
-- gap. The second and third are told apart because they look identical in the
-- atlas and mean different things.

create table if not exists cost_dist_runs (
  id                 uuid primary key default gen_random_uuid(),
  area_slug          text not null,
  household_id       uuid,
  started_by         text,
  -- Every paid Place Details call spends through this session, so a background
  -- resume after a deploy is still attributed and still within its grant (G7–G8).
  started_session_id uuid,
  -- What the estimate reported: the gate refuses a start whose confirm does not
  -- match it, the same gate every paid run here uses.
  requests           integer     not null default 0,
  -- The places as they stood when the run was priced and agreed, frozen — so a
  -- census that adds places after the start cannot make the run spend on more
  -- than was confirmed (Codex). The worker only ever asks about these.
  refs               jsonb       not null default '[]'::jsonb,
  state              text        not null default 'running'
                     check (state in ('running', 'done', 'stopped')),
  problem            text,
  started_at         timestamptz not null default now(),
  touched_at         timestamptz not null default now(),
  finished_at        timestamptz
);
-- The one going now, for the boot pickup.
create index if not exists cost_dist_runs_going on cost_dist_runs (touched_at) where state = 'running';
-- At most one running run per area: two Starts racing cannot each insert one and
-- then each pay for the whole area (Codex). The loser resumes the winner's run.
create unique index if not exists cost_dist_runs_one_running on cost_dist_runs (area_slug) where state = 'running';

create table if not exists cost_dist_samples (
  run_id      uuid        not null references cost_dist_runs (id) on delete cascade,
  venue_ref   text        not null,
  -- Google's 0–4 price level. NULL with resolved = true means Google holds the
  -- place but gives no price (a coverage thinness). resolved = false means Place
  -- Details could not resolve the id at all — a stale id we hold, not a gap
  -- (owner, 1 Oct 2026: the more interesting number). One row per place, written
  -- as it is measured, so a deploy loses nothing and a resume skips the done.
  price_level integer,
  resolved    boolean     not null,
  at          timestamptz not null default now(),
  primary key (run_id, venue_ref)
);
