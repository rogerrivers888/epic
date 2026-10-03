-- Cancellations and the 5% (register L5, 3 Oct 2026; owner's answers the same day).
--
--   · A guest who cancels where they would otherwise get everything back gets it
--     less a cancellation fee, kept by Epic to cover Stripe's costs. On a part
--     refund under the policy there is no fee: they get exactly what it says.
--   · When the host causes it — cancels, or moves a date and the guest then
--     cancels (K8b) — the guest gets everything back and Epic recovers the same
--     share of the refund from the host's own Stripe balance. Not when the
--     minimum isn't met, unless the owner switches that on.
--   · Every refund line says what was kept and who set it off.
--
-- The rate and the switch are settings, as every money number is.

insert into hosting_settings (key, label, value, unit, position) values
  ('cancellation_fee_pct', 'Cancellation fee kept / recovered', '5',     'percent', 95),
  ('recovery_on_minimum',  'Recover the fee when the minimum isn''t met', 'false', 'switch', 96)
on conflict (key) do nothing;

-- A refund line: what Epic kept of the cancelled amount, who set the refund off, and how it unwinds at Stripe —
-- 'proportional' (the host's share and Epic's fee back in proportion, K11) or 'keep_fee' (the guest gets the
-- cancelled amount less the fee; the host's whole share of it comes back; Epic keeps the fee).
alter table hosting_payments
  add column if not exists fee_kept_pence integer not null default 0,
  add column if not exists triggered_by   text,
  add column if not exists refund_mode    text,
  -- A host recovery names the refund it recovers for.
  add column if not exists recovers       uuid references hosting_payments(id) on delete set null;
alter table hosting_payments drop constraint if exists hosting_payments_triggered_by_check;
alter table hosting_payments add constraint hosting_payments_triggered_by_check
  check (triggered_by is null or triggered_by in ('guest', 'host', 'epic', 'staff'));
alter table hosting_payments drop constraint if exists hosting_payments_refund_mode_check;
alter table hosting_payments add constraint hosting_payments_refund_mode_check
  check (refund_mode is null or refund_mode in ('proportional', 'keep_fee'));
-- One recovery a refund, however often the job runs.
create unique index if not exists hosting_payments_recovers_idx on hosting_payments (recovers) where recovers is not null;

-- What of a booking's money Epic kept as cancellation fees: counted with what was refunded wherever "what is left"
-- is worked out, so the host is never paid for it and the guest is never refunded it twice.
alter table experience_bookings
  add column if not exists cancellation_fee_pence integer not null default 0,
  -- The rate agreed when the booking was made, as the refund terms are: a booking made before the fee, or before a
  -- change to it, keeps what it agreed to. Null: no fee (every booking before this migration).
  add column if not exists cancellation_fee_pct   numeric;
