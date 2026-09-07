-- The trip rebuild (owner, 7 Sep 2026 — "Handoff: Epic — Trips, Places, Create
-- trip, Sharing & Chat", `Supporting docs/Rebrand - EPIC/Trip rebuild - 070926 8pm`).
--
-- Four things the trip can now hold that the tables could not:
--
--   * **How they are getting there.** A flight, a train, a drive or a crossing,
--     outbound and back, and the transfer at the far end. The design draws it
--     as one screen per trip (5d) and the times on it are all derived from the
--     one fact the household types — "leave home by 05:20" is the departure
--     minus two hours minus the drive — so what is stored is the leg, never the
--     arithmetic.
--
--   * **A conversation, in two places.** The trip's own chat (5e) and a thread
--     scoped to one stop (3d). One table, because a per-stop Ask also surfaces
--     in the trip chat with a pointer to it ("› Asked on Savill Garden") and two
--     tables would mean two orderings of the same conversation. `venue_ref` null
--     is the trip's chat; anything else is that stop's thread.
--
--   * **Guests.** Somebody with the link who has no Epic account and is not in
--     the household: they read the plan and the people, and post in the chat and
--     the Asks. Distinct from `group_participants`, which is the money-and-
--     headcount machinery of a group trip — a guest here owes nothing and is
--     booked into nothing; they were sent a link.
--
--   * **A date that is not fixed.** The Trips list has three strips now —
--     Upcoming · Past · **Ideas** — and an idea is a trip whose dates are a
--     placeholder ("Date not fixed" on the row). `trips.depart_at` has been NOT
--     NULL since 001, so the flag says what the dates mean rather than the dates
--     being absent.

-- ---------------------------------------------------------------------------
-- the trip itself
-- ---------------------------------------------------------------------------

alter table trips
  -- False = an idea: the dates in the columns are a placeholder to keep the
  -- day machinery working, and every screen says "Date not fixed" instead.
  add column if not exists dates_fixed boolean not null default true,
  -- The link the organiser copies. Minted on first share, never on creation:
  -- a trip nobody has shared has no address anybody else could guess at.
  add column if not exists share_token text;

create unique index if not exists trips_share_token_idx on trips (share_token) where share_token is not null;

-- ---------------------------------------------------------------------------
-- getting there
-- ---------------------------------------------------------------------------

-- One leg out and one back, per mode. The design (5d) draws Fly · Train ·
-- Drive · Ferry as a strip over the same two kickers, so the mode lives on the
-- leg rather than on the trip: a household that flies out and takes the train
-- back is two rows, and neither of them is wrong.
--
-- Every field a provider would fill is nullable, because none of them needs a
-- provider: the household types a flight number and we resolve what open data
-- knows (the airline, the two airports); the times come from their booking.
create table if not exists trip_travel_legs (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips(id) on delete cascade,
  -- 'outbound' | 'return'
  direction        text not null,
  -- 'fly' | 'train' | 'drive' | 'ferry'
  mode             text not null,
  on_date          date,
  -- Where from and where to. The code is the airport's IATA, the station's CRS
  -- or the port's name; the label is what a person calls it.
  from_code        text,
  from_label       text,
  to_code          text,
  to_label         text,
  depart_at        time,
  arrive_at        time,
  -- "British Airways", "BA 548", "Terminal 5" — three separate facts, because
  -- the row shows them separately and only the first two can be looked up.
  carrier          text,
  service_no       text,
  terminal         text,
  duration_minutes integer,
  booking_ref      text,
  -- How long it takes to get to the terminal from home, so "leave home by" can
  -- be derived rather than stored. Null means we have not worked it out yet.
  access_minutes   integer,
  note             text,
  -- Where this leg came from: typed by hand, resolved from a service number, or
  -- parsed out of a forwarded booking email.
  source           text not null default 'typed',
  created_at       timestamptz not null default now(),
  unique (trip_id, direction, mode)
);
create index if not exists trip_travel_legs_trip_idx on trip_travel_legs (trip_id, direction);

-- Airport to hotel (5d): three cells — train, taxi, hire car — with a time and
-- an estimated cost for the party, one of which may be picked and added to the
-- plan. Costs are estimates and are stored in pence with their currency, the
-- way every other price in Epic is.
create table if not exists trip_transfers (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  leg_id         uuid references trip_travel_legs(id) on delete cascade,
  -- 'train' | 'taxi' | 'hire'
  mode           text not null,
  label          text,
  detail         text,
  minutes        integer,
  est_cost_pence integer,
  currency       text not null default 'GBP',
  chosen         boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (trip_id, leg_id, mode)
);
create index if not exists trip_transfers_trip_idx on trip_transfers (trip_id);

-- ---------------------------------------------------------------------------
-- who else is on the trip
-- ---------------------------------------------------------------------------

-- A guest: a name, one way to reach them, and a link of their own. They are not
-- a member of the household and never become one; if they later make an Epic
-- account of their own it is linked here so a second invite recognises them.
create table if not exists trip_guests (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  name           text not null,
  contact        text,
  -- 'mobile' | 'email'
  contact_kind   text,
  -- Their own door into this trip. The organiser can send it by hand; the
  -- shared link asks for the contact and matches it to this row.
  token          text not null unique,
  -- 'invited' — sent, not yet opened; 'joined' — they have been in.
  status         text not null default 'invited',
  account_id     uuid references accounts(id) on delete set null,
  invited_at     timestamptz not null default now(),
  joined_at      timestamptz,
  last_seen_at   timestamptz,
  unique (trip_id, contact)
);
create index if not exists trip_guests_trip_idx on trip_guests (trip_id);

-- The one-time code a guest is sent when they open the shared link and give a
-- contact the organiser has written down. Short-lived and single use.
create table if not exists trip_guest_codes (
  id          uuid primary key default gen_random_uuid(),
  guest_id    uuid not null references trip_guests(id) on delete cascade,
  code        text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists trip_guest_codes_guest_idx on trip_guest_codes (guest_id, created_at desc);

-- ---------------------------------------------------------------------------
-- the conversation
-- ---------------------------------------------------------------------------

create table if not exists trip_messages (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips(id) on delete cascade,
  -- Null is the trip's own chat. A venue_ref is that stop's Ask thread, which
  -- also surfaces in the chat with a pointer to it.
  venue_ref        text,
  -- The household's name for the stop, so the pointer in the chat can say
  -- "Asked on Savill Garden" without a second read. Household-written, like
  -- trip_stops.venue_name — never a provider's name.
  venue_label      text,
  body             text not null,
  -- Exactly one of these is set. A member is somebody in the household; a
  -- guest is somebody with the link.
  author_member_id uuid references members(id) on delete set null,
  author_guest_id  uuid references trip_guests(id) on delete cascade,
  created_at       timestamptz not null default now()
);
create index if not exists trip_messages_trip_idx on trip_messages (trip_id, created_at);
create index if not exists trip_messages_stop_idx on trip_messages (trip_id, venue_ref, created_at);

-- "Seen by 3". One row per person who has read the message; the sender's own is
-- written when it is sent, so the count on their own bubble is honest.
create table if not exists trip_message_reads (
  message_id uuid not null references trip_messages(id) on delete cascade,
  member_id  uuid references members(id) on delete cascade,
  guest_id   uuid references trip_guests(id) on delete cascade,
  read_at    timestamptz not null default now()
);
create unique index if not exists trip_message_reads_member_idx on trip_message_reads (message_id, member_id) where member_id is not null;
create unique index if not exists trip_message_reads_guest_idx on trip_message_reads (message_id, guest_id) where guest_id is not null;

-- ---------------------------------------------------------------------------
-- airports, stations and ports, as open data
-- ---------------------------------------------------------------------------

-- Looked up from OpenStreetMap by code (`iata=LHR`, `ref:crs=BTH`) and kept,
-- because OSM is open and a terminal is not a rented place record. This is what
-- lets "LHR → FCO" become "Heathrow → Fiumicino, 4 min apart on the map"
-- without a provider and without a second lookup next time.
create table if not exists travel_terminals (
  code        text primary key,
  kind        text not null,            -- 'airport' | 'station' | 'port'
  name        text not null,
  locality    text,
  country     text,
  country_code text,
  lat         double precision,
  lng         double precision,
  attribution text,
  fetched_at  timestamptz not null default now()
);
