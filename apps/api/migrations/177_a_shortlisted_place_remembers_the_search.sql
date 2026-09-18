-- Which search put this on the shortlist.
--
-- A trip Find result is shortlisted first and placed into a day later, often on
-- another visit — and by then the client has long forgotten which search found
-- it. So the only outcome those searches could ever reach was "saved", and the
-- Demand board filed every one of them under "clicked, never tripped" even
-- where the place became a stop on the itinerary. That is the wrong fault on
-- the board the whole log exists to fill (Codex, 18 Sep 2026).
--
-- Nullable, and nothing depends on it: a shortlist item added by hand, or from
-- before this column, simply does not know.
alter table trip_shortlist add column if not exists search_id uuid;

-- No foreign key on purpose: the log is allowed to be rolled up and dropped
-- (retention), and a shortlist item must not be held hostage to that.
create index if not exists trip_shortlist_search_idx
  on trip_shortlist (search_id) where search_id is not null;
