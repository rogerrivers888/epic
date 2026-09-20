-- A question is asked of a kind of place, and the same question of all of them.
--
-- Brief: "Epic — Question sets and the vocabulary harvest", 20 September 2026,
-- with its companion design brief of the same date.
--
-- Until now a label was a word attached to a place and anything could be
-- attached to anything. The brief's sentence for why that fails: "an open
-- question produces sprawl and a closed one produces something comparable."
-- Two water parks asked the same eight questions can be compared; two water
-- parks freely described cannot.
--
-- Three properties the brief asks the schema to carry, each of which is a
-- decision rather than a convenience:
--
--   · **A set is shared, not owned by a subcategory.** Water parks, lidos and
--     leisure pools want nearly the same questions, so the questions hang off
--     a set and a join table attaches the set to many subcategories. Hanging
--     them off `subcategory_key` would have duplicated every one of them.
--   · **Some questions are global, most are local.** Step free, parking,
--     toilets, booking and food on site are asked of everything; a wave
--     machine is asked where it makes sense. A place's full interrogation is
--     the global questions plus its set's own.
--   · **The questions come from the places.** `harvest_candidates` is what a
--     harvest noticed; a human promotes.
--
-- **This invents no second word list.** A question names an entry in
-- `place_attributes` — our own secondary-label vocabulary, migration 105, the
-- same vocabulary the taxonomy already writes rules in. The answer shape is
-- the attribute's own `kind`, so a question cannot disagree with the label it
-- asks about.
--
-- The provenance rule the brief puts above everything else in it:
--
--   **Google may raise a candidate word. Google may never answer a question
--   about a place.**
--
-- So `place_answers` carries a source, a URL and a date, and a check that the
-- source is one Epic owns or may freely read. Nothing rented can be written
-- here — not by this migration's authors and not by a later one that forgets.

-- ---------------------------------------------------------------------------
-- The sets.
--
-- "Nothing else; a set is a grouping, not a document." A name and whether it
-- is switched on, and every other fact about a set — how many subcategories
-- use it, how many places it covers — is counted rather than stored, because a
-- stored count is a count that goes wrong.
create table if not exists question_sets (
  key        text primary key,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which subcategories it is asked of.
--
-- **One set per subcategory** (brief §8, "I lean to one"), enforced by making
-- the subcategory the primary key. It is the reversible half of that open
-- question: widening to many later is dropping a primary key and adding a
-- composite one, where narrowing afterwards would mean choosing which of a
-- subcategory's sets to throw away.
create table if not exists question_set_subcategories (
  subcategory_key text primary key references shelf_subcategories (key) on delete cascade,
  set_key         text not null references question_sets (key) on delete cascade,
  attached_at     timestamptz not null default now()
);
create index if not exists question_set_subcategories_set on question_set_subcategories (set_key);

-- ---------------------------------------------------------------------------
-- The questions.
--
-- `scope` answers the brief's second open question — global questions live in
-- a scope of their own rather than in a set called "Everywhere" that somebody
-- could delete. A set cannot be deleted into the global questions going away.
--
-- `gate` is the distinction the design brief protects from the sort: a gate
-- makes a place *impossible* for somebody rather than less appealing — step
-- free, hearing loop, accessible toilet. Gates are exempt from any "too common
-- to be useful" retirement, which is why it is a column and not a threshold.
--
-- `refresh_days` answers the third open question — expiry is per question, not
-- global (a toddler pool does not move; a step-free entrance might). Null
-- means the answer never goes stale, which is the right default for the
-- things a building simply has.
create table if not exists questions (
  id            bigserial primary key,
  -- The vocabulary entry it asks about. Not a word of its own.
  attribute_key text not null references place_attributes (key) on delete cascade,
  scope         text not null default 'set' check (scope in ('global', 'set')),
  set_key       text references question_sets (key) on delete cascade,
  gate          boolean not null default false,
  refresh_days  integer,
  position      integer not null default 100,
  active        boolean not null default true,
  -- Where it came from, so a question can be traced back to the harvest that
  -- raised it rather than looking like somebody's idea.
  from_candidate bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A global question belongs to no set; a local one must name its set.
  constraint questions_scope_set check (
    (scope = 'global' and set_key is null) or (scope = 'set' and set_key is not null)
  )
);
-- The same thing is never asked twice of the same place: once globally, or
-- once within a set.
create unique index if not exists questions_global_once on questions (attribute_key) where scope = 'global';
create unique index if not exists questions_set_once    on questions (set_key, attribute_key) where scope = 'set';
create index if not exists questions_set_idx on questions (set_key) where set_key is not null;

-- ---------------------------------------------------------------------------
-- What a place answered.
--
-- Three states, and the middle one is the one that gets lost:
--
--   answered            we asked and an owned source said so
--   asked_nothing_found we asked and every owned source was silent
--   (no row)            never asked — the question postdates the last look
--
-- "A place where nothing mentioned a toddler pool probably lacks one, and that
-- is worth knowing. Store it, do not infer it from absence."
--
-- The primary key carries the **source**, because two owned sources are
-- allowed to disagree and the brief says to keep both: the venue's own page
-- says step free, OSM says otherwise. `unresolved` marks the pair so a screen
-- can show both and a human can pick, and nothing resolves it silently.
--
-- The value columns are `place_attribute_values`' columns, in the same order
-- and the same shapes, so one reader serves both: an answer researched from an
-- owned source and an answer a person typed in the back office are the same
-- kind of thing at different provenance.
create table if not exists place_answers (
  venue_ref   text not null,
  question_id bigint not null references questions (id) on delete cascade,
  -- Who said so. The check is the provenance rule, in the database, where a
  -- later writer cannot talk their way past it.
  source      text not null check (source in ('site', 'osm', 'wikipedia', 'wikidata', 'fsa', 'atlas', 'household', 'hand')),
  state       text not null check (state in ('answered', 'asked_nothing_found')),
  yesno       boolean,
  from_value  integer,
  to_value    integer,
  choice      text,
  number      real,
  source_url  text,
  confidence  real,
  unresolved  boolean not null default false,
  checked_at  timestamptz not null default now(),
  primary key (venue_ref, question_id, source)
);
create index if not exists place_answers_question on place_answers (question_id);
create index if not exists place_answers_unresolved on place_answers (venue_ref) where unresolved;
-- The share column the design brief calls the important one — "what share of
-- places in the set answer yes" — is this index's whole job.
create index if not exists place_answers_yes on place_answers (question_id, yesno) where state = 'answered';

comment on table place_answers is
  'Owned answers only. Google may raise a candidate word (harvest_candidates); it may never answer a question here. The source check is that rule, enforced.';

-- ---------------------------------------------------------------------------
-- The harvest.
--
-- A candidate is a normalised word, the raw forms it was seen as, how many of
-- the sampled places it appeared for, and which sources said it. Both the
-- free sweep and the Google pass write here, "so a word confirmed by both
-- reads as stronger" — `sources` is that, as counts per source rather than a
-- single winner.
--
-- **The count is kept and the sorting is not.** The harvester does not filter
-- by frequency: "lockers 19 of 20" against "wave machine 2 of 20" is what
-- makes materiality obvious, and deciding which of those is worth asking is a
-- human's job in front of a screen.
create table if not exists harvest_candidates (
  id            bigserial primary key,
  -- The normalised key, through `domain/hostSkills.js normalise` — the one
  -- normaliser Epic has, so "wave machine", "wavemachine" and "Wave Machine"
  -- are one candidate before anybody sees them.
  norm          text not null,
  raw_forms     text[] not null default '{}',
  -- Which subcategory's sample raised it. A set is reached through the join,
  -- so a candidate survives a subcategory moving between sets.
  subcategory   text not null references shelf_subcategories (key) on delete cascade,
  -- How many of the sampled places it appeared for, and out of how many, which
  -- is the share the design brief wants the eye to land on.
  places_seen   integer not null default 0,
  places_total  integer not null default 0,
  sources       jsonb not null default '{}'::jsonb,
  -- Scaffolding, and the brief says so: example place refs exist so a human
  -- can see what a word came from during review, and are cleared the moment
  -- the candidate is promoted or ignored.
  examples      text[] not null default '{}',
  -- new → promoted | ignored. **Ignored is permanent**: the harvester skips a
  -- norm this subcategory has already rejected, so the same wording never
  -- raises a second candidate.
  status        text not null default 'new' check (status in ('new', 'promoted', 'ignored')),
  question_id   bigint references questions (id) on delete set null,
  decided_by    text,
  decided_at    timestamptz,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  unique (subcategory, norm)
);
create index if not exists harvest_candidates_status on harvest_candidates (status, subcategory);

comment on column harvest_candidates.examples is
  'Scaffolding for review only. Cleared on promote or ignore — there is no reason to keep the word-to-place association once it has done its job.';

-- A promoted candidate is why a question exists; the question is where the
-- candidate went. Added after both tables so neither has to come first.
alter table harvest_candidates drop constraint if exists harvest_candidates_question_fk;
alter table questions drop constraint if exists questions_from_candidate_fk;
alter table questions add constraint questions_from_candidate_fk
  foreign key (from_candidate) references harvest_candidates (id) on delete set null;

-- ---------------------------------------------------------------------------
-- The runs, so a harvest can always be taken apart.
--
-- **Called `vocabulary_runs`, not `harvest_runs`.** The brief's name was
-- already taken: `harvest_runs` is the atlas picture harvest's table
-- (migration 037), and `create table if not exists` against a name that exists
-- does nothing at all — the schema would have looked applied and every insert
-- would have failed on a column that was never there. A name collision is the
-- one kind of clash a migration cannot warn about, so this one is renamed and
-- says why.
--
-- `saturation` holds the curve the brief asks for — distinct new normalised
-- candidates per ten places within a subcategory — because that is how we know
-- whether twenty was the right sample or whether some subcategories need
-- forty. `params` records the sampling rule that was used, including what
-- counted as "mid-tail", so a later run can be compared with this one.
create table if not exists vocabulary_runs (
  id            bigserial primary key,
  kind          text not null check (kind in ('free', 'google', 'probe')),
  status        text not null default 'running' check (status in ('running', 'done', 'failed', 'stopped')),
  subcategories text[] not null default '{}',
  places        integer not null default 0,
  calls         integer not null default 0,
  candidates    integer not null default 0,
  -- From the ledger, never from a guess: summed out of `provider_calls` for
  -- the window this run covers.
  cost_usd      numeric(12, 6) not null default 0,
  saturation    jsonb not null default '{}'::jsonb,
  params        jsonb not null default '{}'::jsonb,
  note          text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists vocabulary_runs_started on vocabulary_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- The resolver's alias table, for our own labels.
--
-- The same shape as `host_skill_aliases` and for the same reason: every
-- canonical label resolves to itself, seeded at boot, so one normaliser in
-- JavaScript serves every path rather than a second one in SQL that drifts
-- from it. Without this a harvest would raise "step-free access" as a new word
-- beside the `step-free` label we have had since migration 105.
create table if not exists attribute_aliases (
  norm       text primary key,
  target_key text not null references place_attributes (key) on delete cascade,
  raw        text,
  created_at timestamptz not null default now()
);
create index if not exists attribute_aliases_target on attribute_aliases (target_key);

-- ---------------------------------------------------------------------------
-- The questions asked of everything.
--
-- The brief names them: step free, parking, toilets, booking required, food on
-- site. `step-free` is already one of our labels (migration 105) and is a
-- gate; the other four are new secondary labels, created here so the global
-- scope is not empty on the day the screen arrives.
insert into place_attributes (key, label, kind, blurb, position, seeded) values
  ('parking',          'Parking',          'yesno', 'Somewhere to leave the car, on site or alongside.', 60, true),
  ('toilets',          'Toilets',          'yesno', 'Public toilets on site.', 61, true),
  ('booking-required', 'Booking required', 'yesno', 'You have to book ahead; turning up is not enough.', 62, true),
  ('food-on-site',     'Food on site',     'yesno', 'Somewhere to eat without leaving.', 63, true)
on conflict (key) do nothing;

insert into questions (attribute_key, scope, gate, refresh_days, position) values
  ('step-free',        'global', true,  365, 10),
  ('parking',          'global', false, 365, 20),
  ('toilets',          'global', false, null, 30),
  ('booking-required', 'global', false, 180, 40),
  ('food-on-site',     'global', false, 365, 50)
on conflict do nothing;
