-- The money against calls that only ever recorded a meter.
--
-- `provider_calls` has had `units` — what the provider bills for — and
-- `estimated_cost_usd` side by side, and four different helpers wrote to the
-- table with only some of them filling the money in. The monthly collection
-- ceiling is a sum of the money, so this month's planning and trip searches
-- read as free and Collect could authorise spending past the limit (Codex,
-- 17 Sep 2026).
--
-- There is one writer now, and it prices every call. This is the history: the
-- same list prices, applied to the units already recorded. Rows with no meter
-- and no cost are left alone — a nought we invented would be worse than a gap
-- that says so.

update provider_calls
   set estimated_cost_usd =
         coalesce((units->>'google')::numeric, 0)          * 0.017
       + coalesce((units->>'google-routes')::numeric, 0)   * 0.005
 where estimated_cost_usd is null
   and units is not null
   and (units ? 'google' or units ? 'google-routes');
