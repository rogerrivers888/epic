-- BO2r's History tab reads the calls made about one place, and the ledger had
-- nowhere to put that: `units` is the billing meter, and no writer ever put a
-- reference in it. So the tab showed a place's edits and none of the asking
-- that had been done about it (Codex, 18 Sep 2026).
--
-- Its own column rather than a key in the meter, because the meter is priced by
-- adding up its keys and a reference is not a unit of anything.
alter table provider_calls add column if not exists venue_ref text;

-- The History tab's question: this place, newest first.
create index if not exists provider_calls_venue_idx
  on provider_calls (venue_ref, created_at desc) where venue_ref is not null;
