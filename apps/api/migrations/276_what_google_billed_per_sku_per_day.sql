-- What Google's billing export says it billed, per SKU per day, and each
-- ledger row's share of it (owner, 29 Sep 2026: "Reconcile September per SKU
-- and per day against the ledger … and fix the ledger to match billing. This
-- is now about attribution, not money lost").
--
-- The ledger (`provider_calls`) knows who asked for what — household,
-- session, purpose — and estimates cost at list price. Billing knows what was
-- charged, after the free allowances, per SKU per day, and nothing of who.
-- `billing_days` keeps billing's side; `provider_calls.billed_gbp` is each
-- row's share of its day's billed usage for its SKU, in proportion to the
-- requests it made. The estimate is kept beside it, never overwritten.
create table if not exists billing_days (
  day         date not null,
  service     text not null,
  sku         text not null,
  sku_id      text not null,
  meter       text,                       -- our meter key, where the SKU maps to one
  usage       numeric not null default 0, -- in the SKU's own unit
  unit        text,
  cost        numeric not null default 0, -- usage before credit
  credits     numeric not null default 0, -- negative: credit applied
  promo       numeric not null default 0, -- of which promotional (free-trial) credit
  currency    text,
  read_at     timestamptz not null default now(),
  primary key (day, sku_id)
);
create index if not exists billing_days_meter on billing_days (meter, day);

alter table provider_calls add column if not exists billed_gbp numeric;
alter table provider_calls add column if not exists billed_at timestamptz;
