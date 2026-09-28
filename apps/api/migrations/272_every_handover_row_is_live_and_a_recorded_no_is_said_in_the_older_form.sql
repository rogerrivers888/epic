-- Every handover row is live, and a recorded No is said in the older form
-- (audit 2 of the back office, 28 Sep 2026). A follow-on to 270, never an
-- edit of it: 270 has run.
--
-- 1. Live. The design README: "Every row is live." 270 wrote the handover's
--    rule onto the seeded rows whose predicate was empty or asked a retired
--    axis, and left `active` as it found it — off, for these nineteen:
--
--      twoofyou, onekid, dayyourself, dryrun, stilllight, darkbyfour,
--      twohours, halfday, properday, bigkids, sneaky, heartmouth, wearout,
--      lovely, quiet, birthday, halfterm, history, foodtravel
--
--    They are switched on here. Only a row nobody has saved in the editor
--    (`updated_by is null`) and that carries a rule is touched; a person's
--    save already set `active` itself, and is theirs.
--
--    Note for whoever reads the app side: the household app still reads
--    `predicate`, and for most of the nineteen that is the retired-axis form
--    (the desk counts by `rule`). This migration does not rewrite those
--    predicates; that is a separate decision.
--
-- 2. A recorded No. Three handover rules mean a place answered No, which the
--    desk's rule model cannot say — its "not" is the absence of a yes, and a
--    place nobody has asked answers the two differently:
--
--      stilllight     Outdoors             = Indoors: No
--      quiet          No booking required  = Booking required: No
--      cheapcheerful  No booking required  = Booking required: No
--
--    So their `rule` is set back to null and their `predicate` is the exact
--    older form, which the desk shows read-only and counts by (and the app
--    runs). stilllight's and quiet's old predicates asked retired axes
--    (how-long-a-day, how-busy-and-loud, how-much-planning) and are replaced
--    with the handover's; cheapcheerful's was already exact and is rewritten
--    to the same value only where it differs. quiet's categories are kept
--    only where they exist here.
--
-- 3. Left exactly as they are: the rows whose older predicate still works and
--    differs from the prototype's ROW_RULES, because the rule model cannot
--    say them or they are a deliberate local reading —
--
--      grandparents   step free AND parking AND toilets (pills would read "any of")
--      dog            dog friendly AND indoors: No (a recorded No)
--      toohot         indoors OR water/woodland/caves — an OR across groups
--      beachoff       not coast AND indoors
--      water, animals, engines, gethigh, gardens
--                     our own drawer keys for the prototype's lists
--
--    and the rows that already match it (toddler, little, older, teen,
--    allofyou, raining, goingout, booknext, costsnothing), and the build's own
--    three (fun, norush, byhand) and neverdone, as 270 left them.
--
-- Idempotent: every write is guarded by the state it changes.

-- 1. Live.
update browse_rows
   set active = true, updated_at = now()
 where seeded and not active and rule is not null and updated_by is null
   and key in ('twoofyou', 'onekid', 'dayyourself', 'dryrun', 'stilllight', 'darkbyfour',
               'twohours', 'halfday', 'properday', 'bigkids', 'sneaky', 'heartmouth', 'wearout',
               'lovely', 'quiet', 'birthday', 'halfterm', 'history', 'foodtravel');

-- 2. A recorded No, in the older form.
update browse_rows
   set rule = null, predicate = '{"all":[{"attribute":"indoor","yes":false}]}'::jsonb, active = true, updated_at = now()
 where key = 'stilllight' and seeded and updated_by is null
   and exists (select 1 from place_attributes a where a.key = 'indoor' and a.active)
   and (rule is not null or predicate is distinct from '{"all":[{"attribute":"indoor","yes":false}]}'::jsonb);

with cats as (
  select coalesce(jsonb_agg(k order by ord), '[]'::jsonb) as keys
    from unnest(array['relaxing', 'outdoors']) with ordinality as u(k, ord)
   where exists (select 1 from shelf_categories c where c.key = u.k and c.active)
), pred as (
  select case when jsonb_array_length(keys) > 0
              then jsonb_build_object('all', jsonb_build_array(
                     jsonb_build_object('category', keys),
                     jsonb_build_object('attribute', 'booking-required', 'yes', false)))
              else jsonb_build_object('all', jsonb_build_array(
                     jsonb_build_object('attribute', 'booking-required', 'yes', false)))
         end as p
    from cats
)
update browse_rows b
   set rule = null, predicate = pred.p, active = true, updated_at = now()
  from pred
 where b.key = 'quiet' and b.seeded and b.updated_by is null
   and exists (select 1 from place_attributes a where a.key = 'booking-required' and a.active)
   and (b.rule is not null or b.predicate is distinct from pred.p);

update browse_rows
   set rule = null,
       predicate = '{"all":[{"attribute":"cost-band","choice":"cheap"},{"attribute":"booking-required","yes":false}]}'::jsonb,
       updated_at = now()
 where key = 'cheapcheerful' and seeded and updated_by is null
   and (rule is not null
        or predicate is distinct from '{"all":[{"attribute":"cost-band","choice":"cheap"},{"attribute":"booking-required","yes":false}]}'::jsonb);
