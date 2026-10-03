-- Pay on the day (register L10; Stripe build, Phase 6, 3 Oct 2026; owner's answers the same day).
--
-- An organiser of a private event may collect guests' money themselves on the day (money = 'direct'). Epic then holds
-- nothing and no Connect account is made; the organiser still proves who they are (L7). Epic's fee — the private
-- payment fee — is charged to the organiser's own card, on Epic's own account (L8):
--
--   up front     24 hours before each session, on the ticket price × the guests who said they're coming
--   headcount    the organiser confirms how many came within 48 hours after the session (a setting); more came, the
--                saved card is topped up; fewer came, Epic's fee is not refunded; not confirmed, the up-front charge
--                stands (owner, 3 Oct 2026)
--
-- Guests paying on the day are not covered by Epic's refund policy or satisfaction guarantee, and are told before they
-- say they're coming.

alter table hosts
  add column if not exists fee_payment_method   text,
  add column if not exists fee_card_setup_intent text,
  add column if not exists fee_card_saved_at    timestamptz,
  -- The last fee the card refused: the checklist asks for a card again until a new one is saved.
  add column if not exists fee_card_failed_at   timestamptz;

alter table offer_sessions
  add column if not exists headcount     integer,
  add column if not exists headcount_at  timestamptz;

create table if not exists organiser_fees (
  id                    uuid primary key default gen_random_uuid(),
  offer_id              uuid not null references host_offers(id) on delete cascade,
  session_id            uuid not null references offer_sessions(id) on delete cascade,
  host_id               uuid not null references hosts(id) on delete cascade,
  kind                  text not null,
  heads                 integer not null,
  base_pence            integer not null,
  rate_pct              numeric,
  fee_pence             integer not null,
  state                 text not null default 'pending',
  stripe_payment_intent text unique,
  failure               text,
  -- A definite refusal moves the next try to a new idempotency key (a new card is a new request).
  attempt               integer not null default 0,
  failed_at             timestamptz,
  -- The card it was refused on: tried again only on a different one.
  failed_card           text,
  mode                  text not null default 'test',
  created_at            timestamptz not null default now(),
  paid_at               timestamptz,
  constraint organiser_fees_kind_check check (kind in ('upfront', 'topup')),
  constraint organiser_fees_state_check check (state in ('pending', 'paid', 'failed')),
  unique (session_id, kind)
);

insert into hosting_settings (key, label, value, unit, position) values
  ('pay_on_day_headcount_hours', 'Pay on the day: hours to confirm how many came', '48', 'hours', 98)
on conflict (key) do nothing;
