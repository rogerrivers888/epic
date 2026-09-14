-- Host skills: five fields where there was one word, and the vocabularies
-- behind them.
--
-- Brief: "Supporting docs/Groups & events NEW/Specialist skills/Epic Host
-- Skills — Claude Code.md", 13 September 2026. An offer carried one word the
-- host chose, matched against nothing and reused by nobody, so a fossil walk on
-- the Jurassic Coast and a talk about the Norman conquest were both filed as
-- "History" and neither could be found by somebody who wanted exactly it.
--
-- There is no skills library for tourism to buy in: occupational taxonomies
-- (ESCO, Lightcast, O*NET) describe paid work and have no word for birdwatching
-- or foraging; marketplace taxonomies are one to three levels of browse filter;
-- subject vocabularies have the coverage but no usable hierarchy. So Epic owns
-- its own, and these tables are it.
--
-- Five fields, five vocabularies, because they are five different kinds of fact
-- and must never share a list:
--
--   * **browse category** — guest-facing and deliberately shallow, fifteen
--     buckets that fit a phone. Depth is carried by tags, never by nesting this.
--   * **format** — what physically happens: a walk, a workshop, a dig, a call.
--     "Walking tour" and "fossils" are not the same kind of fact.
--   * **expertise tags** — the open vocabulary, grown from what hosts type.
--     Capped per offer (six — domain/hostSkills.js).
--   * **facets** — the specialism a host has *instead of* a discipline. This
--     axis exists because of the Local host: the dad who knows every playground
--     has no discipline and no credential, and his expertise is a place plus an
--     activity. One table with a `kind`, decided by the owner 13 Sep 2026.
--   * **credential types** — evidence, not expertise. Blue Badge is a
--     qualification. Confirmation is a back-office act, like trust (079).
--
-- Three rules are in the shape of these tables rather than in the code above
-- them:
--
--   **Wikidata is the identifier space, never the hierarchy.** `source` and
--   `external_id` carry a QID where one is known; `parent_key` is set by a
--   person and only by a person. The class graph has documented cycles and a
--   naive closure from *foraging* pulls in animal behaviour and psychology, so
--   P279 may be shown to an administrator as a suggestion and may never write
--   unattended. A tag with no identifier is legitimate and reads as unmapped.
--
--   **Nothing deactivates by disappearing.** Every vocabulary carries `active`
--   and `seeded`, like `taxonomy_labels` (077). A category no longer offered
--   still renders on the offers already carrying it; deleting one in use is
--   refused by the API with a count of the offers affected.
--
--   **An offer publishes even when Epic has never heard of the words.** The
--   join table holds the host's own wording beside a null `tag_key`, the offer
--   goes live, and a proposal is raised. Unresolved wording is never shown to a
--   guest as though it were canonical. Approving a proposal repoints every row
--   that carried those words; merging keeps the wording as an alias that
--   resolves to the survivor.
--
-- Licence: everything here is Epic's own words. We take a QID and nothing else
-- — no descriptions, no aliases, no statements — so a vandalised Wikidata label
-- can never reach a guest, and CC0 means nothing propagates into Epic's
-- licensing. Where a seed source is CC BY or ODC-By, `vocabulary_sources`
-- carries the attribution wording recorded at import time, because
-- reconstructing it later is painful.
--
-- `host_offers.category` stays exactly where it is. Offers carrying the old
-- word are asked for a category and a format on next edit, with the old word
-- offered as a starting suggestion (domain/hostSkills.js `categoryForPassion`)
-- — deliberately not a data migration, because a guess written into the
-- database is indistinguishable from a host's own answer afterwards.

-- Trigram matching is how a typo and a plural still find the tag. It is not
-- required: `pg_trgm` needs rights an ordinary role may not have on a managed
-- database, so the resolver asks whether it is there and falls back to prefix
-- and substring matching if it is not (repositories/hostSkills.js).
do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm not available; the skills resolver will match on prefix and substring only';
end;
$$;

-- ---------------------------------------------------------------------------
-- browse categories: the guest-facing row
-- ---------------------------------------------------------------------------
create table if not exists host_categories (
  key         text primary key,
  label       text not null,
  blurb       text,                              -- one line, shown under the label in set-up
  icon        text,                              -- a name from components/Icon.tsx, never a glyph
  position    integer not null default 0,
  active      boolean not null default true,
  seeded      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists host_categories_order_idx on host_categories (position, key);

-- ---------------------------------------------------------------------------
-- formats: what physically happens
-- ---------------------------------------------------------------------------
create table if not exists host_formats (
  key         text primary key,
  label       text not null,
  blurb       text,
  icon        text,
  -- Answers §9's "does a format ever gate another field": a venueless format
  -- (an online call) suppresses the venue step rather than the wizard knowing
  -- the word 'online'. Held here so adding a second venueless format is a row.
  venueless   boolean not null default false,
  position    integer not null default 0,
  active      boolean not null default true,
  seeded      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists host_formats_order_idx on host_formats (position, key);

-- ---------------------------------------------------------------------------
-- the open vocabulary: tags and facets
-- ---------------------------------------------------------------------------
-- One table each, the same shape, because they are resolved and stored
-- identically and only differ in what kind of thing they name. A tag is a
-- discipline, a craft or a practice; a facet is an entity — a named coast, a
-- national park, a city quarter, a species group, a monument type, a period.
create table if not exists host_skill_tags (
  key         text primary key,                  -- the normalised key: 'fossil-hunting'
  label       text not null,                     -- Epic's own English, in Epic's voice
  parent_key  text references host_skill_tags(key) on delete set null,  -- set by a person, always
  category_key text references host_categories(key) on delete set null, -- where it reads by default
  source      text,                              -- 'wikidata' | 'esco' | 'getty' | … | null = unmapped
  external_id text,                              -- the QID, where one is known
  note        text,                              -- why this is the sense we mean, for the back office
  seen_count  integer not null default 0,        -- how many offers have carried it
  active      boolean not null default true,
  seeded      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists host_skill_tags_parent_idx on host_skill_tags (parent_key);
create index if not exists host_skill_tags_seen_idx on host_skill_tags (seen_count desc, key);

create table if not exists host_facets (
  key         text primary key,
  kind        text not null,                     -- 'place' | 'subject' | 'species' | 'monument' | 'period'
  label       text not null,
  parent_key  text references host_facets(key) on delete set null,
  -- Where a place facet is, when it has a where. Not a place record: a named
  -- coast is not somewhere a household saves, and tying the two would make a
  -- vocabulary row depend on the atlas having swept the area.
  lat         double precision,
  lng         double precision,
  source      text,
  external_id text,
  note        text,
  seen_count  integer not null default 0,
  active      boolean not null default true,
  seeded      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists host_facets_kind_idx on host_facets (kind, label);

-- Alternative wordings. Merge survivors live here — this is what makes a guest
-- searching "fossil hunting" find offers tagged *palaeontology*, and what stops
-- an already-decided wording raising the same proposal a second time.
create table if not exists host_skill_aliases (
  vocab       text not null,                     -- 'tag' | 'facet'
  norm        text not null,                     -- the normalised wording
  target_key  text not null,                     -- the tag or facet it resolves to
  raw         text,                              -- what somebody actually typed, kept for the screen
  created_at  timestamptz not null default now(),
  primary key (vocab, norm)
);
create index if not exists host_skill_aliases_target_idx on host_skill_aliases (vocab, target_key);

-- ---------------------------------------------------------------------------
-- what an offer carries
-- ---------------------------------------------------------------------------
alter table host_offers add column if not exists category_key text references host_categories(key) on delete set null;
alter table host_offers add column if not exists format_key   text references host_formats(key)    on delete set null;
create index if not exists host_offers_category_idx on host_offers (category_key) where state = 'live';
create index if not exists host_offers_format_idx   on host_offers (format_key)   where state = 'live';

-- Tags and facets on an offer, resolved or not, in the order the host gave
-- them. `target_key` null is the unresolved case: the host's words are kept,
-- the offer publishes, a proposal is raised, and approving it is an update of
-- this column rather than a rewrite of the row.
create table if not exists host_offer_skills (
  offer_id    uuid not null references host_offers(id) on delete cascade,
  vocab       text not null,                     -- 'tag' | 'facet'
  norm        text not null,                     -- the normalised wording, which is what makes a row unique
  raw         text not null,                     -- exactly what the host typed
  target_key  text,                              -- null until it resolves
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (offer_id, vocab, norm)
);
create index if not exists host_offer_skills_target_idx on host_offer_skills (vocab, target_key);
create index if not exists host_offer_skills_norm_idx on host_offer_skills (vocab, norm) where target_key is null;

-- A host's own tags are not stored: they are the union of what their live
-- offers carry (repositories/hostSkills.js `tagsForHost`). Owner, 13 Sep 2026 —
-- one place to keep right, and a profile can still say what somebody knows
-- without letting them claim an expertise no offer evidences.

-- ---------------------------------------------------------------------------
-- the review queue
-- ---------------------------------------------------------------------------
-- Anything unresolved becomes a proposal carrying the host's words, the offer
-- that produced it and a count. Identical wording from another host increments
-- the existing row rather than creating a second — which is why `norm` is
-- unique per vocabulary and why normalisation (domain/hostSkills.js) decides
-- whether this queue is workable at all. A rejected proposal keeps its row, so
-- the same wording never raises a new one.
create table if not exists host_skill_proposals (
  id           uuid primary key default gen_random_uuid(),
  vocab        text not null,                    -- 'tag' | 'facet'
  norm         text not null,
  raw          text not null,                    -- the first host's wording, verbatim
  count        integer not null default 1,       -- how many times it has been typed
  state        text not null default 'open',     -- 'open' | 'approved' | 'merged' | 'rejected'
  target_key   text,                             -- what it became, on approve or merge
  first_offer  uuid references host_offers(id) on delete set null,
  note         text,
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (vocab, norm)
);
create index if not exists host_skill_proposals_open_idx on host_skill_proposals (state, count desc, updated_at desc);

-- ---------------------------------------------------------------------------
-- credentials
-- ---------------------------------------------------------------------------
-- A credential is evidence, and evidence is confirmed by the back office. A
-- type that needs evidence does not display until somebody confirms it, and
-- then displays with the date; one that does not is shown as the host's own
-- claim, labelled as stated rather than confirmed. Neither is a trust rung —
-- `hosts.trust` is still the only ladder, and still not the host's to set.
create table if not exists host_credential_types (
  key                text primary key,
  label              text not null,
  note               text,
  host_types         text[] not null default '{skill,meetups,expert}',  -- 079's three kinds
  evidence_required  boolean not null default true,
  -- Where a credential is a condition of hosting at all rather than a badge:
  -- the categories an offer cannot go live in without it. Empty = a badge, and
  -- **empty is what everything ships as**.
  --
  -- The brief leaves "which credential types gate which categories — does a
  -- food offer need a registration reference before going live?" open, for the
  -- owner (§9). It is left open here too, because a browse category is a bucket
  -- of sixteen and the real condition is narrower than that: a food business
  -- registration is the law for cooking for people who pay, and not for a
  -- wine-tasting walk; a Mountain Leader award is for the hills, and not for a
  -- stroll along a canal. Gating a whole bucket would refuse every honest offer
  -- in it (Codex, 13 Sep 2026).
  --
  -- So the mechanism is here and switched off. Setting it is one edit per type
  -- in Back office › Skills › Credentials, and the moment one is set the
  -- publish gate enforces it — where a category is gated by more than one, any
  -- one of them clears it.
  gates_categories   text[] not null default '{}',
  -- Null = it does not expire. A number of months = the confirmation goes stale
  -- and the back office is asked again.
  expires_months     integer,
  position           integer not null default 0,
  active             boolean not null default true,
  seeded             boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists host_credentials (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references hosts(id) on delete cascade,
  type_key      text not null references host_credential_types(key) on delete cascade,
  -- What the host said: a membership or licence number, a year, a body.
  reference     text,
  detail        text,
  -- 'stated'    the host's own claim, no evidence asked for — shows, labelled
  -- 'pending'   evidence required, waiting on the back office — does not show
  -- 'confirmed' somebody checked — shows with the date
  -- 'rejected'  it does not show, the host is told, and the record stays
  state         text not null default 'pending',
  confirmed_at  timestamptz,
  expires_on    date,
  decided_by    text,
  decided_note  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (host_id, type_key)
);
create index if not exists host_credentials_state_idx on host_credentials (state, updated_at desc);

-- ---------------------------------------------------------------------------
-- the source register
-- ---------------------------------------------------------------------------
-- Where each vocabulary came from, what it costs us in obligations, and when it
-- was last looked at. Every canonical row's `source` column points at a key
-- here. None of these is a runtime dependency: no external call sits in a
-- host's typing path (brief §5), so the only outward calls are a bulk refresh
-- and an administrator asking for candidate identifiers on the review screen,
-- both ledgered in `provider_calls` like everything else.
create table if not exists vocabulary_sources (
  key              text primary key,
  label            text not null,
  what_we_take     text not null,
  licence          text not null,
  -- The exact wording the licence requires, recorded at import time.
  attribution      text,
  -- Whether the data itself may be kept, as opposed to identifiers pointing at
  -- it. We take QIDs and write our own labels, so this is false far more often
  -- than a reader expects.
  may_retain       boolean not null default false,
  resolves         text,                          -- the endpoint or file, in words
  url              text,
  note             text,
  last_refreshed   timestamptz,
  active           boolean not null default true,
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- who may work on this
-- ---------------------------------------------------------------------------
-- Reading a vocabulary and changing it are separate capabilities. That rule is
-- explicit in 034 and PV's own warning is the one worth repeating: a capability
-- that "nearly fits" is the trap, so this area declares its own pair rather
-- than borrowing `manage_library`.
insert into role_capabilities (role_id, capability)
select r.id, c.capability from roles r
  join (values
    ('admin', 'view_skills'), ('admin', 'manage_skills'),
    ('support', 'view_skills'),
    ('analyst', 'view_skills')
  ) as c(role_key, capability) on c.role_key = r.key
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- what Epic ships with
-- ---------------------------------------------------------------------------
-- The sixteen browse categories, in the order and the words the design fixes
-- (`Specialist skills UI` README §9, artboard S17). Sixteen scroll comfortably
-- at 390px and the row is chosen once; it must not grow with the vocabulary,
-- because a filter row that grows is a filter row that stops working in month
-- three. Depth lives in tags.
insert into host_categories (key, label, blurb, icon, position, seeded) values
  ('geology-fossils', 'Geology and fossils',  'Rocks, fossils, caves and the ground underneath',     'attraction',  0,  true),
  ('food-drink',      'Food and drink',       'Cooking, baking, brewing, tasting and the table',     'restaurant',  1,  true),
  ('crafts',          'Crafts and making',    'Hands, tools and materials',                          'owned',       2,  true),
  ('nature',          'Nature and wildlife',  'Birds, plants, fungi and the things that live here',  'zoo',         3,  true),
  ('heritage',        'History and heritage', 'What happened here, and what is left of it',          'castle',      4,  true),
  ('on-the-water',    'On the water',         'Sea, river, lake and everything afloat',              'boat',        5,  true),
  ('walking',         'Walking and hills',    'On foot, from a stroll to a summit',                  'walk',        6,  true),
  ('art-photography', 'Art and photography',  'Drawing, painting, printing and the camera',          'gallery',     7,  true),
  ('music',           'Music',                'Playing it, singing it and listening properly',       'liveMusic',   8,  true),
  ('sport-games',     'Sport and games',      'Moving, competing and playing',                       'sport',       9,  true),
  ('families',        'Families',             'Things that work with children in tow',               'family',      10, true),
  ('neighbourhoods',  'Neighbourhoods',       'One area, known properly',                            'place',       11, true),
  ('growing',         'Gardens and growing',  'Soil, seeds, plots and glasshouses',                  'park',        12, true),
  ('wellbeing',       'Wellbeing',            'Breathing, moving, resting and the cold water',       'family',      13, true),
  ('night-out',       'Night out',            'The evening, done by somebody who knows it',          'pub',         14, true),
  ('markets-shops',   'Markets and shops',    'Stalls, makers, records and the good bakery',         'market',      15, true)
on conflict (key) do nothing;

-- The formats: what physically happens, kept apart from what it is about.
-- "Walking tour" and "fossils" are different kinds of fact.
insert into host_formats (key, label, blurb, icon, venueless, position, seeded) values
  ('walk',        'A walk',           'On foot, together, at a talking pace',            'walk',       false, 0,  true),
  ('tour',        'A tour',           'Somewhere, with somebody who knows it',           'directions', false, 1,  true),
  ('workshop',    'A workshop',       'Everyone makes something',                        'owned',      false, 2,  true),
  ('class',       'A class',          'You are taught, and you practise',                'pitch',      false, 3,  true),
  ('session',     'A session',        'One to one, or very nearly',                      'handshake',  false, 4,  true),
  ('dig',         'A dig or a hunt',  'Looking for something, in the field',             'search',     false, 5,  true),
  ('tasting',     'A tasting',        'Sat down, trying things, being told about them',  'restaurant', false, 6,  true),
  ('talk',        'A talk',           'Somebody explains it, then questions',            'pitch',      false, 7,  true),
  ('demo',        'A demonstration',  'You watch it done properly, up close',            'preview',    false, 8,  true),
  ('day-out',     'A day out',        'A whole day, with a plan',                        'trips',      false, 9,  true),
  ('meetup',      'A meet-up',        'People who like the same thing, in one place',    'guest',      false, 10, true),
  ('performance', 'A performance',    'It is played, sung or acted at you',              'theatre',    false, 11, true),
  ('online-call', 'An online call',   'A video call, wherever either of you is',         'online',     true,  12, true)
on conflict (key) do nothing;

-- The launch tag vocabulary: the disciplines first, because a child's parent
-- has to exist before it can point at one. Every one of these is Epic's own
-- English — the labels are written here, not imported — and every one starts
-- **unmapped**. An identifier is attached in the back office, one candidate at
-- a time, with the candidate's Wikidata description shown so an administrator
-- can tell *foraging* the human activity from *foraging* the animal behaviour
-- and *fossil collecting* the activity from *fossil collector* the occupation.
-- Guessing a QID here would be indistinguishable afterwards from one somebody
-- checked, which is the one thing this table cannot afford.
insert into host_skill_tags (key, label, category_key, seeded) values
  ('palaeontology',   'Palaeontology',     'geology-fossils', true),
  ('geology',         'Geology',           'geology-fossils', true),
  ('caving',          'Caving',            'geology-fossils', true),
  ('mineralogy',      'Mineralogy',        'geology-fossils', true),
  ('baking',          'Baking',            'food-drink',      true),
  ('cooking',         'Cooking',           'food-drink',      true),
  ('brewing',         'Brewing',           'food-drink',      true),
  ('cheesemaking',    'Cheesemaking',      'food-drink',      true),
  ('butchery',        'Butchery',          'food-drink',      true),
  ('wine',            'Wine',              'food-drink',      true),
  ('coffee',          'Coffee',            'food-drink',      true),
  ('preserving',      'Preserving',        'food-drink',      true),
  ('pottery',         'Pottery',           'crafts',          true),
  ('woodwork',        'Woodwork',          'crafts',          true),
  ('metalwork',       'Metalwork',         'crafts',          true),
  ('textiles',        'Textiles',          'crafts',          true),
  ('glasswork',       'Glasswork',         'crafts',          true),
  ('leatherwork',     'Leatherwork',       'crafts',          true),
  ('jewellery',       'Jewellery making',  'crafts',          true),
  ('bookbinding',     'Bookbinding',       'crafts',          true),
  ('basketry',        'Basketry',          'crafts',          true),
  ('stonework',       'Stonework',         'crafts',          true),
  ('bushcraft',       'Bushcraft',         'crafts',          true),
  ('candlemaking',    'Candle making',     'crafts',          true),
  ('soapmaking',      'Soap making',       'crafts',          true),
  ('modelmaking',     'Model making',      'crafts',          true),
  ('birdwatching',    'Birdwatching',      'nature',          true),
  ('botany',          'Botany',            'nature',          true),
  ('mycology',        'Fungi',             'nature',          true),
  ('foraging',        'Foraging',          'nature',          true),
  ('entomology',      'Insects',           'nature',          true),
  ('beekeeping',      'Beekeeping',        'nature',          true),
  ('marine-life',     'Marine life',       'nature',          true),
  ('archaeology',     'Archaeology',       'heritage',        true),
  ('local-history',   'Local history',     'heritage',        true),
  ('industrial-heritage', 'Industrial heritage', 'heritage',  true),
  ('architecture',    'Architecture',      'heritage',        true),
  ('genealogy',       'Family history',    'heritage',        true),
  ('military-history','Military history',  'heritage',        true),
  ('sailing',         'Sailing',           'on-the-water',    true),
  ('paddling',        'Paddling',          'on-the-water',    true),
  ('swimming-outdoors','Outdoor swimming', 'on-the-water',    true),
  ('surfing',         'Surfing',           'on-the-water',    true),
  ('angling',         'Angling',           'on-the-water',    true),
  ('rowing',          'Rowing',            'on-the-water',    true),
  ('hillwalking',     'Hillwalking',       'walking',         true),
  ('navigation',      'Navigation',        'walking',         true),
  ('scrambling',      'Scrambling',        'walking',         true),
  ('long-distance-paths', 'Long-distance paths', 'walking',   true),
  ('drawing',         'Drawing',           'art-photography', true),
  ('painting',        'Painting',          'art-photography', true),
  ('printmaking',     'Printmaking',       'art-photography', true),
  ('photography',     'Photography',       'art-photography', true),
  ('film-making',     'Film making',       'art-photography', true),
  ('sculpture',       'Sculpture',         'art-photography', true),
  ('calligraphy',     'Calligraphy',       'art-photography', true),
  ('singing',         'Singing',           'music',           true),
  ('guitar',          'Guitar',            'music',           true),
  ('piano',           'Piano',             'music',           true),
  ('drumming',        'Drumming',          'music',           true),
  ('folk-music',      'Folk music',        'music',           true),
  ('djing',           'DJing',             'music',           true),
  ('instrument-making','Instrument making','music',           true),
  ('running',         'Running',           'sport-games',     true),
  ('cycling',         'Cycling',           'sport-games',     true),
  ('climbing',        'Climbing',          'sport-games',     true),
  ('bouldering',      'Bouldering',        'sport-games',     true),
  ('skateboarding',   'Skateboarding',     'sport-games',     true),
  ('horse-riding',    'Horse riding',      'sport-games',     true),
  ('martial-arts',    'Martial arts',      'sport-games',     true),
  ('board-games',     'Board games',       'sport-games',     true),
  ('chess',           'Chess',             'sport-games',     true),
  ('playgrounds',     'Playgrounds',       'families',        true),
  ('soft-play',       'Soft play',         'families',        true),
  ('rockpooling',     'Rockpooling',       'families',        true),
  ('den-building',    'Den building',      'families',        true),
  ('family-cycling',  'Cycling with children', 'families',    true),
  ('street-art',      'Street art',        'neighbourhoods',  true),
  ('pub-history',     'Pubs and their history', 'neighbourhoods', true),
  ('canals',          'Canals',            'neighbourhoods',  true),
  ('markets',         'Markets',           'markets-shops',   true),
  ('record-shops',    'Record shops',      'markets-shops',   true),
  ('bookshops',       'Bookshops',         'markets-shops',   true),
  ('vintage',         'Vintage and second-hand', 'markets-shops', true),
  ('gardening',       'Gardening',         'growing',         true),
  ('vegetable-growing','Growing vegetables','growing',        true),
  ('orchards',        'Orchards',          'growing',         true),
  ('houseplants',     'Houseplants',       'growing',         true),
  ('floristry',       'Floristry',         'growing',         true),
  ('yoga',            'Yoga',              'wellbeing',       true),
  ('breathwork',      'Breathwork',        'wellbeing',       true),
  ('cold-water',      'Cold water',        'wellbeing',       true),
  ('meditation',      'Meditation',        'wellbeing',       true),
  ('herbalism',       'Herbalism',         'wellbeing',       true),
  ('pubs',            'Pubs',              'night-out',       true),
  ('cocktails',       'Cocktails',         'night-out',       true),
  ('live-music-nights','Live music nights','night-out',       true),
  ('comedy',          'Comedy',            'night-out',       true),
  ('stargazing',      'Stargazing',        'geology-fossils', true)
on conflict (key) do nothing;

-- …then the children, each pointing at a parent set by a person. Nothing here
-- was walked out of `subclass of`: the Wikidata class graph has documented
-- cycles, and a naive closure from *foraging* pulls in animal behaviour and
-- psychology. P279 is a suggestion on a review screen and never a writer.
insert into host_skill_tags (key, label, parent_key, category_key, seeded) values
  ('fossil-hunting',    'Fossil hunting',       'palaeontology',   'geology-fossils', true),
  ('ammonites',         'Ammonites',            'palaeontology',   'geology-fossils', true),
  ('fossil-preparation','Fossil preparation',   'palaeontology',   'geology-fossils', true),
  ('fossil-casting',    'Fossil casting',       'palaeontology',   'geology-fossils', true),
  ('dinosaur-tracks',   'Dinosaur footprints',  'palaeontology',   'geology-fossils', true),
  ('rock-identification','Identifying rocks',   'geology',         'geology-fossils', true),
  ('gold-panning',      'Gold panning',         'geology',         'geology-fossils', true),
  ('fluorescent-minerals','Fluorescent minerals','mineralogy',     'geology-fossils', true),
  ('sourdough',         'Sourdough',            'baking',          'food-drink',      true),
  ('bread',             'Bread',                'baking',          'food-drink',      true),
  ('pastry',            'Pastry',               'baking',          'food-drink',      true),
  ('cake-decorating',   'Cake decorating',      'baking',          'food-drink',      true),
  ('pasta-making',      'Pasta making',         'cooking',         'food-drink',      true),
  ('curry',             'Curry',                'cooking',         'food-drink',      true),
  ('fermenting',        'Fermenting',           'preserving',      'food-drink',      true),
  ('smoking-curing',    'Smoking and curing',   'preserving',      'food-drink',      true),
  ('home-brewing',      'Home brewing',         'brewing',         'food-drink',      true),
  ('cider',             'Cider',                'brewing',         'food-drink',      true),
  ('wine-tasting',      'Wine tasting',         'wine',            'food-drink',      true),
  ('coffee-roasting',   'Coffee roasting',      'coffee',          'food-drink',      true),
  ('latte-art',         'Latte art',            'coffee',          'food-drink',      true),
  ('wheel-throwing',    'Throwing on the wheel','pottery',         'crafts',          true),
  ('hand-building',     'Hand-building',        'pottery',         'crafts',          true),
  ('raku',              'Raku',                 'pottery',         'crafts',          true),
  ('glazing',           'Glazing',              'pottery',         'crafts',          true),
  ('green-woodworking', 'Green woodworking',    'woodwork',        'crafts',          true),
  ('wood-turning',      'Wood turning',         'woodwork',        'crafts',          true),
  ('wood-carving',      'Wood carving',         'woodwork',        'crafts',          true),
  ('chair-making',      'Chair making',         'woodwork',        'crafts',          true),
  ('spoon-carving',     'Spoon carving',        'woodwork',        'crafts',          true),
  ('furniture-making',  'Furniture making',     'woodwork',        'crafts',          true),
  ('timber-framing',    'Timber framing',       'woodwork',        'crafts',          true),
  ('blacksmithing',     'Blacksmithing',        'metalwork',       'crafts',          true),
  ('bladesmithing',     'Bladesmithing',        'metalwork',       'crafts',          true),
  ('silversmithing',    'Silversmithing',       'metalwork',       'crafts',          true),
  ('farriery',          'Farriery',             'metalwork',       'crafts',          true),
  ('enamelling',        'Enamelling',           'metalwork',       'crafts',          true),
  ('weaving',           'Weaving',              'textiles',        'crafts',          true),
  ('spinning',          'Spinning',             'textiles',        'crafts',          true),
  ('natural-dyeing',    'Natural dyeing',       'textiles',        'crafts',          true),
  ('knitting',          'Knitting',             'textiles',        'crafts',          true),
  ('crochet',           'Crochet',              'textiles',        'crafts',          true),
  ('embroidery',        'Embroidery',           'textiles',        'crafts',          true),
  ('quilting',          'Quilting',             'textiles',        'crafts',          true),
  ('feltmaking',        'Feltmaking',           'textiles',        'crafts',          true),
  ('dressmaking',       'Dressmaking',          'textiles',        'crafts',          true),
  ('tailoring',         'Tailoring',            'textiles',        'crafts',          true),
  ('millinery',         'Millinery',            'textiles',        'crafts',          true),
  ('upholstery',        'Upholstery',           'textiles',        'crafts',          true),
  ('rag-rug-making',    'Rag rug making',       'textiles',        'crafts',          true),
  ('stained-glass',     'Stained glass',        'glasswork',       'crafts',          true),
  ('glassblowing',      'Glassblowing',         'glasswork',       'crafts',          true),
  ('glass-engraving',   'Glass engraving',      'glasswork',       'crafts',          true),
  ('mosaic',            'Mosaic',               'glasswork',       'crafts',          true),
  ('saddlery',          'Saddlery',             'leatherwork',     'crafts',          true),
  ('shoemaking',        'Shoemaking',           'leatherwork',     'crafts',          true),
  ('willow-weaving',    'Willow weaving',       'basketry',        'crafts',          true),
  ('trug-making',       'Trug making',          'basketry',        'crafts',          true),
  ('dry-stone-walling', 'Dry stone walling',    'stonework',       'crafts',          true),
  ('stone-carving',     'Stone carving',        'stonework',       'crafts',          true),
  ('letter-cutting',    'Letter cutting',       'stonework',       'crafts',          true),
  ('flintknapping',     'Flintknapping',        'stonework',       'crafts',          true),
  ('thatching',         'Thatching',            null,              'crafts',          true),
  ('hedgelaying',       'Hedgelaying',          'bushcraft',       'crafts',          true),
  ('charcoal-burning',  'Charcoal burning',     'bushcraft',       'crafts',          true),
  ('fire-lighting',     'Fire lighting',        'bushcraft',       'crafts',          true),
  ('coppicing',         'Coppicing',            'bushcraft',       'crafts',          true),
  ('wild-camping',      'Wild camping',         'bushcraft',       'crafts',          true),
  ('signwriting',       'Signwriting',          null,              'crafts',          true),
  ('bell-ringing',      'Bell ringing',         null,              'heritage',        true),
  ('seabirds',          'Seabirds',             'birdwatching',    'nature',          true),
  ('birds-of-prey',     'Birds of prey',        'birdwatching',    'nature',          true),
  ('dawn-chorus',       'The dawn chorus',      'birdwatching',    'nature',          true),
  ('falconry',          'Falconry',             'birdwatching',    'nature',          true),
  ('orchids',           'Orchids',              'botany',          'nature',          true),
  ('wildflowers',       'Wildflowers',          'botany',          'nature',          true),
  ('trees',             'Trees',                'botany',          'nature',          true),
  ('lichens',           'Lichens',              'botany',          'nature',          true),
  ('mushroom-hunting',  'Mushroom hunting',     'mycology',        'nature',          true),
  ('seaweed',           'Seaweed',              'foraging',        'nature',          true),
  ('coastal-foraging',  'Coastal foraging',     'foraging',        'nature',          true),
  ('hedgerow-foraging', 'Hedgerow foraging',    'foraging',        'nature',          true),
  ('moths',             'Moths',                'entomology',      'nature',          true),
  ('butterflies',       'Butterflies',          'entomology',      'nature',          true),
  ('bats',              'Bats',                 null,              'nature',          true),
  ('deer',              'Deer',                 null,              'nature',          true),
  ('seals',             'Seals',                'marine-life',     'nature',          true),
  ('roman-britain',     'Roman Britain',        'archaeology',     'heritage',        true),
  ('prehistory',        'Prehistory',           'archaeology',     'heritage',        true),
  ('medieval-history',  'The Middle Ages',      'local-history',   'heritage',        true),
  ('victorian-history', 'The Victorians',       'local-history',   'heritage',        true),
  ('mills',             'Mills',                'industrial-heritage', 'heritage',    true),
  ('mining-heritage',   'Mining',               'industrial-heritage', 'heritage',    true),
  ('railway-heritage',  'Railways',             'industrial-heritage', 'heritage',    true),
  ('churches',          'Churches',             'architecture',    'heritage',        true),
  ('castles',           'Castles',              'architecture',    'heritage',        true),
  ('brutalism',         'Brutalism',            'architecture',    'heritage',        true),
  ('dinghy-sailing',    'Dinghy sailing',       'sailing',         'on-the-water',    true),
  ('kayaking',          'Kayaking',             'paddling',        'on-the-water',    true),
  ('canoeing',          'Canoeing',             'paddling',        'on-the-water',    true),
  ('paddleboarding',    'Paddleboarding',       'paddling',        'on-the-water',    true),
  ('sea-swimming',      'Sea swimming',         'swimming-outdoors','on-the-water',   true),
  ('wild-swimming',     'Wild swimming',        'swimming-outdoors','on-the-water',   true),
  ('fly-fishing',       'Fly fishing',          'angling',         'on-the-water',    true),
  ('sea-fishing',       'Sea fishing',          'angling',         'on-the-water',    true),
  ('coasteering',       'Coasteering',          null,              'on-the-water',    true),
  ('map-and-compass',   'Map and compass',      'navigation',      'walking',         true),
  ('wainwrights',       'The Wainwrights',      'hillwalking',     'walking',         true),
  ('night-walking',     'Walking at night',     'hillwalking',     'walking',         true),
  ('watercolour',       'Watercolour',          'painting',        'art-photography', true),
  ('oil-painting',      'Oil painting',         'painting',        'art-photography', true),
  ('life-drawing',      'Life drawing',         'drawing',         'art-photography', true),
  ('urban-sketching',   'Urban sketching',      'drawing',         'art-photography', true),
  ('lino-printing',     'Lino printing',        'printmaking',     'art-photography', true),
  ('screen-printing',   'Screen printing',      'printmaking',     'art-photography', true),
  ('letterpress',       'Letterpress',          'printmaking',     'art-photography', true),
  ('darkroom',          'Darkroom printing',    'photography',     'art-photography', true),
  ('landscape-photography','Landscape photography','photography',  'art-photography', true),
  ('wildlife-photography','Wildlife photography','photography',    'art-photography', true),
  ('street-photography','Street photography',   'photography',     'art-photography', true),
  ('choral-singing',    'Choral singing',       'singing',         'music',           true),
  ('sea-shanties',      'Sea shanties',         'folk-music',      'music',           true),
  ('fiddle',            'Fiddle',               'folk-music',      'music',           true),
  ('morris-dancing',    'Morris dancing',       'folk-music',      'music',           true),
  ('vinyl',             'Vinyl',                'record-shops',    'markets-shops',   true),
  ('trail-running',     'Trail running',        'running',         'sport-games',     true),
  ('fell-running',      'Fell running',         'running',         'sport-games',     true),
  ('mountain-biking',   'Mountain biking',      'cycling',         'sport-games',     true),
  ('bike-maintenance',  'Bike maintenance',     'cycling',         'sport-games',     true),
  ('sport-climbing',    'Sport climbing',       'climbing',        'sport-games',     true),
  ('skate-parks',       'Skate parks',          'skateboarding',   'families',        true),
  ('bushcraft-for-kids','Bushcraft with children','bushcraft',     'families',        true),
  ('beach-days',        'Beach days',           null,              'families',        true),
  ('farm-visits',       'Farms',                null,              'families',        true),
  ('vegetable-plots',   'Allotments',           'vegetable-growing','growing',        true),
  ('seed-saving',       'Seed saving',          'vegetable-growing','growing',        true),
  ('pruning',           'Pruning',              'gardening',       'growing',          true),
  ('wildlife-gardening','Wildlife gardening',   'gardening',       'growing',          true),
  ('cider-orchards',    'Cider orchards',       'orchards',        'growing',          true),
  ('sea-swimming-wellbeing','Cold water swimming','cold-water',    'wellbeing',        true),
  ('sauna',             'Sauna',                'cold-water',      'wellbeing',        true),
  ('forest-bathing',    'Forest bathing',       'meditation',      'wellbeing',        true),
  ('real-ale',          'Real ale',             'pubs',            'night-out',        true),
  ('whisky',            'Whisky',               'cocktails',       'night-out',        true),
  ('astrophotography',  'Astrophotography',     'stargazing',      'geology-fossils',  true)
on conflict (key) do nothing;

-- The wordings a host is likely to type that are the same thing said
-- differently. Everything here resolves to a canonical tag, which is also what
-- makes a guest searching "fossils" find offers tagged *Fossil hunting*. These
-- are the ones known in advance; the rest arrive through the review queue as
-- merges.
insert into host_skill_aliases (vocab, norm, target_key, raw) values
  ('tag', 'fossil',            'fossil-hunting',  'Fossils'),
  ('tag', 'fossil hunt',       'fossil-hunting',  'Fossil hunting'),
  ('tag', 'fossil collecting', 'fossil-hunting',  'Fossil collecting'),
  ('tag', 'fossil collector',  'fossil-hunting',  'Fossil collector'),
  ('tag', 'ammonite',          'ammonites',       'Ammonites'),
  ('tag', 'dinosaur',          'dinosaur-tracks', 'Dinosaurs'),
  ('tag', 'mushroom',          'mushroom-hunting','Mushrooms'),
  ('tag', 'fungus',            'mycology',        'Fungi'),
  ('tag', 'mushroom foraging', 'mushroom-hunting','Mushroom foraging'),
  ('tag', 'wild food',         'foraging',        'Wild food'),
  ('tag', 'bread making',      'bread',           'Bread making'),
  ('tag', 'breadmaking',       'bread',           'Breadmaking'),
  ('tag', 'sourdough bread',   'sourdough',       'Sourdough bread'),
  ('tag', 'pot',               'pottery',         'Pots'),
  ('tag', 'ceramic',           'pottery',         'Ceramics'),
  ('tag', 'throwing',          'wheel-throwing',  'Throwing'),
  ('tag', 'smithing',          'blacksmithing',   'Smithing'),
  ('tag', 'forge',             'blacksmithing',   'Forging'),
  ('tag', 'knife making',      'bladesmithing',   'Knife making'),
  ('tag', 'bird watching',     'birdwatching',    'Bird watching'),
  ('tag', 'birding',           'birdwatching',    'Birding'),
  ('tag', 'rock pooling',      'rockpooling',     'Rock pooling'),
  ('tag', 'rockpool',          'rockpooling',     'Rockpools'),
  ('tag', 'cold water swimming','cold-water',     'Cold water swimming'),
  ('tag', 'wild swim',         'wild-swimming',   'Wild swimming'),
  ('tag', 'open water swimming','swimming-outdoors','Open water swimming'),
  ('tag', 'sup',               'paddleboarding',  'SUP'),
  ('tag', 'stand up paddleboarding','paddleboarding','Stand-up paddleboarding'),
  ('tag', 'hiking',            'hillwalking',     'Hiking'),
  ('tag', 'rambling',          'hillwalking',     'Rambling'),
  ('tag', 'record shop',       'record-shops',    'Record shops'),
  ('tag', 'record',            'vinyl',           'Records'),
  ('tag', 'play park',         'playgrounds',     'Play parks'),
  ('tag', 'playpark',          'playgrounds',     'Play parks'),
  ('tag', 'allotment',         'vegetable-plots', 'Allotments'),
  ('tag', 'veg growing',       'vegetable-growing','Veg growing'),
  ('tag', 'stargaze',          'stargazing',      'Stargazing'),
  ('tag', 'astronomy',         'stargazing',      'Astronomy'),
  ('tag', 'photo',             'photography',     'Photos'),
  ('tag', 'sewing',            'dressmaking',     'Sewing'),
  ('tag', 'needlework',        'embroidery',      'Needlework'),
  ('tag', 'wool',              'spinning',        'Wool'),
  ('tag', 'mtb',               'mountain-biking', 'MTB'),
  ('tag', 'roman',             'roman-britain',   'Romans')
on conflict (vocab, norm) do nothing;

-- Facets: the specialism a host has *instead of* a discipline. A starter set
-- only — a named coast, a national park, a period, a monument type, a species
-- group — because the useful ones are the ones hosts actually name, and the
-- nature and heritage sources (BGS, NHM, FISH) load into this table rather than
-- being transcribed by hand.
insert into host_facets (key, kind, label, lat, lng, seeded) values
  ('jurassic-coast',    'place', 'Jurassic Coast',      50.72, -2.93, true),
  ('peak-district',     'place', 'Peak District',       53.35, -1.81, true),
  ('lake-district',     'place', 'Lake District',       54.47, -3.09, true),
  ('snowdonia',         'place', 'Eryri (Snowdonia)',   52.99, -3.92, true),
  ('cairngorms',        'place', 'Cairngorms',          57.08, -3.67, true),
  ('north-york-moors',  'place', 'North York Moors',    54.37, -0.90, true),
  ('south-downs',       'place', 'South Downs',         50.92, -0.50, true),
  ('dartmoor',          'place', 'Dartmoor',            50.57, -3.92, true),
  ('exmoor',            'place', 'Exmoor',              51.15, -3.65, true),
  ('yorkshire-dales',   'place', 'Yorkshire Dales',     54.24, -2.20, true),
  ('norfolk-broads',    'place', 'The Broads',          52.62,  1.51, true),
  ('pembrokeshire-coast','place','Pembrokeshire Coast', 51.88, -5.10, true),
  ('northumberland-coast','place','Northumberland Coast',55.55,-1.63, true),
  ('cornish-coast',     'place', 'The Cornish coast',   50.30, -5.05, true),
  ('gower',             'place', 'Gower',               51.59, -4.17, true),
  ('isle-of-skye',      'place', 'Skye',                57.30, -6.25, true),
  ('hadrians-wall',     'place', 'Hadrian''s Wall',     55.02, -2.31, true),
  ('thames-path',       'place', 'The Thames Path',     51.50, -0.80, true),
  ('windsor-great-park','place', 'Windsor Great Park',  51.43, -0.60, true)
on conflict (key) do nothing;

insert into host_facets (key, kind, label, seeded) values
  ('ammonite-species',  'species',  'Ammonites',          true),
  ('orchid-species',    'species',  'Orchids',            true),
  ('seabird-species',   'species',  'Seabirds',           true),
  ('fungi-species',     'species',  'Fungi',              true),
  ('butterfly-species', 'species',  'Butterflies',        true),
  ('long-barrow',       'monument', 'Long barrows',       true),
  ('stone-circle',      'monument', 'Stone circles',      true),
  ('motte-and-bailey',  'monument', 'Motte-and-bailey castles', true),
  ('watermill',         'monument', 'Watermills',         true),
  ('lime-kiln',         'monument', 'Lime kilns',         true),
  ('parish-church',     'monument', 'Parish churches',    true),
  ('jurassic',          'period',   'The Jurassic',       true),
  ('cretaceous',        'period',   'The Cretaceous',     true),
  ('neolithic',         'period',   'The Neolithic',      true),
  ('roman-period',      'period',   'Roman Britain',      true),
  ('medieval-period',   'period',   'The Middle Ages',    true),
  ('victorian-period',  'period',   'The Victorians',     true)
on conflict (key) do nothing;

-- Credential types. Evidence, never expertise, and never a rung on the trust
-- ladder — `hosts.trust` is the only ladder and it is not the host's to set.
-- Every one of them ships as a badge: `gates_categories` is empty, because a
-- browse category is a bucket of sixteen and the real condition is narrower
-- than that. Which of these is a condition of hosting, and of what, is §9's
-- open question and the owner's to answer — the mechanism is here, switched
-- off, and one edit per type turns it on.
insert into host_credential_types (key, label, note, host_types, evidence_required, gates_categories, expires_months, position, seeded) values
  ('blue-badge',        'Blue Badge guide',            'The national qualification. We check the badge number.',       '{expert}',                 true,  '{}',            36,   0,  true),
  ('regional-badge',    'Green or regional badge',     'A regional guiding qualification.',                            '{expert}',                 true,  '{}',            36,   1,  true),
  ('mountain-leader',   'Mountain Leader',             'Mountain Training''s award. We check the candidate number.',    '{skill,expert}',           true,  '{}',     null, 2,  true),
  ('paddlesport-coach', 'Paddlesport coach',           'British Canoeing coaching award.',                             '{skill,expert}',           true,  '{}',36,   3,  true),
  ('open-water-coach',  'Open water swim coach',       'A recognised open-water coaching award.',                      '{skill,expert}',           true,  '{}',36,   4,  true),
  ('first-aid',         'First aid',                   'A current certificate. Outdoor first aid where it applies.',   '{skill,meetups,expert}',   true,  '{}',            36,   5,  true),
  ('food-hygiene',      'Food hygiene',                'Level 2 or above.',                                            '{skill,expert}',           true,  '{}',            36,   6,  true),
  ('food-registration', 'Food business registration',  'Registered with the local authority. Required before cooking for people who pay.', '{skill,meetups,expert}', true, '{}', null, 7, true),
  ('public-liability',  'Public liability insurance',  'The certificate, in date.',                                    '{skill,meetups,expert}',   true,  '{}',            12,   8,  true),
  ('dbs',               'DBS check',                   'Enhanced, where children are involved.',                       '{skill,meetups,expert}',   true,  '{}',    36,   9,  true),
  ('teaching',          'Teaching qualification',      'PGCE, or a recognised teaching award.',                        '{skill,expert}',           true,  '{}',            null, 10, true),
  ('professional-body', 'A professional body',         'Membership of a recognised body in the field.',                '{skill,expert}',           true,  '{}',            12,   11, true),
  ('heritage-crafts',   'Heritage Crafts maker',       'Listed as a maker of a craft on the Red List.',                '{skill}',                  false, '{}',            null, 12, true),
  ('years-at-it',       'Years at it',                 'How long they have been doing this. Their own word for it.',   '{skill,meetups,expert}',   false, '{}',            null, 13, true),
  ('degree',            'A degree in the subject',     'Named, with the institution. Their own word for it.',          '{skill,expert}',           false, '{}',            null, 14, true)
on conflict (key) do nothing;

-- The register. None of these is a runtime dependency: every one is imported or
-- read once, and a host typing never waits on any of them. What is recorded is
-- what the licence obliges us to say and whether the data itself may be kept —
-- which, because we take identifiers and write our own labels, is usually no.
insert into vocabulary_sources (key, label, what_we_take, licence, attribution, may_retain, resolves, url, note, position) values
  ('wikidata', 'Wikidata', 'Identifiers for tags and facets — the QID and nothing else.', 'CC0 1.0', null, false,
   'wbsearchentities for one candidate at a time; SPARQL for a bulk refresh. No key.', 'https://www.wikidata.org',
   'The identifier space, never the hierarchy. Parent is set by a person. Labels, descriptions, aliases and statements are not mirrored, so a vandalised label cannot reach a guest. CC0 means nothing propagates into Epic''s licensing.', 0),
  ('esco', 'ESCO v1.2.1', 'Wording for discipline and craft labels. Not the hierarchy, and not its occupational verbs.', 'CC BY 4.0',
   '© European Union, 1995–2026. ESCO classification, reproduced under CC BY 4.0.', false,
   'Free public REST, no key; a full download is available and self-hostable.', 'https://esco.ec.europa.eu',
   'A seed, not a backbone. It has locate fossils, identify fossils and paleontology — more than any tourism source — and nothing at all for birdwatching or foraging, because neither is a job.', 1),
  ('getty-aat', 'Getty AAT', 'Craft and technique terms.', 'ODC-By 1.0',
   'Contains information from the Getty Art & Architecture Thesaurus, made available under the ODC Attribution License.', false,
   'SPARQL at vocab.getty.edu.', 'https://vocab.getty.edu',
   'Scope is art and material culture, so the craft terms are near-certain and the natural-science ones are not. Verify on first integration.', 2),
  ('fish', 'FISH / heritagedata.org', 'Monument and object types — the heritage facets.', 'CC BY 3.0 per concept',
   'Concepts from the FISH vocabularies, published by Historic England and partners under CC BY 3.0.', true,
   'JSON REST at heritagedata.org.', 'https://www.heritagedata.org',
   'A proper licensed download, so it loads rather than being transcribed.', 3),
  ('bgs', 'BGS vocabularies', 'Geochronology and named rock units.', 'OGL 3.0',
   'Contains British Geological Survey materials © UKRI, licensed under the Open Government Licence v3.0.', true,
   'SKOS N-Triples at data.bgs.ac.uk.', 'https://data.bgs.ac.uk',
   'Half of the Jurassic Coast case: the periods and the named beds.', 4),
  ('nhm', 'NHM UK Species Inventory', 'Species and taxon-group facets.', 'CC BY 4.0',
   'Contains data from the UK Species Inventory, Natural History Museum, London, under CC BY 4.0.', true,
   'XLSX download.', 'https://www.nhm.ac.uk',
   'The other half: what is actually on the beach.', 5),
  ('iab', 'IAB Content Taxonomy 3.0', 'Wording for the browse categories.', 'CC BY 4.0',
   'Contains the IAB Tech Lab Content Taxonomy, under CC BY 4.0.', false,
   'TSV on GitHub.', 'https://github.com/InteractiveAdvertisingBureau', null, 6),
  ('read-by-hand', 'Read once, by hand', 'Category wording only, rewritten in Epic''s voice.', 'None — no dataset taken', null, false,
   'Four public pages read on 13 September 2026 and transcribed into the brief''s Appendix A.', null,
   'Craft Courses, ClassBento, Meetup and the Heritage Crafts inventory. A category name carries no copyright on its own and writing your own list informed by public pages is ordinary product work; what carries weight is the compilation and automated crawling against a site''s terms, and neither is engaged by reading four pages once. So: no scheduled crawler, no ingestion of anyone''s list as live data, no refresh job pointed at a competitor. Heritage Crafts is the one to handle differently — their Red List is a charity''s curated compilation, and the right move is an e-mail asking to reference it properly, which is the owner''s to send.', 7),
  ('epic', 'Epic', 'Everything a host typed, and every label written here.', 'Epic''s own', null, true,
   'The tags table itself.', null, 'What the vocabulary grows into. A tag with no external identifier is legitimate and reads as unmapped.', 8)
on conflict (key) do nothing;
