-- The pre-launch waitlist: everyone who registered interest on epic.day.
--
-- Website & Registration v2 ("Register your interest", signed off 1 Oct 2026).
-- Every page of the site carries an email form — the homepage's "Remind me",
-- the host page's "Become a host" — and every one of them posts here
-- (routes/interest.js). The back office reads it as Waitlist (WL1): totals, a
-- breakdown by host kind and by campaign, a filtered table, a CSV export and a
-- delete for erasure requests.
--
-- One row per person per list. The homepage and the hosts page are two lists —
-- somebody can want the app and want to host on it, and those are two different
-- promises — so the unique key is the lowercased address *and* the source. A
-- repeat sign-up on the same list is answered exactly like the first
-- (`on conflict do nothing`), so the form cannot be used to learn whether an
-- address is already on it, and no second confirmation is sent.
--
-- The email is stored lowercased by the route; the index is on `lower(email)`
-- as well, so an address that somehow arrived mixed-case still cannot sit on a
-- list twice.
--
-- `consent_wording` is the words the person agreed to (Technical Foundations ›
-- Waitlist data: "the form button text is the consent… store that wording; no
-- other marketing without a separate opt-in", UK PECR). It is what they were
-- shown, kept with the row, so an export can always say what each address
-- signed up *for* — never a flag that could later be read as broader consent.
--
-- The attribution columns (landing page, referrer, utm_*, gclid/fbclid) and the
-- country (from Cloudflare's `CF-IPCountry`, never from a lookup of the address)
-- are what WL1's "By campaign" breakdown is drawn from. Nothing here is rented
-- content; it is what a person handed us, and a delete removes all of it.
--
-- `host_kind` is the host page's picker and is only ever set for `source =
-- 'host'`; on the homepage it is null, which WL1 shows as "Not given".

create table if not exists interest_signups (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  source           text not null check (source in ('home', 'host')),
  host_kind        text check (host_kind in ('one-off', 'activity', 'class', 'homeschool')),
  locale           text not null,
  country          text,
  landing_page     text,
  referrer         text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_term         text,
  utm_content      text,
  gclid            text,
  fbclid           text,
  consent_wording  text not null,
  created_at       timestamptz not null default now(),
  constraint interest_signups_kind_is_hosts_only check (host_kind is null or source = 'host')
);

create unique index if not exists interest_signups_email_source_idx on interest_signups (lower(email), source);
create index if not exists interest_signups_created_idx on interest_signups (created_at desc);
