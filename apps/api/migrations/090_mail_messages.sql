-- Every e-mail Epic sends, and what became of it (owner, 13 Sep 2026: "we
-- should use the same service [as Parcelvision] because we get send and read
-- receipts and bounced email reporting").
--
-- One row per send. Postmark's MessageID is the key its webhook events arrive
-- under; the events land in `events` verbatim and move `status` along:
-- sent → delivered → opened, or sent → bounced / soft_bounced / complained,
-- or failed when the sender refused it and nothing left. A hard bounce or a
-- complaint against an address suppresses further sends to it (mail.js).
create table if not exists mail_messages (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  purpose text not null default 'message',
  provider text not null default 'postmark',
  provider_id text,
  -- `sending` is the row before Postmark has answered; a process that dies there
  -- leaves it honest rather than claiming a send that may never have left.
  status text not null default 'sending' check (status in ('sending', 'sent', 'delivered', 'opened', 'bounced', 'soft_bounced', 'complained', 'failed')),
  bounce_type text,
  failure text,
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  opened_at timestamptz,
  bounced_at timestamptz,
  events jsonb not null default '[]'::jsonb
);
create index if not exists mail_messages_provider_idx on mail_messages (provider_id) where provider_id is not null;
create index if not exists mail_messages_sent_idx on mail_messages (sent_at desc);
create index if not exists mail_messages_to_idx on mail_messages (lower(to_address), sent_at desc);
