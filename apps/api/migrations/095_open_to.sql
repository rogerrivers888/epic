-- "Just say what you are up for" (owner, 13 Sep 2026, Supporting docs/Groups &
-- events NEW/Casual meet ups: "build this functionality end to end… build it
-- for real"). The casual half of meetups and mini tours.
--
-- Most meetups are not events yet; they are interests. So this path asks for no
-- date, no price, no cap, no venue and no listing — there is nothing to cancel
-- because nothing was ever scheduled. One intake serves both sides: a household
-- at home says what it is up for **standing**, re-asked every three months; a
-- household on a trip says what it is up for **there**, and it clears when the
-- trip ends.
create table if not exists open_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  -- 'standing' is near home and has no end; 'trip' expires with the trip.
  scope text not null default 'standing' check (scope in ('standing', 'trip')),
  trip_id uuid references trips(id) on delete cascade,
  -- What they said, as confirmed chips. Never a transcript the user proof-reads.
  interests text[] not null default '{}',
  -- How it goes: relaxed, not teaching, happy on my own too.
  level text[] not null default '{}',
  -- Roughly when and roughly where — from the profile or the trip, overridable.
  when_chips text[] not null default '{}',
  where_label text,
  where_miles integer,
  -- [{ name, level }] — level is 'fluent' | 'some'. A shared language is a
  -- requirement of a match, never a question; only fluency is asked.
  languages jsonb not null default '[]'::jsonb,
  money text not null default 'free',
  -- Who they would rather meet. Age, company and language, and nothing else —
  -- never ethnicity, religion or nationality, and never anything about a child.
  pref_age text not null default 'any' check (pref_age in ('any', 'similar')),
  pref_company text[] not null default '{anyone}',
  pref_fluency text not null default 'some' check (pref_fluency in ('fluent', 'some')),
  -- A family entry only ever matches another family entry.
  kind text not null default 'adult' check (kind in ('adult', 'family')),
  child_age_bands text[] not null default '{}',
  -- What was said, kept for the household's own record. Never shown to anybody else.
  transcript text,
  state text not null default 'active' check (state in ('active', 'ended')),
  -- A standing entry is re-asked every three months; a trip entry ends with the trip.
  review_due_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists open_entries_household_idx on open_entries (household_id, state);
create index if not exists open_entries_live_idx on open_entries (state, scope) where state = 'active';
create unique index if not exists open_entries_one_standing_idx on open_entries (household_id) where scope = 'standing' and state = 'active';
create unique index if not exists open_entries_one_per_trip_idx on open_entries (trip_id) where trip_id is not null and state = 'active';

-- An introduction between two entries, one step at a time. The local, standing
-- entry is the host and is **always asked first**; the visitor is the guest and
-- hears nothing until the host has answered. Each verdict is hidden until both
-- are in, a no is silent at every stage, and an unanswered match lapses after a
-- week with one nudge.
create table if not exists open_matches (
  id uuid primary key default gen_random_uuid(),
  host_entry_id uuid not null references open_entries(id) on delete cascade,
  guest_entry_id uuid not null references open_entries(id) on delete cascade,
  -- What the two have in common, which is all either is told at first.
  interests text[] not null default '{}',
  kind text not null default 'adult' check (kind in ('adult', 'family')),
  stage text not null default 'host_asked'
    check (stage in ('host_asked', 'guest_asked', 'videos', 'both_yes', 'verified', 'chat', 'lapsed', 'ended')),
  -- The host's enrichment for this one guest: where and when, and what to know.
  host_where text,
  host_note text,
  -- Hidden from the other side until both have answered (domain/openTo.js).
  host_verdict text check (host_verdict in ('yes', 'no')),
  guest_verdict text check (guest_verdict in ('yes', 'no')),
  host_answered_at timestamptz,
  guest_answered_at timestamptz,
  -- Twenty seconds each, blind until both are in, deleted once both have decided.
  host_video_id uuid references host_media(id) on delete set null,
  guest_video_id uuid references host_media(id) on delete set null,
  host_video_yes boolean,
  guest_video_yes boolean,
  videos_deleted_at timestamptz,
  -- ID is asked once, both sides, after two yeses and before anything is exchanged.
  host_verified_at timestamptz,
  guest_verified_at timestamptz,
  nudged_at timestamptz,
  lapses_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists open_matches_host_idx on open_matches (host_entry_id, stage);
create index if not exists open_matches_guest_idx on open_matches (guest_entry_id, stage);
create unique index if not exists open_matches_pair_idx on open_matches (host_entry_id, guest_entry_id);
create index if not exists open_matches_lapse_idx on open_matches (lapses_at) where stage in ('host_asked', 'guest_asked', 'videos');
