-- How a session proved who it is, not just what kind of client it is (G11, 1 Oct 2026).
--
-- `kind` (migration 264) says device, agent or service. It does not say how the
-- session signed in: the shared passcode, which the owner and every coding
-- agent hold alike, or a personal sign-in — the magic link to an account's own
-- address. Privileged actions (lift a census hold, grant an agent paid calls, a
-- bulk production change) need the second: the owner, personally, logged by
-- name. Not available to a passcode session, whoever holds it. So the session
-- records its method and the gate reads it.
--
-- Default 'passcode', the least-privileged: a session whose method was never
-- recorded can never clear the privileged gate. Service sessions are marked as
-- their own method. Existing link sessions cannot be told apart in hindsight
-- and read as passcode, so the owner signs in again by link to lift a hold —
-- safe, not silent.
alter table api_sessions add column if not exists auth_method text not null default 'passcode';
alter table api_sessions drop constraint if exists api_sessions_auth_method_check;
alter table api_sessions add constraint api_sessions_auth_method_check
  check (auth_method in ('passcode', 'link', 'google', 'service', 'invite'));
update api_sessions set auth_method = 'service' where token_hash like 'service:%' and auth_method <> 'service';
