-- "Change how many are going" (hosting attendee README; Stripe build, 3 Oct 2026): a booking grows or shrinks in
-- place, never by a second booking.
--
--   more    only if there is room; the places are the guest's at once (held by the booking's own head count) while
--           they pay the difference — a destination charge like any other (L1, L2) — and go back if the payment
--           fails or isn't finished within 30 minutes. A booking whose card is saved for later (L4) simply owes more
--           at its later charge.
--   fewer   the removed people's share of what was paid is refunded under the booking's own refund policy, through
--           the same refund queue as a cancellation; on a card saved for later it comes off what will be charged.
--
-- One row a change: what it was, what it cost or gave back, and how it ended.

create table if not exists booking_party_changes (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references experience_bookings(id) on delete cascade,
  from_heads            integer not null,
  to_heads              integer not null,
  from_party            jsonb not null,
  to_party              jsonb not null,
  from_children         jsonb not null default '[]'::jsonb,
  -- Signed: more to pay (+) or the share given up (−), before the refund policy.
  delta_pence           integer not null default 0,
  charge_pence          integer not null default 0,
  fee_pence             integer not null default 0,
  refund_pence          integer not null default 0,
  fee_kept_pence        integer not null default 0,
  stripe_payment_intent text unique,
  refund_line           uuid references hosting_payments(id) on delete set null,
  state                 text not null default 'pending',
  by_label              text,
  by_account            uuid,
  created_at            timestamptz not null default now(),
  finished_at           timestamptz,
  constraint booking_party_changes_state_check check (state in ('pending', 'done', 'failed', 'expired')),
  constraint booking_party_changes_by_check check (by_label is null or by_label in ('guest', 'host', 'staff'))
);
-- One change waiting on a payment at a time.
create unique index if not exists booking_party_changes_one_pending_idx on booking_party_changes (booking_id) where state = 'pending';
create index if not exists booking_party_changes_booking_idx on booking_party_changes (booking_id, created_at desc);

-- A booking whose money sits in more than one payment (the first charge, then payments for more places): a refund is
-- split across them, newest first, once — worked out from Stripe's own refunded amounts and kept, so a retry sends the
-- same refunds under the same keys. [{ pi, pence }]; null on a refund of a single payment.
alter table hosting_payments add column if not exists refund_split jsonb;
