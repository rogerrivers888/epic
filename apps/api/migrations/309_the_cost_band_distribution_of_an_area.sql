-- The cost-band distribution of an area (owner, 1 Oct 2026). How often does
-- Google actually hold a price level for the places the census found? The
-- drawer's four-step scale (Free · £ · ££ · £££) earns its row only if most
-- places have a level; on the kind of place Epic exists to surface — gardens,
-- farm parks, heritage — Google's coverage is thin, and SL5 is close to its
-- worst. Measured once, so the scale can be judged against a real number rather
-- than central London's best-in-the-world coverage.
--
-- A run spends through the session that started it (a granted agent session) and
-- is resumable across a deploy. What it keeps is the DISTRIBUTION, not the
-- prices: the per-place price level is rented content the data policy says we may
-- not store (google.js retention: none), so it is counted in memory and only the
-- aggregate histogram lands on the run row (Codex). The sample table records only
-- which place ids this run has a committed outcome for — ids we already hold — and
-- a row is written in the same statement as the count it adds to, so a resume
-- never pays for a counted place twice and a crash can never split a count from
-- its record. Only one worker touches a run at a time — a row lease (leased_by,
-- leased_until) held by short pooled queries, never a connection kept open for
-- the pass — so no place is paid for twice and concurrent area-runs cannot
-- exhaust the pool. The histogram tells two coverage facts apart that look
-- identical in the atlas: a place Google holds but gives no price, versus an id
-- that will not resolve at all — a stale id we hold, the more interesting number.

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
  -- The histogram, counted in memory and written here — never the per-place
  -- price, which is rented (Codex). band0 Free · band1 £ · band2 ££ · band3 £££
  -- (Google's level 4 folds into £££); no_price: Google holds it but gives no
  -- price; unresolved: a stale id Place Details would not resolve.
  band0              integer     not null default 0,
  band1              integer     not null default 0,
  band2              integer     not null default 0,
  band3              integer     not null default 0,
  no_price           integer     not null default 0,
  unresolved         integer     not null default 0,
  -- 'running' covers both a run actively being worked and one paused on a
  -- transient failure (problem set): a paused run keeps state 'running' so the
  -- one-running-run index still guards its area, and it is reclaimed — by a
  -- restart or the boot pickup — rather than abandoned (Codex). 'done' is the
  -- only terminal state.
  state              text        not null default 'running'
                     check (state in ('running', 'done')),
  -- Why a still-running run is not being worked: a 429, a timeout, the grant
  -- gone. NULL while it is being worked or when it is done.
  problem            text,
  -- The lease that makes a worker exclusive without holding a connection: a
  -- worker takes the run by stamping its own token and an expiry, renews the
  -- expiry as it goes, and clears it on pause or completion. A run is free to
  -- reclaim when leased_until is null or in the past (its worker is gone); every
  -- write a worker makes is gated on its own token, so a lease that lapses mid-run
  -- and is stolen cannot be clobbered by the slow worker that lost it.
  leased_by          uuid,
  leased_until       timestamptz,
  started_at         timestamptz not null default now(),
  touched_at         timestamptz not null default now(),
  finished_at        timestamptz
);
-- The ones to reclaim at boot: a paused run, or one whose worker's lease lapsed.
create index if not exists cost_dist_runs_going on cost_dist_runs (leased_until) where state = 'running';
-- At most one running run per area: two Starts racing cannot each insert one and
-- then each pay for the whole area (Codex). The loser resumes the winner's run.
create unique index if not exists cost_dist_runs_one_running on cost_dist_runs (area_slug) where state = 'running';

-- The outcome ledger: which place ids this run has a committed outcome for. No
-- provider content — only the id (which we already hold) and when it was recorded.
-- A row is written in the same statement as the histogram count it contributes to
-- (never before the paid call), so presence always means counted: a resume skips
-- it, and a crash mid-call leaves no row so the place is retried. A place whose
-- call fails transiently gets no row at all.
create table if not exists cost_dist_samples (
  run_id      uuid        not null references cost_dist_runs (id) on delete cascade,
  venue_ref   text        not null,
  at          timestamptz not null default now(),
  primary key (run_id, venue_ref)
);
