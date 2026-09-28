-- The desk reads a month of the ledger by index (round 4 PERF, 29 Sep 2026).
--
-- Overview's Spend tile, Billing › Reconcile and Claude by caller each read
-- one month of provider_calls, and provider_calls had no index that a month
-- on created_at could use: every read scanned the whole month — hundreds of
-- thousands of free-source rows (Wikipedia, Overpass) — to find the few
-- thousand Google or Claude rows it adds up, and ran jsonb_each over all of
-- them. Google's estimate alone took 0.4–0.5 s, twice a Reconcile.
--
-- Two partial indexes on created_at, each over exactly the rows one reader
-- can count. Nothing is precomputed: every figure is still added up from the
-- ledger's own rows on every read, so no number can be stale.
--
-- `provider_call_bills_google` is true of every row desk/billing.js can read
-- as a Google meter (LEDGER_METERS, PRO_DETAILS) and of more besides — a
-- superset, so adding it to those queries narrows the scan without changing
-- what they count. It is a pure function of the row, hence immutable.
create or replace function provider_call_bills_google(units jsonb, provider text) returns boolean
language sql immutable parallel safe as $$
  select case jsonb_typeof(units)
           when 'object' then exists (select 1 from jsonb_object_keys(units) k where k like 'google%' or k = 'pro-details')
           when 'number' then provider ~* 'google'
           when 'string' then provider ~* 'google'
           else false
         end
$$;

create index if not exists provider_calls_google_month_idx
  on provider_calls (created_at) where provider_call_bills_google(units, provider);

-- Claude's rows, as desk/claudeSpend.js and Overview's Spend tile name them.
create index if not exists provider_calls_claude_month_idx
  on provider_calls (created_at) where provider ~* 'anthropic|claude';
