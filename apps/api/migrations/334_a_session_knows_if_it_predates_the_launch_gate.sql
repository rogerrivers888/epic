-- A session knows for itself whether it predates the launch gate's clean slate
-- (owner, 2 Oct 2026: "do the real fix (comparison inside the session lookup):
-- the migration is approved provided it only adds, nothing destructive").
--
-- Until now the gate read the clean-slate time from schema_migrations once at
-- boot and held it in memory. When that read failed, the gate could not date any
-- session and refused all of them — fresh sign-ins included — so an agent signed
-- in with the passcode and then saw only 401 coming_soon. With the answer on the
-- row, the session lookup returns it in the same query that finds the session:
-- nothing loaded at boot, nothing held per process, no clock compared with
-- another host's, and the same answer on every replica (siteGate.js).
--
-- Additive only. One column with a default — every session made from now on is
-- after the clean slate — and its value written once for the rows that already
-- exist, from the recorded clean-slate time. Nothing is dropped, renamed or
-- revoked: migration 315 already revoked every session that predates the gate,
-- and this records the fact beside them.
alter table api_sessions add column if not exists before_clean_slate boolean not null default false;

-- schema_migrations is the runner's own table (migrate.js); a database built some
-- other way (the test databases) has none and no clean slate to date, so the
-- update is skipped there and every row stays after it.
do $$
begin
  if to_regclass('schema_migrations') is not null then
    update api_sessions s
       set before_clean_slate = true
     where s.created_at < (select m.applied_at from schema_migrations m
                            where m.name like '%clean_slate_of_sessions%'
                            order by m.applied_at limit 1);
  end if;
end $$;
