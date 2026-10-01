-- Allergens become the UK's 14, and nothing else (Settings revised v2, owner
-- 1 Oct 2026). Allergens are a filter — they hide places that can't avoid them
-- — so a value that isn't one of the fourteen can't filter anything and must
-- not pretend to. The old list was a nine-item US-ish set ('shellfish',
-- 'wheat', 'soybeans', …); this maps it onto the fourteen and sends anything
-- free-text ("Other") to a private note on the person that no longer filters.
--
-- The fourteen (canonical lowercase keys), in the order the UI reveals them —
-- the eight commonest first, then the rest behind "Show all 14":
--   peanuts, tree nuts, milk, eggs, gluten, sesame, fish, crustaceans,
--   soya, celery, mustard, lupin, molluscs, sulphites
--
-- Mapping of note: 'egg'→eggs, 'wheat'/'cereals…'→gluten, 'soybeans'/'soy'→soya,
-- and 'shellfish' splits into BOTH crustaceans and molluscs (it named neither
-- precisely, and a filter must err towards hiding). Transform + delete, so it
-- is its own revertible number.

-- `allergen_note` was added in migration 317 (the person's private note).
--
-- RECOVERABLE: archive every kind='allergen' row before the transform touches
-- anything, so the original list is kept whatever the mapping does. Named by
-- content, not number, so a renumber at integration doesn't strand it; dropped
-- by a later migration only once the owner has confirmed.
create table if not exists member_allergen_archive (
  id uuid, member_id uuid, kind text, value text, concept_key text, concept_kind text,
  max_minutes integer, favourite boolean, created_at timestamptz, archived_at timestamptz not null default now()
);
insert into member_allergen_archive (id, member_id, kind, value, concept_key, concept_kind, max_minutes, favourite, created_at)
  select id, member_id, kind, value, concept_key, concept_kind, max_minutes, favourite, created_at
    from member_constraints where kind = 'allergen';

-- 1. shellfish named neither crustaceans nor molluscs precisely → both.
insert into member_constraints (member_id, kind, value)
  select member_id, 'allergen', 'crustaceans' from member_constraints where kind = 'allergen' and lower(value) = 'shellfish'
  on conflict (member_id, kind, value) do nothing;
insert into member_constraints (member_id, kind, value)
  select member_id, 'allergen', 'molluscs' from member_constraints where kind = 'allergen' and lower(value) = 'shellfish'
  on conflict (member_id, kind, value) do nothing;
delete from member_constraints where kind = 'allergen' and lower(value) = 'shellfish';

-- 2. write the canonical key alongside every row that maps to one of the 14.
--    (insert-then-delete rather than update, so a member who held both a
--    synonym and its canonical form doesn't trip the unique(member,kind,value).)
insert into member_constraints (member_id, kind, value)
  select member_id, 'allergen',
    case
      when lower(value) in ('wheat', 'cereals', 'cereals containing gluten', 'gluten') then 'gluten'
      when lower(value) in ('soybeans', 'soy', 'soya')                                 then 'soya'
      when lower(value) in ('egg', 'eggs')                                             then 'eggs'
      when lower(value) in ('tree nuts', 'treenuts', 'nuts')                           then 'tree nuts'
      when lower(value) in ('peanuts', 'peanut')                                       then 'peanuts'
      when lower(value) in ('milk', 'dairy')                                           then 'milk'
      when lower(value) = 'fish'                                                       then 'fish'
      when lower(value) = 'sesame'                                                     then 'sesame'
      when lower(value) = 'crustaceans'                                                then 'crustaceans'
      when lower(value) in ('molluscs', 'mollusks')                                    then 'molluscs'
      when lower(value) = 'celery'                                                     then 'celery'
      when lower(value) = 'mustard'                                                    then 'mustard'
      when lower(value) = 'lupin'                                                      then 'lupin'
      when lower(value) in ('sulphites', 'sulfites', 'sulphur dioxide', 'sulfur dioxide') then 'sulphites'
    end
  from member_constraints
  where kind = 'allergen'
    and lower(value) in ('wheat','cereals','cereals containing gluten','gluten','soybeans','soy','soya',
      'egg','eggs','tree nuts','treenuts','nuts','peanuts','peanut','milk','dairy','fish','sesame',
      'crustaceans','molluscs','mollusks','celery','mustard','lupin','sulphites','sulfites',
      'sulphur dioxide','sulfur dioxide')
  on conflict (member_id, kind, value) do nothing;

-- 3. free text that maps to nothing → a private note that never filters.
--    (Must exclude every synonym that step 2 just mapped, not only the
--    canonical fourteen — otherwise a capitalised original like 'Peanuts',
--    still present until step 4, would be swept into the note alongside the
--    genuine free text.)
update members m
   set allergen_note = nullif(trim(both ' ,' from concat_ws(', ', nullif(m.allergen_note, ''), x.vals)), '')
  from (
    select member_id, string_agg(distinct value, ', ') as vals
      from member_constraints
     where kind = 'allergen'
       and lower(value) not in ('wheat','cereals','cereals containing gluten','gluten','soybeans','soy','soya',
         'egg','eggs','tree nuts','treenuts','nuts','peanuts','peanut','milk','dairy','fish','sesame',
         'crustaceans','molluscs','mollusks','celery','mustard','lupin','sulphites','sulfites',
         'sulphur dioxide','sulfur dioxide')
     group by member_id
  ) x
 where x.member_id = m.id;

-- 4. keep only the canonical fourteen; synonyms and free text are gone.
delete from member_constraints
 where kind = 'allergen'
   and value not in ('peanuts','tree nuts','milk','eggs','gluten','sesame','fish','crustaceans',
                     'soya','celery','mustard','lupin','molluscs','sulphites');

-- counts for the post-deploy report.
insert into settings_v2_migration_report (migration, metric, value)
  select 'allergens', k, v from (values
    ('allergens.rows_archived',  (select count(*) from member_allergen_archive)),
    ('allergens.shellfish_split',(select count(*) from member_allergen_archive where lower(value) = 'shellfish')),
    ('allergens.people_with_any',(select count(distinct member_id) from member_constraints where kind = 'allergen')),
    ('allergens.other_to_note',  (select count(distinct member_id) from member_allergen_archive
       where lower(value) not in ('wheat','cereals','cereals containing gluten','gluten','soybeans','soy','soya',
         'egg','eggs','tree nuts','treenuts','nuts','peanuts','peanut','milk','dairy','fish','sesame',
         'crustaceans','molluscs','mollusks','celery','mustard','lupin','sulphites','sulfites',
         'sulphur dioxide','sulfur dioxide','shellfish')))
  ) as t(k, v);
