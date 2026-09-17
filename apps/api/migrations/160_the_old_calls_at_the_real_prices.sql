-- The same backfill, at the prices the ledger actually uses.
--
-- Migration 154 valued the calls already made at $0.017 a Places request and
-- $0.005 a Routes element. Those were a second table's figures, and the one
-- cost model says $0.032 and $0.01 — so every backfilled call in the current
-- month stayed undercounted by about half, and the monthly ceiling is a sum of
-- them (Codex, 17 Sep 2026).
--
-- Recomputed from `units`, which is what the providers billed for, rather than
-- scaled from the earlier figure: a row whose meter we can read does not need
-- guessing at, and one we cannot read is left exactly as it is. Rows billed in
-- tokens are untouched — Claude's cost is worked out where it is recorded.

update provider_calls
   set estimated_cost_usd =
         coalesce((units->>'google')::numeric, 0)          * 0.032
       + coalesce((units->>'google-photos')::numeric, 0)   * 0.007
       + coalesce((units->>'google-routes')::numeric, 0)   * 0.01
       + coalesce((units->>'tripadvisor')::numeric, 0)     * 0.015
 where units is not null
   and input_tokens is null
   and (units ? 'google' or units ? 'google-photos' or units ? 'google-routes' or units ? 'tripadvisor');
