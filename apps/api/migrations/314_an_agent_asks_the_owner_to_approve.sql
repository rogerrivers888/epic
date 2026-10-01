-- An agent asks, the owner approves — the Approvals queue (G11, owner 1 Oct 2026).
--
-- An agent session may read and propose but not perform a privileged action
-- (a purge, a bulk apply, a paid run). Rather than ask in chat, it files a
-- request here: the exact call it needs, a one-line description, and the numbers
-- affected. The owner, signed in personally, approves or declines with one
-- click — logged with his name. V1 is a governance record: the owner then
-- performs the action. (The `request` column names the exact call, so a later
-- follow-on could authorise an approved call without reopening the shape.)
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references api_sessions(id) on delete set null,
  requested_label text,                 -- how the filing session named itself
  request text not null,                -- the exact "METHOD /path" the approval unlocks, once
  description text not null,             -- the one line the owner reads
  numbers jsonb,                         -- what it would affect (places, cost, rows)
  state text not null default 'pending'
    check (state in ('pending', 'approved', 'declined', 'consumed', 'expired')),
  decided_by text,                       -- the owner's name, from his signed-in account
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approvals_pending_idx on approvals (created_at) where state = 'pending';
create index if not exists approvals_live_idx on approvals (session_id, request) where state = 'approved';
