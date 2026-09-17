-- Money that is about to be spent, written down before it is.
--
-- The ceiling was enforced by reading what `provider_calls` already held. Two
-- collection runs starting at the same moment both read the same total, both
-- decided there was room, and between them went past it — a limit that only
-- one caller at a time can be held to is not a limit (Codex, 17 Sep 2026).
--
-- A reservation is taken in the same transaction that reads the total, under a
-- lock on the ceiling setting, so the second caller sees the first one's claim.
-- It is released when the run finishes, and expires on its own if a process
-- dies holding one: by then the calls it covered are in `provider_calls` and
-- counting both would refuse spending that is genuinely available.

create table if not exists spend_reservations (
  id         uuid primary key default gen_random_uuid(),
  pence      integer     not null,
  holder     text,
  made_at    timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);

create index if not exists spend_reservations_live_idx on spend_reservations (expires_at);
