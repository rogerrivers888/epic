-- A row is a title, a copy line and a rule. Nothing is ever filed into one.
--
-- The rows are the long scrollable list a household browses, and hearting one
-- is the highest-signal tap in the product (the Places redesign, 20 Sep 2026).
-- A row is a *question asked of every place*, so what it returns changes as
-- the places do — which is why there is no join table here putting places into
-- rows. There is a rule, and it is run.
--
-- **The rule is structured, and that is deliberate.** The design prototype
-- carries a shorthand string beside a JavaScript predicate and filters on the
-- predicate; editing the caption to "anything at all" leaves the row returning
-- exactly what it returned before. An editable field that changes nothing is
-- worse than a read-only one, because somebody will edit it, believe they have
-- changed what a household sees, and be wrong. So `predicate` is the rule, the
-- shorthand is rendered from it, and the two cannot come apart. The grammar is
-- in `domain/browseRows.js`.
--
-- **A heart belongs to a person, not to a household.** The prototype asks
-- "whose list is this?" on the first heart and attributes every heart after it
-- to them. A boolean on the row could not hold that, could not age a heart
-- ("hearted five months ago · fading" is a fact about one person's tap), and
-- could not tell "nobody has hearted this" from "0% of households heart it",
-- which the back office draws differently on purpose.

create table if not exists browse_rows (
  key        text primary key,
  -- The heading it sits under: Who's coming, The weather and the light, …
  grouping   text not null,
  title      text not null,
  -- The second line, where there is one. Most rows do not need one, and an
  -- empty one is not a failure to write it.
  copy       text,
  predicate  jsonb not null,
  position   integer not null default 100,
  active     boolean not null default true,
  -- Whether a person wrote it. A seeded row can be replaced by a later
  -- migration; one somebody edited may not be.
  seeded     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists browse_rows_group on browse_rows (grouping, position);

create table if not exists browse_row_hearts (
  row_key      text not null references browse_rows (key) on delete cascade,
  household_id uuid not null references households (id) on delete cascade,
  -- Whose heart it is. Not null: the first-heart question exists precisely so
  -- that no heart is anonymous, and a nullable column here would make "we did
  -- not ask" and "nobody" the same row.
  member_id    uuid not null references members (id) on delete cascade,
  hearted_at   timestamptz not null default now(),
  primary key (row_key, member_id)
);

create index if not exists browse_row_hearts_household on browse_row_hearts (household_id);
create index if not exists browse_row_hearts_row on browse_row_hearts (row_key);

-- The rows themselves, from the drawing, written against our own labels and
-- our own drawer keys rather than the prototype's invented ones.
--
-- Two of the drawing's rows are deliberately absent: "Ten minutes away" and
-- "Worth the drive". Both are about how far somewhere is, which belongs to one
-- fence (`domain/band.js`) and depends on who is asking. A row holding its own
-- idea of "near" would be a second fence, and the first thing it would do is
-- disagree with the first one.
insert into browse_rows (key, grouping, title, copy, predicate, position, seeded) values
  ('toddler',      'Who''s coming', 'Toddler-proof', null,
   '{"all":[{"attribute":"suits-ages","overlaps":[0,3]}]}', 10, true),
  ('little',       'Who''s coming', 'Little ones', null,
   '{"all":[{"attribute":"suits-ages","overlaps":[4,7]}]}', 20, true),
  ('older',        'Who''s coming', 'Older kids', null,
   '{"all":[{"attribute":"suits-ages","overlaps":[8,12]}]}', 30, true),
  ('teen',         'Who''s coming', 'Teenager-proof', 'Things they won''t sneer at.',
   '{"all":[{"attribute":"suits-ages","overlaps":[13,18]}]}', 40, true),
  ('allofyou',     'Who''s coming', 'All of you at once', null,
   '{"all":[{"attribute":"suits-ages","overlaps":[5,40]}]}', 50, true),
  ('twoofyou',     'Who''s coming', 'Just the two of you', null,
   '{"all":[{"attribute":"suits-ages","from":12},{"attribute":"how-smart","atLeast":2}]}', 60, true),
  ('onekid',       'Who''s coming', 'One kid, one grown-up', null,
   '{"all":[{"attribute":"suits-ages","overlaps":[4,12]},{"attribute":"how-busy-and-loud","atMost":2}]}', 70, true),
  ('grandparents', 'Who''s coming', 'Bring the grandparents', null,
   '{"all":[{"attribute":"step-free","yes":true},{"attribute":"how-much-walking","atMost":1}]}', 80, true),
  ('dog',          'Who''s coming', 'Bring the dog', null,
   '{"all":[{"attribute":"dog-friendly","yes":true},{"attribute":"indoor","yes":false}]}', 90, true),
  ('dayyourself',  'Who''s coming', 'A day to yourself', null,
   '{"all":[{"attribute":"suits-ages","from":16},{"attribute":"how-busy-and-loud","atMost":1}]}', 100, true),

  ('raining',      'The weather and the light', 'It''s raining again', null,
   '{"all":[{"attribute":"indoor","yes":true}]}', 110, true),
  ('dryrun',       'The weather and the light', 'Dry, and they can run', null,
   '{"all":[{"attribute":"indoor","yes":true},{"attribute":"how-much-walking","atLeast":3}]}', 120, true),
  ('toohot',       'The weather and the light', 'Too hot to think', null,
   '{"any":[{"attribute":"indoor","yes":true},{"subcategory":["water","woodland","caves-falls"]}]}', 130, true),
  ('stilllight',   'The weather and the light', 'Still light at nine', null,
   '{"all":[{"attribute":"indoor","yes":false},{"attribute":"how-long-a-day","atLeast":2}]}', 140, true),
  ('darkbyfour',   'The weather and the light', 'Dark by four', null,
   '{"all":[{"attribute":"indoor","yes":true},{"attribute":"how-long-a-day","atMost":2}]}', 150, true),
  ('beachoff',     'The weather and the light', 'The beach is off', null,
   '{"all":[{"not":{"subcategory":["coast"]}},{"attribute":"indoor","yes":true}]}', 160, true),

  ('twohours',     'How much day you''ve got', 'Two hours, tops', null,
   '{"all":[{"attribute":"how-long-a-day","atMost":1}]}', 170, true),
  ('halfday',      'How much day you''ve got', 'Half a day', null,
   '{"all":[{"attribute":"how-long-a-day","is":2}]}', 180, true),
  ('properday',    'How much day you''ve got', 'A proper day out', null,
   '{"all":[{"attribute":"how-long-a-day","atLeast":3}]}', 190, true),

  ('fun',          'What kind of day', 'Something fun', null,
   '{"all":[{"attribute":"how-much-you-learn","atMost":1},{"attribute":"how-much-planning","atMost":2}]}', 200, true),
  ('neverdone',    'What kind of day', 'Never done that before', null,
   '{"all":[{"attribute":"how-new","atLeast":3}]}', 210, true),
  ('wearout',      'What kind of day', 'Wear them out', null,
   '{"all":[{"attribute":"how-much-walking","atLeast":3}]}', 220, true),
  ('quiet',        'What kind of day', 'Somewhere quiet', null,
   '{"all":[{"attribute":"how-busy-and-loud","atMost":1},{"attribute":"how-much-planning","atMost":1}]}', 230, true),
  ('sneaky',       'What kind of day', 'Sneakily educational', 'They won''t notice they''re learning.',
   '{"all":[{"attribute":"how-much-you-learn","atLeast":3},{"attribute":"how-thrilling","atLeast":1}]}', 240, true),
  ('bigkids',      'What kind of day', 'Big kids', 'Go-karts, axe throwing and other things you''re too old for.',
   '{"all":[{"attribute":"suits-ages","from":8},{"attribute":"how-thrilling","atLeast":3},{"attribute":"how-much-you-learn","is":0}]}', 250, true),
  ('heartmouth',   'What kind of day', 'Heart in your mouth', null,
   '{"all":[{"attribute":"how-thrilling","atLeast":3}]}', 260, true),
  ('norush',       'What kind of day', 'No rush', null,
   '{"all":[{"attribute":"how-much-walking","atMost":1},{"attribute":"how-busy-and-loud","atMost":1}]}', 270, true),
  ('lovely',       'What kind of day', 'Somewhere lovely', null,
   '{"all":[{"attribute":"indoor","yes":false},{"attribute":"how-busy-and-loud","atMost":2}]}', 280, true),

  ('birthday',     'Occasions', 'Birthday', null,
   '{"all":[{"attribute":"how-busy-and-loud","atLeast":3},{"attribute":"food-on-site","yes":true}]}', 290, true),
  ('halfterm',     'Occasions', 'Half-term, day three', null,
   '{"all":[{"attribute":"suits-ages","overlaps":[4,12]},{"attribute":"how-much-walking","atLeast":2}]}', 300, true),
  ('goingout',     'Occasions', 'Going out in an hour', null,
   '{"all":[{"attribute":"booking-required","yes":false}]}', 310, true),
  ('booknext',     'Occasions', 'Book something for next month', null,
   '{"all":[{"attribute":"booking-required","yes":true}]}', 320, true),

  ('water',        'Passions', 'On the water', null,
   '{"all":[{"subcategory":["water","coast","lidos","pools","paddling"]}]}', 330, true),
  ('animals',      'Passions', 'Animals', null,
   '{"all":[{"subcategory":["zoos-wildlife","nature"]}]}', 340, true),
  ('engines',      'Passions', 'Engines', null,
   '{"all":[{"subcategory":["karting","circuits","racecourses","off-road"]}]}', 350, true),
  ('history',      'Passions', 'History you can walk around', null,
   '{"all":[{"subcategory":["historic-houses","museums","landmarks","castles","ancient-sites"]},{"attribute":"how-much-you-learn","atLeast":2}]}', 360, true),
  ('gethigh',      'Passions', 'Get up high', null,
   '{"all":[{"subcategory":["climbing","ropes","viewpoints","hills"]}]}', 370, true),
  ('foodtravel',   'Passions', 'Food you''d travel for', null,
   '{"all":[{"subcategory":["restaurants","pubs-bars","cafes"]},{"attribute":"how-smart","atLeast":2}]}', 380, true),
  ('gardens',      'Passions', 'Gardens and greenery', null,
   '{"all":[{"subcategory":["gardens","woodland","nature","parks"]}]}', 390, true),
  ('byhand',       'Passions', 'Made by hand', null,
   '{"all":[{"subcategory":["galleries","markets","food-markets"]}]}', 400, true)
on conflict (key) do nothing;
