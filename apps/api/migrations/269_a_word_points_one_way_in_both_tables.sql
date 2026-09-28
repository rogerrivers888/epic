-- A Google word's primary lives in two places: `taxonomy_labels.points_at`,
-- which the classifier reads, and `word_targets`, which the back office's
-- Mapping reads (migration 266). The desk writes both in one transaction, but
-- the older routes — the taxonomy screens, the audit, the label repository —
-- write `points_at` alone, and a word that reads one way and files another is
-- the one state nobody goes looking for (audit, 28 Sep 2026).
--
-- So the database keeps them in step, whichever side is written:
--
--   * `points_at` changes (or a word arrives pointing somewhere): the word's
--     unconditional primary in `word_targets` becomes that subcategory — added
--     if it was not there, the old primary demoted to an ordinary target. A
--     word whose `points_at` is cleared loses its unconditional targets; a
--     narrowing (a target with a condition) is left alone, because a narrowed
--     word files nothing by itself and its `points_at` is null on purpose.
--   * `word_targets` changes: `points_at` becomes the unconditional primary,
--     or null where there is none.
--
-- Each trigger does nothing when it is fired from inside the other
-- (`pg_trigger_depth() > 1`), so neither can start the other going round.
--
-- Additive and idempotent: `create or replace` and `drop trigger if exists`,
-- and the resync below only touches rows that disagree.

create or replace function word_targets_follow_points_at() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'UPDATE' and new.points_at is not distinct from old.points_at then return new; end if;
  if new.points_at is null then
    if tg_op = 'UPDATE' then
      delete from word_targets where namespace = new.namespace and word = new.key and condition is null;
    end if;
    return new;
  end if;
  -- A pointer at a drawer we do not hold cannot be a target (the foreign key
  -- would refuse it and take the older route's write down with it).
  if not exists (select 1 from shelf_subcategories where key = new.points_at) then return new; end if;
  update word_targets set is_primary = false
   where namespace = new.namespace and word = new.key and is_primary and subcategory_key <> new.points_at;
  if exists (select 1 from word_targets where namespace = new.namespace and word = new.key and subcategory_key = new.points_at) then
    update word_targets set is_primary = true, condition = null, position = 0
     where namespace = new.namespace and word = new.key and subcategory_key = new.points_at;
  else
    update word_targets set position = position + 1 where namespace = new.namespace and word = new.key;
    insert into word_targets (namespace, word, subcategory_key, is_primary, position)
    values (new.namespace, new.key, new.points_at, true, 0);
  end if;
  return new;
end $$;


create or replace function points_at_follows_word_targets() returns trigger
language plpgsql as $$
declare
  ns text := coalesce(new.namespace, old.namespace);
  w text := coalesce(new.word, old.word);
  p text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  select subcategory_key into p from word_targets
   where namespace = ns and word = w and is_primary and condition is null;
  update taxonomy_labels set points_at = p, updated_at = now()
   where namespace = ns and key = w and points_at is distinct from p;
  return null;
end $$;


-- ---------------------------------------------------------------------------
-- The one-off resync. `points_at` is what the classifier files by, so where
-- the two disagree it is the side that has been acting on places, and the
-- targets are brought to it:
--
--   1. a word pointing somewhere whose unconditional primary is elsewhere, or
--      missing: that subcategory becomes its primary;
--   2. a word that is out of Epic (aside, travel, nearby) keeps no
--      unconditional targets;
--   3. a word pointing nowhere that is not out, but still has an
--      unconditional primary target: the pointer is put back from the target
--      (the desk wrote it, and an older route cleared only half of it).
--
-- Run before the triggers exist (and with any from an earlier run dropped):
-- the resync demotes a primary before it promotes the right one, and a
-- trigger reading the half-way state would clear the pointer it is about to
-- follow.
drop trigger if exists taxonomy_labels_points_at_to_targets on taxonomy_labels;
drop trigger if exists word_targets_to_points_at on word_targets;

-- 1. The pointer wins.
update word_targets t set is_primary = false
  from taxonomy_labels l
 where l.namespace = t.namespace and l.key = t.word
   and l.points_at is not null and t.is_primary and t.subcategory_key <> l.points_at
   and exists (select 1 from shelf_subcategories s where s.key = l.points_at);

update word_targets t set is_primary = true, condition = null
  from taxonomy_labels l
 where l.namespace = t.namespace and l.key = t.word
   and l.points_at = t.subcategory_key and not t.is_primary;

insert into word_targets (namespace, word, subcategory_key, is_primary, position)
select l.namespace, l.key, l.points_at, true, 0
  from taxonomy_labels l
  join shelf_subcategories s on s.key = l.points_at
 where l.points_at is not null
   and not exists (select 1 from word_targets t where t.namespace = l.namespace and t.word = l.key and t.subcategory_key = l.points_at)
on conflict do nothing;

-- 2. Out of Epic is out.
delete from word_targets t
 using taxonomy_labels l
 where l.namespace = t.namespace and l.key = t.word
   and l.decision in ('aside', 'travel', 'nearby') and t.condition is null;

-- 3. A pointer cleared on one side only.
update taxonomy_labels l set points_at = t.subcategory_key, updated_at = now()
  from word_targets t
 where t.namespace = l.namespace and t.word = l.key and t.is_primary and t.condition is null
   and l.points_at is null
   and (l.decision is null or l.decision not in ('aside', 'travel', 'nearby'));

-- ---------------------------------------------------------------------------
-- From here on, the two stay in step.

drop trigger if exists taxonomy_labels_points_at_to_targets on taxonomy_labels;
create trigger taxonomy_labels_points_at_to_targets
  after insert or update of points_at on taxonomy_labels
  for each row execute function word_targets_follow_points_at();

drop trigger if exists word_targets_to_points_at on word_targets;
create trigger word_targets_to_points_at
  after insert or update or delete on word_targets
  for each row execute function points_at_follows_word_targets();
