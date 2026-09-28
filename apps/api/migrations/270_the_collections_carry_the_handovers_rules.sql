-- The collections carry the handover's rules and copy lines (back-office
-- handover 4.11; prototype `ROW_RULES` and `ROWS`, 28 Sep 2026).
--
-- The rows seeded by migration 225 were written in the older predicate form,
-- and twenty-two of them ask about the eight graded axes that migration 246
-- retired (how-long-a-day, how-thrilling, …). Those rows answer nothing, so
-- 246 switched them off. The desk's editor reads `browse_rows.rule`; this
-- writes the prototype's rule there for each of them, in our own keys, so the
-- editor opens each one with pills that mean what the handover says.
--
-- What it touches, and what it leaves:
--
--   * `rule` is written only on a seeded row with no rule yet whose predicate
--     is empty or names a retired axis. A row somebody has saved in the
--     editor has a rule and is theirs; a row whose old predicate still runs
--     keeps it (the editor shows it as it is, read-only where the pills could
--     not say it exactly).
--   * `active` is not changed on any existing row. The app a household uses
--     still reads `predicate`, and a row switched on with a retired
--     predicate would show an empty shelf. Turning one on is saving it in the
--     editor, which is a person's act and in Changes.
--   * `copy` is written where a row has none, and where the one it has is
--     the prototype's with straight apostrophes; titles likewise only where
--     the difference is the apostrophe. Curly, as the prototype writes them.
--   * Two rows are added, as the prototype defines them: "Costs nothing"
--     (cost band free) and "Cheap and cheerful" (cost band cheap, no booking
--     required), each with a rule and a predicate the app can run, live.
--   * Nothing is deleted. "Ten minutes away" and "Worth the drive" stay out,
--     as 225 left them out on purpose (distance is one fence, not a row). The
--     build's own three — Something fun, No rush, Made by hand — are left
--     exactly as they are; they are not in the prototype. "Never done that
--     before" is left too: its prototype rule is empty ("not visited by this
--     household" is applied at display), and an empty rule would count every
--     place.
--
-- Subcategory and category keys are the prototype's mapped to ours, and each
-- is kept only if it exists here, so the migration cannot write a rule naming
-- a drawer this database does not hold. Idempotent: every write is guarded by
-- the state it changes.

create or replace function pg_temp.keep_subs(keys text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k, 'not', false) order by ord), '[]'::jsonb)
    from unnest(keys) with ordinality as u(k, ord)
   where exists (select 1 from shelf_subcategories s where s.key = u.k and s.active)
$$;

create or replace function pg_temp.keep_cats(keys text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k, 'not', false) order by ord), '[]'::jsonb)
    from unnest(keys) with ordinality as u(k, ord)
   where exists (select 1 from shelf_categories c where c.key = u.k and c.active)
$$;

-- A fact item, positive or "not", kept only if the fact is one of ours.
create or replace function pg_temp.keep_facts(keys text[], nots boolean[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k, 'not', n) order by ord), '[]'::jsonb)
    from unnest(keys, nots) with ordinality as u(k, n, ord)
   where exists (select 1 from place_attributes a where a.key = u.k and a.active)
$$;

drop table if exists pg_temp.handover_rows;
drop table if exists pg_temp.handover_rules;
create temporary table handover_rows (
  key text primary key, title text, copy text, cats text[], subs text[], facts text[], nots boolean[],
  ages int[], dur int[], cost text[], age_span boolean default false, primary_cat text
);

insert into handover_rows (key, title, copy, cats, subs, facts, nots, ages, dur, cost, age_span, primary_cat) values
  ('toddler',      'Toddler-proof',                 'Nothing too high, too fast or too far from a toilet.',          null, null, null, null, '{0,3}', null, null, false, null),
  ('little',       'Little ones',                   'Big enough to be exciting, small enough to cope.',             null, null, null, null, '{4,7}', null, null, false, null),
  ('older',        'Older kids',                    'Old enough to want a go, young enough to still say yes.',       null, null, null, null, '{8,12}', null, null, false, null),
  ('teen',         'Teenager-proof',                'Things they won’t sneer at.',                                   null, null, null, null, '{13,18}', null, null, false, null),
  ('allofyou',     'All of you at once',            'Somewhere the youngest and the oldest both enjoy.',            null, null, null, null, '{5,40}', null, null, false, null),
  ('twoofyou',     'Just the two of you',           'A proper grown-up day, for once.',                              null, null, null, null, '{16,99}', null, null, false, null),
  ('onekid',       'One kid, one grown-up',         'Easy for one adult to manage on their own.',                    null, null, null, null, '{12,18}', null, null, false, null),
  ('grandparents', 'Bring the grandparents',        'Level paths, a car park and a loo nearby.',                     null, null, null, null, null, null, null, false, null),
  ('dog',          'Bring the dog',                 'Everyone’s welcome, including the one with four legs.',         null, null, null, null, null, null, null, false, null),
  ('dayyourself',  'A day to yourself',             'Nobody needs anything from you.',                               '{relaxing}', null, null, null, '{16,99}', null, null, false, null),
  ('raining',      'It’s raining again',            'Dry for the whole visit, door to door.',                        null, null, null, null, null, null, null, false, null),
  ('dryrun',       'Dry, and they can run',         'Indoors, with room to let off steam.',                          '{activity,fun}', null, '{indoor}', '{false}', '{4,12}', null, null, false, null),
  ('toohot',       'Too hot to think',              'Shade, water or air conditioning.',                             null, null, null, null, null, null, null, false, null),
  ('stilllight',   'Still light at nine',           'Evenings are long — use them.',                                 null, null, '{indoor}', '{true}', null, null, null, false, null),
  ('darkbyfour',   'Dark by four',                  'Short, bright and back before teatime.',                        null, null, '{indoor}', '{false}', null, '{0,2}', null, false, null),
  ('beachoff',     'The beach is off',              'Sheltered, inland, and no sand anywhere.',                      null, null, null, null, null, null, null, false, null),
  ('twohours',     'Two hours, tops',               'In and out before anyone gets tired.',                          null, null, null, null, null, '{0,2}', null, false, null),
  ('halfday',      'Half a day',                    'A morning or an afternoon, not both.',                          null, null, null, null, null, '{3,4}', null, false, null),
  ('properday',    'A proper day out',              'Pack lunch. You’ll be there all day.',                          null, null, null, null, null, '{5,12}', null, false, null),
  ('bigkids',      'Big kids',                      'Go-karts, axe throwing and other things you’re too old for.',   '{fun,adrenaline}', null, null, null, '{12,60}', null, null, true, null),
  ('sneaky',       'Sneakily educational',          'They won’t notice they’re learning.',                           '{educational}', null, null, null, null, null, null, false, 'fun'),
  ('heartmouth',   'Heart in your mouth',           'For the one who always wants to go faster.',                    '{adrenaline}', null, null, null, null, null, null, false, null),
  ('wearout',      'Wear them out',                 'They’ll sleep in the car on the way home.',                     '{activity,adrenaline}', '{play}', null, null, '{4,12}', null, null, false, null),
  ('neverdone',    'Never done that before',        'Something new for everyone in the car.',                        null, null, null, null, null, null, null, false, null),
  ('costsnothing', 'Costs nothing',                 'Free to get in. Bring a flask.',                                null, null, null, null, null, null, '{Free}', false, null),
  ('cheapcheerful','Cheap and cheerful',            'A good day that doesn’t need a budget meeting.',                null, null, '{booking-required}', '{true}', null, null, '{Cheap}', false, null),
  ('lovely',       'Somewhere lovely',              'Worth it for the view alone.',                                  null, '{gardens,coast,woodland,parks}', null, null, null, null, null, false, null),
  ('quiet',        'Somewhere quiet',               'Room to think, and no queue.',                                  '{relaxing,outdoors}', null, '{booking-required}', '{true}', null, null, null, false, null),
  ('birthday',     'Birthday',                      'Somewhere that does a party properly.',                         null, '{play,cinema-bowling,karting,climbing,skating,theme-parks,science-learning-centres}', '{food-on-site}', '{false}', null, null, null, false, null),
  ('halfterm',     'Half-term, day three',          'You’ve done the park. Try this.',                               null, null, null, null, '{4,12}', null, null, false, null),
  ('goingout',     'Going out in an hour',          'No booking, no faff. Just go.',                                 null, null, null, null, null, null, null, false, null),
  ('booknext',     'Book something for next month', 'The good ones sell out. Get in early.',                         null, null, null, null, null, null, null, false, null),
  ('water',        'On the water',                  'Boats, paddles, lakes and splashing.',                          null, null, null, null, null, null, null, false, null),
  ('animals',      'Animals',                       'Feed them, stroke them, or just watch.',                        null, null, null, null, null, null, null, false, null),
  ('engines',      'Engines',                       'Loud, fast and smelling of petrol.',                            null, null, null, null, null, null, null, false, null),
  ('history',      'History you can walk around',   'Old places you can actually walk around.',                      null, '{historic-houses,museums,landmarks}', null, null, null, null, null, false, null),
  ('gethigh',      'Get up high',                   'A view from the top, earned the hard way.',                     null, null, null, null, null, null, null, false, null),
  ('foodtravel',   'Food you’d travel for',         'Worth planning the whole day around.',                          null, '{pubs-bars}', null, null, null, null, null, false, null),
  ('gardens',      'Gardens and greenery',          'Green, calm and good for a wander.',                            null, null, null, null, null, null, null, false, null);

-- The rule, in the desk's model, for the rows that carry one here.
create temporary table handover_rules as
select h.key,
       jsonb_build_object(
         'cats', case when h.cats is null then '[]'::jsonb else pg_temp.keep_cats(h.cats) end,
         'subs', case when h.subs is null then '[]'::jsonb else pg_temp.keep_subs(h.subs) end,
         'facts', case when h.facts is null then '[]'::jsonb else pg_temp.keep_facts(h.facts, h.nots) end,
         'ages', case when h.ages is null then 'null'::jsonb else to_jsonb(h.ages) end,
         'dur', case when h.dur is null then 'null'::jsonb else to_jsonb(h.dur) end,
         'cost', coalesce(to_jsonb(h.cost), '[]'::jsonb),
         'ageSpan', h.age_span,
         'primaryCat', case when h.primary_cat is not null and exists (select 1 from shelf_categories c where c.key = h.primary_cat and c.active)
                            then to_jsonb(h.primary_cat) else 'null'::jsonb end
       ) as rule
  from handover_rows h
 where h.cats is not null or h.subs is not null or h.facts is not null or h.ages is not null
    or h.dur is not null or h.cost is not null;

-- 1. The rule, where the row has none and its predicate is empty or dead.
update browse_rows b
   set rule = r.rule, updated_at = now()
  from handover_rules r
 where b.key = r.key and b.seeded and b.rule is null
   and (b.predicate = '{}'::jsonb
        or b.predicate::text ~ '"(how-thrilling|how-much-walking|how-much-planning|how-new|how-busy-and-loud|how-much-you-learn|how-smart|how-long-a-day)"')
   -- A rule that lost every drawer it named to this database says nothing.
   and (jsonb_array_length(r.rule->'cats') + jsonb_array_length(r.rule->'subs') + jsonb_array_length(r.rule->'facts') > 0
        or r.rule->'ages' <> 'null'::jsonb or r.rule->'dur' <> 'null'::jsonb or jsonb_array_length(r.rule->'cost') > 0);

-- 2. The copy line, where there is none, or it is the prototype's with
--    straight apostrophes.
update browse_rows b
   set copy = h.copy, updated_at = now()
  from handover_rows h
 where b.key = h.key and b.seeded
   and (coalesce(btrim(b.copy), '') = '' or replace(h.copy, '’', '''') = b.copy)
   and b.copy is distinct from h.copy;

-- 3. The title, only where the difference is the apostrophe.
update browse_rows b
   set title = h.title, updated_at = now()
  from handover_rows h
 where b.key = h.key and b.seeded
   and replace(h.title, '’', '''') = b.title and b.title is distinct from h.title;

-- 4. The two the prototype defines that were never seeded. The predicate is
--    the app's form of the same rule, so a household sees what the desk
--    counts; `seeded`, so a later migration may still correct it until a
--    person saves it.
insert into browse_rows (key, grouping, title, copy, predicate, rule, position, active, seeded)
select 'costsnothing', 'What kind of day', h.title, h.copy,
       '{"all":[{"attribute":"cost-band","choice":"free"}]}'::jsonb, r.rule, 211, true, true
  from handover_rows h join handover_rules r on r.key = h.key
 where h.key = 'costsnothing'
   and exists (select 1 from place_attributes a where a.key = 'cost-band' and a.active and 'free' = any(a.options))
on conflict (key) do nothing;

insert into browse_rows (key, grouping, title, copy, predicate, rule, position, active, seeded)
select 'cheapcheerful', 'What kind of day', h.title, h.copy,
       '{"all":[{"attribute":"cost-band","choice":"cheap"},{"attribute":"booking-required","yes":false}]}'::jsonb, r.rule, 212, true, true
  from handover_rows h join handover_rules r on r.key = h.key
 where h.key = 'cheapcheerful'
   and exists (select 1 from place_attributes a where a.key = 'cost-band' and a.active and 'cheap' = any(a.options))
   and exists (select 1 from place_attributes a where a.key = 'booking-required' and a.active)
on conflict (key) do nothing;

drop table if exists pg_temp.handover_rows;
drop table if exists pg_temp.handover_rules;
