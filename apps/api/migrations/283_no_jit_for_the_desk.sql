-- No just-in-time compilation on this database (round 3 PERF, 29 Sep 2026).
--
-- Postgres compiles a query to machine code when its estimated cost passes
-- jit_above_cost. The desk's counts over the whole place index pass it, and
-- on the dev database the compile alone took 200–400 ms of a query that then
-- ran in a fraction of that: Categories and a subcategory's page each spent
-- half their time compiling (EXPLAIN ANALYZE: "JIT … Total 395 ms" on a
-- 916 ms query). Nothing Epic asks runs long enough to earn the compile back.
--
-- Set on the database, so every new connection has it; a role that may not
-- alter the database is told so and the migration still applies — this is a
-- speed-up, never a reason to stop a deploy.
do $$
begin
  execute format('alter database %I set jit = off', current_database());
exception when insufficient_privilege then
  raise notice 'jit left as it is: % may not alter database %', current_user, current_database();
end $$;
