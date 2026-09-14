-- Migration 108's predicate bound the wrong way round.
--
-- `and` binds tighter than `or`, so `s.active and exists(taxonomy_labels…) or
-- exists(place_kinds…)` applied the active check only to the first half. A
-- subcategory switched off but named by a Wikidata type's mapping therefore got
-- a live rule, and because a switched-off drawer is not in the resolver's
-- vocabulary that rule can win with a drawer nothing knows, leaving the place
-- with no category at all (Codex, 14 Sep 2026).
--
-- Nothing had been caught by it yet. 108 has already run, so it is not edited —
-- this cleans up after it and says what the predicate should have been.

delete from shelf_rules r
 where r.scope = 'ours'
   and not exists (select 1 from shelf_subcategories s where s.key = r.subject and s.active);

insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded, labels)
select 'ours', s.key, s.label, '{}'::jsonb, s.key,
       'Said in our words: every provider word pointing at ' || s.label || ' reaches this.',
       'Epic', false, array[s.key]
  from shelf_subcategories s
 where s.active
   and (exists (select 1 from taxonomy_labels l where l.points_at = s.key)
     or exists (select 1 from place_kinds k where k.points_at = s.key))
on conflict (scope, subject) do nothing;
