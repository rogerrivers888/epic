-- How a household arrived, because it is what every estate figure is divided by.
--
-- The reporting suite's fourth non-negotiable (handoff, "Reporting & overview",
-- 20 Sep 2026): "Origin slices everything. Guest-invite households are ~15% of
-- the estate and ~4% of revenue; the default view excludes them."
--
-- The reason it matters more than it looks: a guest invited to somebody else's
-- group trip gets a household of their own, and so does a non-subscriber who
-- books an event from a public page. Both are successes. Put them in the same
-- denominator as somebody who came to sign up and activation, retention and
-- trial conversion all read as broken while the business works.
--
-- Five values, and they are a closed set:
--
--   founding      the household Epic was built in
--   signup        came to Epic and made an account
--   guest_invite  invited to somebody else's trip, or booked from a public page
--   peer          invited into an existing household by one of its own people
--   marketplace   arrived through a host's page or a public offer
--
-- Backfilled from what is already written down rather than guessed: the oldest
-- household is the founding one, a household reached only through a trip guest
-- code or an offer invite arrived as a guest, and everybody else signed up.
-- `peer` cannot be recovered — a second account in a household does not make a
-- second household — so nothing is backfilled to it; it is written going
-- forward by whatever creates the household.

alter table households
  add column if not exists origin text not null default 'signup';

alter table households
  drop constraint if exists households_origin_check;
alter table households
  add constraint households_origin_check
  check (origin in ('founding', 'signup', 'guest_invite', 'peer', 'marketplace'));

-- The founding household: the first one there ever was.
update households
   set origin = 'founding'
 where id = (select id from households order by created_at, id limit 1);

-- Arrived as somebody else's guest: `trip_guests` is the group-trip invitation,
-- and the account it created carries the household it made.
update households h
   set origin = 'guest_invite'
 where h.origin = 'signup'
   and exists (
     select 1 from trip_guests g
       join accounts a on a.id = g.account_id
      where a.household_id = h.id
   );

-- Arrived through a host's page: their first act on Epic was booking somebody's
-- experience, and they hold no trip of their own.
update households h
   set origin = 'marketplace'
 where h.origin = 'signup'
   and exists (select 1 from experience_bookings b where b.household_id = h.id)
   and not exists (select 1 from trips t where t.household_id = h.id);

create index if not exists households_origin_idx on households (origin);
