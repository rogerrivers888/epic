-- The back office keeps its own record: settings, changes, word decisions,
-- facts per subcategory, answers with their evidence, suggestions, families.
--
-- "Epic — Back office handover", 28 September 2026, sections 3, 5 and 8. Two
-- principles govern every table here, and both are the owner's:
--
--   1. A screen answers one question. "Is Epic looking for this fact here?"
--      (subcategory_facts) never shares a table with "does this place have
--      it?" (place_fact_answers). Conflict (our own sources disagree) and
--      disagreement (the machine against families) are different words for
--      different things, and are stored apart.
--   2. Humans decide; the machine runs itself. Every human decision keeps its
--      reason, who made it and when, and can be undone.
--
-- Additive only. Nothing that exists is rewritten here; the backfills below
-- copy what is already decided into the new shape and leave the old rows as
-- they were, so the screens being replaced keep working until they go.

-- ---------------------------------------------------------------------------
-- Settings: one table, read at run time, every change logged (handover 5.1).
--
-- A value is jsonb so a number, a switch and a band list share one shape.
-- `version` rises by one on each change and the log keeps before and after,
-- so "what was this set to on the 3rd" is a query rather than a memory.
create table if not exists bo_settings (
  key         text primary key,
  value       jsonb not null,
  version     integer not null default 1,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table if not exists bo_settings_log (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,
  version     integer not null,
  before      jsonb,
  after       jsonb not null,
  who         text not null,
  at          timestamptz not null default now()
);
create index if not exists bo_settings_log_key on bo_settings_log (key, at desc);

-- The owner's values (28 Sep 2026, his answers to the handover's open items),
-- where the handover's defaults and his decisions differ his win. Inserted
-- only where absent: a value somebody has since changed is theirs.
insert into bo_settings (key, value, updated_by) values
  ('spotMentions',        '1',     'handover'),
  ('suggestReviews',      '2',     'handover'),
  ('verifySources',       '1',     'handover'),
  ('venueWins',           'true',  'handover'),
  ('addPlaces',           '2',     'handover'),
  ('shareMax',            '90',    'handover'),
  ('recheckPhysical',     '12',    'handover'),
  ('recheckAccess',       '6',     'owner, 28 Sep 2026'),
  ('recheckFood',         '6',     'handover'),
  ('suggestExpiry',       '30',    'handover'),
  ('askPerVisit',         '1',     'handover'),
  ('familiesSettle',      '2',     'handover'),
  ('familiesWrong',       '2',     'handover'),
  ('collectionMinPlaces', '4',     'handover'),
  ('sourceSlow',          '5',     'owner, 28 Sep 2026'),
  ('sourceFailing',       '15',    'owner, 28 Sep 2026'),
  ('budgetGoogle',        '50',    'owner, 28 Sep 2026'),
  ('budgetClaude',        '30',    'owner, 28 Sep 2026'),
  ('ageBands', '[{"key":"babies","label":"Babies under 2","from":0,"to":1},{"key":"toddlers","label":"Toddlers 2–4","from":2,"to":4},{"key":"young","label":"Young children 5–8","from":5,"to":8},{"key":"older","label":"Older children 9–12","from":9,"to":12},{"key":"teens","label":"Teens 13–17","from":13,"to":17},{"key":"adults","label":"Adults 18+","from":18,"to":99}]', 'owner, 28 Sep 2026'),
  ('durationBands', '[{"key":"under1","label":"Under 1 hour","from":0,"to":59},{"key":"1to2","label":"1–2 hours","from":60,"to":120},{"key":"2to3","label":"2–3 hours","from":121,"to":180},{"key":"half","label":"Half a day","from":181,"to":300},{"key":"full","label":"A full day","from":301,"to":720}]', 'owner, 28 Sep 2026'),
  ('costBands', '{"GB":{"currency":"GBP","bands":[{"key":"Free","label":"Free","to":0},{"key":"Cheap","label":"Cheap","under":10},{"key":"Mid","label":"Mid","from":10,"to":25},{"key":"Dear","label":"Dear","over":25}]},"IE":{"currency":"EUR","bands":[{"key":"Free","label":"Free","to":0},{"key":"Cheap","label":"Cheap","under":12},{"key":"Mid","label":"Mid","from":12,"to":30},{"key":"Dear","label":"Dear","over":30}]}}', 'owner, 28 Sep 2026')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Changes: every change a person makes in the back office (handover 6.7).
--
-- One row per change, written by the same statement's transaction wherever a
-- route writes, so a change that did not happen is never logged and one that
-- did never goes unlogged. `why` is required by the screens for Mapping and
-- Defaults and optional elsewhere. `undo` is the machine-readable inverse
-- where there is one, so the toast's Undo and the log agree about what it does.
create table if not exists bo_changes (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  who          text not null,
  area         text not null check (area in ('Categories','Subcategories','Facts','Mapping','Defaults','Collections','Fact automations')),
  what         text not null,
  before       text,
  after        text,
  why          text,
  subject_type text,
  subject_id   text,
  undo         jsonb,
  undone_at    timestamptz,
  undone_by    text
);
create index if not exists bo_changes_at on bo_changes (at desc);
create index if not exists bo_changes_area on bo_changes (area, at desc);

-- ---------------------------------------------------------------------------
-- Word decisions: every decision on a Google word, stored apart from any
-- other log (handover 8: "Store it separately from any other log" — sharing a
-- key crashed the prototype once).
create table if not exists word_decisions (
  id           uuid primary key default gen_random_uuid(),
  namespace    text not null default 'google',
  word         text not null,
  kind         text not null check (kind in ('Excluded','Repointed','Narrowed','Made a fact','Kept','Brought back')),
  why          text,
  who          text not null,
  at           timestamptz not null default now(),
  before       jsonb not null,
  after        jsonb,
  proposal_id  uuid,
  undone_at    timestamptz,
  undone_by    text
);
create index if not exists word_decisions_word on word_decisions (namespace, word, at desc);
create index if not exists word_decisions_at on word_decisions (at desc) where undone_at is null;

-- Where a word sends its places: several subcategories, exactly one primary
-- (handover 4.10, A15). `taxonomy_labels.points_at` stays the primary and is
-- kept in step by the code that writes here, so the classifier reads what it
-- always read; the secondaries are what files a place in more than one drawer.
create table if not exists word_targets (
  namespace       text not null default 'google',
  word            text not null,
  subcategory_key text not null references shelf_subcategories(key) on delete cascade,
  is_primary      boolean not null default false,
  position        integer not null default 0,
  -- A narrowing (handover 4.10): the word files a place here only when the
  -- condition holds, e.g. 'encyclopedia_or_listing' for churches worth
  -- visiting. Null files every place the word brings.
  condition       text check (condition is null or condition in ('encyclopedia_or_listing')),
  created_at      timestamptz not null default now(),
  primary key (namespace, word, subcategory_key)
);
create unique index if not exists word_targets_one_primary on word_targets (namespace, word) where is_primary;
create index if not exists word_targets_sub on word_targets (subcategory_key);

insert into word_targets (namespace, word, subcategory_key, is_primary, position)
select l.namespace, l.key, l.points_at, true, 0
  from taxonomy_labels l
  join shelf_subcategories s on s.key = l.points_at
 where l.points_at is not null
on conflict do nothing;

-- The machine's proposals about words (handover 4.10 and 6.4, "Needs a
-- decision"). Grouped in plain words; each decided on its own; a proposal
-- that is Kept is never raised again (`kept`), and one that would reverse a
-- settled decision is never written at all.
create table if not exists word_proposals (
  id              uuid primary key default gen_random_uuid(),
  namespace       text not null default 'google',
  word            text not null,
  grp             text not null check (grp in ('not_places','fold','narrow','stop_filing','no_suggestion')),
  action          text not null check (action in ('exclude','repoint','narrow','make_fact','choose')),
  change_to       jsonb not null,
  rule_text       text,
  places_affected integer,
  state           text not null default 'open' check (state in ('open','decided','kept')),
  raised_at       timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      text
);
create unique index if not exists word_proposals_open on word_proposals (namespace, word) where state = 'open';
create index if not exists word_proposals_state on word_proposals (state, grp);

-- ---------------------------------------------------------------------------
-- Facts per subcategory (handover 3 "Fact status", C44: no shared sheets).
--
-- Active is the normal state. `active_since` gives the 30-day New mark;
-- `reason` is one of the four the screens say, and a fact removed by a person
-- is never re-added by the machine.
create table if not exists subcategory_facts (
  subcategory_key text not null references shelf_subcategories(key) on delete cascade,
  attribute_key   text not null references place_attributes(key) on delete cascade,
  status          text not null check (status in ('active','gathering','ignored')),
  reason          text check (reason is null or reason in ('on_nearly_every_place','an_opinion','a_condition','removed_by_a_person')),
  first_seen      timestamptz not null default now(),
  active_since    timestamptz,
  verified_places integer not null default 0,
  removed_by      text,
  removed_at      timestamptz,
  include_anyway  boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (subcategory_key, attribute_key)
);
create index if not exists subcategory_facts_attr on subcategory_facts (attribute_key, status);

-- What the sets asked is what each drawer already looks for. Copied, not
-- moved: the sets stay until the screens that read them are gone.
insert into subcategory_facts (subcategory_key, attribute_key, status, active_since)
select ss.subcategory_key, q.attribute_key, 'active', coalesce(q.created_at, now())
  from question_set_subcategories ss
  join questions q on q.set_key = ss.set_key and q.scope = 'set' and q.active
  join shelf_subcategories s on s.key = ss.subcategory_key
on conflict do nothing;

-- What a fact is (handover 8 "Fact"): the flags the rules read.
alter table place_attributes add column if not exists standard   boolean not null default false;
alter table place_attributes add column if not exists access     boolean not null default false;
alter table place_attributes add column if not exists age        boolean not null default false;
alter table place_attributes add column if not exists dietary    boolean not null default false;
alter table place_attributes add column if not exists definition text;

-- The ten standard facts (handover 3), and which of them are access or age
-- facts (exempt from shareMax) or food and dietary (re-checked on recheckFood).
update place_attributes set standard = true
 where key in ('indoor','step-free','parking','toilets','booking-required','food-on-site','dog-friendly','suits-ages','duration','cost-band')
   and not standard;
update place_attributes set access = true
 where key in ('step-free','parking','toilets','dog-friendly','booking-required') and not access;
update place_attributes set age = true where key = 'suits-ages' and not age;
update place_attributes set dietary = true where key in ('halal-food','food-on-site','cuisine','dining') and not dietary;

-- Related subcategories a person adds by hand (A14). Stored once, lowest key
-- first, so a link and its mirror cannot both exist.
create table if not exists subcategory_links (
  a          text not null references shelf_subcategories(key) on delete cascade,
  b          text not null references shelf_subcategories(key) on delete cascade,
  added_by   text not null,
  added_at   timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);

-- ---------------------------------------------------------------------------
-- Answers, per place per fact (handover 3 "Answer", 5.2, 8 "Place").
--
-- The machine's settled answer. Verified yes and No are public and counted;
-- Conflict is private; Don't know is the absence of anything found, and is a
-- real answer. A person's correction lives in `place_attribute_values` and is
-- never overwritten by anything here.
create table if not exists place_fact_answers (
  venue_ref        text not null,
  attribute_key    text not null references place_attributes(key) on delete cascade,
  state            text not null check (state in ('yes','no','conflict','dont_know')),
  yesno            boolean,
  from_value       integer,
  to_value         integer,
  choice           text,
  source           text check (source is null or source in ('site','osm','wikipedia','wikidata','fsa','families')),
  source_url       text,
  evidence_quote   text,
  checked_at       timestamptz not null default now(),
  recheck_due      timestamptz,
  disputed_before  boolean not null default false,
  hidden_at        timestamptz,
  venue_override   boolean not null default false,
  primary key (venue_ref, attribute_key)
);
create index if not exists place_fact_answers_attr on place_fact_answers (attribute_key, state);
create index if not exists place_fact_answers_due on place_fact_answers (recheck_due) where recheck_due is not null;

-- What each of our own sources said, one row a source (the evidence behind an
-- answer). Owned text may be stored; nothing from Google ever is.
create table if not exists place_fact_evidence (
  venue_ref      text not null,
  attribute_key  text not null references place_attributes(key) on delete cascade,
  source         text not null check (source in ('site','osm','wikipedia','wikidata','fsa','families')),
  says           text not null check (says in ('yes','no','nothing')),
  quote          text,
  url            text,
  checked_at     timestamptz not null default now(),
  primary key (venue_ref, attribute_key, source)
);

-- Suggestions (C30): the only Google-derived thing stored. A place id, a
-- feature, a status and when it was first seen — no text, no quote, no review
-- id, no count. Deleted once checked and after `suggestExpiry` days at most.
create table if not exists fact_suggestions (
  venue_ref   text not null,
  feature     text not null,
  status      text not null default 'waiting' check (status in ('waiting','conflict')),
  first_seen  timestamptz not null default now(),
  primary key (venue_ref, feature)
);
create index if not exists fact_suggestions_age on fact_suggestions (first_seen);

-- What happened to each suggestion, for Verification's charts and
-- drill-downs. Owned outcomes only: the fact, the place, what we found.
create table if not exists fact_checks (
  id             uuid primary key default gen_random_uuid(),
  venue_ref      text not null,
  attribute_key  text,
  feature        text not null,
  outcome        text not null check (outcome in ('verified','no','dont_know','conflict','dropped')),
  source         text,
  -- When the suggestion it answered was first seen, so the backlog on any
  -- past day is a count rather than a reconstruction.
  first_seen     timestamptz,
  at             timestamptz not null default now()
);
create index if not exists fact_checks_at on fact_checks (at desc);

-- ---------------------------------------------------------------------------
-- Families (handover 4.7 and 8 "Family answer").
--
-- The answer, and the machine's answer at the time with the source it relied
-- on, so accuracy can be measured against the rules and not the places.
create table if not exists family_answers (
  id               uuid primary key default gen_random_uuid(),
  venue_ref        text not null,
  attribute_key    text not null references place_attributes(key) on delete cascade,
  household_id     uuid not null references households(id) on delete cascade,
  answer           text not null check (answer in ('yes','no','didnt_notice')),
  answered_at      timestamptz not null default now(),
  machine_state    text check (machine_state is null or machine_state in ('yes','no','conflict','dont_know')),
  machine_source   text,
  subcategory_key  text,
  unique (venue_ref, attribute_key, household_id)
);
create index if not exists family_answers_fact on family_answers (attribute_key, answered_at desc);

-- Who has been asked what, so a household is never asked the same fact twice
-- and a visit carries at most `askPerVisit` questions.
create table if not exists family_asks (
  household_id   uuid not null references households(id) on delete cascade,
  venue_ref      text not null,
  attribute_key  text not null references place_attributes(key) on delete cascade,
  visit_id       uuid,
  asked_at       timestamptz not null default now(),
  primary key (household_id, venue_ref, attribute_key)
);

-- ---------------------------------------------------------------------------
-- Defaults (handover 4.8, C49): who set it, and whether it is the machine's
-- proposal waiting for a person. `settled` (migration 216) is the acceptance.
alter table shelf_subcategory_attributes add column if not exists origin text not null default 'machine'
  check (origin in ('person','machine'));
alter table shelf_subcategory_attributes add column if not exists set_by text;
alter table shelf_subcategory_attributes add column if not exists set_at timestamptz;
update shelf_subcategory_attributes set origin = 'person', set_at = coalesce(set_at, updated_at)
 where settled and origin = 'machine';

-- ---------------------------------------------------------------------------
-- Collections (renamed from Ideas, handover 4.11): the rule over facts, and
-- engagement per audience.
alter table browse_rows add column if not exists rule jsonb;
alter table browse_rows add column if not exists updated_by text;

create table if not exists collection_events (
  id              uuid primary key default gen_random_uuid(),
  collection_key  text not null,
  household_id    uuid references households(id) on delete set null,
  kind            text not null check (kind in ('shown','opened')),
  audience        text,
  at              timestamptz not null default now()
);
create index if not exists collection_events_key on collection_events (collection_key, kind, at desc);

-- ---------------------------------------------------------------------------
-- The older taxonomy and shelf routes record some of their writes in
-- `admin_audit`. Every one of those that is a mapping, rule or subcategory
-- change is also a change a person made in the back office, so it is copied
-- into Changes as it is written (owner, 28 Sep 2026: "Wire the Changes log
-- into every existing write path"). Other audited actions (roles, library,
-- accounts) are not back-office filing changes and are left where they are.
create or replace function bo_changes_from_admin_audit() returns trigger language plpgsql as $$
declare
  area_ text;
  what_ text;
begin
  if new.action in ('taxonomy.rule', 'shelf.teach', 'shelf.move', 'shelf.forget') then
    area_ := 'Mapping';
    what_ := 'Rule · ' || coalesce(new.subject_label, new.subject_id, '');
  elsif new.action = 'taxonomy.adopt' then
    area_ := 'Categories';
    what_ := 'Subcategory added · ' || coalesce(new.subject_label, '');
  elsif new.action = 'taxonomy.attribute' then
    area_ := 'Facts';
    what_ := 'Fact · ' || coalesce(new.subject_label, '');
  else
    return new;
  end if;
  insert into bo_changes (at, who, area, what, before, after, subject_type, subject_id)
  values (coalesce(new.at, now()), coalesce(new.actor_label, 'unknown'), area_, what_,
          case when new.before is null then '—' else left(new.before::text, 500) end,
          case when new.after is null then '—' else left(new.after::text, 500) end,
          new.subject_type, new.subject_id);
  return new;
end $$;

drop trigger if exists admin_audit_to_bo_changes on admin_audit;
create trigger admin_audit_to_bo_changes after insert on admin_audit
  for each row execute function bo_changes_from_admin_audit();
