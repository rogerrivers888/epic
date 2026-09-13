-- Lanes A and B (owner, 13 Sep 2026, "Lanes A and B Revised 130926"): the two
-- private paths to a one-off. Two things the set-up needs that the rows did
-- not have.
--
-- 1. An invitation link on every offer. Lane B is "anyone with the link"; lane
--    A shows the same link beside the named list, because a host who has
--    named people still passes one round. It opens the page for a private
--    offer the way a personal invitation's token does; whoever books through
--    it has RSVP'd.
alter table host_offers add column if not exists link_token text;
-- A default as well as the repository's own token, so a row inserted by any
-- other path — a test, a back-office fixture — still has a link rather than
-- failing the not-null.
alter table host_offers alter column link_token set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 18);
update host_offers set link_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 18) where link_token is null;
alter table host_offers alter column link_token set not null;
create unique index if not exists host_offers_link_token_idx on host_offers (link_token);

-- 2. My Epic contacts: everyone a household has ever invited, kept so the next
--    event's "who is invited" search finds them (C2a, C2f). One row per person
--    per household, matched on mobile or email, never on name — two people
--    with the same name and different numbers are two rows.
create table if not exists host_contacts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  mobile text,
  email text,
  times_invited integer not null default 0,
  last_invited_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists host_contacts_household_idx on host_contacts (household_id, times_invited desc, name);
create unique index if not exists host_contacts_mobile_idx on host_contacts (household_id, mobile) where mobile is not null;
create unique index if not exists host_contacts_email_idx on host_contacts (household_id, lower(email)) where email is not null;
