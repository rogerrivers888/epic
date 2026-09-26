-- A plan is not a session, and a deleted account's spend stays on the ledger.
--
-- 256 made session_id an api_sessions id and nothing else. The planner, the
-- voice lab and the call bounds had been using that column for the *plan*
-- session — the run receipt, a trip's spend and the per-plan bound all read
-- by it — so unifying the column emptied those readings and, worse, the
-- planner's token rows failed the foreign key after the paid call had been
-- made (Codex via epic-09, 26 Sep 2026). A plan is a different fact from a
-- session and gets its own column; session_id stays the session.
--
-- And the key refused to delete a session with spend on it, which through
-- api_sessions' cascade from accounts refused to delete any account that had
-- ever spent. A deleted account's rows move to a session named for what
-- they are; the ledger keeps them, the account goes.

alter table provider_calls add column if not exists plan_session_id uuid references plan_sessions(id) on delete set null;
create index if not exists provider_calls_plan_session_idx on provider_calls (plan_session_id) where plan_session_id is not null;

insert into api_sessions (token_hash, label, expires_at, revoked_at)
values ('service:sessions-of-deleted-accounts', 'service: sessions of deleted accounts', now(), now())
on conflict (token_hash) do update set label = excluded.label;

create or replace function deleted_account_session_id() returns uuid
language sql stable as $$
  select id from api_sessions where token_hash = 'service:sessions-of-deleted-accounts'
$$;

alter table provider_calls alter column session_id set default deleted_account_session_id();
alter table provider_calls drop constraint if exists provider_calls_session_fk;
alter table provider_calls
  add constraint provider_calls_session_fk foreign key (session_id) references api_sessions(id) on delete set default;
