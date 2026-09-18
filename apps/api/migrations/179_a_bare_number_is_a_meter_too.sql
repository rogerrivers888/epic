-- The calls whose meter is a number, not an object.
--
-- 160 priced the old calls by looking inside the meter — `units ? 'google'` and
-- the rest — and the routing path wrote its meter as a bare count for a long
-- time, so those rows matched nothing and kept a null cost. The monthly ceiling
-- is a sum of `estimated_cost_usd`, which means every one of those journeys was
-- money the guard could not see (Codex, 18 Sep 2026).
--
-- A new file rather than an edit of 160, which has run.
--
-- The provider says what a unit costs where the meter does not name it. Only
-- the providers that bill: the open map, the encyclopedias and the address
-- lookup are free, and pricing them would be inventing a bill.
update provider_calls
   set estimated_cost_usd = round((units #>> '{}')::numeric * case provider
         when 'google-routes'  then 0.01
         when 'google'         then 0.032
         when 'google-places'  then 0.017
         when 'tripadvisor'    then 0.002
       end, 6)
 where estimated_cost_usd is null
   and input_tokens is null
   and jsonb_typeof(units) = 'number'
   and (units #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
   and provider in ('google-routes', 'google', 'google-places', 'tripadvisor');
