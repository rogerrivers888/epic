-- A drawer Google has no word for is still asked about.
--
-- The big census brief, 20 Sep 2026, §2: "Map the types for the five empty
-- subcategories before running… A subcategory with no mapped types generates
-- no queries, so it comes back zero — and zero is indistinguishable from
-- 'there are none in the south of England', which is obviously false for
-- climbing walls." Everything else in the taxonomy can be fixed after the
-- fact, because a mapping change re-maps for free; an unasked question cannot
-- be answered retrospectively.
--
-- Working the not-sure queue against the five turns up the reason they are
-- empty. **Google's Table A has no type for any of them.** There is no
-- climbing word, no rowing word, no zip-line word, no wakeboarding word, and
-- the nearest words — `sports_activity_location`, `sports_club` — stand for
-- hundreds of other things too. Teaching one of those as a rule would file
-- every gym class and five-a-side pitch under Climbing for ever, so those five
-- are asked as words fenced by a type instead, in `sources/censusQuestions.js`,
-- which is a question and not a mapping.
--
-- Three real types did turn up, and they are mappings: an airstrip, a heliport
-- and an aircraft rental service are Flying & skydiving whoever finds them and
-- whatever asked. They are taught here so that a place carrying one is filed
-- there by the ordinary rules, not only when the census happens to ask.
insert into shelf_rules (scope, subject, subject_label, subcategory, labels, reason, taught_by, seeded)
select 'labels', v.type_key, v.label, 'flying', array[v.type_key], v.reason,
       'the big census brief (20 Sep 2026)', false
  from (values
    ('google:airstrip',                'Airstrip',
     'Table A has no flying word; an airstrip is the nearest real type, and it is one.'),
    ('google:heliport',                'Heliport',
     'Pleasure flights and lessons operate from heliports, and nothing else claimed the type.'),
    ('google:aircraft_rental_service', 'Aircraft rental service',
     'Where a flying lesson is actually bought. Unmapped until now.')
  ) as v(type_key, label, reason)
 where exists (select 1 from shelf_subcategories s where s.key = 'flying' and s.active)
   and not exists (
     select 1 from shelf_rules r
      where r.scope = 'labels' and r.subcategory = 'flying' and r.labels @> array[v.type_key]);
