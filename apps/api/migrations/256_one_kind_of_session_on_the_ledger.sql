-- One kind of session on the ledger: an api_sessions row, and nothing else.
--
-- Owner, 26 Sep 2026: "Unify the session ids. Two tables meaning 'which
-- session did this' is how attribution erodes, and the whole point of
-- yesterday's work was that no spend is unattributable. Six per cent in a
-- different table is six per cent nobody looks at."
--
-- The planner wrote its plan_sessions id into session_id (recordSessionCall),
-- a session of a different kind that the cap and the spend reports never
-- joined to. Those rows — 314, the newest a week old, their plan sessions
-- long expired — move onto a service session named for what they were, and
-- the column takes a foreign key so nothing but an api_sessions id can be
-- written again. Deleting a session that has ledger rows is refused: the
-- ledger is the record, and a session with spend on it is not for deleting.

with plans as (
  insert into api_sessions (token_hash, label, expires_at, revoked_at)
  values ('service:plan-sessions-before-2026-09-26', 'service: plan sessions, before 26 Sep 2026', now(), now())
  on conflict (token_hash) do update set label = excluded.label
  returning id
)
update provider_calls p set session_id = (select id from plans)
 where not exists (select 1 from api_sessions s where s.id = p.session_id);

alter table provider_calls
  add constraint provider_calls_session_fk foreign key (session_id) references api_sessions(id) on delete restrict;
