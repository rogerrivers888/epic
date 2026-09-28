-- The collections migration 273 kept off, rewritten or retired (owner, 29 Sep
-- 2026: "Rewrite each rule using categories, subcategories, facts, age
-- ranges, duration and cost only — no graded scores (B1)… Any collection
-- that can't be expressed without a retired axis: retire it. Put the
-- rewritten ones live").
--
-- Each of the seventeen already carries its desk rule (written from the
-- handover's ROW_RULES by 270), in categories, subcategories, facts, ages,
-- duration and cost only; what kept it off was its old household rule
-- (`predicate`), which names a graded axis. The desk rule is the one both the
-- back office and families read (`rule` wins over `predicate`), so the old
-- predicate is emptied — `{"all": []}` — and the row goes live. Big kids is
-- the agreed definition: Fun or Adrenaline, ages from 12 or under to 60 or
-- over, left thin on purpose.
--
-- Three mean something only a graded axis could say, and are retired —
-- kept, off, with why, never shown to a family or listed on the desk:
--   Something fun          "learn little, plan little"  (how much you learn, how much planning)
--   No rush                "little walking, not busy"   (how much walking, how busy and loud)
--   Never done that before "new to everyone"            (how new)

alter table browse_rows add column if not exists retired_at timestamptz;
alter table browse_rows add column if not exists retired_why text;

update browse_rows
   set predicate = '{"all": []}'::jsonb, active = true, updated_by = 'Epic (migration 275)', updated_at = now()
 where key in ('twoofyou', 'onekid', 'dayyourself', 'dryrun', 'darkbyfour', 'twohours', 'halfday', 'properday',
               'wearout', 'sneaky', 'bigkids', 'heartmouth', 'lovely', 'birthday', 'halfterm', 'history', 'foodtravel')
   and rule is not null
   and retired_at is null;

-- Big kids, exactly as agreed.
update browse_rows
   set rule = '{"cats":[{"id":"fun","not":false},{"id":"adrenaline","not":false}],"subs":[],"facts":[],"ages":[12,60],"dur":null,"cost":[],"ageSpan":true,"primaryCat":null}'::jsonb
 where key = 'bigkids';

update browse_rows
   set active = false, retired_at = now(), updated_by = 'Epic (migration 275)', updated_at = now(),
       retired_why = case key
         when 'fun' then 'Needs graded axes — how much you learn, how much planning — retired in migration 246.'
         when 'norush' then 'Needs graded axes — how much walking, how busy and loud — retired in migration 246.'
         when 'neverdone' then 'Needs a graded axis — how new — retired in migration 246.'
       end
 where key in ('fun', 'norush', 'neverdone') and retired_at is null;

-- Written down in Changes, as every change to a collection is.
insert into bo_changes (who, area, what, before, after, why, subject_type, subject_id)
select 'Epic (migration 275)', 'Collections', 'Collection live · ' || title, 'Off — its old rule named a graded axis', 'Live',
       'Rewritten with categories, subcategories, facts, ages, duration and cost only (owner, 29 Sep 2026).', 'collection', key
  from browse_rows
 where key in ('twoofyou', 'onekid', 'dayyourself', 'dryrun', 'darkbyfour', 'twohours', 'halfday', 'properday',
               'wearout', 'sneaky', 'bigkids', 'heartmouth', 'lovely', 'birthday', 'halfterm', 'history', 'foodtravel')
   and updated_by = 'Epic (migration 275)'
   and not exists (select 1 from bo_changes c where c.subject_type = 'collection' and c.subject_id = browse_rows.key and c.who = 'Epic (migration 275)');

insert into bo_changes (who, area, what, before, after, why, subject_type, subject_id)
select 'Epic (migration 275)', 'Collections', 'Collection retired · ' || title, 'Off', 'Retired', retired_why, 'collection', key
  from browse_rows
 where key in ('fun', 'norush', 'neverdone') and retired_at is not null
   and not exists (select 1 from bo_changes c where c.subject_type = 'collection' and c.subject_id = browse_rows.key and c.who = 'Epic (migration 275)');
