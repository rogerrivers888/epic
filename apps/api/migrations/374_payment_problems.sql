-- The payment problems log (Stripe build, Phase 7; owner, 3 Oct 2026). One row for each thing that went wrong with
-- money, written as it happens by the code that saw it — never reconstructed later — and kept: open until it is put
-- right (by Epic's own jobs when Stripe says so, or by a person with a resolution), then resolved with who and how.
--
-- Thirteen kinds in five groups, as the back office draws them:
--   guest payments   hold_expired · later_charge_failed · payment_failed · refund_failed
--   memberships      membership_payment_failed
--   fraud            blocked_fraud · early_fraud_warning · chargeback (every stage)
--   host money       payout_failed · payout_held · host_recovery_waiting · near_90_day_limit
--   our records      reconciliation_mismatch
--
-- A row says what it is about through its links (booking, the guest's household, host, event, membership) and the
-- Stripe object it came from. `dedupe_key` makes the same problem one row however often it is seen — a chargeback
-- moves through its stages on its own row.

create table if not exists payment_problems (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,
  occurred_at    timestamptz not null default now(),
  amount_pence   integer,
  currency       text not null default 'gbp',
  tx_count       integer not null default 1,
  booking_id     uuid references experience_bookings(id) on delete set null,
  household_id   uuid references households(id) on delete set null,
  host_id        uuid references hosts(id) on delete set null,
  offer_id       uuid references host_offers(id) on delete set null,
  membership_id  uuid references memberships(id) on delete set null,
  stripe_ref     text,
  stage          text,
  detail         jsonb not null default '{}'::jsonb,
  status         text not null default 'open',
  resolution     text,
  resolved_by    text,
  resolved_at    timestamptz,
  dedupe_key     text not null unique,
  mode           text not null default 'test',
  updated_at     timestamptz not null default now(),
  constraint payment_problems_kind_check check (kind in (
    'hold_expired', 'later_charge_failed', 'payment_failed', 'refund_failed',
    'membership_payment_failed',
    'blocked_fraud', 'early_fraud_warning', 'chargeback',
    'payout_failed', 'payout_held', 'host_recovery_waiting', 'near_90_day_limit',
    'reconciliation_mismatch')),
  constraint payment_problems_status_check check (status in ('open', 'resolved')),
  constraint payment_problems_mode_check check (mode in ('test', 'live'))
);
create index if not exists payment_problems_open_idx on payment_problems (kind, occurred_at desc) where status = 'open';
create index if not exists payment_problems_when_idx on payment_problems (occurred_at desc);
create index if not exists payment_problems_booking_idx on payment_problems (booking_id) where booking_id is not null;
