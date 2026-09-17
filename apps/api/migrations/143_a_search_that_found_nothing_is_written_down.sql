-- The search log.
--
-- Until now the search itself was thrown away. `queryId` was a
-- `crypto.randomUUID()` made in routes/discover.js, handed to the client and
-- never written to any table: the where, the filters, the counts and the
-- outcome all died the moment the response was sent. So the one question the
-- business most needs answering — what did people ask us for, and did we have
-- it — could not be asked at all.
--
-- **None of this can be backfilled.** Every day it is not written is gone, which
-- is why it is built first and why a search that returned nothing is logged as
-- loudly as one that returned forty.
--
-- Owner, 17 Sep 2026, on identity: "it would just be nice to understand specific
-- user behaviours and then also to be able to target them with specific
-- communication." So `account_id` is stored — lawful under UK GDPR on legitimate
-- interests for product analytics, provided the privacy notice says so and
-- marketing is kept to a separate basis. `marketing_opt_in` is added here rather
-- than later for exactly that reason: using behaviour to target communications
-- is direct marketing, and PECR needs consent or the soft opt-in.

create table if not exists searches (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households(id) on delete cascade,
  -- set null rather than cascade: a deleted account leaves the counts intact and
  -- the person gone, which is what erasure is meant to do.
  account_id    uuid references accounts(id) on delete set null,
  session_id    uuid,
  at            timestamptz not null default now(),
  surface       text not null,                  -- find | inspire | plan | places | trip | sketch
  -- Where they were looking. A slug, a point, or both.
  area_slug     text,
  lat           double precision,
  lng           double precision,
  cell          text,
  radius_km     real,
  mode          text,
  minutes       integer,
  -- What was asked for. Our own words only: a category, a subcategory, a count
  -- of people — never a provider's label and never free text we did not write.
  asked         jsonb not null default '{}'::jsonb,
  subject       text,                           -- the subcategory or category asked for; null = "anything"
  shown_total   integer not null default 0,
  shown         jsonb not null default '[]'::jsonb,   -- [{category, subcategory, source, n}]
  sources_queried text[] not null default '{}',
  degraded      text[] not null default '{}',
  empty         boolean not null default false,
  -- none | clicked | saved | tripped. Moved forward as events arrive, never back.
  outcome       text not null default 'none',
  outcome_at    timestamptz,
  trip_id       uuid references trips(id) on delete set null
);
create index if not exists searches_at_idx      on searches (at desc);
create index if not exists searches_area_idx    on searches (area_slug, at desc);
create index if not exists searches_subject_idx on searches (subject, at desc);
create index if not exists searches_cell_idx    on searches (cell, at desc);
create index if not exists searches_empty_idx   on searches (empty, at desc) where empty;
create index if not exists searches_account_idx on searches (account_id) where account_id is not null;

-- The click stream between "shown" and "saved", which did not exist either.
--
-- A replay reads this in order and prints exactly what that household saw, with
-- what they did to each row. The rows hold identifiers; names are re-resolved at
-- display, and for a Google-only ref that costs a call — so a replay is a
-- deliberate action with its cost said on screen, never something a list does
-- forty times on load.
create table if not exists search_events (
  id         bigserial primary key,
  search_id  uuid not null references searches(id) on delete cascade,
  at         timestamptz not null default now(),
  kind       text not null,                 -- shown | open | dismiss | save | shortlist | add_to_trip | refine | close
  venue_ref  text,
  position   integer,
  dwell_ms   integer,
  meta       jsonb not null default '{}'::jsonb
);
create index if not exists search_events_search_idx on search_events (search_id, position, at);
create index if not exists search_events_ref_idx    on search_events (venue_ref);

-- The monthly rollup that makes retention a setting rather than a migration
-- under pressure. Owner: "I think we should retain all searches for now, but
-- once that starts to become too big, then we can certainly start to remove or
-- aggregate." So the path is built and left switched off.
create table if not exists search_rollups (
  month        date not null,
  area_slug    text not null default '',
  subject      text not null default '',
  searches     integer not null default 0,
  empty        integer not null default 0,
  no_click     integer not null default 0,
  no_trip      integer not null default 0,
  rolled_at    timestamptz not null default now(),
  primary key (month, area_slug, subject)
);

-- Behaviour may be logged on legitimate interests; e-mailing somebody because of
-- it is direct marketing and needs its own basis. The flag is built with the log.
alter table accounts add column if not exists marketing_opt_in boolean not null default false;
alter table accounts add column if not exists marketing_opt_in_at timestamptz;

-- `source_impressions.query_id` pointed at nothing at all. Now it points here.
create index if not exists source_impressions_query_idx on source_impressions (query_id);
