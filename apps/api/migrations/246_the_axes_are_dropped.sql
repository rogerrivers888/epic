-- The eight graded axes are cancelled, and two facts take their place.
--
-- "Epic — The axes are dropped: build brief" (25 Sep 2026). The eight 0–4
-- scales migration 216 seeded — how thrilling, how much walking, how much
-- planning, how new, how busy, how much you learn, how smart, how long a day —
-- each failed on review: a duplicate of a category or of the Epic score, a
-- property of the household rather than the place, or a judgement no person
-- could make twice the same way and no machine could read. The governing test
-- is now in CLAUDE.md: if a value cannot be extracted from text, it cannot
-- exist at Epic's scale.
--
-- **Deactivated, never deleted.** The `scale` kind stays in the check
-- constraint and `level` stays on every table that carries it, because
-- production may hold values under these labels and a retirement that breaks a
-- place is not a retirement. Nothing reads an inactive label: `resolveFor`,
-- `drawerOf` and the rows' `pool()` all skip it, so a value that is still in
-- the table is a value nobody is shown.
--
-- What survives is categories with primary and secondary filing, yes/no
-- labels, ranges, a cost band, and question sets per kind of place.

-- ---------------------------------------------------------------------------
-- 1. A ninth category: Educational.
--
-- Distinct from Culture. A castle is Culture; a science centre is Educational;
-- a farm with a learning barn is Educational and not Culture at all. The
-- cabinet is seeded here because a cabinet is structure; its drawers and the
-- existing drawers that list it as a second cabinet (Museums as Culture
-- primary, Educational secondary) go through the signed-off cleanup in
-- `domain/taxonomyCleanup.js`, so they are grouped, reversible and recorded
-- like the rest of that document.
-- ---------------------------------------------------------------------------
insert into shelf_categories (key, label, blurb, icon, position, is_door, seeded) values
  ('educational', 'Educational', 'You come away knowing something: a science centre, a planetarium, a farm with a learning barn.', 'learn', 35, false, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Two new labels, both extractable from a venue page.
--
-- Duration is a range in the same shape as Suits ages: a from and a to, in
-- minutes. The brief's four bands — roughly an hour, two to three hours, half
-- a day, all day — are 45–90, 120–180, 180–300 and 300–480. Minutes rather
-- than hours because a range holds whole numbers and half an hour is one.
--
-- Cost band was missing from the label set entirely, and "what is this going
-- to cost us" is among the first questions any family asks.
-- ---------------------------------------------------------------------------
insert into place_attributes (key, label, kind, blurb, options, range_min, range_max, unit, position, seeded) values
  ('duration',  'Duration',  'range', 'How long a family is actually there. Roughly an hour is 45 to 90; two to three hours 120 to 180; half a day 180 to 300; all day 300 to 480.',
   '{}', 0, 720, 'minutes', 64, true),
  ('cost-band', 'Cost band', 'oneof', 'What it is going to cost, per person, roughly.',
   array['free', 'cheap', 'moderate', 'expensive'], null, null, null, 65, true)
on conflict (key) do nothing;

-- Asked of every place, the way step free and parking are (migration 207), so
-- the free-data sweep answers them from the venue's own page.
insert into questions (attribute_key, scope, gate, refresh_days, position) values
  ('duration',  'global', false, 365, 60),
  ('cost-band', 'global', false, 180, 70)
on conflict do nothing;

-- So the harvest cannot raise either as a new word (migration 211's rule).
insert into attribute_aliases (norm, target_key, raw) values
  ('duration',        'duration',  'Duration'),
  ('how long',        'duration',  'How long'),
  ('length of visit', 'duration',  'Length of visit'),
  ('cost',            'cost-band', 'Cost'),
  ('price',           'cost-band', 'Price'),
  ('admission',       'cost-band', 'Admission'),
  ('entry fee',       'cost-band', 'Entry fee'),
  ('free entry',      'cost-band', 'Free entry')
on conflict (norm) do nothing;

-- ---------------------------------------------------------------------------
-- Subcategory defaults, proposed rather than set.
--
-- `settled` is false on every row written here: a default arrives proposed
-- and a person accepts, corrects or leaves it (migration 216's rule for the
-- Categories screen). Duration is read off `typical_minutes` (migration 067),
-- which has said how long a drawer is worth since the trip planner needed it,
-- banded to the four the brief names. A drawer under 45 minutes — a café, a
-- takeaway, a viewpoint, a church — is not "roughly an hour" and gets no
-- default: the four bands do not describe a quick stop, and saying so is the
-- gap report's job, not a migration's.
-- ---------------------------------------------------------------------------
insert into shelf_subcategory_attributes (subcategory_key, attribute_key, from_value, to_value, settled)
select key, 'duration',
       case when typical_minutes < 105 then 45
            when typical_minutes <= 210 then 120
            when typical_minutes < 300 then 180
            else 300 end,
       case when typical_minutes < 105 then 90
            when typical_minutes <= 210 then 180
            when typical_minutes < 300 then 300
            else 480 end,
       false
  from shelf_subcategories
 where typical_minutes is not null and typical_minutes >= 45
on conflict (subcategory_key, attribute_key) do nothing;

-- Cost band: only the drawers that are free to walk into by their nature —
-- open country, the coast, a viewpoint, a war memorial, a splash pad. Anything
-- with a gate is left for the sweep to read off the venue's page.
insert into shelf_subcategory_attributes (subcategory_key, attribute_key, choice, settled)
select key, 'cost-band', 'free', false
  from shelf_subcategories
 where key in ('parks', 'woodland', 'coast', 'water', 'hills', 'nature', 'viewpoints', 'trails',
               'scenic', 'monuments-memorials', 'splash-pads')
on conflict (subcategory_key, attribute_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The eight, retired.
-- ---------------------------------------------------------------------------
update place_attributes set active = false, updated_at = now() where kind = 'scale';

-- Their aliases go, so no harvested word resolves to a retired label and a
-- promotion cannot land a question on one. The harvest raising "thrilling"
-- again is fine: it is an opinion, and opinions go to the holding pen.
delete from attribute_aliases where target_key in (select key from place_attributes where kind = 'scale');

-- A row whose rule names an axis is switched off, its rule left as it was:
-- these are being rewritten and will arrive from the Rows work, and the rewrite
-- needs to see what the row meant. A retired label answers nothing, so a row
-- left on would return nothing for ever and read as a row nobody could fill.
update browse_rows set active = false, updated_at = now()
 where predicate::text ~ '"(how-thrilling|how-much-walking|how-much-planning|how-new|how-busy-and-loud|how-much-you-learn|how-smart|how-long-a-day)"';

-- The one rewrite the design brief states outright ("Rows and hearting, design
-- brief v2", 24 Sep 2026, phase one): Bring the grandparents is step free,
-- parking, toilets. Only where the row is still the seeded one — a row somebody
-- has edited is theirs.
update browse_rows
   set predicate = '{"all":[{"attribute":"step-free","yes":true},{"attribute":"parking","yes":true},{"attribute":"toilets","yes":true}]}'::jsonb,
       active = true, updated_at = now()
 where key = 'grandparents' and seeded;
