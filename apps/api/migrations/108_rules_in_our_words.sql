-- The 383 rules, said in our words.
--
-- Migration 107 gave every provider word a label of ours to point at, but left
-- every rule in the vocabulary it was written in, so nothing could actually
-- fire: an OpenStreetMap word pointing at the same label as a Google word still
-- could not trigger the Google word's rule, which was the whole point (Codex,
-- 14 Sep 2026).
--
-- One rule per label of ours that a provider word points at. Where the label
-- and the subcategory are the same word, which is most of them, the rule reads
-- "a place carrying our label Museums gets the primary label Museums" — an
-- identity, and correct: what earns its keep is that every provider reaches it.
-- A rule naming a combination is the owner's to write, and there are none yet.
--
-- Weights are left empty on purpose. A drawer belongs to exactly one cabinet,
-- so naming the drawer is a complete answer; that is how most of the atlas is
-- already filed.

insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded, labels)
select 'ours',
       s.key,
       s.label,
       '{}'::jsonb,
       s.key,
       'Said in our words: every provider word pointing at ' || s.label || ' reaches this.',
       'Epic',
       false,
       array[s.key]
  from shelf_subcategories s
 where s.active
   and exists (select 1 from taxonomy_labels l where l.points_at = s.key)
    or exists (select 1 from place_kinds k where k.points_at = s.key)
on conflict (scope, subject) do nothing;
