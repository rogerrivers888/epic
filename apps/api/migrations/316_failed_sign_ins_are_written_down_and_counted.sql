-- Every failed sign-in is written down, and a handful from one place locks it out
-- (owner, 1 Oct 2026). The sign-in door is reachable without the launch-gate
-- password (so native clients and the magic link still work), so it is hardened
-- instead: each failure is a row here, and the count over a short window is what
-- the guard reads to lock an IP or an account out and to alert the owner
-- (signInGuard.js).
create table if not exists sign_in_failures (
  id      uuid primary key default gen_random_uuid(),
  ip      text,
  contact text,                         -- the account a bad magic link was for; null for a wrong passcode
  kind    text not null,                -- 'passcode' | 'link'
  reason  text not null,
  at      timestamptz not null default now()
);

-- The guard counts by IP and by contact over the last few minutes; both are
-- time-ordered so the window is an index range, not a scan.
create index if not exists sign_in_failures_ip_at_idx on sign_in_failures (ip, at desc);
create index if not exists sign_in_failures_contact_at_idx on sign_in_failures (contact, at desc);
