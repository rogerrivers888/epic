-- A word is a feature, an opinion, or not yet known — and it can be denied.
--
-- Brief: "Epic — Question sets and the vocabulary harvest" §5, *the pipeline,
-- end to end*, settled 20 September 2026, with the design comments on L17–L32
-- of the same date. Migration 207 built the sets; this builds the mechanics of
-- how a word becomes a question.
--
-- Three things the first pass could not say, each of which changes what a
-- screen should show:
--
--   · **Polarity.** *"Does it have a wave machine? We couldn't find one"*
--     mentions the feature and means the opposite. Counting the mention as
--     evidence the place has one is worse than not counting it at all, and the
--     brief is blunt about when it can be caught: "It cannot be recovered
--     later, so capture it at extraction or not at all." So every candidate
--     carries three counts — asserted, denied, merely asked — and a row whose
--     mentions are mostly denials reads as the different candidate it is.
--
--   · **Kind.** A harvest raises *wave machine*, *busy at weekends* and *rude
--     staff* with equal enthusiasm. Only the first is a question about a
--     place: the second is a condition and the third is an opinion, and
--     opinions are the Epic score's job. This is the filter that stops the
--     queue being mostly noise.
--
--   · **The holding pen.** A word the classifier cannot call is not pending,
--     not ignored and not waiting on a human — it is unresolved. It sits
--     costing nothing, apart from the promotable words, and is reconsidered
--     when a later harvest raises its count. Forcing a verdict on thin
--     evidence is how a question set fills with rubbish nobody can defend.

alter table harvest_candidates
  add column if not exists kind          text not null default 'unclear'
    check (kind in ('feature', 'condition', 'opinion', 'unclear')),
  -- The three polarities, counted in places rather than mentions: a word
  -- asserted by six places and denied by two is six and two, whatever the
  -- reviewers wrote.
  add column if not exists asserts       integer not null default 0,
  add column if not exists denies        integer not null default 0,
  add column if not exists asks          integer not null default 0,
  add column if not exists classified_at timestamptz,
  add column if not exists classified_by text;

comment on column harvest_candidates.kind is
  'feature = a question about a place. condition (busy at weekends) and opinion (rude staff) are not, and never become questions. unclear is the holding pen — reconsidered when a later harvest raises the count, never forced.';

-- The holding pen is a status, not an absence of one.
--
-- `new` now means *promotable*: a feature, waiting for a human. `unresolved`
-- is the pen. Keeping them apart is what lets the candidate screen show the
-- promotable list at a length somebody will actually read to the end of.
alter table harvest_candidates drop constraint if exists harvest_candidates_status_check;
alter table harvest_candidates add constraint harvest_candidates_status_check
  check (status in ('new', 'unresolved', 'promoted', 'ignored'));

create index if not exists harvest_candidates_kind on harvest_candidates (subcategory, kind, status);

-- ---------------------------------------------------------------------------
-- When a set is settled, Google leaves the category.
--
-- The consequence the brief calls the important one: "When water parks have a
-- saturated question set, Epic already knows what to ask of every water park
-- it ever sees. It does not need Google's reviews to tell it again."
--
-- So this is a switch, not a badge. The Google pass skips a settled set, and
-- enrichment for it reads owned sources only — no call, no cost, no licensing
-- question. Expect Google spend on the harvest to trend to nothing as sets
-- mature, which is the whole point of buying vocabulary rather than renting
-- facts.
--
-- `settled_on` records what it was settled *on* — how many places, over which
-- run — because a set settled on nineteen places in one county is a different
-- claim from one settled on a hundred across five regions, and the difference
-- must survive.
alter table question_sets
  add column if not exists vocabulary_settled boolean not null default false,
  add column if not exists settled_at         timestamptz,
  add column if not exists settled_on         jsonb not null default '{}'::jsonb;

comment on column question_sets.vocabulary_settled is
  'Settled = the harvest stopped teaching this set new words. The Google pass skips it and enrichment reads owned sources only (brief §5.4, 20 Sep 2026). Reversible: a new subcategory attached to the set unsettles it.';
