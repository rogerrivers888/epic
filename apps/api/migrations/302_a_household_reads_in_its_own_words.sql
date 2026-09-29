-- A household reads in its own words (owner, 29 Sep 2026; Epic — Markets: build
-- brief §7 / step 3, and the "not applicable in this market" status).
--
-- British and American English are different locales, and Google treats them as
-- such. This is the wording layer: a key-based store of every user-visible
-- string in the two variants, with everything falling back to en-GB. It is NOT
-- translation — there is no second language — it is en-GB and en-US and a rule
-- for choosing between them.
--
-- The one rule that has to be right and is easy to get wrong: **wording follows
-- the HOUSEHOLD, never the market of the place being displayed** (register entry
-- 1). A British family browsing Florida reads "car park"; an American browsing
-- Cornwall reads "parking lot". So the resolver reads a household's own locale
-- and never reaches for a place's market — see `domain/wording.js`, and the test
-- that fails if it ever does.

-- Every user-visible string, once, in the two variants. A row is keyed by its
-- namespace and key; the label resolves at display, never stored already
-- rendered (register entry 9 / brief §4.9).
create table if not exists market_wording (
  namespace   text not null check (namespace in ('interface', 'places', 'collection')),
  key         text not null,
  en_gb       text not null,
  -- null means "same as en-GB": an American household sees the British line
  -- until someone writes theirs. The normal, correct state for most keys.
  en_us       text,
  -- Drift detection. `en_gb_version` bumps whenever en_gb is edited;
  -- `en_gb_version_when_us_written` snapshots it at the moment en_us was written.
  -- When they differ and en_us is set, the English has moved on and the American
  -- copy needs review ("Needs review · English changed").
  en_gb_version                integer not null default 1,
  en_gb_version_when_us_written integer,
  -- A machine draft, shown as the en-US placeholder until a person types. Never
  -- set for collection copy, which is written by a person only (register 7).
  suggestion  text,
  -- Whether a machine may ever draft this key. false for the collection
  -- namespace, enforced by the back office, recorded here so the rule travels
  -- with the row.
  machine_allowed boolean not null default true,
  set_by      text,                       -- who wrote the en_us
  at          timestamptz,                -- when
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (namespace, key)
);

-- Collection copy is written by a person only, in every variant (register 7).
-- The rule travels with the row so nothing has to remember it.
alter table market_wording add constraint market_wording_collection_is_handwritten
  check (namespace <> 'collection' or (machine_allowed = false and suggestion is null));

-- A missing wording renders en-GB and LOGS the miss (register 6) — it never
-- renders a key and never renders blank. The log is how a gap in the en-US
-- vocabulary becomes visible rather than silent.
create table if not exists wording_misses (
  namespace  text not null,
  key        text not null,
  locale     text not null,               -- the locale that was asked for and not found
  seen       integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (namespace, key, locale)
);

-- The household's own locale — the thing the resolver reads. Seeded from the
-- market a household registered in (its home country's default_wording_locale),
-- and en-GB for anyone we cannot place. From here on registration sets it; the
-- market's default only seeds it.
alter table households add column if not exists wording_locale text not null default 'en-GB';
update households h
   set wording_locale = coalesce(
         (select m.default_wording_locale from markets m where m.code = upper(h.home_country_code)),
         'en-GB')
 where h.home_country_code is not null;

-- Whether a subcategory is offered in a market at all — the "not applicable in
-- this market" status. A pub with a garden is not a bar with a patio: rather
-- than give the drawer a local label and leave it correctly named but empty
-- (which reads as a coverage failure), a market can say the subcategory is not
-- offered here. Absence of a row means "applicable" (the default everywhere);
-- a row with applicable = false is the deliberate "not applicable here", and a
-- count for it reads "not applicable here" rather than 0. Behaviour settled
-- (owner, 29 Sep 2026); the visual treatment is provisional.
create table if not exists market_subcategories (
  market_code text not null references markets(code) on delete cascade,
  subcategory text not null,
  applicable  boolean not null default true,
  set_by      text,
  at          timestamptz not null default now(),
  primary key (market_code, subcategory)
);
