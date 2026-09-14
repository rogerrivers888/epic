-- Rules are written in our words, never in a provider's.
--
-- The owner, 14 Sep 2026: "we don't use Google words; we use our own words. The
-- first exercise is to map Google words to our labels, and then we can add
-- labels. We create rules using our own internal labels, which will change over
-- time because we have other providers other than Google."
--
-- Our own data made his case. 29 of 53 subcategories were already reached by
-- rules written in more than one vocabulary: "zoo" as a Google rule, "zoo" as a
-- Wikidata rule and "a zoo" as a spoken rule, all saying one thing three times.
-- And Windsor Castle reaches Epic from Wikidata carrying no Google word at all,
-- so a rule written against Google could never catch it however careful.
--
-- `points_at` is the mapping: which of our labels a provider's word means.
-- Google's `water_park`, OpenStreetMap's `leisure=water_park` and Wikidata's
-- Q1080794 all point at the one label of ours. One of our labels is either a
-- subcategory (a primary label, the one thing a place is) or a secondary label
-- (everything else true about it) — nothing else.
--
-- `scope = 'ours'` is a rule written in that vocabulary. It sits exactly where
-- the old `labels` scope sat in the order, and it will replace it.

alter table taxonomy_labels add column if not exists points_at text;
create index if not exists taxonomy_labels_points_at on taxonomy_labels (points_at) where points_at is not null;

alter table shelf_rules drop constraint if exists shelf_rules_scope_check;
alter table shelf_rules add constraint shelf_rules_scope_check
  check (scope = any (array['place', 'labels', 'ours', 'kind', 'category', 'experience']));

-- What we already know, taken from the rules that exist.
--
-- Every single-word rule is itself a statement that the word means that
-- subcategory, so 241 label rules and 113 Wikidata rules carry the mapping
-- already and nobody has to type them again.
update taxonomy_labels l
   set points_at = r.subcategory, updated_at = now()
  from shelf_rules r
 where r.scope = 'labels'
   and r.subcategory is not null
   and array_length(r.labels, 1) = 1
   and r.labels[1] = l.namespace || ':' || l.key
   and l.points_at is null;

update place_kinds k
   set updated_at = now()
  from shelf_rules r
 where r.scope = 'kind' and r.subject = k.qid and r.subcategory is not null;

-- Wikidata types live in `place_kinds`, so they carry the same column.
alter table place_kinds add column if not exists points_at text;
update place_kinds k
   set points_at = r.subcategory
  from shelf_rules r
 where r.scope = 'kind' and r.subject = k.qid and r.subcategory is not null and k.points_at is null;
