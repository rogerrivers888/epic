-- Hosts and events (owner, 12 Sep 2026 — "Supporting docs/Groups & events NEW":
-- Events & Hosts brief v4/v5, the three design canvases and the build handoff).
--
-- Epic already lets an organiser run a private group trip. This lets anyone
-- *host* something strangers can find and join, and lets a guest see and hear
-- who the host is before they commit. Four decisions from the brief are in the
-- shape of these tables rather than in the code that reads them:
--
--   * **A host is a person with a menu of offers, not a listing.** One row in
--     `hosts` per household (the person behind the account); many rows in
--     `host_offers`, each with its own video, its own "why you" line, its own
--     format, duration, party size and price. There is no generic bio column
--     an offer could fall back to.
--
--   * **Type is a positioning axis, never a quality ladder.** `type` is one of
--     practitioner / local / guide and nothing here orders by it. Trust is a
--     separate column with its own three rungs (verified / checked / trusted),
--     because any type can hold any rung.
--
--   * **The shape changes the questions.** `shape` is one-off / series /
--     anytime, and the columns that only one shape uses (a running order, a
--     week list, an availability pattern) are nullable rather than pushed into
--     a generic blob, so the wizard and the guest page can be honest about
--     what they hold.
--
--   * **Paused is not gone.** `state` carries `paused` and `paused_until`
--     beside `draft`, `in_review` and `live`, so a card can grey and say "back
--     in November" instead of disappearing.
--
-- Money. Public experiences are Epic-collects only, and Epic has no payment
-- provider yet (that key is the owner's — CLAUDE.md). So a booking records
-- what was agreed (`payment_status = 'recorded'`) exactly as group bookings
-- do, and nothing here holds a card, a Stripe id or a payout. The host's
-- payout row says `not_connected` until the day it can say otherwise.
--
-- Licence. Everything in these tables was written or recorded by a host or a
-- guest: names, words, their own videos and photographs, and the household's
-- own bookings. No provider content lands here. A venue is an address the host
-- typed and a coordinate from open geocoding.
--
-- Two smaller things for the group-trip screens the same handoff adds (G20 and
-- G24): a six-digit sign-in code for the invite flow, and a waiting list for a
-- group that is full.

-- ---------------------------------------------------------------------------
-- media: the videos and photographs a host records or uploads
-- ---------------------------------------------------------------------------
-- Held as bytes in the database, like the picture library (036). Railway's
-- disk does not survive a deploy, and a host's one-minute video is the hero of
-- their page — losing it on a redeploy would be losing the product. A 30–60 s
-- self-shot clip at a phone's default bitrate is a few megabytes; the route
-- caps an upload at 40 MB.
create table if not exists host_media (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  kind          text not null,                      -- 'video' | 'photo'
  mime          text not null,
  bytes         bytea not null,
  size          integer not null,
  duration_s    integer,                            -- videos: how long it plays
  trim_start_s  integer,                            -- the simple trim, kept as marks rather than re-encoding
  trim_end_s    integer,
  made_by       text not null default 'self',       -- 'self' | 'epic' (the polish tier, badged quietly)
  created_at    timestamptz not null default now()
);
create index if not exists host_media_household_idx on host_media (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- hosts
-- ---------------------------------------------------------------------------
create table if not exists hosts (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null unique references households(id) on delete cascade,
  account_id          uuid references accounts(id) on delete set null,
  name                text not null,
  type                text not null default 'practitioner',   -- 'practitioner' | 'local' | 'guide'
  local_kind          text,                                    -- Local only: 'family' | 'something_you_do' | 'night_out' | 'neighbourhood'
  -- The ladder. Every host clears 'verified' once their checks pass; the
  -- other two are set in the back office and never by the host.
  trust               text not null default 'verified',        -- 'verified' | 'checked' | 'trusted'
  checks              text not null default 'running',         -- 'running' | 'passed' — "checks running" is a state the profile shows
  intro_text          text,
  intro_video_id      uuid references host_media(id) on delete set null,
  photo_id            uuid references host_media(id) on delete set null,
  -- Where they are, in their own words and as a point: "Windsor", 51.48, -0.61.
  location_label      text,
  lat                 double precision,
  lng                 double precision,
  country_code        text,
  credentials         jsonb not null default '[]'::jsonb,      -- ["Blue Badge guide", "15 years", …]
  languages           jsonb not null default '[]'::jsonb,
  children_ages       jsonb not null default '[]'::jsonb,      -- Local · Family: the host's own children's ages
  -- What they said they would show. Never the document itself.
  id_document         text,                                    -- 'passport' | 'driving_licence'
  insurance_confirmed boolean not null default false,
  -- UK platform reporting: NI or UTR, needed before a first payout. Held
  -- because HMRC requires it of us; shown back only masked.
  tax_reference       text,
  -- Payouts. Stripe is a key and a key is the owner's; until it exists this
  -- can only ever say so.
  payout_status       text not null default 'not_connected',   -- 'not_connected' | 'connected'
  payout_label        text,
  date_of_birth       date,                                    -- hosts are 18+, and the onboarding checks it
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists hosts_location_idx on hosts (lat, lng) where lat is not null;

-- ---------------------------------------------------------------------------
-- offers: one bookable thing a host does
-- ---------------------------------------------------------------------------
create table if not exists host_offers (
  id               uuid primary key default gen_random_uuid(),
  host_id          uuid not null references hosts(id) on delete cascade,
  shape            text not null,                         -- 'oneoff' | 'series' | 'anytime'
  state            text not null default 'draft',         -- 'draft' | 'in_review' | 'live' | 'paused' | 'ended'
  paused_until     date,
  visibility       text not null default 'public',        -- 'public' | 'link'
  title            text,
  description      text,                                  -- what happens
  why_you          text,                                  -- the credentials and story for *this* offer
  includes         text,                                  -- "The walk, the stories and the first round."
  category         text,                                  -- a mood / passion word: painting, cooking, running…
  photo_ids        jsonb not null default '[]'::jsonb,
  video_id         uuid references host_media(id) on delete set null,
  -- Where it happens (brief §7). The four formats, and what each shows before
  -- and after booking.
  venue            text not null default 'out_about',     -- 'their_place' | 'your_place' | 'out_about' | 'online'
  venue_label      text,                                  -- the exact spot, revealed to a guest once booked
  venue_area       text,                                  -- what is shown before: "central Windsor"
  venue_lat        double precision,
  venue_lng        double precision,
  venue_country    text,
  venue_notes      text,                                  -- their place: who else is in the house, stairs, a dog
  travel_radius_min integer,                              -- your place: how far they will come
  travel_charge_pence integer,                            -- …and what it costs beyond that
  online_platform  text,                                  -- online: "a video call"
  duration_min     integer,
  -- Who and how many: the group set-up's three numbers, verbatim.
  min_count        integer,
  expected_count   integer,
  max_count        integer,
  party_max        integer,                               -- the most one booking can bring; null = any
  age_limit        integer,                               -- null | 12 | 16 | 18
  -- Price: Free / Same each / Depends on numbers, per Person / Household.
  price_mode       text not null default 'free',          -- 'free' | 'same_each' | 'by_numbers'
  price_pence      integer,
  total_pence      integer,                               -- by_numbers: the whole amount to recover
  per              text not null default 'person',        -- 'person' | 'household'
  refund_rule      text not null default '24h',           -- '24h' | '7d' | 'none'
  -- One-off.
  starts_on        date,
  starts_at        time,
  running_order    jsonb not null default '[]'::jsonb,    -- [{time, title, detail}]
  featured_people  jsonb not null default '[]'::jsonb,    -- [{name, role, photoId}]
  -- Series.
  weekday          integer,                               -- 0 Sunday … 6 Saturday
  first_date       date,
  sessions         integer,
  skipped_dates    jsonb not null default '[]'::jsonb,
  outcome          text,                                  -- what they will be able to do by the end
  arc              text,                                  -- how it develops
  weeks            jsonb not null default '[]'::jsonb,    -- [{n, title}]
  join_mode        text,                                  -- 'whole' | 'drop_in' | 'both'
  drop_in_pence    integer,
  missed_note      text,
  -- Anytime.
  availability     jsonb not null default '{}'::jsonb,    -- {days: [1,2,…], parts: ['morning','afternoon','evening']}
  slot_min         integer,
  -- Compliance (brief §12): the city-aware step, in regulated countries only.
  regulated_answer text,                                  -- 'no_commentary' | 'licensed'
  licence_number   text,
  licence_expiry   date,
  -- Pitch review: a real state with a 48-hour promise.
  review_checklist jsonb,                                 -- {what, home, suits, not_suits, photos} each 'clear' | 'missing' | string
  review_note      text,                                  -- the editorial reply
  reviewed_at      timestamptz,
  submitted_at     timestamptz,
  published_at     timestamptz,
  cancelled_at     timestamptz,
  cancelled_note   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists host_offers_host_idx on host_offers (host_id, created_at desc);
create index if not exists host_offers_live_idx on host_offers (state, starts_on) where state in ('live', 'paused');

-- ---------------------------------------------------------------------------
-- bookings: a person's place
-- ---------------------------------------------------------------------------
create table if not exists experience_bookings (
  id              uuid primary key default gen_random_uuid(),
  offer_id        uuid not null references host_offers(id) on delete cascade,
  host_id         uuid not null references hosts(id) on delete cascade,
  household_id    uuid not null references households(id) on delete cascade,
  account_id      uuid references accounts(id) on delete set null,
  booked_by       text,                                   -- the adult's name
  -- Which instance: a one-off's date, 'whole' or a session date for a series,
  -- 'YYYY-MM-DDTHH:MM' for an anytime slot.
  occurrence      text,
  party           jsonb not null default '[]'::jsonb,     -- [{name, age, child}]
  heads           integer not null default 1,
  -- 'pending' is held until the minimum is met; 'confirmed' has a place;
  -- 'waitlisted' was over the maximum; 'attended' after it ran.
  state           text not null default 'pending',        -- 'pending' | 'confirmed' | 'waitlisted' | 'cancelled' | 'attended'
  amount_pence    integer not null default 0,
  -- 'recorded' — nothing has left anybody's account, because Epic holds no
  -- money yet; 'paid' once a provider has taken it; 'refunded' after a call-off.
  payment_status  text not null default 'recorded',       -- 'recorded' | 'paid' | 'refunded'
  paid_at         timestamptz,
  refunded_at     timestamptz,
  address         text,                                   -- your place: where the host comes to
  access_notes    text,                                   -- …and how to get in
  note_to_host    text,
  decide_by       date,                                   -- when a held booking is decided
  cancelled_at    timestamptz,
  cancelled_by    text,                                   -- 'guest' | 'host' | 'epic'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists experience_bookings_offer_idx on experience_bookings (offer_id, created_at);
create index if not exists experience_bookings_household_idx on experience_bookings (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- reviews: both sides, published together a fortnight later
-- ---------------------------------------------------------------------------
create table if not exists host_reviews (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references experience_bookings(id) on delete cascade,
  offer_id      uuid not null references host_offers(id) on delete cascade,
  host_id       uuid not null references hosts(id) on delete cascade,
  household_id  uuid not null references households(id) on delete cascade,
  side          text not null default 'guest',            -- 'guest' | 'host'
  stars         integer not null,
  chips         jsonb not null default '[]'::jsonb,       -- ['skill','company','value']
  text          text,
  photo_id      uuid references host_media(id) on delete set null,
  -- Day of the experience + 14, so neither review is written in reply to the other.
  publish_on    date not null,
  created_at    timestamptz not null default now(),
  unique (booking_id, side)
);
create index if not exists host_reviews_host_idx on host_reviews (host_id, publish_on);

-- What a host said to everyone booked on an offer, and a report about a host.
create table if not exists host_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  offer_id    uuid not null references host_offers(id) on delete cascade,
  body        text not null,
  sent_to     integer not null default 0,
  delivered   integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists host_reports (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references hosts(id) on delete cascade,
  offer_id      uuid references host_offers(id) on delete set null,
  household_id  uuid references households(id) on delete set null,
  reason        text not null,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- group trips: the two states the handoff adds
-- ---------------------------------------------------------------------------
-- G20: a six-digit code, sent to the contact a guest gave, is how they sign in
-- from now on. Only the hash is written down, like every other credential here.
create table if not exists sign_in_codes (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id) on delete cascade,
  code_hash    text not null,
  contact      text not null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  attempts     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists sign_in_codes_account_idx on sign_in_codes (account_id, created_at desc);

-- G24: "Tell me if a place comes up" — just a mobile, no account, nothing held.
create table if not exists group_waitlist (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references trip_groups(id) on delete cascade,
  contact       text not null,
  contact_kind  text,
  created_at    timestamptz not null default now(),
  -- A send in progress holds a short lease; only a delivered send writes `told_at`,
  -- so a process that dies mid-send leaves a row that is tried again.
  claimed_at    timestamptz,
  told_at       timestamptz,
  unique (group_id, contact)
);
