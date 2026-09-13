-- A sweep that stops without finishing must not lock its area for ever.
--
-- `markSweeping` sets state='sweeping' and only `finishSweep` clears it, so a
-- sweep that threw — a source erroring, the process restarting mid-run — left
-- the area locked with nothing able to reopen it. Neither the loop nor the
-- owner could ever sweep that code again. Found on BS48 during the Bristol
-- sweep, 13 September 2026: one bad answer and the area was out of reach.
--
-- Recording when the lock was taken makes it possible to tell "running" from
-- "abandoned", which is the only thing the code was missing.
alter table scout_areas add column if not exists sweeping_since timestamptz;

-- Anything already stuck is abandoned by definition: no sweep survives a
-- deploy, and every one of these predates this migration.
update scout_areas set state = 'failed', why = coalesce(why, 'the sweep stopped before it finished')
 where state = 'sweeping';
