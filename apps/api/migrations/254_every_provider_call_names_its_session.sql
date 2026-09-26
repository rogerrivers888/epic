-- Every provider call names its session, and the ledger will not take one
-- that does not.
--
-- Owner, 26 Sep 2026: "Add a session id to every provider call, as a separate
-- job. With five agents on a shared tree, spend nobody can attribute is spend
-- nobody can stop, and yesterday four sessions spent an afternoon chasing
-- £16.39 that turned out to be this. Make it required rather than optional
-- on the ledger."
--
-- Three kinds of session write the ledger now (repositories/providerCalls.js):
-- a request's api_sessions row, put in the store by auth.js; the session that
-- started a census run or a research sweep, carried on the run; and the
-- server's own, one api_sessions row per process, expired at birth so it can
-- never sign anybody in. The 167,000 rows written before today carry a
-- session of their own kind, named for what it is, so the column can be made
-- required without pretending those calls were attributed.

alter table census_runs     add column if not exists started_session_id uuid references api_sessions(id) on delete set null;
alter table research_sweeps add column if not exists started_session_id uuid references api_sessions(id) on delete set null;

with unattributed as (
  insert into api_sessions (token_hash, label, expires_at, revoked_at)
  values ('service:unattributed-before-2026-09-26', 'service: unattributed, before 26 Sep 2026', now(), now())
  on conflict (token_hash) do update set label = excluded.label
  returning id
)
update provider_calls set session_id = (select id from unattributed) where session_id is null;

alter table provider_calls alter column session_id set not null;
