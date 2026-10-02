-- Hosting v4, phase 1 (owner's Claude Code handover, 2 Oct 2026; "Supporting
-- docs/Host/Host v4"): the settings the money rules read at run time, the
-- ledger, payouts, refunds, tips, the waiting list, complaints, incidents,
-- attendance and notifications — on top of the four lanes (migration 365).
--
--   · hosting_settings holds the values in handover §7. Code reads them when it
--     uses them and never keeps its own copy; a setting nobody has set yet is a
--     null value, and whatever depends on it shows a dash. Every change is a
--     row in hosting_changes (who, when, before → after, why).
--   · A booking's fee is worked out once, when it is made, and stored on it with
--     its rate and reason. History is never recomputed from today's rates.
--   · hosting_payments (migration 365) is the ledger: every money movement, now
--     with the booking value, the rate, Epic's and the host's share, the cause
--     of a refund and whether Stripe's own record matches it.
--   · An incident can't be deleted, by anybody.
--   · "Approved · waiting on Checked" is host_offers.state = 'approved': passed
--     review, not live until Checked is done (handover §3.5).

-- ---------------------------------------------------------------------------
-- settings, and every change to anything that matters
-- ---------------------------------------------------------------------------
create table if not exists hosting_settings (
  key          text primary key,
  label        text not null,
  value        jsonb,                      -- null: still to set; anything depending on it shows a dash
  is_on        boolean not null default true,
  unit         text not null,
  position     integer not null default 0,
  changed_at   timestamptz not null default now(),
  changed_by   uuid references accounts(id) on delete set null,
  approval_id  uuid references approvals(id) on delete set null
);

insert into hosting_settings (key, label, value, unit, position) values
  ('private_event_fee',       'Private event fee',                 '1000',                                    'pence',      10),
  ('pro_monthly',             'Pro',                               '1299',                                    'pence',      20),
  ('private_payment_fee',     'Private payment fee',               '3',                                       'percent',    30),
  ('public_commission',       'Public commission',                 '[{"pct":20},{"pct":15,"ratedEvents":5,"avgAtLeast":4.5},{"pct":10,"ratedEvents":10,"avgAtLeast":4.8}]', 'ladder', 40),
  ('intro_zero',              'Intro 0%',                          '{"days":90,"bookings":10}',               'intro',      50),
  ('host_link_rate',          'Host-link bookings',                '5',                                       'percent',    60),
  ('minimum_fee',             'Minimum fee per booking',           '150',                                     'pence',      70),
  ('tip_admin_fee',           'Tip admin fee',                     '{"pct":3,"minPence":30}',                 'tip',        80),
  ('refund_terms',            'Refund terms',                      '{"flexible":{"fullHoursBefore":24},"moderate":{"fullHoursBefore":120},"strict":{"partHoursBefore":168,"partPct":50}}', 'refunds', 90),
  ('decides_by_default',      'Decides-by default',                '7',                                       'days',       100),
  ('weekly_session_decides',  'Weekly session decides',            '24',                                      'hours',      110),
  ('on_request_limits',       'On request notice / cap',           '{"noticeHours":48,"perWeek":3}',          'on_request', 120),
  ('ask_to_book_window',      'Ask to book reply window',          '24',                                      'hours',      130),
  ('waitlist_offer',          'Waiting-list offer',                '12',                                      'hours',      140),
  ('late_change_window',      'Late change / cancel window',       '48',                                      'hours',      150),
  ('payout_release',          'Payout release',                    '72',                                      'hours',      160),
  ('payout_early_on_confirm', 'Guest confirmation releases early', 'true',                                    'switch',     170),
  ('review_window',           'Review window',                     '48',                                      'hours',      180),
  ('guarantee_pool',          'Guarantee pool',                    null,                                      'pence',      190),
  ('claim_auto_pay_limit',    'Claim auto-pay limit',              null,                                      'pence',      200),
  ('rating_escalation',       'Rating escalation thresholds',      null,                                      'thresholds', 210),
  ('dbs_age',                 'DBS age',                           null,                                      'months',     220)
on conflict (key) do nothing;

create table if not exists hosting_changes (
  id            uuid primary key default gen_random_uuid(),
  subject_kind  text not null,
  subject_id    text not null,
  field         text,
  before        jsonb,
  after         jsonb,
  why           text,
  by_account    uuid references accounts(id) on delete set null,
  by_label      text not null,           -- 'host' | 'guest' | 'staff' | 'epic' (a job) | 'stripe'
  approval_id   uuid references approvals(id) on delete set null,
  at            timestamptz not null default now(),
  constraint hosting_changes_subject_check check (subject_kind in ('setting', 'event', 'session', 'host', 'booking', 'payout', 'review', 'complaint'))
);
create index if not exists hosting_changes_subject_idx on hosting_changes (subject_kind, subject_id, at desc);
create index if not exists hosting_changes_at_idx on hosting_changes (at desc);

-- ---------------------------------------------------------------------------
-- the event
-- ---------------------------------------------------------------------------
alter table host_offers
  add column if not exists waitlist_on        boolean not null default false,
  add column if not exists address_hidden     boolean not null default true,
  add column if not exists chosen_dates       jsonb   not null default '[]'::jsonb,
  add column if not exists approved_at        timestamptz,
  add column if not exists finished_at        timestamptz,
  add column if not exists called_off_at      timestamptz,
  add column if not exists cancelled_at       timestamptz,
  add column if not exists cancel_reason      text,
  add column if not exists changes_requested  jsonb;

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
alter table offer_sessions
  add column if not exists length_min        integer,
  add column if not exists decided_outcome   text,
  add column if not exists decided_at        timestamptz,
  add column if not exists changed_from      jsonb,
  add column if not exists cancel_reason     text,
  add column if not exists late              boolean not null default false,
  add column if not exists finished_at       timestamptz;
alter table offer_sessions drop constraint if exists offer_sessions_decided_outcome_check;
alter table offer_sessions add constraint offer_sessions_decided_outcome_check
  check (decided_outcome is null or decided_outcome in ('on', 'called_off'));

-- A booking covers one or more sessions (Weekly "book ahead" picks several).
create table if not exists booking_sessions (
  booking_id   uuid not null references experience_bookings(id) on delete cascade,
  session_id   uuid not null references offer_sessions(id) on delete cascade,
  state        text not null default 'booked',
  created_at   timestamptz not null default now(),
  primary key (booking_id, session_id),
  -- 'forfeited': the guest gave the session up inside the no-refund window. The place is free again, and the
  -- money kept is still the host's, so its payout counts it.
  constraint booking_sessions_state_check check (state in ('booked', 'cancelled', 'moved', 'forfeited'))
);
create index if not exists booking_sessions_session_idx on booking_sessions (session_id);

-- Who came. Recorded by the host; it never releases a payout.
create table if not exists session_attendance (
  session_id   uuid not null references offer_sessions(id) on delete cascade,
  booking_id   uuid not null references experience_bookings(id) on delete cascade,
  present      boolean not null,
  marked_at    timestamptz not null default now(),
  primary key (session_id, booking_id)
);

-- ---------------------------------------------------------------------------
-- bookings: price, fee and reason as they were when it was made
-- ---------------------------------------------------------------------------
alter table experience_bookings
  add column if not exists source              text,
  add column if not exists price_lines         jsonb,
  add column if not exists gross_pence         integer,
  add column if not exists discount_pence      integer not null default 0,
  add column if not exists value_pence         integer,
  add column if not exists fee_rate_pct        numeric,
  add column if not exists fee_reason          text,
  add column if not exists fee_pence           integer,
  add column if not exists host_pence          integer,
  add column if not exists confirmed_happened  text,
  add column if not exists confirmed_at        timestamptz,
  add column if not exists rated_at            timestamptz,
  add column if not exists cancelled_by        text,
  add column if not exists cancel_cause        text,
  -- The guest saw a date change and chose Keep my place (guest brief §7).
  add column if not exists change_seen_at      timestamptz,
  -- Answers stop being editable 24 hours before the first session (guest brief §6).
  add column if not exists answers_changed_at  timestamptz,
  -- On request: the slot the guest asked for; a session is made from it when the host accepts.
  add column if not exists requested_date      date,
  add column if not exists requested_time      time,
  add column if not exists requested_length_min integer;

-- An invitation answered by a household on Epic becomes its booking, so it lives in Trips › Booked.
alter table offer_invites
  add column if not exists household_id uuid references households(id) on delete set null,
  add column if not exists booking_id   uuid references experience_bookings(id) on delete set null;
alter table experience_bookings drop constraint if exists experience_bookings_fee_reason_check;
alter table experience_bookings add constraint experience_bookings_fee_reason_check
  check (fee_reason is null or fee_reason in ('standard', 'intro', 'host_link', 'minimum', 'override', 'private_payment', 'free'));
alter table experience_bookings drop constraint if exists experience_bookings_confirmed_happened_check;
alter table experience_bookings add constraint experience_bookings_confirmed_happened_check
  check (confirmed_happened is null or confirmed_happened in ('yes', 'no', 'wrong'));

alter table booking_children
  add column if not exists emergency_contact text;

-- ---------------------------------------------------------------------------
-- the ledger (hosting_payments, migration 365): every money movement
-- ---------------------------------------------------------------------------
alter table hosting_payments
  add column if not exists booking_value_pence integer,
  add column if not exists rate_pct            numeric,
  add column if not exists host_pence          integer,
  add column if not exists cause               text,      -- a refund's: 'guest_cancelled' | 'host_cancelled' | 'called_off' | 'date_changed' | 'numbers_settled' | 'declined' | 'lapsed' | 'complaint'
  add column if not exists session_id          uuid references offer_sessions(id) on delete set null,
  add column if not exists payout_id           uuid,
  add column if not exists stripe_match        text not null default 'pending',
  -- A refund or release is written here, pending, in the same transaction as
  -- the cancel or call-off that owes it; a job then asks Stripe with this as
  -- the idempotency key, so a retry is the same refund and never a second one.
  add column if not exists idem_key            text;
create unique index if not exists hosting_payments_idem_idx on hosting_payments (idem_key) where idem_key is not null;
create index if not exists hosting_payments_pending_idx on hosting_payments (created_at) where state = 'pending' and kind in ('refund', 'release');
alter table hosting_payments drop constraint if exists hosting_payments_stripe_match_check;
alter table hosting_payments add constraint hosting_payments_stripe_match_check
  check (stripe_match in ('pending', 'matched', 'mismatch', 'not_checked'));

-- Payouts: one per session (Weekly and Course pay per session), tips with the next.
create table if not exists host_payouts (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references hosts(id) on delete cascade,
  offer_id        uuid references host_offers(id) on delete set null,
  session_id      uuid references offer_sessions(id) on delete set null,
  amount_pence    integer not null,
  tips_pence      integer not null default 0,
  release_at      timestamptz not null,
  state           text not null default 'scheduled',
  hold_reason     text,
  released_by     text,
  stripe_transfer text,
  mode            text not null default 'test',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint host_payouts_state_check check (state in ('scheduled', 'held', 'released', 'paid', 'failed')),
  constraint host_payouts_mode_check check (mode in ('test', 'live'))
);
create unique index if not exists host_payouts_session_idx on host_payouts (session_id) where session_id is not null;
create index if not exists host_payouts_due_idx on host_payouts (release_at) where state in ('scheduled', 'held');
create index if not exists host_payouts_host_idx on host_payouts (host_id, release_at desc);

-- Tips: the host keeps all of it; the guest pays the admin fee on top.
create table if not exists booking_tips (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid references experience_bookings(id) on delete set null,
  offer_id         uuid not null references host_offers(id) on delete cascade,
  host_id          uuid not null references hosts(id) on delete cascade,
  household_id     uuid references households(id) on delete set null,
  amount_pence     integer not null,
  admin_fee_pence  integer not null,
  state            text not null default 'pending',
  stripe_ref       text,
  payout_id        uuid references host_payouts(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint booking_tips_amount_check check (amount_pence > 0 and admin_fee_pence >= 0),
  constraint booking_tips_state_check check (state in ('pending', 'paid', 'failed', 'refunded'))
);
create index if not exists booking_tips_host_idx on booking_tips (host_id, created_at desc);
-- One tip a booking: a double tap can't charge twice (Codex, 2 Oct 2026).
create unique index if not exists booking_tips_once_idx on booking_tips (booking_id) where state in ('pending', 'paid');

-- The waiting list: a freed place is offered to the first in line for a while.
create table if not exists offer_waitlist (
  id                uuid primary key default gen_random_uuid(),
  offer_id          uuid not null references host_offers(id) on delete cascade,
  session_id        uuid references offer_sessions(id) on delete cascade,
  household_id      uuid not null references households(id) on delete cascade,
  party             integer not null default 1,
  state             text not null default 'waiting',
  offered_at        timestamptz,
  offer_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  constraint offer_waitlist_state_check check (state in ('waiting', 'offered', 'taken', 'expired', 'left')),
  constraint offer_waitlist_party_check check (party >= 1)
);
create index if not exists offer_waitlist_line_idx on offer_waitlist (offer_id, session_id, created_at) where state in ('waiting', 'offered');
create unique index if not exists offer_waitlist_once_idx on offer_waitlist (offer_id, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid), household_id) where state in ('waiting', 'offered');

-- A complaint holds the payout until it is resolved.
create table if not exists hosting_complaints (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid references experience_bookings(id) on delete set null,
  session_id   uuid references offer_sessions(id) on delete set null,
  offer_id     uuid references host_offers(id) on delete set null,
  host_id      uuid references hosts(id) on delete set null,
  household_id uuid references households(id) on delete set null,
  kind         text not null default 'complaint',
  reason       text,
  state        text not null default 'open',
  amount_pence integer,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  constraint hosting_complaints_kind_check check (kind in ('complaint', 'guarantee_claim', 'host_no_show')),
  constraint hosting_complaints_state_check check (state in ('open', 'resolved', 'paid', 'declined'))
);
create index if not exists hosting_complaints_open_idx on hosting_complaints (session_id) where state = 'open';

-- An incident during a session, especially with children. Straight to Safety; never deleted.
create table if not exists session_incidents (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid references offer_sessions(id) on delete set null,
  offer_id         uuid references host_offers(id) on delete set null,
  host_id          uuid references hosts(id) on delete set null,
  children         jsonb not null default '[]'::jsonb,
  reporter         text not null,
  reporter_account uuid references accounts(id) on delete set null,
  body             text not null,
  created_at       timestamptz not null default now(),
  constraint session_incidents_reporter_check check (reporter in ('host', 'guest', 'staff'))
);
create or replace function epic_incidents_never_deleted() returns trigger language plpgsql as $$
begin
  raise exception 'an incident is never deleted';
end $$;
drop trigger if exists session_incidents_never_deleted on session_incidents;
create trigger session_incidents_never_deleted before delete on session_incidents
  for each row execute function epic_incidents_never_deleted();

-- ---------------------------------------------------------------------------
-- the host
-- ---------------------------------------------------------------------------
alter table hosts
  add column if not exists paused             boolean not null default false,
  add column if not exists paused_at          timestamptz,
  add column if not exists stopped_at         timestamptz,
  add column if not exists earnings_goal_pence integer,
  add column if not exists fee_override_pct   numeric,       -- set only through an Approval
  add column if not exists checked_level      text,
  add column if not exists checked_on         date,
  add column if not exists insurance_expires  date,
  add column if not exists away               jsonb not null default '[]'::jsonb,
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb,
  -- The host's own link (E10): a booking that arrives with it is charged the host-link rate. A token, so the
  -- rate can't be claimed by sending a flag (Codex, 2 Oct 2026).
  add column if not exists link_token        text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists hosts_link_token_idx on hosts (link_token);
alter table hosts drop constraint if exists hosts_fee_override_check;
alter table hosts add constraint hosts_fee_override_check
  check (fee_override_pct is null or (fee_override_pct >= 0 and fee_override_pct <= 100));

create table if not exists host_auto_messages (
  host_id    uuid not null references hosts(id) on delete cascade,
  kind       text not null,
  is_on      boolean not null default true,
  body       text,
  updated_at timestamptz not null default now(),
  primary key (host_id, kind)
);
create table if not exists host_quick_replies (
  id         uuid primary key default gen_random_uuid(),
  host_id    uuid not null references hosts(id) on delete cascade,
  body       text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

-- Co-hosts: what each may see. Payout splits are deferred.
alter table offer_cohosts
  add column if not exists can_see_money boolean not null default false,
  add column if not exists accepted_at   timestamptz;

-- Reviews: one public reply each, a report, and a child's rating given by an adult.
alter table host_reviews
  add column if not exists host_stars    integer,
  add column if not exists reply         text,
  add column if not exists replied_at    timestamptz,
  add column if not exists reported_at   timestamptz,
  add column if not exists report_reason text,
  add column if not exists by_proxy      boolean not null default false;

-- What the daily reconciliation found. Stripe is the source of truth.
create table if not exists stripe_reconciliations (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  mode        text not null default 'test',
  checked     integer not null default 0,
  mismatched  integer not null default 0,
  details     jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- insight and notification
-- ---------------------------------------------------------------------------
create table if not exists offer_views (
  offer_id   uuid not null references host_offers(id) on delete cascade,
  day        date not null default current_date,
  source     text not null default 'search',
  views      integer not null default 0,
  primary key (offer_id, day, source)
);

create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households(id) on delete cascade,
  account_id    uuid references accounts(id) on delete cascade,
  audience      text not null,
  kind          text not null,
  title         text not null,
  body          text,
  link          text,                   -- the screen it is about
  dedupe_key    text,                   -- one notification per thing, however often a job runs
  email_state   text not null default 'none',
  read_at       timestamptz,
  created_at    timestamptz not null default now(),
  constraint notifications_audience_check check (audience in ('guest', 'host')),
  constraint notifications_email_state_check check (email_state in ('none', 'queued', 'sent', 'failed', 'skipped')),
  constraint notifications_owner_check check (household_id is not null or account_id is not null)
);
create unique index if not exists notifications_dedupe_idx on notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_household_idx on notifications (household_id, created_at desc);
create index if not exists notifications_email_idx on notifications (created_at) where email_state = 'queued';

create table if not exists review_change_reasons (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  created_at timestamptz not null default now()
);
insert into review_change_reasons (label) values
  ('Video does not show the host'), ('Title or description unclear'), ('Photos missing or unsuitable'),
  ('Price or refund terms unclear'), ('Contact details in the listing'), ('Address too exact')
on conflict (label) do nothing;
