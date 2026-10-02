-- Diet is one main choice plus two faith flags, not a bag of chips (Settings
-- revised v2, owner 1 Oct 2026). The redesign draws diet as a single dropdown
-- — None / Vegetarian / Vegan / Pescatarian — with Halal and Kosher as two
-- separate checkboxes that can combine with it (e.g. Vegetarian + Halal).
--
-- The old `member_constraints` rows of kind='diet' are folded onto the person
-- and removed. Nothing is dropped (owner, 1 Oct 2026 — "the list of dropped
-- values is empty"): a preference becomes a filter in the safe direction.
--   · vegan / vegetarian / pescatarian → the main diet (strictest wins)
--   · halal / kosher                   → the two booleans
--   · gluten-free                      → a Gluten allergen  (filters)
--   · dairy-free                       → a Milk allergen    (filters)
--   · no-pork                          → a "pork" dislike   (ranks)
--   · no-alcohol                       → an "alcohol" dislike (ranks)
--   · anything else (free text)        → the person's private note (allergen_note)
--
-- RECOVERABLE: every kind='diet' row is copied into `member_diet_archive` with
-- a timestamp before any delete, so nothing goes without an archived copy. A
-- later migration drops the archive once the owner has confirmed — never before.
-- The archive is named by content, not by this migration's number, so a
-- renumber at integration does not strand it.

-- 0. archive first — nothing deleted without a copy.
create table if not exists member_diet_archive (
  id uuid, member_id uuid, kind text, value text, concept_key text, concept_kind text,
  max_minutes integer, favourite boolean, created_at timestamptz, archived_at timestamptz not null default now()
);
insert into member_diet_archive (id, member_id, kind, value, concept_key, concept_kind, max_minutes, favourite, created_at)
  select id, member_id, kind, value, concept_key, concept_kind, max_minutes, favourite, created_at
    from member_constraints where kind = 'diet';

alter table members add column if not exists diet   text    not null default 'none';
alter table members add column if not exists halal  boolean not null default false;
alter table members add column if not exists kosher boolean not null default false;

-- Main diet: strictest wins, written as three ordered updates so vegan sticks.
update members m set diet = 'pescatarian'
  where exists (select 1 from member_constraints c where c.member_id = m.id and c.kind = 'diet' and lower(c.value) = 'pescatarian');
update members m set diet = 'vegetarian'
  where exists (select 1 from member_constraints c where c.member_id = m.id and c.kind = 'diet' and lower(c.value) = 'vegetarian');
update members m set diet = 'vegan'
  where exists (select 1 from member_constraints c where c.member_id = m.id and c.kind = 'diet' and lower(c.value) = 'vegan');

update members m set halal  = true where exists (select 1 from member_constraints c where c.member_id = m.id and c.kind = 'diet' and lower(c.value) = 'halal');
update members m set kosher = true where exists (select 1 from member_constraints c where c.member_id = m.id and c.kind = 'diet' and lower(c.value) = 'kosher');

-- gluten-free → a Gluten allergen; dairy-free → a Milk allergen (the safe
-- direction: a preference becomes a filter). Canonical UK-14 keys, so the
-- allergen migration that runs next leaves them untouched.
insert into member_constraints (member_id, kind, value)
  select member_id, 'allergen', 'gluten' from member_constraints where kind = 'diet' and lower(value) in ('gluten-free', 'gluten free', 'coeliac', 'celiac', 'no gluten')
  on conflict (member_id, kind, value) do nothing;
insert into member_constraints (member_id, kind, value)
  select member_id, 'allergen', 'milk' from member_constraints where kind = 'diet' and lower(value) in ('dairy-free', 'dairy free', 'lactose free', 'lactose-free', 'no dairy')
  on conflict (member_id, kind, value) do nothing;

-- no-pork → a pork dislike; no-alcohol → an alcohol dislike (these rank, never hide).
insert into member_constraints (member_id, kind, value)
  select member_id, 'dislike', 'pork' from member_constraints where kind = 'diet' and lower(value) in ('no-pork', 'no pork', 'pork-free')
  on conflict (member_id, kind, value) do nothing;
insert into member_constraints (member_id, kind, value)
  select member_id, 'dislike', 'alcohol' from member_constraints where kind = 'diet' and lower(value) in ('no-alcohol', 'no alcohol', 'teetotal', 'alcohol free', 'alcohol-free')
  on conflict (member_id, kind, value) do nothing;

-- Anything else filed under diet (genuine free text) → the person's private
-- note, the same as a free-text allergen. Never filters; never lost.
update members m
   set allergen_note = nullif(trim(both ' ,' from concat_ws(', ', nullif(m.allergen_note, ''), x.vals)), '')
  from (
    select member_id, string_agg(distinct value, ', ') as vals
      from member_constraints
     where kind = 'diet'
       and lower(value) not in ('vegan','vegetarian','pescatarian','halal','kosher',
         'gluten-free','gluten free','coeliac','celiac','no gluten',
         'dairy-free','dairy free','lactose free','lactose-free','no dairy',
         'no-pork','no pork','pork-free','no-alcohol','no alcohol','teetotal','alcohol free','alcohol-free')
     group by member_id
  ) x
 where x.member_id = m.id;

-- before/after counts, for the post-deploy report.
insert into settings_v2_migration_report (migration, metric, value)
  select 'diet', k, v from (values
    ('diet.rows_archived',        (select count(*) from member_diet_archive)),
    ('diet.people_vegan',         (select count(*) from members where diet = 'vegan')),
    ('diet.people_vegetarian',    (select count(*) from members where diet = 'vegetarian')),
    ('diet.people_pescatarian',   (select count(*) from members where diet = 'pescatarian')),
    ('diet.people_none',          (select count(*) from members where diet = 'none')),
    ('diet.halal',                (select count(*) from members where halal)),
    ('diet.kosher',               (select count(*) from members where kosher)),
    ('diet.gluten_free_to_allergen', (select count(distinct member_id) from member_constraints where kind='diet' and lower(value) in ('gluten-free','gluten free','coeliac','celiac','no gluten'))),
    ('diet.dairy_free_to_allergen',  (select count(distinct member_id) from member_constraints where kind='diet' and lower(value) in ('dairy-free','dairy free','lactose free','lactose-free','no dairy'))),
    ('diet.no_pork_to_dislike',   (select count(distinct member_id) from member_constraints where kind='diet' and lower(value) in ('no-pork','no pork','pork-free'))),
    ('diet.no_alcohol_to_dislike',(select count(distinct member_id) from member_constraints where kind='diet' and lower(value) in ('no-alcohol','no alcohol','teetotal','alcohol free','alcohol-free')))
  ) as t(k, v);

-- Now the rows are folded in and archived; remove the old representation.
delete from member_constraints where kind = 'diet';

-- Only the four values the dropdown offers are legal.
alter table members drop constraint if exists members_diet_check;
alter table members add  constraint members_diet_check
  check (diet in ('none', 'vegetarian', 'vegan', 'pescatarian'));
