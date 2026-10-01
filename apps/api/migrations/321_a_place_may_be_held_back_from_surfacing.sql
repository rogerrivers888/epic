-- A place may be held back from surfacing (Option 2, owner, 1 Oct 2026).
--
-- "For low-attraction types (places of worship, monuments & memorials, generic
-- landmarks), surfacing requires positive notability evidence: cathedral/abbey/
-- minster, Grade I or II* listed, scheduled monument, a Wikipedia article, or
-- visitor facilities/opening hours. Without it, the place stays in the data but
-- isn't surfaced or counted."
--
-- This is the surfacing bar — not the closed check (C57), and not the
-- can't-speak rule. **Can't-speak governs FACTS** (a verdict about the world,
-- which withholds itself when the evidence is too thin); **this governs
-- SURFACING** (whether a family is shown a place). For surfacing there is no
-- can't-tell: absence of notability evidence simply reads as "not surfaced".
--
-- One row per place, keyed by the same venue_ref every place table uses
-- (place_index.venue_ref, place_records.venue_ref, 'atlas:'||attractions.id).
-- `surfaced=false` is the determination "not notable enough to surface", written
-- by the narrowing check with `applied=false`; mirroring place_status (C57),
-- nothing is hidden from a family until a person applies it. A place keeps its
-- row and its back-office listing exactly as now; only family surfacing and the
-- Culture counts leave it out. Reversible: a place that gains evidence through
-- normal use is re-evaluated (surfaced flips true) and comes back on its own —
-- never a sweep (C38).
--
-- `applied` follows the same rule as the closed check: a row that comes to hide
-- *more* (surfaced true -> false) waits for the owner again; one that hides less
-- (false -> true, which un-hides) keeps the OK it had, because showing a place
-- again needs nobody's approval.

create table if not exists place_surfacing (
  venue_ref    text primary key,
  -- true: it surfaces (notable, or never judged). false: held back as not notable.
  surfaced     boolean not null default true,
  reason       text,          -- 'not_notable'
  detail       text,          -- the true cause, in plain words (never "listing not loaded")
  subcategory  text,          -- the low-attraction drawer it was judged under
  check_id     uuid,
  applied      boolean not null default false,
  applied_at   timestamptz,
  applied_by   text,
  decided_at   timestamptz not null default now(),
  checked_at   timestamptz not null default now()
);

-- The only rows a family read ever has to find: applied and not surfaced. Small
-- while unapplied, so each probe against it is an index lookup.
create index if not exists place_surfacing_hidden_idx on place_surfacing (venue_ref)
  where applied and not surfaced;

-- The exact refs a determination judged: the snapshot of the cluster (every
-- alias of the physical place) at the moment the check wrote it. Family reads
-- hide ONLY these for a not-surfaced determination — never a live expansion of
-- the alias graph — so a ref linked after the check (a new provider match, a
-- newly harvested museum or a Wikipedia-backed attraction) stays visible until
-- the next check or a reconsider judges the enlarged cluster. The bar fails open
-- toward surfacing. Replaced whenever the determination is rewritten; deleted
-- with it.
create table if not exists place_surfacing_members (
  venue_ref   text not null references place_surfacing(venue_ref) on delete cascade,
  member_ref  text not null,
  check_id    uuid,
  primary key (venue_ref, member_ref)
);
create index if not exists place_surfacing_members_member_idx on place_surfacing_members (member_ref);

-- One row per run of the narrowing check, so the report can name the run it is
-- reading and a deploy mid-run shows as a run that never finished.
create table if not exists surfacing_checks (
  id           uuid primary key default gen_random_uuid(),
  state        text not null default 'running' check (state in ('running', 'done', 'failed')),
  dry_run      boolean not null default true,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  started_by   text,
  counts       jsonb not null default '{}',
  error        text
);

-- One run at a time, enforced by the database so two API instances cannot both
-- start a check whose per-place writes would interleave and split the check_id
-- (Codex, Part B): the second insert of a 'running' row violates this and is
-- refused. A stale 'running' row (a crashed run) is marked failed before a new
-- reservation, so the slot frees itself after the same six hours runningCheck()
-- already uses.
create unique index if not exists surfacing_checks_single_running on surfacing_checks ((true)) where state = 'running';
