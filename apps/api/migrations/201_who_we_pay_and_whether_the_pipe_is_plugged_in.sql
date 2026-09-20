-- Who we pay, what we pay them, and whether the pipe is plugged in.
--
-- The commercial register. Two things it is deliberately **not**:
--
--  · It is not `sources/catalogue.js`. That is the data-provenance register —
--    licence, attribution, retention, which vocabulary a source resolves. This
--    is the commercial one: who we pay, at what rate, is the adapter live, when
--    was the rate last checked. The money brief says it in as many words: "Do
--    not merge this with Sources. Link them; keep them apart."
--  · It is not a constant in an adapter. `provider_calls.estimated_cost_usd` is
--    computed today from numbers written into `domain/providerPrices.js`, so the
--    day Google changes a SKU every historical cost silently changes meaning.
--    A rate is a row with an effective date, and pinning it is what makes "what
--    did last quarter cost" stay true.
--
-- **"Infrastructure" is a cost category, not a supplier** (handoff §5). It is
-- broken into the real counterparties — Fly.io, Neon, Cloudflare R2 — each with
-- its own purpose, credential and health, because "infrastructure is up 3%" is
-- not a sentence anybody can act on.
--
-- `counterparty_rates` is insert-only, same discipline as `plan_prices`: a rate
-- change inserts and closes, and `confirmed_at` is stamped separately so that
-- "nobody has checked this in six months" is a fact the screen can say.

create table if not exists counterparties (
  key               text primary key,
  name              text not null,
  -- inbound_cost (we pay them) | outbound_revenue (they pay us) | both
  direction         text not null default 'inbound_cost',
  -- The plain sentence the record opens with: what this integration does.
  purpose           text,
  -- Which surfaces read it — "Trips · Inspire · Places".
  used_by           text,
  -- library | serve | office | research, the same four classes as a call's.
  cost_class        text,
  -- live | degraded | trial | off | approved | evaluating | declined | retired
  status            text not null default 'live',
  -- none | built | wired | enabled
  adapter_state     text not null default 'enabled',
  /**
   * What a unit is, in words, and the masked credential.
   *
   * Masked, and only masked: the secret itself is Doppler's and never the
   * repository's or this database's (CLAUDE.md). What is held here is the last
   * four characters and whatever says which key it is, which is the whole of
   * what the screen needs to answer "is the right key in there".
   */
  unit_name         text,
  credential_masked text,
  credential_expiry text,
  rotated_at        timestamptz,
  allowance_note    text,
  -- The provider name this counterparty's calls are logged under, so the
  -- register joins to the ledger. Null for anything off-ledger, like an invoice.
  provider_key      text,
  notes             text,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists counterparties_provider_idx on counterparties (provider_key);

create table if not exists counterparty_rates (
  id               uuid primary key default gen_random_uuid(),
  counterparty_key text not null references counterparties (key) on delete cascade,
  -- The SKU or unit this rate prices — 'default' where there is only one.
  sku              text not null default 'default',
  -- How the rate reads on the screen: "£0.26 each", "1.5% + 20p", "3.2p".
  -- Held as text as well as a number because a two-part rate is not one number,
  -- and what the owner confirmed is the sentence on the provider's page.
  says             text not null,
  currency         text,
  amount           numeric(12, 6),
  unit             text,
  effective_from   timestamptz not null default now(),
  effective_to     timestamptz,
  source_url       text,
  confirmed_at     timestamptz,
  confirmed_by     text,
  created_at       timestamptz not null default now()
);

create index if not exists counterparty_rates_current_idx
  on counterparty_rates (counterparty_key, sku, effective_from desc)
  where effective_to is null;

-- The twelve, as at 20 September 2026 — the handoff's own register.
insert into counterparties (key, name, direction, purpose, used_by, cost_class, status,
                            adapter_state, unit_name, credential_masked, credential_expiry,
                            allowance_note, provider_key, position)
select v.key, v.name, v.direction, v.purpose, v.used_by, v.cost_class, v.status,
       v.adapter_state, v.unit_name, v.credential, v.expiry, v.allowance, v.provider, v.pos
  from (values
    ('anthropic', 'anthropic', 'inbound_cost',
     'Writes the day plan itself, and reads restaurant menus into structured dishes so a place can be searched on what it serves.',
     'Trips · Inspire · Places', 'serve', 'live', 'enabled', 'plan and menu read',
     'sk-ant-…9f2c · org Epic Ltd', 'No expiry set', 'No cap · spend alert at £1,500', 'anthropic', 0),

    ('google-places', 'google Places (New)', 'inbound_cost',
     'The place catalogue — names, opening hours, photos and ratings for everything a household can search.',
     'Places · Inspire', 'library', 'live', 'enabled', '20 place details',
     'AIza…Kd41 · restricted to server IPs', 'Rotates 4 Dec 26', 'Allowance exhausted · billed on overage', 'google', 1),

    ('google-routes', 'google-routes', 'inbound_cost',
     'Travel times between every pair of places in a day, so the running order is drivable rather than theoretical.',
     'Trips', 'serve', 'live', 'enabled', 'travel matrix',
     'AIza…Kd41 · shared with Places', 'Rotates 4 Dec 26', 'No cap', 'google-routes', 2),

    ('stripe', 'Stripe', 'inbound_cost',
     'Takes subscription and booking payments, and pays hosts out through Connect.',
     'Subscriptions · Bookings · Host payouts', 'serve', 'evaluating', 'none', 'charge or payout',
     null, 'No expiry set', 'No cap', 'stripe', 3),

    ('fly', 'Fly.io', 'inbound_cost',
     'Runs the API and the background workers.',
     'Everything', 'office', 'live', 'enabled', 'app hosting',
     'Org token · CI only', 'No expiry set', 'Autoscale ceiling 4 machines', null, 4),

    ('neon', 'Neon', 'inbound_cost',
     'The database — households, places, trips, events, the ledger.',
     'Everything', 'office', 'live', 'enabled', 'Postgres',
     'Connection string in secrets', 'No expiry set', 'Storage 20GB of 50GB', null, 5),

    ('r2', 'Cloudflare R2', 'inbound_cost',
     'Stores place photos and cached provider responses.',
     'Places · Inspire', 'library', 'live', 'enabled', 'object storage',
     'R2 token · scoped to epic-media', 'No expiry set', 'No cap', null, 6),

    ('tripadvisor', 'tripadvisor', 'inbound_cost',
     'Second-opinion ratings and review counts where Google is thin. The drawer only — never the search path, and never an input to the Epic score.',
     'Places', 'library', 'trial', 'wired', 'content lookup',
     'ta_…c19 · sandbox tier', 'Expires 12 Nov 26', '260 places left this month', 'tripadvisor', 7),

    ('mapbox', 'Mapbox', 'inbound_cost',
     'Draws every map in the app.',
     'Places · Trips', 'serve', 'live', 'enabled', '1,000 map tiles',
     'pk.…8a2 · URL restricted', 'No expiry set', '200k tiles free, then billed', 'mapbox', 8),

    ('openai', 'OpenAI · speech', 'inbound_cost',
     'Turns a spoken "we fancy a pub lunch near the coast" into a search.',
     'Voice intake', 'serve', 'trial', 'wired', 'minute transcribed',
     'sk-…41bd · personal account', 'No expiry set', 'Trial credit £40 remaining', 'openai', 9),

    ('osm', 'OSM · Overpass · Wikidata', 'inbound_cost',
     'Free geography — footpaths, parks, transport stops, postcodes, menu links, and the places Google never returns.',
     'Places · Inspire', 'library', 'live', 'enabled', 'keyless lookup',
     'None · keyless', '—', 'Fair use · self-throttled', 'osm', 10),

    ('stores', 'Apple · Google stores', 'inbound_cost',
     'Commission on subscriptions bought inside the iOS app.',
     'Subscriptions', 'serve', 'evaluating', 'none', 'in-app charge',
     null, 'Agreement renews 1 Jan 27', 'Small-business rate 15%', null, 11)
  ) as v(key, name, direction, purpose, used_by, cost_class, status, adapter_state,
         unit_name, credential, expiry, allowance, provider, pos)
on conflict (key) do nothing;

-- The rates as they stand, with what has actually been confirmed and what has
-- not. A rate nobody has checked carries a null `confirmed_at`, and the screen
-- says "never confirmed" rather than inventing a date.
insert into counterparty_rates (counterparty_key, says, amount, unit, currency, confirmed_at, confirmed_by, source_url)
select v.key, v.says, v.amount, v.unit, v.currency, v.confirmed::timestamptz, v.by, v.url
  from (values
    ('anthropic',     '£0.26 each',   0.26,    'call',   'GBP', '2026-09-18T00:00:00Z', 'the owner', null),
    ('google-places', '3.2p',         0.032,   'call',   'GBP', '2026-09-12T00:00:00Z', 'the owner', 'https://developers.google.com/maps/billing-and-pricing/pricing'),
    ('google-routes', '£1.00',        1.00,    'call',   'GBP', '2026-03-20T00:00:00Z', 'the owner', null),
    ('stripe',        '1.5% + 20p',   null,    'charge', 'GBP', '2026-09-09T00:00:00Z', 'the owner', 'https://stripe.com/gb/pricing'),
    ('fly',           'monthly',      null,    'month',  'GBP', null,                    null,        null),
    ('neon',          'monthly',      null,    'month',  'GBP', null,                    null,        null),
    ('r2',            'monthly',      null,    'month',  'GBP', null,                    null,        null),
    ('tripadvisor',   '1.5p → 0.9p',  0.015,   'place',  'GBP', '2026-08-30T00:00:00Z', 'the owner', null),
    ('mapbox',        '£0.42',        0.42,    '1k tiles','GBP', '2026-08-25T00:00:00Z', 'the owner', null),
    ('openai',        '£0.044',       0.044,   'minute', 'GBP', '2026-06-16T00:00:00Z', 'the owner', null),
    ('osm',           '£0',           0,       'call',   'GBP', null,                    null,        null),
    ('stores',        '15%',          null,    'charge', 'GBP', null,                    null,        null)
  ) as v(key, says, amount, unit, currency, confirmed, by, url)
 where exists (select 1 from counterparties c where c.key = v.key)
   and not exists (
     select 1 from counterparty_rates r
      where r.counterparty_key = v.key and r.sku = 'default' and r.effective_to is null
   );
