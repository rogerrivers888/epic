-- A price is a row, and once it is sold it cannot be rewritten.
--
-- The reporting handoff's eighth non-negotiable: "Prices and provider rates are
-- insert-only rows. Revenue joins each subscription to the price row it was sold
-- on. Last quarter can never be rewritten."
--
-- `plans.price_pence` is a single editable column, which means the day a price
-- changes every historical revenue figure silently changes meaning. So a price
-- lives here instead, with an effective date and a channel, and `plans` keeps
-- its column as the current-price cache the older screens already read.
--
-- **Three channels, because Apple takes a cut.** The same tier is £8.99 on the
-- website and £9.99 in the App Store, and the difference is not a discount —
-- it is Apple's 15%. Reporting that as one price hides the only lever there is
-- (steering a subscriber to the website is worth 11.6% more), so the channel is
-- part of the key rather than a note.
--
-- Annual is derived, not stored: `round(monthly × 12 × (1 − discount/100))`.
-- Storing it would let the two disagree, and the screen computes it live as the
-- owner types.
--
-- The three tiers settled on 19 September 2026 (the entitlements table in the
-- money-and-entitlements brief) are seeded here. Nothing is moved onto them —
-- an account's plan is somebody's decision, not a migration's.

create table if not exists plan_prices (
  id                  uuid primary key default gen_random_uuid(),
  plan_key            text not null references plans (key) on delete cascade,
  -- web | ios | android. The channel is part of the price, not a note on it.
  channel             text not null,
  currency            text not null default 'GBP',
  amount_pence        integer not null,
  interval            text not null default 'month',
  -- What an annual subscription comes off the monthly price by, per cent. Held
  -- with the price because changing the discount is a price change.
  annual_discount_pct numeric(5, 2) not null default 0,
  effective_from      timestamptz not null default now(),
  -- Null means current. A change inserts a row and closes the one before it.
  effective_to        timestamptz,
  created_by          text,
  note                text,
  created_at          timestamptz not null default now()
);

create index if not exists plan_prices_current_idx
  on plan_prices (plan_key, channel, effective_from desc)
  where effective_to is null;
create index if not exists plan_prices_span_idx on plan_prices (plan_key, effective_from, effective_to);

-- The published benefits matrix: what a household is told it gets.
--
-- One row per benefit with a cell per tier, rather than a row per (benefit,
-- tier): the screen is a table the owner edits across, and the thing he adds or
-- removes is a whole line of it. `position` is the order it is published in.
create table if not exists plan_benefits (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  -- One entry per tier key: {"solo": "1", "household": "6", "pro": "6"}.
  values       jsonb not null default '{}'::jsonb,
  position     integer not null default 0,
  -- Null until it has been published. An edit clears it, which is what makes
  -- "unpublished changes" a fact about the row rather than a flag in a session.
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists plan_benefits_order_idx on plan_benefits (position, created_at);

-- The three tiers. `standard` stays exactly as it is — somebody is on it.
insert into plans (key, label, note, price_pence, interval, active, position)
values
  ('solo',      'Solo',      'One login. Everything a person on their own needs.',            599,  'month', true, 10),
  ('household', 'Household', 'Up to six logins. Children are members, not accounts.',          899,  'month', true, 11),
  ('pro',       'Pro',       'Adds hosting, events and the AI tools. Not launched.',           1299, 'month', true, 12)
on conflict (key) do nothing;

-- The prices as at 19 September 2026, per channel. Insert-only from here on.
insert into plan_prices (plan_key, channel, amount_pence, annual_discount_pct, created_by, note)
select v.plan_key, v.channel, v.amount_pence, v.discount, 'migration 200', 'Settled 19 Sep 2026'
  from (values
    ('solo',      'web', 599,  10.0),
    ('solo',      'ios', 699,  10.0),
    ('household', 'web', 899,  7.0),
    ('household', 'ios', 999,  7.0),
    ('pro',       'web', 1299, 10.0),
    ('pro',       'ios', 1499, 10.0)
  ) as v(plan_key, channel, amount_pence, discount)
 where exists (select 1 from plans p where p.key = v.plan_key)
   and not exists (
     select 1 from plan_prices pp
      where pp.plan_key = v.plan_key and pp.channel = v.channel and pp.effective_to is null
   );

-- The benefits as published on 19 September 2026.
insert into plan_benefits (label, values, position, published_at)
select v.label, v.vals::jsonb, v.pos, '2026-09-19T00:00:00Z'::timestamptz
  from (values
    ('Logins included',                '{"solo":"1","household":"6","pro":"6"}',                       0),
    ('Saved places',                   '{"solo":"Unlimited","household":"Unlimited","pro":"Unlimited"}', 1),
    ('Day plans generated a month',    '{"solo":"20","household":"60","pro":"Unlimited"}',             2),
    ('Trips and running order',        '{"solo":"Yes","household":"Yes","pro":"Yes"}',                 3),
    ('Group trips and guest invites',  '{"solo":"—","household":"Yes","pro":"Yes"}',                   4),
    ('Hotel and activity booking',     '{"solo":"Yes","household":"Yes","pro":"Yes"}',                 5),
    ('Host tools and event wizard',    '{"solo":"—","household":"—","pro":"Yes"}',                     6),
    ('Commission on hosted events',    '{"solo":"15%","household":"15%","pro":"10%"}',                 7),
    ('Priority support',               '{"solo":"—","household":"—","pro":"Yes"}',                     8)
  ) as v(label, vals, pos)
 where not exists (select 1 from plan_benefits b where b.label = v.label);
