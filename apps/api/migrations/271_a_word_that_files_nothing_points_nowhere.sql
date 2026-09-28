-- A word that files nothing points nowhere, in both tables (Codex on 269,
-- 28 Sep 2026). A follow-on, never an edit: 269 has run.
--
-- 269's one-off resync had two holes:
--
--   * its step 3 put a pointer back from an old target for any word not out
--     of Epic — including a `generic` word, which is kept as a fact only and
--     must file nothing (the older route clears `points_at` when it marks a
--     word generic and leaves the target behind);
--   * its step 2 removed the targets of a word that is out of Epic (aside,
--     travel, nearby) but left a non-null `points_at`, which the classifier
--     reads without looking at the decision.
--
-- Production, read before writing this (28 Sep 2026, /api/admin/filing/
-- mapping): 21 words kept as a fact and 207 out of Epic, none of them with a
-- pointer — so this puts back exactly the state production is in, whatever
-- 269 did on the way. A narrowing (a target with a condition) is left alone.
--
-- With the triggers from 269 in place, clearing a pointer here also removes
-- the word's unconditional targets; the explicit delete is for any the
-- trigger did not see (a word whose pointer was already null).

update taxonomy_labels
   set points_at = null, updated_at = now()
 where decision in ('generic', 'aside', 'travel', 'nearby')
   and points_at is not null;

delete from word_targets t
 using taxonomy_labels l
 where l.namespace = t.namespace and l.key = t.word
   and l.decision in ('generic', 'aside', 'travel', 'nearby')
   and t.condition is null;

-- ---------------------------------------------------------------------------
-- A person's "Don't know" on one place's fact (Codex on 6cd61a5). It is a
-- decision, so it is kept: while it stands our sources' answer for that fact
-- is not shown and a later check cannot bring it back. Its own table, because
-- a value row must be the shape its fact is (migrations 132/135) and "nobody
-- can tell" is not a value.
create table if not exists fact_unknowns (
  venue_ref     text not null,
  attribute_key text not null references place_attributes(key) on delete cascade,
  who           text not null,
  at            timestamptz not null default now(),
  primary key (venue_ref, attribute_key)
);
