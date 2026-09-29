-- A place belongs to a market (owner, 29 Sep 2026; Epic — Markets: build brief §4/§5).
--
-- Epic launches UK → US → possibly Ireland, all English: this is not translation.
-- What every country needs is a *market* — a currency, units, an area shape, a
-- middle administrative level, a timezone and cost bands that mean something
-- locally. The idea of a country was scattered across a bare `country_code` on
-- place_index and households; this gives it a table to point at, and carries a
-- currency, a timezone and the ledger's language beside every amount, time and
-- Google call. None of it is visible to a household.
--
-- Whole, on purpose (owner: "Build migration 300 whole"). The wording table and
-- its resolver (step 3) and the cross-language alias locale (step 7) are their
-- own later migrations, sequenced after this.
--
-- Blocked markets are NOT rows here. Google's nine prohibited territories are a
-- code constant (`apps/api/src/domain/markets.js`) that the paid door refuses
-- against — one source of truth, and no status value that can drift (register
-- entry 4). So `status` has no 'blocked' member; the markets screen renders the
-- blocked list from the constant.

create table if not exists markets (
  code                   text primary key,          -- ISO-3166 alpha-2: GB, US, IE, PT …
  name                   text not null,
  status                 text not null default 'groundwork'
                           check (status in ('live', 'soft', 'groundwork')),
  currency               text not null,             -- ISO-4217: GBP, USD, EUR
  distance_unit          text not null default 'km' check (distance_unit in ('miles', 'km')),
  temp_unit              text not null default 'C'  check (temp_unit in ('C', 'F')),
  -- The shape of an area, not its prose. { name, pattern, searchBy } — the code
  -- type's own noun, an anchored validation pattern and what the box searches by.
  -- The family-facing sentences (placeholder, "not a place we know yet…") are
  -- wording keys, resolved per household locale (migration B), never stored here.
  area_code              jsonb,
  -- What replaces "county" everywhere Epic says it, for this market.
  mid_level_name         text not null default 'Region',
  date_format            text not null default 'D MMM YYYY',
  -- The timezone a place in this market falls back to before it has learned its
  -- own (the value `place_records.timezone` defaults to in words). The US spans
  -- six zones, so its market default is only a fallback — a place's own zone,
  -- once known, always wins.
  default_timezone       text not null default 'UTC',
  -- The wording locale a household REGISTERING in this market is seeded with, and
  -- nothing else. Wording follows the household, never the market of the place
  -- being displayed (register entry 1): a British family browsing Florida reads
  -- "car park", an American browsing Cornwall reads "parking lot". The resolver
  -- (migration B) reads the household's own locale and falls back to en-GB; it
  -- never reaches for this column at display time.
  default_wording_locale text not null default 'en-GB',
  -- Per-band money ranges, per person, in this market's currency's minor units
  -- (pence, cents). A per-market human judgement, never derived from price data;
  -- a null bands set reads as "don't know", never as free. Free is exactly 0; a
  -- paid band matches the half-open interval [min, max) — min inclusive, max
  -- exclusive, a null max unbounded — so the bands never overlap and every price
  -- lands in exactly one. [{ symbol, min, max, basis: 'judgement'|'prices', set_by, at }].
  cost_bands             jsonb,
  -- Which owned sources apply here, and in what state. Ids are the provenance
  -- vocabulary the rest of the system uses ('site' is the venue's own page, as
  -- in own.js and verification.js). Three states, because a source that does not
  -- exist in a country and one we have not wired up are different facts and must
  -- read differently. [{ id, state: 'here'|'absent'|'notConnected' }].
  sources                jsonb not null default '[]',
  status_set_by          text,
  status_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- The market a subcategory count belongs to. A count means nothing without the
-- country it was taken in, once there is more than one. Not part of the identity
-- yet: every area_counts write keys on (area_slug, category, subcategory), and
-- the census is Britain-only, so no two markets share a slug today. Folding it
-- into the primary key is a prerequisite of the US census (step 6), where two
-- markets' slugs could coincide — not of this migration.
alter table area_counts add column if not exists country_code text not null default 'GB';

-- Money is an amount AND a currency, never a bare number with an implied pound.
-- Host offers carried pence alone; plans and trip costs already carry a currency.
alter table host_offers add column if not exists currency text not null default 'GBP';

-- Opening hours and event times are held against the PLACE's own timezone, not
-- the household's, or every American opening time is wrong for most of the
-- country. Null falls back to the market's default_timezone until a place learns
-- its own.
alter table place_records add column if not exists timezone text;
alter table host_offers  add column if not exists timezone text;

-- Every Google call records the language and region it asked in, beside the
-- session and (from here) the field mask, so the ledger can say what was bought
-- and in whose words. Foundations: populated by the display and census call
-- paths as those are pointed at a market (later steps), not by this migration.
alter table provider_calls add column if not exists language_code text;
alter table provider_calls add column if not exists region_code   text;
alter table provider_calls add column if not exists field_mask    text;

-- The seed. GB soft launch (NOT live — owner, 29 Sep 2026, superseding the
-- design mock), US and Ireland groundwork, and the countries British families
-- holiday in on the same groundwork status so their places display from launch.
-- Spain carries the Canaries and Balearics on this one row (same code, same
-- currency). Cost bands are a starting position: GB, US and IE seeded; Portugal
-- and Greece left null because they need their own euro bands (owner: they do
-- not inherit Ireland's); other eurozone groundwork carry Ireland's as a
-- placeholder; Turkey and the UAE null (no currency match to borrow).
insert into markets (code, name, status, currency, distance_unit, temp_unit, mid_level_name, default_timezone, default_wording_locale, area_code, cost_bands, sources, status_set_by, status_at)
values
  ('GB', 'United Kingdom', 'soft', 'GBP', 'miles', 'C', 'County', 'Europe/London', 'en-GB',
     '{"name":"Postcode","pattern":"^[A-Z]{1,2}[0-9][A-Z0-9]?( ?[0-9][A-Z]{2})?$","searchBy":"postcode"}'::jsonb,
     '[{"symbol":"Free","min":0,"max":0,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"£","min":1,"max":1000,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"££","min":1000,"max":2500,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"£££","min":2500,"max":null,"basis":"judgement","set_by":"seed","at":"2026-09-29"}]'::jsonb,
     '[{"id":"osm","state":"here"},{"id":"wikidata","state":"here"},{"id":"wikipedia","state":"here"},{"id":"site","state":"here"},{"id":"fsa","state":"here"},{"id":"ons","state":"here"},{"id":"historic-england","state":"here"}]'::jsonb,
     'seed', now()),
  ('US', 'United States', 'groundwork', 'USD', 'miles', 'F', 'State', 'America/New_York', 'en-US',
     '{"name":"ZIP code","pattern":"^[0-9]{5}$","searchBy":"zip"}'::jsonb,
     '[{"symbol":"Free","min":0,"max":0,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"$","min":1,"max":1500,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"$$","min":1500,"max":4000,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"$$$","min":4000,"max":null,"basis":"judgement","set_by":"seed","at":"2026-09-29"}]'::jsonb,
     '[{"id":"osm","state":"here"},{"id":"wikidata","state":"here"},{"id":"wikipedia","state":"here"},{"id":"site","state":"here"},{"id":"fsa","state":"absent"},{"id":"ons","state":"absent"},{"id":"nrhp","state":"notConnected"}]'::jsonb,
     'seed', now()),
  ('IE', 'Ireland', 'groundwork', 'EUR', 'km', 'C', 'County', 'Europe/Dublin', 'en-GB',
     '{"name":"Eircode","pattern":"^[A-Z0-9]{3} ?[A-Z0-9]{4}$","searchBy":"eircode"}'::jsonb,
     '[{"symbol":"Free","min":0,"max":0,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"€","min":1,"max":1200,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"€€","min":1200,"max":3000,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"€€€","min":3000,"max":null,"basis":"judgement","set_by":"seed","at":"2026-09-29"}]'::jsonb,
     '[{"id":"osm","state":"here"},{"id":"wikidata","state":"here"},{"id":"wikipedia","state":"here"},{"id":"site","state":"here"},{"id":"fsa","state":"absent"},{"id":"ons","state":"absent"},{"id":"niah","state":"notConnected"}]'::jsonb,
     'seed', now())
on conflict (code) do nothing;

-- The euro-band placeholder for eurozone groundwork markets that may borrow
-- Ireland's (owner). Portugal and Greece are deliberately excluded — they need
-- their own — as are Turkey and the UAE, whose currency does not match.
insert into markets (code, name, status, currency, distance_unit, temp_unit, mid_level_name, default_timezone, default_wording_locale, cost_bands, sources, status_set_by, status_at)
select v.code, v.name, 'groundwork', v.currency, 'km', 'C', 'Region', v.tz, 'en-GB',
       case when v.currency = 'EUR' and v.code not in ('PT', 'GR')
            then '[{"symbol":"Free","min":0,"max":0,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"€","min":1,"max":1200,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"€€","min":1200,"max":3000,"basis":"judgement","set_by":"seed","at":"2026-09-29"},{"symbol":"€€€","min":3000,"max":null,"basis":"judgement","set_by":"seed","at":"2026-09-29"}]'::jsonb
            else null end,
       '[{"id":"osm","state":"here"},{"id":"wikidata","state":"here"},{"id":"wikipedia","state":"here"},{"id":"site","state":"here"},{"id":"fsa","state":"absent"},{"id":"ons","state":"absent"}]'::jsonb,
       'seed', now()
from (values
  ('PT', 'Portugal',    'EUR', 'Europe/Lisbon'),
  ('ES', 'Spain',       'EUR', 'Europe/Madrid'),
  ('FR', 'France',      'EUR', 'Europe/Paris'),
  ('IT', 'Italy',       'EUR', 'Europe/Rome'),
  ('GR', 'Greece',      'EUR', 'Europe/Athens'),
  ('NL', 'Netherlands', 'EUR', 'Europe/Amsterdam'),
  ('TR', 'Turkey',      'TRY', 'Europe/Istanbul'),
  ('HR', 'Croatia',     'EUR', 'Europe/Zagreb'),
  ('CY', 'Cyprus',      'EUR', 'Asia/Nicosia'),
  ('MT', 'Malta',       'EUR', 'Europe/Malta'),
  ('AT', 'Austria',     'EUR', 'Europe/Vienna'),
  ('AE', 'United Arab Emirates', 'AED', 'Asia/Dubai')
) as v(code, name, currency, tz)
on conflict (code) do nothing;
