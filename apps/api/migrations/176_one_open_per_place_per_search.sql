-- An open is counted once per place per search, and the database is what holds
-- that rule.
--
-- The screen keeps its own guard, but a guard on a device cannot be the whole
-- of it: an insert that commits and whose answer is lost on the way back leaves
-- the client thinking it never happened, so the next tap sends it again and the
-- count goes up twice for one look (Codex, 18 Sep 2026).
--
-- Only `open`. A save, a shortlist and an add-to-trip are each their own act and
-- can honestly happen more than once; a dwell is measured on every look and is
-- written on the `close`.
--
-- Nothing to clean up first: no duplicate has been written yet.
create unique index if not exists search_events_one_open_idx
  on search_events (search_id, venue_ref)
  where kind = 'open' and venue_ref is not null;
