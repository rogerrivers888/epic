-- A call says whether it came back, and how long it took.
--
-- The owner, 20 September 2026, on the supplier record's health panel: "it
-- should show failures also, so yes, worth fixing."
--
-- `provider_calls` has recorded what every outbound call *cost* since day one
-- and nothing at all about how it went, so the panel could only say "provider
-- calls do not record an outcome or a duration". Three columns, and each of
-- them is deliberately nullable:
--
--   ok      true, false, or **null for a call made before this existed** — and
--           for one made through an adapter nobody has instrumented yet. Null
--           reads as "not recorded", which is a different fact from "it worked",
--           and defaulting it to true would have written four thousand
--           successes nobody observed.
--   ms      how long it took, wall clock, for the p95.
--   fault   a short reason, in the provider's own terms — `http_429`,
--           `timeout`, `no_key`. Never the provider's message: a raw body can
--           carry a query, a key or somebody's address.
--
-- `failed` is a count rather than a flag because one row can be several calls:
-- a search's meter records one row for the whole search, and three requests of
-- which one failed is not the same as a failure.

alter table provider_calls add column if not exists ok      boolean;
alter table provider_calls add column if not exists ms      integer;
alter table provider_calls add column if not exists failed  integer not null default 0;
alter table provider_calls add column if not exists fault   text;

-- Read per provider over a window, which is the one question the panel asks.
create index if not exists provider_calls_health_idx
  on provider_calls (provider, created_at desc)
  where ok is not null;
