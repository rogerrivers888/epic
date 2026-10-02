-- Four ways to host (Epic hosting v7, signed off 2 Oct 2026 — "Supporting
-- docs/Host/Host v3": RULINGS.md, README.md and the v7 prototype).
--
-- Hosting is split by how often the thing runs — one-off, weekly, course, on
-- request — and three choices are made independently and never derived from
-- one another: the lane (how often), who can come (private or public, asked
-- last) and the money (free, same each, depends on numbers). An offer keeps
-- living in `host_offers`, so the guest page, the booking, the chat and the
-- dashboard that already read it go on working; `lane` is what marks a v7 offer
-- and decides which steps it is asked. `shape` is kept in step for the readers
-- that only know the old three (oneoff · series · anytime).
--
-- This also lays down what guest booking and payment, and host management,
-- will need, so their briefs can follow without a migration: dated sessions,
-- per-booking payment state, the refund policy as agreed at booking, children
-- held with either an age or a date of birth, what a guest claimed from the
-- bring list, a payment ledger, and the host's Stripe identity and payouts.
--
-- Money. Stripe runs in test mode only until the owner approves going live
-- (RULINGS: an Approval on the Overview). Nothing here holds a card or a bank
-- account: payouts are Stripe Connect's hosted onboarding, and Epic keeps the
-- connected account's id and whether it can be paid. Every figure the charges
-- depend on (the £10, the 3%, the share ladder, the refund windows) is config,
-- not a column default.

-- ---------------------------------------------------------------------------
-- the offer
-- ---------------------------------------------------------------------------
alter table host_offers
  add column if not exists lane                   text,
  -- What is it: the category and the subcategory (or the host's own words).
  add column if not exists what_category          text,
  add column if not exists what_label             text,
  -- "Under the title" is marked Suggested until the host edits it.
  add column if not exists line_suggested         boolean not null default false,
  -- One-off over more than one day: the last day and its finishing time
  -- (`ends_at`, already here, is the finishing time on either kind).
  add column if not exists multi_day              boolean not null default false,
  add column if not exists ends_on                date,
  -- Weekly may run on more than one day: 0 Sunday … 6 Saturday, as `weekday`.
  add column if not exists weekdays               jsonb   not null default '[]'::jsonb,
  -- Weekly and Course: bank holidays (England and Wales) left out of the run.
  -- The host's own excluded dates stay in `skipped_dates`.
  add column if not exists exclude_bank_holidays  boolean not null default true,
  -- Who can come › age restriction: null and null is Anyone.
  add column if not exists age_min                integer,
  add column if not exists age_max                integer,
  -- Children's path: parents stay or drop off. Course asks it as step 7; the
  -- other lanes ask it on Who can come when the upper age is under 18.
  add column if not exists parents                text,
  -- Price.
  add column if not exists child_pence            integer,
  add column if not exists book_ahead_pence       integer,
  add column if not exists drop_in_group_pct      integer,
  add column if not exists drop_in_group_min      integer,
  add column if not exists book_ahead_group_pct   integer,
  add column if not exists book_ahead_group_min   integer,
  -- Decides by: null is the default (config: days before the first session).
  add column if not exists decides_on             date,
  -- Paid events only: flexible · moderate · strict (terms are config).
  add column if not exists refund_policy          text,
  -- One-off: what guests tell you, and each toggle's own settings.
  add column if not exists guest_questions        jsonb   not null default '{}'::jsonb,
  -- On request: exact hour ranges per weekday, the session lengths offered,
  -- notice and how many a week.
  add column if not exists free_hours             jsonb   not null default '{}'::jsonb,
  add column if not exists session_lengths        jsonb   not null default '[]'::jsonb,
  add column if not exists notice_hours           integer,
  add column if not exists per_week_max           integer,
  -- Where › online: Epic makes the call link, or the host uses their own.
  add column if not exists online_mode            text,
  add column if not exists online_link            text,
  add column if not exists time_zone              text,
  -- Private: how the host pays to send the invites.
  add column if not exists private_plan           text,
  add column if not exists private_fee_state      text    not null default 'unpaid',
  add column if not exists private_fee_ref        text,
  -- The offer video's choices (the video itself is `video_id`).
  add column if not exists video_made_by          text,
  add column if not exists video_cover_s          numeric,
  add column if not exists video_on_profile       boolean not null default true,
  add column if not exists video_photo_ids        jsonb   not null default '[]'::jsonb,
  add column if not exists hello_video_id         uuid references host_media(id) on delete set null,
  -- The 48-hour review: what the automatic check of the video found.
  add column if not exists review_ai              jsonb,
  -- Drafts: where the host left off, and how the draft began.
  -- Who can come is asked, never assumed: a draft is neither private nor
  -- public until the host has chosen on the last step.
  add column if not exists who_chosen             boolean not null default false,
  add column if not exists draft_step             text,
  add column if not exists draft_source           text;

alter table host_offers drop constraint if exists host_offers_lane_check;
alter table host_offers add constraint host_offers_lane_check
  check (lane is null or lane in ('oneoff', 'weekly', 'course', 'onrequest'));
alter table host_offers drop constraint if exists host_offers_parents_check;
alter table host_offers add constraint host_offers_parents_check
  check (parents is null or parents in ('stay', 'drop_off'));
alter table host_offers drop constraint if exists host_offers_refund_policy_check;
alter table host_offers add constraint host_offers_refund_policy_check
  check (refund_policy is null or refund_policy in ('flexible', 'moderate', 'strict'));
alter table host_offers drop constraint if exists host_offers_age_range_check;
alter table host_offers add constraint host_offers_age_range_check
  check ((age_min is null or age_min between 0 and 120) and (age_max is null or age_max between 0 and 120)
         and (age_min is null or age_max is null or age_min <= age_max));
alter table host_offers drop constraint if exists host_offers_private_plan_check;
alter table host_offers add constraint host_offers_private_plan_check
  check (private_plan is null or private_plan in ('event', 'pro'));
alter table host_offers drop constraint if exists host_offers_private_fee_state_check;
alter table host_offers add constraint host_offers_private_fee_state_check
  check (private_fee_state in ('unpaid', 'pending', 'paid', 'included', 'not_needed'));
alter table host_offers drop constraint if exists host_offers_online_mode_check;
alter table host_offers add constraint host_offers_online_mode_check
  check (online_mode is null or online_mode in ('epic', 'own'));

create index if not exists host_offers_lane_drafts_idx on host_offers (host_id, updated_at desc) where lane is not null and state = 'draft';

-- ---------------------------------------------------------------------------
-- sessions: every dated occurrence of an offer
-- ---------------------------------------------------------------------------
-- One-off: one row a day. Weekly: a rolling run ahead, each deciding on its
-- own (config: hours before). Course: the run, numbered, with its topic. On
-- request: a row is made when a booking is accepted. A session that is called
-- off keeps its row and says so.
create table if not exists offer_sessions (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references host_offers(id) on delete cascade,
  n             integer,                                  -- Course: session 1, 2, 3…; One-off: day 1, 2…
  on_date       date not null,
  starts_at     time,
  ends_at       time,
  ends_on       date,                                     -- a session that runs past midnight or over days
  topic         text,                                     -- Course: the session plan's row
  state         text not null default 'scheduled',        -- 'scheduled' | 'called_off' | 'cancelled' | 'done'
  decides_at    timestamptz,                              -- under the minimum by then and it is called off
  min_count     integer,                                  -- null: the offer's own
  max_count     integer,
  called_off_at timestamptz,
  created_at    timestamptz not null default now(),
  constraint offer_sessions_state_check check (state in ('scheduled', 'called_off', 'cancelled', 'done'))
);
create index if not exists offer_sessions_offer_idx on offer_sessions (offer_id, on_date, starts_at);
create index if not exists offer_sessions_deciding_idx on offer_sessions (decides_at) where state = 'scheduled' and decides_at is not null;

-- ---------------------------------------------------------------------------
-- other hosts: a co-host or a helper, and what each can do
-- ---------------------------------------------------------------------------
create table if not exists offer_cohosts (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references host_offers(id) on delete cascade,
  account_id     uuid references accounts(id) on delete set null,   -- when they are on Epic
  contact_id     uuid references host_contacts(id) on delete set null,
  name           text not null,
  role           text not null default 'helper',                     -- 'cohost' | 'helper'
  can_edit       boolean not null default false,
  can_message    boolean not null default false,
  shown_on_page  boolean not null default true,
  with_photo     boolean not null default true,
  sees_guests    boolean not null default false,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  constraint offer_cohosts_role_check check (role in ('cohost', 'helper'))
);
create index if not exists offer_cohosts_offer_idx on offer_cohosts (offer_id, position);

-- ---------------------------------------------------------------------------
-- the host: identity, payouts, the children's check
-- ---------------------------------------------------------------------------
alter table hosts
  add column if not exists stripe_account_id      text,
  add column if not exists payouts_state          text not null default 'none',   -- 'none' | 'pending' | 'ready'
  add column if not exists identity_state         text not null default 'none',   -- 'none' | 'pending' | 'verified' | 'failed'
  add column if not exists identity_session_id    text,
  add column if not exists identity_verified_at   timestamptz,
  add column if not exists checked_state          text not null default 'none',   -- 'none' | 'submitted' | 'passed' | 'failed'
  add column if not exists dbs_number             text,
  add column if not exists insurance_media_id     uuid references host_media(id) on delete set null,
  add column if not exists referees               jsonb not null default '[]'::jsonb,  -- [{name, email}] × 2
  add column if not exists checked_submitted_at   timestamptz,
  add column if not exists stripe_mode            text;                            -- 'test' | 'live': which Stripe the ids above belong to

alter table hosts drop constraint if exists hosts_payouts_state_check;
alter table hosts add constraint hosts_payouts_state_check check (payouts_state in ('none', 'pending', 'ready'));
alter table hosts drop constraint if exists hosts_identity_state_check;
alter table hosts add constraint hosts_identity_state_check check (identity_state in ('none', 'pending', 'verified', 'failed'));
alter table hosts drop constraint if exists hosts_checked_state_check;
alter table hosts add constraint hosts_checked_state_check check (checked_state in ('none', 'submitted', 'passed', 'failed'));

-- ---------------------------------------------------------------------------
-- bookings: what guest booking and payment will write
-- ---------------------------------------------------------------------------
alter table experience_bookings
  add column if not exists session_id            uuid references offer_sessions(id) on delete set null,
  -- 'whole' (One-off, Course) · 'drop_in' · 'book_ahead' (Weekly) · 'request' (On request)
  add column if not exists booking_kind          text,
  -- On request › Ask to book: the host has a window to accept; the card is
  -- held, not charged, until then.
  add column if not exists request_state         text,                 -- 'asked' | 'accepted' | 'declined' | 'lapsed'
  add column if not exists respond_by            timestamptz,
  add column if not exists payment_state         text not null default 'none',
  add column if not exists stripe_payment_intent text,
  add column if not exists held_pence            integer,
  add column if not exists charged_pence         integer,
  add column if not exists refunded_pence        integer not null default 0,
  -- Depends on numbers: paid at the minimum-numbers price, settled at the
  -- decides-by date to total ÷ people booked.
  add column if not exists final_price_pence     integer,
  add column if not exists settled_at            timestamptz,
  -- The terms the guest agreed to, as they stood when they booked.
  add column if not exists refund_policy         text,
  add column if not exists refund_terms          jsonb,
  -- What the guest told the host: plus-one, dietary ticks and other, kids'
  -- needs, which nights and where they are staying.
  add column if not exists answers               jsonb not null default '{}'::jsonb,
  -- Adult-only events: the guest ticks that they are 18 or over.
  add column if not exists adult_confirmed       boolean;

alter table experience_bookings drop constraint if exists experience_bookings_payment_state_check;
alter table experience_bookings add constraint experience_bookings_payment_state_check
  check (payment_state in ('none', 'held', 'charged', 'partially_refunded', 'refunded', 'released', 'failed'));
alter table experience_bookings drop constraint if exists experience_bookings_request_state_check;
alter table experience_bookings add constraint experience_bookings_request_state_check
  check (request_state is null or request_state in ('asked', 'accepted', 'declined', 'lapsed'));
alter table experience_bookings drop constraint if exists experience_bookings_booking_kind_check;
alter table experience_bookings add constraint experience_bookings_booking_kind_check
  check (booking_kind is null or booking_kind in ('whole', 'drop_in', 'book_ahead', 'request'));
create index if not exists experience_bookings_session_idx on experience_bookings (session_id) where session_id is not null;
create index if not exists experience_bookings_respond_idx on experience_bookings (respond_by) where request_state = 'asked';

-- A child on a booking: the parent gives an age or a date of birth, whichever
-- they choose — exactly one of the two. Guests never give their own.
create table if not exists booking_children (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references experience_bookings(id) on delete cascade,
  name           text,
  age            integer,
  date_of_birth  date,
  needs          jsonb not null default '[]'::jsonb,       -- 'high_chair' | 'cot' | 'quiet_room'
  created_at     timestamptz not null default now(),
  constraint booking_children_age_or_dob check (num_nonnulls(age, date_of_birth) = 1),
  constraint booking_children_age_range check (age is null or age between 0 and 17)
);
create index if not exists booking_children_booking_idx on booking_children (booking_id);

-- Bring something: what a guest said they would bring. The items live on the
-- offer (`guest_questions.bring.items`, each with a stable id).
create table if not exists booking_claims (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references experience_bookings(id) on delete cascade,
  offer_id    uuid not null references host_offers(id) on delete cascade,
  item_id     text not null,
  qty         integer not null default 1,
  created_at  timestamptz not null default now(),
  constraint booking_claims_qty_check check (qty > 0)
);
create index if not exists booking_claims_offer_idx on booking_claims (offer_id, item_id);

-- ---------------------------------------------------------------------------
-- money that moved, or was meant to
-- ---------------------------------------------------------------------------
-- One row per thing Stripe was asked to do, whatever it was for: a guest's
-- hold, charge or refund; the host's £10 or Pro; a payout. `mode` keeps test
-- and live apart for good.
create table if not exists hosting_payments (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,             -- 'hold' | 'charge' | 'refund' | 'release' | 'payout' | 'private_fee' | 'pro'
  booking_id    uuid references experience_bookings(id) on delete set null,
  offer_id      uuid references host_offers(id) on delete set null,
  host_id       uuid references hosts(id) on delete set null,
  household_id  uuid references households(id) on delete set null,
  amount_pence  integer not null default 0,
  epic_pence    integer,                   -- Epic's share of it, card fees included
  state         text not null default 'pending',   -- 'pending' | 'succeeded' | 'failed' | 'cancelled'
  stripe_ref    text,
  mode          text not null default 'test',
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hosting_payments_mode_check check (mode in ('test', 'live')),
  constraint hosting_payments_state_check check (state in ('pending', 'succeeded', 'failed', 'cancelled'))
);
create index if not exists hosting_payments_booking_idx on hosting_payments (booking_id) where booking_id is not null;
create index if not exists hosting_payments_offer_idx on hosting_payments (offer_id) where offer_id is not null;
create unique index if not exists hosting_payments_ref_idx on hosting_payments (stripe_ref, kind) where stripe_ref is not null;
