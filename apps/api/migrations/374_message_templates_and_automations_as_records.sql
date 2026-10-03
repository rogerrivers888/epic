-- Messages and automations become records (K16 step 1, Roger, 3 Oct 2026; built
-- by the hosting chat, finished by the back office, 3 Oct 2026).
--
--   · A message template is what Epic says at one moment (a trigger), in each
--     channel it can say it on: in-app (title + body), e-mail (its own subject
--     + body), SMS (body), and push, which is declared and refused for delivery
--     until a push channel exists. Its words use {{field}} placeholders limited
--     to what the trigger provides; the catalogue of triggers and their fields
--     lives in code (src/domain/messages.js), so a template can never ask for a
--     field nothing will fill.
--   · Every save is a new version and nothing is overwritten; Restore saves an
--     older version again as the newest. The template row points at its
--     current version.
--   · Today's senders keep their own hard-coded words in this batch. The
--     records hold the same words, so moving a sender later changes nothing
--     anybody reads; `state` says which records mirror a sender, which are new
--     wording nothing sends yet, and (later) which are live.
--   · `message_sends` is the log of what the template layer itself sent —
--     "Send me a test" now, deliver() once senders move.
--   · An automation is a record: its rule values, the templates it sends, an
--     on/off switch, and a lock where the owner has said it may not be switched
--     (child-safety pause, always on) or not yet (rating suspension and the
--     suspended step of Strikes, off until the owner unlocks them).
--   · `automation_runs` is every automatic action: what fired, on whom, the
--     evidence, what it did, and how to undo it where undoing is allowed.
--   · The back office's Changes log (bo_changes) gains two areas, Messages and
--     Automations: every template edit and restore, and every automation
--     switch, lock or rule change, is written there.
--
-- Automations are seeded here, in this migration, switched on (Roger, 3 Oct
-- 2026: "seed every automation record switched on, in the same migration, so
-- nothing that runs today stops") — 22 rows, the design handover's list (§6).
-- The exceptions are his rulings: Rating suspension and the suspended step of
-- Strikes are locked off until Host Terms; the child-safety pause and the
-- lapsed-checks pause are always on, with no switch; the automations whose
-- code is the Payments chat's show "Run by Payments" and have no switch here.
-- repositories/automations.js holds the same list, and a test holds the two
-- together.
--
-- Templates are seeded by the code on first use (repositories/templates.js),
-- only where absent: one the owner has edited is his and is never written
-- over. No sender reads a template yet, so nothing waits on them.

create table if not exists message_templates (
  key                text primary key,
  name               text not null,
  trigger            text not null,
  category           text not null default 'transactional',
  -- 'automatic': sent by a trigger. 'reply': chosen by a person (design handover §7).
  kind               text not null default 'automatic',
  -- The notifications kind an in-app copy is written under (repositories/notifications.js KINDS).
  notification_kind  text,
  -- Where today's words are sent from, file and line, while a sender still has its own copy.
  sent_by            text,
  state              text not null default 'mirrors_code',
  current_version    integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint message_templates_category_check check (category in ('transactional', 'marketing')),
  constraint message_templates_kind_check check (kind in ('automatic', 'reply')),
  constraint message_templates_state_check check (state in ('mirrors_code', 'new_wording', 'live'))
);

create table if not exists message_template_versions (
  id             uuid primary key default gen_random_uuid(),
  template_key   text not null references message_templates(key) on delete cascade,
  version        integer not null,
  -- { in_app: { title, body }, email: { subject, body }, sms: { body }, push: { title, body } }; a channel left out is not said there.
  channels       jsonb not null,
  note           text,
  restored_from  integer,
  saved_by       text not null,
  saved_by_account uuid references accounts(id) on delete set null,
  saved_at       timestamptz not null default now(),
  constraint message_template_versions_once unique (template_key, version)
);

create table if not exists message_sends (
  id             uuid primary key default gen_random_uuid(),
  template_key   text not null,
  version        integer not null,
  channel        text not null,
  purpose        text not null,
  to_kind        text,
  to_ref         text,
  result         jsonb not null default '{}'::jsonb,
  by_account     uuid references accounts(id) on delete set null,
  at             timestamptz not null default now(),
  constraint message_sends_channel_check check (channel in ('in_app', 'email', 'sms', 'push')),
  constraint message_sends_purpose_check check (purpose in ('test', 'deliver'))
);
create index if not exists message_sends_template_idx on message_sends (template_key, at desc);

create table if not exists automations (
  key             text primary key,
  area            text not null,
  name            text not null,
  trigger         text not null,
  rules           jsonb not null default '{}'::jsonb,
  template_keys   text[] not null default '{}',
  -- Set when it sends nothing by design ("Nothing sent (deliberate)"): it may be on with no template.
  no_template     text,
  is_on           boolean not null default false,
  locked          boolean not null default false,
  -- 'always_on': nobody switches it (the child-safety and lapsed-checks pauses). 'owner': off until the
  -- owner, signed in, unlocks it. 'payments': its code is the Payments chat's and does not read this record yet.
  lock_kind       text,
  lock_reason     text,
  -- A step that may not run while the rest does: { suspended: 'Waits for Host Terms' } on Strikes.
  step_locks      jsonb not null default '{}'::jsonb,
  -- Where its logic lives today, or null when it comes later; and the chat that owns that code, when it is not ours.
  logic           text,
  owner_chat      text,
  -- Whether the code reads the switch yet. Off on a record whose code does not read it changes nothing.
  honours_switch  boolean not null default false,
  updated_by      text,
  updated_at      timestamptz not null default now(),
  constraint automations_lock_kind_check check (lock_kind is null or lock_kind in ('always_on', 'owner', 'payments')),
  constraint automations_lock_has_reason check (not locked or (lock_kind is not null and lock_reason is not null)),
  constraint automations_always_on_is_on check (lock_kind is distinct from 'always_on' or (locked and is_on))
);

create table if not exists automation_runs (
  id               uuid primary key default gen_random_uuid(),
  automation_key   text not null,
  subject_kind     text,
  subject_id       text,
  rule             text not null,
  evidence         jsonb not null default '{}'::jsonb,
  did              text not null,
  undo             jsonb,
  at               timestamptz not null default now(),
  undone_at        timestamptz,
  undone_by        uuid references accounts(id) on delete set null,
  undone_note      text,
  constraint automation_runs_undone_by_person check (undone_at is null or undone_by is not null)
);
create index if not exists automation_runs_key_idx on automation_runs (automation_key, at desc);
create index if not exists automation_runs_at_idx on automation_runs (at desc);
create index if not exists automation_runs_subject_idx on automation_runs (subject_kind, subject_id);

insert into automations (key, area, name, trigger, rules, template_keys, no_template, is_on, locked, lock_kind, lock_reason, step_locks, logic, owner_chat, honours_switch, updated_by)
select v.*, 'Epic (migration 374)' from (values
  ('hide_contact_details', 'safety', 'Hide contact details', 'chat.contact_hidden', '{}'::jsonb, array['contact_details_hidden']::text[], null, true, false, null, null, '{}'::jsonb, 'routes/chat.js — phone numbers and e-mail addresses in messages before a booking', null, false),
  ('strikes', 'safety', 'Strikes', 'host.strike', '{"warningAt":1,"finalWarningAt":2,"suspendedAt":3,"expiryMonths":12,"lateChangesForStrike":3,"lateChangeWindowDays":90}'::jsonb, array['strike_warning', 'strike_final_warning', 'strike_suspension']::text[], null, true, false, null, null, '{"suspended":"Waits for Host Terms"}'::jsonb, 'The rules engine (sources/rulesEngine.js)', null, false),
  ('child_safety_pause', 'safety', 'Child safety pause', 'safety.child_safety_report', '{}'::jsonb, array['children_paused']::text[], null, true, true, 'always_on', 'Always on: a report about a child’s safety always pauses that host’s events with children; only a person closing the safety item lifts it (Roger, 3 Oct 2026).', '{}'::jsonb, 'sources/safetyHolds.js childSafetyReported', null, false),
  ('checks_lapse_pause', 'safety', 'Checked lapses — pause public drop-off events', 'safety.checks_lapsed', '{}'::jsonb, array['checks_lapsed']::text[], null, true, true, 'always_on', 'Always on: a public drop-off event never runs on lapsed checks (Roger, 3 Oct 2026).', '{}'::jsonb, 'sources/safetyHolds.js pauseForLapsedChecks', null, false),
  ('rating_warning', 'hosting', 'Rating warning', 'host.rating_dropped', '{"below":3.8,"lastRated":10,"minRated":5}'::jsonb, array['rating_dropped']::text[], null, true, false, null, null, '{}'::jsonb, 'The rules engine (sources/rulesEngine.js)', null, false),
  ('rating_suspension', 'hosting', 'Rating suspension', 'host.rating_dropped', '{"below":3.5,"lastRated":10,"minRated":5,"comeBackDays":90}'::jsonb, array['strike_suspension']::text[], null, false, true, 'owner', 'Waits for Host Terms', '{}'::jsonb, 'The rules engine (sources/rulesEngine.js)', null, false),
  ('checked_reminders', 'hosting', 'Checked reminders — now, then days 3, 7, 14', 'host.checked_expiring', '{"remindOnDays":[0,3,7,14]}'::jsonb, array['check_expiring', 'referee_request', 'referee_reminder']::text[], null, true, false, null, null, '{}'::jsonb, 'The rules engine (sources/rulesEngine.js)', null, false),
  ('back_to_draft', 'hosting', 'Back to draft after 30 days', 'host.back_to_draft', '{"days":30}'::jsonb, array['back_to_drafts']::text[], null, true, false, null, null, '{}'::jsonb, 'The rules engine (sources/rulesEngine.js)', null, false),
  ('decides_by', 'hosting', 'Decides by', 'session.going_ahead', '{}'::jsonb, array['decides_by_result', 'called_off', 'event_called_off', 'under_minimum']::text[], null, true, true, 'payments', 'Run by Payments', '{}'::jsonb, 'sources/bookingMoney.js decideDue (the days are the hosting settings decides_by_default and weekly_session_decides)', 'stripe', false),
  ('reminder_24h', 'hosting', 'Reminder 24 h before', 'booking.reminder_24h', '{"hoursBefore":24}'::jsonb, array['reminder_24h']::text[], null, true, false, null, null, '{}'::jsonb, 'routes/guestBookings.js guestPrompts', null, false),
  ('morning_after', 'hosting', 'Did it happen? (morning after)', 'booking.morning_after', '{"fromLocalTime":"08:00"}'::jsonb, array['after_event']::text[], null, true, false, null, null, '{}'::jsonb, 'routes/guestBookings.js guestPrompts', null, false),
  ('late_change', 'hosting', 'Late change counts (within 48 h)', 'host.late_change', '{"withinHours":48}'::jsonb, array['late_change_counts']::text[], null, true, false, null, null, '{}'::jsonb, 'sources/bookingMoney.js marks a late cancel or move; the rules engine counts it', null, false),
  ('events_go_live', 'hosting', 'Events go live', 'event.live', '{}'::jsonb, array['event_live']::text[], null, true, false, null, null, '{}'::jsonb, 'routes/hostingAdmin.js — AI-cleared events, and releaseApproved for “Approved · waiting on Checked”', null, false),
  ('refunds_within_policy', 'money', 'Refunds within policy', 'refund.issued', '{}'::jsonb, array['refund_issued']::text[], null, true, true, 'payments', 'Run by Payments', '{}'::jsonb, 'sources/bookingMoney.js processRefunds', 'stripe', false),
  ('release_card_holds', 'money', 'Release card holds (24 h — the host didn’t reply)', 'booking.request_declined', '{"hours":24}'::jsonb, array['ask_to_book_declined']::text[], null, true, true, 'payments', 'Run by Payments', '{}'::jsonb, 'Ask to book: a request the host has not answered in time releases the guest’s card hold', 'stripe', false),
  ('waitlist_offer', 'money', 'Pass on waiting-list places (12 h)', 'waitlist.place_offered', '{"hours":12}'::jsonb, array['waitlist_offered']::text[], null, true, false, null, null, '{}'::jsonb, 'routes/guestBookings.js offerFreedPlaces (the hours are the hosting setting waitlist_offer)', null, false),
  ('pay_hosts', 'money', 'Pay hosts (72 h, set in Billing)', 'payout.sent', '{}'::jsonb, '{}'::text[], 'Nothing sent (deliberate)', true, true, 'payments', 'Run by Payments', '{}'::jsonb, 'sources/hostingMoney.js — payouts', 'stripe', false),
  ('complaint_hold', 'money', 'Hold payout on a complaint (host has 48 h; auto-refund up to £50, set in Billing)', 'complaint.opened', '{"respondWithinHours":48}'::jsonb, array['something_went_wrong']::text[], null, true, true, 'payments', 'Run by Payments', '{}'::jsonb, 'sources/hostingMoney.js — a complaint holds the payout', 'stripe', false),
  ('chargebacks', 'money', 'Chargebacks — evidence assembled, auto-sent 2 days before the deadline', 'payout.held', '{}'::jsonb, '{}'::text[], 'Nothing sent (deliberate)', true, true, 'payments', 'Run by Payments', '{}'::jsonb, 'The Stripe chat’s dispute handling', 'stripe', false),
  ('fix_stripe_differences', 'money', 'Fix Stripe differences', 'payout.held', '{}'::jsonb, '{}'::text[], 'Nothing sent (deliberate)', true, true, 'payments', 'Run by Payments', '{}'::jsonb, 'The Stripe chat’s reconciliation', 'stripe', false),
  ('failed_membership_payments', 'members', 'Failed membership payments — update-card email, retry after 3 days, then pause', 'membership.renewal_failed', '{}'::jsonb, array['renewal_failed']::text[], null, true, true, 'payments', 'Run by Payments', '{}'::jsonb, 'Membership billing (the Stripe chat’s)', 'stripe', false),
  ('tell_me_when', 'demand', 'Tell me when — at most one a week', 'tell_me_when.match', '{"maxPerWeek":1}'::jsonb, array['tell_me_when']::text[], null, true, false, null, null, '{}'::jsonb, '“Tell me when” sign-ups (guide_alerts, migration 373)', null, false)
) as v(key, area, name, trigger, rules, template_keys, no_template, is_on, locked, lock_kind, lock_reason, step_locks, logic, owner_chat, honours_switch)
on conflict (key) do nothing;

-- The two pauses cannot be turned off at all, whatever writes to the table.
create or replace function automations_keep_pauses_on() returns trigger language plpgsql as $$
begin
  if new.key in ('child_safety_pause', 'checks_lapse_pause') and (not new.is_on or new.lock_kind is distinct from 'always_on' or not new.locked) then
    raise exception 'The % is always on', replace(new.key, '_', ' ') using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists automations_keep_pauses_on on automations;
create trigger automations_keep_pauses_on before insert or update on automations
  for each row execute function automations_keep_pauses_on();
create or replace function automations_keep_pauses() returns trigger language plpgsql as $$
begin
  if old.key in ('child_safety_pause', 'checks_lapse_pause') then
    raise exception 'The % cannot be removed', replace(old.key, '_', ' ') using errcode = 'check_violation';
  end if;
  return old;
end $$;
drop trigger if exists automations_keep_pauses on automations;
create trigger automations_keep_pauses before delete on automations
  for each row execute function automations_keep_pauses();

-- Never edit 266 or 303: the list gains two areas here.
alter table bo_changes drop constraint if exists bo_changes_area_check;
alter table bo_changes add constraint bo_changes_area_check
  check (area in ('Categories','Subcategories','Facts','Mapping','Defaults','Collections','Fact automations','Markets','Messages','Automations'));
