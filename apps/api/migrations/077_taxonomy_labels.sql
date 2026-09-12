-- Labels: one vocabulary for everything a source says about a place, and rules
-- that read a combination of them.
--
-- The owner, 12 Sep 2026: "Do we label particular attributes of a place as an
-- attribute, and then could we, for each category or subcategory, add the
-- combination of labels that determine whether that particular activity lives
-- in that particular subcategory? … view all of our providers, categories,
-- and subcategories … the mappings between our providers' categories … map
-- [our master categories and subcategories] to the providers' subcategories."
--
-- Two things follow.
--
-- **A label is a fact a source stated, in that source's own words, with the
-- source's name in front.** `google:museum`, `osm:tourism=museum`,
-- `wikidata:Q33506`, `tripadvisor:Museums`, `ticketmaster:Music`. Epic's own
-- derived words are labels too — `experience:museum`, `atlas:museum`,
-- `venue:restaurant`, `style:fast-food`, `flag:ticketed` — so that a rule can
-- be written against whichever level of the ladder is the honest one. This
-- table is the vocabulary: which labels exist, what each is called in English,
-- and how often each has been seen on a real place. Wikidata's types are not
-- copied in — `place_kinds` already is that vocabulary, with the same
-- seen-count — and the API reads the two as one.
--
-- **A rule may now name several labels at once.** `shelf_rules` gains a fifth
-- scope, `labels`: the rule fires only when a place carries every label in
-- `labels`, and among the label rules that fire, the one naming the most labels
-- wins. That is the "combination of labels" above. A rule about exactly one
-- Wikidata type, atlas word or experience still goes to its own scope — it is
-- the same thing said the old way, and the order those scopes resolve in
-- (place → labels → kind → category → experience) does not move anything that
-- has already been filed.
--
-- Nothing a licensed provider says about a *place* lands here. The vocabulary
-- is the provider's published list of words and a count; which place carried
-- which word stays in the session, as before (Technical Constraints §4).

create table if not exists taxonomy_labels (
  namespace   text not null,                  -- 'google', 'osm', 'experience'…
  key         text not null,                  -- 'museum', 'tourism=museum'
  label       text,                           -- 'Museum' — the English, where the source gives one
  note        text,                           -- where the word came from, for the screen
  seen_count  integer not null default 0,     -- how many real places have carried it
  active      boolean not null default true,  -- switched off = still known, no longer offered
  seeded      boolean not null default false, -- arrived with the code rather than being observed
  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (namespace, key)
);
create index if not exists taxonomy_labels_seen_idx on taxonomy_labels (namespace, seen_count desc);

-- The fifth scope, and the labels a rule at that scope requires.
alter table shelf_rules drop constraint if exists shelf_rules_scope_check;
alter table shelf_rules add constraint shelf_rules_scope_check
  check (scope in ('place', 'labels', 'kind', 'category', 'experience'));
alter table shelf_rules add column if not exists labels text[];
create index if not exists shelf_rules_labels_idx on shelf_rules using gin (labels) where scope = 'labels';
