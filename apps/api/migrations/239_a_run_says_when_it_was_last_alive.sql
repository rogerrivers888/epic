-- A run says when it was last alive, so a corpse cannot pass for one.
--
-- `vocabulary_runs` records when a run started and when it finished, and
-- nothing in between. A run interrupted between those two — and they are
-- interrupted often, because every deploy restarts the process a sweep is
-- living inside — keeps `status = 'running'` and `finished_at` null for ever.
--
-- The Runs screen reads exactly that to decide whether a run is in flight, so
-- an abandoned row makes the live panel claim a sweep is going, with a red
-- Stop beside it, until somebody edits the database. I watched it happen: a
-- free sweep over sixty-two subcategories on production wrote candidates for
-- ten minutes, stopped, and went on reporting itself as running for another
-- half hour with its queue frozen. Nothing on the screen could tell that from
-- a slow run, because nothing on the screen had anything newer than the start.
--
-- So: a heartbeat. `noteRun` already writes a run's middle between
-- subcategories and now stamps this with it, which makes "when did this last
-- do anything" answerable without a second table or a second write. A run
-- untouched for longer than the screen's patience is *stalled* — drawn as
-- neither running nor finished, because it is neither, and the honest thing to
-- say about it is that nobody knows how it ended.
--
-- Defaulted to `started_at` rather than to `now()`, so every run already in the
-- table gets a truthful answer: an old run was last alive when it began, which
-- is all we know about it, and that correctly reads as long stalled rather than
-- as touched the moment this migration ran.
alter table vocabulary_runs add column if not exists touched_at timestamptz;

update vocabulary_runs
   set touched_at = coalesce(finished_at, started_at)
 where touched_at is null;

alter table vocabulary_runs alter column touched_at set default now();

-- Finding the live one is a hot read on the Runs screen and on every poll of
-- it, and `status` alone does not narrow enough once the table has a year of
-- finished runs in it.
create index if not exists vocabulary_runs_live
  on vocabulary_runs (status, touched_at desc)
  where finished_at is null;
