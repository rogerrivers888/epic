-- Complaints that end in money, and chargebacks Epic answers (Stripe build, 3 Oct 2026; back-office hooks).
--
--   Complaints: the host has 48 hours to answer. A refund the host offers is paid at once and closes it; one the host
--   leaves unanswered is paid automatically when it is within the auto-refund limit (the claim_auto_pay_limit
--   setting; £50 until it is set — owner, 3 Oct 2026); above it, or disputed by the host, it waits for a person.
--   Every refund goes through the same refund queue as a cancellation (cause 'complaint').
--
--   Chargebacks: one row per Stripe dispute, with its deadline. Epic's own evidence (the booking, attendance, what
--   was agreed) is sent automatically two days before the deadline unless a person has sent or accepted it first.

alter table hosting_complaints
  add column if not exists host_replied_at  timestamptz,
  add column if not exists host_offer_pence integer,
  add column if not exists host_disputes    boolean not null default false,
  add column if not exists refund_line      uuid references hosting_payments(id) on delete set null,
  add column if not exists refunded_by      text;

create table if not exists chargebacks (
  id                 text primary key,
  booking_id         uuid references experience_bookings(id) on delete set null,
  payment_intent     text,
  amount_pence       integer,
  reason             text,
  status             text,
  due_by             timestamptz,
  evidence           jsonb,
  evidence_sent_at   timestamptz,
  evidence_sent_by   text,
  accepted_at        timestamptz,
  accepted_by        text,
  closed_at          timestamptz,
  mode               text not null default 'test',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists chargebacks_due_idx on chargebacks (due_by) where evidence_sent_at is null and accepted_at is null and closed_at is null;
