-- A day is a budget, and a refusal is a date.
--
-- Owner, 21 September 2026: "Quota: assume the daily Text Search cap is 75,000
-- (it was yesterday). Plan the run across two days: stop cleanly on the first
-- 429, never retry against it, resume automatically after the 00:00 UTC reset,
-- and report what the 429 says the limit actually is."
--
-- Two mechanisms, because either alone is wrong. A **daily budget** stops the
-- run before Google has to, which is how a well-behaved client treats a quota;
-- a **clean stop on the refusal** handles the case where the assumption is out
-- of date, which it will be one day — the figure is 75,000 because that is what
-- it was yesterday, and nothing here is entitled to believe that for ever.
--
-- What must not happen is a retry. The first ring census walked into the daily
-- cap and then fired 9,321 more doomed requests because nothing read the
-- answer; a run that retries against a refusal spends the whole of the next
-- day's allowance proving the same point.
--
-- `refusal` is the provider's own message, kept verbatim, because the owner
-- asked what the 429 says the limit actually *is* — the metric and the number
-- are in that string and nowhere else we can see.
alter table census_runs add column if not exists daily_cap    integer;
alter table census_runs add column if not exists day          date;
alter table census_runs add column if not exists day_requests integer not null default 0;
alter table census_runs add column if not exists resume_after timestamptz;
alter table census_runs add column if not exists refusal      text;
alter table census_runs add column if not exists refused_at   timestamptz;
