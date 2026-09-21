-- Riding is not off-roading, and a stable is not a facility.
--
-- The owner, 21 Sep 2026: "add a Riding & stables drawer, with sport=equestrian
-- and leisure=horse_riding mapped to it and a Google question… Move them out of
-- Off-road." 235 had filed both under Off-road & quad biking as the nearest
-- drawer that existed, and said so at the time; this is the drawer they wanted.
--
-- **Google does have a word for it, and it is not the one expected.** There is
-- no `horse_riding` type in Table A (checked against googleTypes.js, read
-- 2026-09-12). There is `stable`, filed by Google under Facilities beside
-- public baths — which is why 125's sweep of shops and services took it out as
-- `aside`. A riding stable is a day out, so it comes back in and points here.
-- That means this drawer gets a real type-fenced question rather than the bare
-- text the owner offered as the fallback.
insert into shelf_subcategories (key, label, category_key, active)
select 'riding-stables', 'Riding & stables', 'activity', true
 where exists (select 1 from shelf_categories where key = 'activity')
    on conflict (key) do update set label = excluded.label, active = true, updated_at = now();

-- The two OSM tags move out of Off-road.
update shelf_rules
   set subcategory = 'riding-stables', updated_at = now()
 where subject in ('osm:sport=equestrian', 'osm:leisure=horse_riding')
   and exists (select 1 from shelf_subcategories where key = 'riding-stables');

-- `stable` comes back in and brings its places with it.
update taxonomy_labels
   set decision = null, points_at = 'riding-stables', active = true, updated_at = now()
 where namespace = 'google' and key = 'stable'
   and exists (select 1 from shelf_subcategories where key = 'riding-stables');

insert into shelf_rules (scope, subject, subject_label, subcategory, labels, weights, taught_by, reason)
select 'labels', 'google:stable', 'Stable', 'riding-stables', array['google:stable'], '{}'::jsonb, 'Epic',
       'Google files a stable under Facilities, beside public baths, which is how 125 came to sweep it out with the services. A riding stable is a day out.'
 where exists (select 1 from shelf_subcategories where key = 'riding-stables')
    on conflict (scope, subject) do update
       set subcategory = excluded.subcategory, updated_at = now();

-- Two drawers superseded by section 4 and left behind empty.
--
-- The owner, 21 Sep 2026: "retire indoor-golf-course and paintball-center; both
-- superseded and empty." Their rules move first. Retiring a drawer that still
-- holds rules would leave them filing into something switched off, which is the
-- same fault 233 refused to commit when it would not retire a half-emptied
-- Landmarks.
update shelf_rules set subcategory = 'golf', updated_at = now()
 where subcategory = 'indoor-golf-course'
   and exists (select 1 from shelf_subcategories where key = 'golf');

update shelf_rules set subcategory = 'paintball-lasertag', updated_at = now()
 where subcategory = 'paintball-center'
   and exists (select 1 from shelf_subcategories where key = 'paintball-lasertag');

update taxonomy_labels set points_at = 'golf', updated_at = now()
 where points_at = 'indoor-golf-course'
   and exists (select 1 from shelf_subcategories where key = 'golf');

update taxonomy_labels set points_at = 'paintball-lasertag', updated_at = now()
 where points_at = 'paintball-center'
   and exists (select 1 from shelf_subcategories where key = 'paintball-lasertag');

-- Only once nothing points at them.
update shelf_subcategories set active = false, updated_at = now()
 where key in ('indoor-golf-course', 'paintball-center')
   and not exists (select 1 from shelf_rules r where r.subcategory = shelf_subcategories.key);
