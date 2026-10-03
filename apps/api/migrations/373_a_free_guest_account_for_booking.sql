-- A free guest account, made by the person themselves (G21, Roger 3 Oct 2026).
--
-- "Yes — ask to book and joining a waiting list create the same free account
-- as booking (bookings, messages, payments only)." Until now nobody could make
-- their own account: Google signed in existing staff only, and every account
-- was made by an administrator, a staff invite or a household invite. The
-- booking screen's "Your free account" (Continue with Google · Use my email)
-- now makes one.
--
-- Two things the database has to know:
--
-- 1. `guest` is a plan. Free, and not a paid plan: price_pence is null, which
--    034 defines as "not a paid plan" (0 would be a paid plan priced at
--    nothing). Its call bound is 0 — a guest never spends a paid Google or
--    Claude call; sources/paidGate.js and claude.js refuse the plan outright
--    whatever the number says. Not a member: a guest's household is
--    `origin = 'guest_invite'`, which memberships.js never classifies.
--
-- 2. "Use my email" must not make an account for an address nobody has proved
--    is theirs. The account is made when the link is opened, not when it is
--    asked for — so a link can now be for an address that has no account yet.
--    It is the same single-use, hashed, expiring `sign_in_links` row every
--    other link is (never a second token system); `account_id` is filled in
--    when it is spent. Such a link carries `purpose = 'guest'`, which no other
--    door redeems (repositories/accounts.js consumeSignInLink).

insert into plans (key, label, note, price_pence, call_bound, active, position)
values ('guest', 'Guest', 'A free account made to book, ask to book or join a waiting list. Bookings, messages and payments only — never a paid search.', null, 0, true, 9)
on conflict (key) do nothing;

alter table sign_in_links alter column account_id drop not null;
alter table sign_in_links add column if not exists pending_email text;
alter table sign_in_links add column if not exists pending_name text;

alter table sign_in_links drop constraint if exists sign_in_links_purpose_check;
alter table sign_in_links add constraint sign_in_links_purpose_check
  check (purpose is null or purpose in ('invite', 'reset', 'guest'));

-- A link is for an account, or — only a guest link — for an address that will
-- become one when it is opened. Never neither.
alter table sign_in_links drop constraint if exists sign_in_links_for_someone_check;
alter table sign_in_links add constraint sign_in_links_for_someone_check
  check (account_id is not null or (purpose = 'guest' and pending_email is not null));

create index if not exists sign_in_links_pending_email_idx
  on sign_in_links (lower(pending_email)) where used_at is null and pending_email is not null;
