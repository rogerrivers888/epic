-- Two of the prices in 179 were invented.
--
-- `domain/providerPrices.js` is the one table: a Tripadvisor location is
-- $0.015, not the $0.002 I wrote, and `google-places` is not in the table at
-- all — those calls are photographs, priced as `google-photos` at $0.007, where
-- I wrote $0.017. A backfill at the wrong rate is worse than none: the monthly
-- ceiling is a sum of this column, so it would admit or refuse work on a figure
-- nobody can trace to a price list (Codex, 18 Sep 2026).
--
-- A new file rather than an edit of 179, which has run. Nothing was mispriced
-- by it here or on production — the only rows it touched were google-routes,
-- whose rate was right — but the file is the thing a future installation runs.
update provider_calls
   set estimated_cost_usd = round((units #>> '{}')::numeric * case provider
         when 'google-places' then 0.007
         when 'tripadvisor'   then 0.015
       end, 6)
 where input_tokens is null
   and jsonb_typeof(units) = 'number'
   and (units #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
   and provider in ('google-places', 'tripadvisor')
   -- Only rows 179 would have priced, and only where its answer differs from
   -- the price table's.
   and estimated_cost_usd is distinct from round((units #>> '{}')::numeric * case provider
         when 'google-places' then 0.007
         when 'tripadvisor'   then 0.015
       end, 6);
