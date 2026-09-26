-- Who may spend, and how much a day (owner, 26 Sep 2026, G8).
--
-- "Agent sessions get a zero paid budget unless I grant one." Every session
-- is now one of three kinds. A *device* is somebody's browser or phone signed
-- in through the app; an *agent* is anything else that holds the passcode —
-- a script, a coding session, a headless browser — and spends nothing paid
-- until the owner grants it hours (`paid_grant_until`); *service* is the
-- server's own session, which the paid door already refuses. New rows default
-- to agent, so a session opened by any path that forgets to say is the one
-- that cannot spend.
--
-- Existing sessions are sorted by what the app has always written: a device
-- label is "<Phone|Tablet|Computer> · <browser>" (apps/web/src/session.ts
-- `deviceLabel`), and an invitation names itself "<name> · invited to …".
-- Having an account is not enough on its own: the passcode opens a session on
-- the owner's account once one is claimed, whoever holds it (Codex, 26 Sep
-- 2026). Everything else is an agent — 274 unlabelled passcode sessions and
-- labels like "epic-f0 edge census" among them.
alter table api_sessions add column if not exists kind text not null default 'agent';
alter table api_sessions add column if not exists paid_grant_until timestamptz;
alter table api_sessions drop constraint if exists api_sessions_kind_check;
alter table api_sessions add constraint api_sessions_kind_check check (kind in ('device', 'agent', 'service'));

update api_sessions set kind = 'service' where token_hash like 'service:%';
update api_sessions set kind = 'device'
 where kind = 'agent'
   and (label ~ '^(Phone|Tablet|Computer) · (Edge|Chrome|Safari|Firefox|Browser)$'
        or label in ('ios', 'android')
        or (account_id is not null and label like '% · invited to %'));

-- "Daily £ ceiling across the estate from estimated_cost_usd: alarm at 80%
-- (email and back-office banner), refuse at 100%." One row per day and level,
-- so the alarm is raised once, whichever process or restart crosses the line
-- first; the banner reads the same rows.
create table if not exists spend_alarms (
  day date not null,
  level text not null check (level in ('warn', 'stop')),
  spent_usd numeric not null,
  ceiling_usd numeric not null,
  raised_at timestamptz not null default now(),
  mailed boolean not null default false,
  mail_note text,
  primary key (day, level)
);

-- The ceiling sums a day of the ledger on every paid admission.
create index if not exists provider_calls_created_idx on provider_calls (created_at);
