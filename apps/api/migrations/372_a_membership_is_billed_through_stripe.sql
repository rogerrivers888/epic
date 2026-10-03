-- A household membership, billed through Stripe (register L8, Phase 4, 3 Oct 2026).
--
-- Solo, Household and Pro are Epic's own revenue, on Epic's own Stripe account:
-- a Checkout subscription with a month free and the card taken up front, the
-- customer portal for card changes and cancelling, and nothing switched on by a
-- return page — only by what Stripe's events say. The reports' one plug-in point
-- (repositories/memberships.js › billedMemberships) reads from here.
--
--   status   trialling · active · paused · cancelled
--            "paused" is Stripe's past_due or unpaid: a payment after the trial
--            failed and Stripe's Smart Retries are trying again. It is not
--            cancelled (owner, 3 Oct 2026); it comes back when a retry succeeds.
--   channel  website · app_store · google_play — the website only for now.

-- The household as a Stripe customer: one, whatever it subscribes to.
alter table households
  add column if not exists stripe_customer_id text;
create unique index if not exists households_stripe_customer_idx on households (stripe_customer_id) where stripe_customer_id is not null;

create table if not exists memberships (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references households(id) on delete cascade,
  plan_key               text not null,
  channel                text not null default 'website',
  status                 text not null,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  -- What it is billed a month, from Stripe's own price (an annual price divided by twelve).
  monthly_pence          integer not null default 0,
  interval               text not null default 'month',
  trial_end              timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  started_at             timestamptz not null default now(),
  ended_at               timestamptz,
  paused_at              timestamptz,
  pause_reason           text,
  -- The reminder sent before a trial ends or an annual renewal: which date it was for, so it goes once a date.
  reminded_for           timestamptz,
  -- The one-tap cancel link in that reminder: an unguessable token that opens Stripe's cancel page for this
  -- membership and nothing else. A new one with every reminder.
  cancel_token           text unique,
  mode                   text not null default 'test',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint memberships_status_check check (status in ('trialling', 'active', 'paused', 'cancelled')),
  constraint memberships_channel_check check (channel in ('website', 'app_store', 'google_play')),
  constraint memberships_mode_check check (mode in ('test', 'live'))
);
create index if not exists memberships_household_idx on memberships (household_id, started_at desc);
create index if not exists memberships_trial_idx on memberships (trial_end) where status = 'trialling';

-- Which Stripe Price is each plan's website price: found by lookup key, made if missing (test mode), and kept here
-- so a membership's price is read back to its plan.
create table if not exists stripe_plan_prices (
  plan_price_id   uuid not null references plan_prices(id) on delete cascade,
  mode            text not null,
  stripe_product_id text not null,
  stripe_price_id   text not null unique,
  created_at      timestamptz not null default now(),
  primary key (plan_price_id, mode),
  constraint stripe_plan_prices_mode_check check (mode in ('test', 'live'))
);

-- The hosting set-up's "how do you want to be paid" column, unused since the payment schedule was removed (L15).
alter table hosts drop column if exists pay_schedule;
