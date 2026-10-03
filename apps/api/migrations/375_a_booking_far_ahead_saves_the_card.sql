-- Bookings more than 80 days ahead (register L4; Stripe build, Phase 5, 3 Oct 2026).
--
-- Stripe must pay a UK host out within 90 days of a charge, and Epic pays out only after the event (L3). So a paid
-- booking whose charge would sit longer than that saves the guest's card at booking — a SetupIntent, off-session use
-- agreed — and charges it 80 days before the event, or at the decides-by date if that is earlier.
--
--   card_saved      the card is saved and nothing is charged yet: the place is the guest's
--   charge_failed   the later charge was refused: the guest is asked to pay, the booking is NOT cancelled (open in
--                   L4 — "notify Roger and the guest, do not cancel automatically, until Roger decides"); the
--                   payment problems log carries it for a person
--
-- Nothing reaches Epic's balance: the card is saved on Epic's own account (the household's Stripe customer) and the
-- later charge is the same destination charge to the host's account as any other (L1, L2).

alter table experience_bookings
  add column if not exists stripe_setup_intent     text,
  add column if not exists saved_payment_method    text,
  add column if not exists charge_due_at           timestamptz,
  -- Taken off what will be charged by sessions cancelled before the charge (a part of the booking cancelled).
  add column if not exists later_off_pence         integer not null default 0,
  add column if not exists later_charge_claimed_at timestamptz,
  add column if not exists later_charge_failed_at  timestamptz;

alter table experience_bookings drop constraint if exists experience_bookings_payment_state_check;
alter table experience_bookings add constraint experience_bookings_payment_state_check
  check (payment_state in ('none', 'held', 'charged', 'partially_refunded', 'refunded', 'released', 'failed', 'card_saved', 'charge_failed'));

create index if not exists experience_bookings_charge_due_idx on experience_bookings (charge_due_at) where payment_state = 'card_saved';
create unique index if not exists experience_bookings_setup_intent_idx on experience_bookings (stripe_setup_intent) where stripe_setup_intent is not null;
