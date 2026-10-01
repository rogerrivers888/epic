-- Where a host is paid (SX16, owner 1 Oct 2026). A host may have more than one
-- bank account on file and chooses which one payouts go to; the chosen one wears
-- the "PAID HERE" chip. Adding an account is Stripe's own onboarding and is out
-- of this build — this table is the record the screen lists and switches between,
-- seeded by that onboarding when it lands.
--
-- Epic never holds the money (payouts go through Stripe straight to the bank),
-- so nothing here is an account number: a display label, the last four digits
-- and the holder name are all that is shown, and all that is kept.

create table if not exists host_payout_accounts (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references hosts(id) on delete cascade,
  label       text not null,                       -- the bank, e.g. 'Monzo', 'Starling'
  last4       text not null,                        -- the only digits shown, e.g. '42'
  holder_name text,                                 -- 'R Sumner'
  added_on    date not null default current_date,
  is_active   boolean not null default false,       -- the one payouts go to
  created_at  timestamptz not null default now()
);

create index if not exists host_payout_accounts_host on host_payout_accounts(host_id);

-- One account is the payout account at a time.
create unique index if not exists host_payout_accounts_one_active
  on host_payout_accounts(host_id) where is_active;
