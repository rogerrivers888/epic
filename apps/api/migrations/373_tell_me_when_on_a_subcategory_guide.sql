-- "Tell me when" on a subcategory guide (Epic Events on the web › Subcategory
-- guides, brief §6a; 3 Oct 2026).
--
-- At the bottom of /en-gb/events/pottery and /en-gb/events/fossil-hunting, until
-- hosts join: an email, a place (city, county or postcode), a radius and a
-- consent tick. Each row is one person asking about one subcategory near one
-- place, and what the back office reads to say where the demand is ("38 people
-- want pottery near Reading") — beside the waitlist, which is a different
-- promise (interest_signups: the app, or hosting on it).
--
-- `place_typed` is what the person wrote. `place_name`, `county`, `region`,
-- `country`, `lat` and `lng` are where it was filed, from Ordnance Survey Open
-- Names or the ONS postcode directory (through postcodes.io; open data, kept
-- for good) and never from Google. A place that could not be looked up keeps
-- the typed words and nulls — a sign-up the counts file under what was typed,
-- never a refusal and never a guess (`place_source` null says which).
--
-- `consent_wording` is the sentence beside the tick, kept with the row (UK
-- PECR), so an export can always say what each address agreed to. The route
-- refuses any other wording (sources/consentWordings.json › guide).
--
-- One row per address, subcategory and place: the same person asking about
-- pottery near Reading and near Bath is two asks; asking twice about one is
-- one, answered exactly like the first so the form never says who is on it,
-- and the second ask's radius and place replace the first's (`updated_at`).
-- "The same place" is `place_key`, read from the words alone so it is the
-- same whether or not the lookup answered (sources/ukPlace.js › placeKeyOf):
-- every way of writing one postcode is `pc:RG1 1AA`, a county `county:Dorset`,
-- and a town `name:` and its words, lowercased, stops and doubled spaces out.
--
-- A county is filed by name with no point (`lat`/`lng` null): a radius from
-- "Dorset" has no one origin, so when the alert is built a county ask matches
-- an event by its county, and the radius applies to a town or a postcode.
--
-- `last_emailed_at` and `unsubscribed_at` are for the alert itself (one email
-- when a matching public event goes live, at most one a week, unsubscribe in
-- one tap), which is not built yet; they are here so it needs no second table.

create table if not exists guide_alerts (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  subcategory      text not null,
  place_typed      text not null,
  place_name       text,
  county           text,
  region           text,
  country          text,
  lat              double precision,
  lng              double precision,
  place_source     text,
  place_key        text not null,
  within_miles     integer not null check (within_miles in (10, 15, 25, 50)),
  locale           text not null,
  consent_wording  text not null,
  page_url         text,
  referrer         text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_term         text,
  utm_content      text,
  gclid            text,
  fbclid           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_emailed_at  timestamptz,
  unsubscribed_at  timestamptz
);

create unique index if not exists guide_alerts_one_ask_idx on guide_alerts (lower(email), subcategory, place_key);
create index if not exists guide_alerts_subcategory_idx on guide_alerts (subcategory, created_at desc);
