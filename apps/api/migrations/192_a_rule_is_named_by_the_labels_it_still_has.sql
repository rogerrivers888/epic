-- A rule is named by the labels it still has.
--
-- Migration 191 took two group names out of the labels that name a rule, and
-- changed only `labels`. `(scope, subject)` is a rule's identity and its cache
-- key, and for a labels rule the subject is its labels sorted and joined with
-- " + " (`domain/labels.js`, `canonical`). So a combination rule that named one
-- of those groups alongside another label would have kept a subject naming a
-- label it no longer has — and teaching the remaining combination afterwards
-- would make a *second* rule rather than updating that one, leaving two rules
-- that both fire and disagree (Codex, 20 Sep 2026).
--
-- No rule in production is in that state: the two group names were each on a
-- rule of their own, so 191 deletes them whole and its update touches nothing.
-- This is written anyway, because a repair that depends on the data happening
-- to be simple is not a repair, and because the same drift can be introduced by
-- hand at any time.
--
-- 191 has already run, so this is its own file rather than an edit to it. It is
-- also written to be safe to run repeatedly and on a database where nothing is
-- wrong, which is what it will meet almost every time.

-- Any labels rule whose subject disagrees with its own labels, made to agree.
-- Where that collides with a rule already holding the canonical subject, the
-- newer one is dropped and the older kept: the older is the one other rows and
-- caches already point at, and two rules for one combination is the fault being
-- repaired rather than a second copy of it.
delete from shelf_rules dup
 where dup.scope = 'labels'
   and dup.subject is distinct from array_to_string(array(select unnest(dup.labels) order by 1), ' + ')
   and exists (
     select 1 from shelf_rules keep
      where keep.scope = 'labels'
        and keep.id <> dup.id
        and keep.subject = array_to_string(array(select unnest(dup.labels) order by 1), ' + ')
        and keep.created_at <= dup.created_at);

update shelf_rules
   set subject = array_to_string(array(select unnest(labels) order by 1), ' + '),
       updated_at = now()
 where scope = 'labels'
   and labels is not null
   and array_length(labels, 1) > 0
   and subject is distinct from array_to_string(array(select unnest(labels) order by 1), ' + ');
