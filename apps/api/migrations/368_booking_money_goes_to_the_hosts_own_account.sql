-- Booking money goes to the host's own account (register L1–L3, 3 Oct 2026).
--
-- Hosting v4 charged guests on Epic's own Stripe balance and transferred the
-- host's share when the payout was released: separate charges and transfers,
-- the escrow pattern the FCA says needs authorisation. From here a guest's
-- payment is a destination charge to the host's connected account, with the
-- host as merchant of record and Epic's fee as the application fee; the host's
-- account is on manual payouts and a released payout is a Payout on that
-- account. Epic holds the timing, never the money.
--
-- `charge_model` marks which way a booking or tip was charged. Rows made before
-- this have none: they are the old model, and the payout job will not pay them
-- from a host's balance they never reached. Voiding them is its own migration,
-- an Approval for the owner (G7), not this one.
--
-- A host's account keeps only what the brief allows (§2): the account and
-- Person ids, whether charges and payouts are on, and what Stripe still wants.
-- Never a bank detail.

alter table hosts
  add column if not exists stripe_person_id        text,
  add column if not exists stripe_charges_enabled  boolean not null default false,
  add column if not exists stripe_payouts_enabled  boolean not null default false,
  add column if not exists stripe_requirements     jsonb,
  add column if not exists stripe_payouts_manual   boolean not null default false,
  -- 'v2': made by Accounts v2 on manual payouts (this build). Null: an account from before it.
  add column if not exists stripe_account_model    text;
alter table hosts drop constraint if exists hosts_stripe_account_model_check;
alter table hosts add constraint hosts_stripe_account_model_check check (stripe_account_model is null or stripe_account_model in ('v2'));

alter table experience_bookings
  add column if not exists charge_model  text,
  -- A chargeback on the booking's payment: 'open' while the guest's bank decides (L3), and the payout waits.
  add column if not exists dispute_state text;
alter table experience_bookings drop constraint if exists experience_bookings_dispute_state_check;
alter table experience_bookings add constraint experience_bookings_dispute_state_check check (dispute_state is null or dispute_state in ('open', 'won', 'lost'));
alter table experience_bookings drop constraint if exists experience_bookings_charge_model_check;
alter table experience_bookings add constraint experience_bookings_charge_model_check check (charge_model is null or charge_model = 'destination');

alter table booking_tips
  add column if not exists charge_model text;
alter table booking_tips drop constraint if exists booking_tips_charge_model_check;
alter table booking_tips add constraint booking_tips_charge_model_check check (charge_model is null or charge_model = 'destination');

-- A refund of something other than the booking's own payment — a tip charged twice — names
-- the PaymentIntent it refunds and the tip it belongs to (Hosting v7 handover, 3 Oct 2026).
alter table hosting_payments
  add column if not exists refund_of text,
  add column if not exists tip_id    uuid references booking_tips(id) on delete set null;

-- A released payout is a Payout on the host's account now, not a transfer from Epic's.
alter table host_payouts
  add column if not exists stripe_payout text;

-- Stripe's webhook, once per event: an event delivered twice is applied once.
create table if not exists stripe_events (
  id            text primary key,          -- Stripe's evt_ id
  type          text not null,
  account       text,                      -- the host's account, for a Connect event
  livemode      boolean not null default false,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  fault         text
);
create index if not exists stripe_events_unprocessed_idx on stripe_events (received_at) where processed_at is null;

-- Passport only (L7). A UK photocard licence is open in the register; this
-- switch lets it in when the owner decides, and it is off (owner, 3 Oct 2026).
insert into hosting_settings (key, label, value, unit, position) values
  ('identity_driving_licence', 'Identity: accept a UK driving licence', 'false', 'switch', 230)
on conflict (key) do nothing;
