-- A question that has been settled says so.
--
-- Owner, 19 Sep 2026: "Free data stays in the back office. Experiment 1 settles
-- it: record the result on the board as the standing verdict, with the date, so
-- nobody re-runs the question by accident."
--
-- The data programme's questions are expensive to ask and cheap to ask twice.
-- Experiment 1 took a day to build, a hundred and fourteen Google calls and two
-- wrong fences to arrive at "Google has essentially everything" — and nothing
-- anywhere records that, so the next person to wonder starts from the top.
--
-- A verdict is not a measurement. `evidence` holds the numbers it was drawn
-- from, and `decided_on` is the date it was drawn, so a reader can see how old
-- the answer is and decide whether the ground has moved. `supersedes` lets a
-- later verdict point at the one it replaces rather than deleting it: being
-- able to read what we used to believe, and when we stopped, is the point.

create table if not exists data_verdicts (
  key          text primary key,          -- 'residual.free-data', 'pages.thin'
  question     text not null,             -- what was asked, in plain words
  verdict      text not null,             -- what was decided, in plain words
  -- The numbers behind it. Never a provider's content: counts and rates only.
  evidence     jsonb not null default '{}'::jsonb,
  -- Where it was measured and how wide, because a verdict from one outcode is
  -- not a verdict about the country and must not read as one.
  scope        text,
  method       text,
  -- What would make this worth asking again. A verdict with no trigger is a
  -- belief rather than a decision.
  revisit_when text,
  decided_on   date not null default current_date,
  decided_by   text,
  supersedes   text references data_verdicts(key) on delete set null
);

insert into data_verdicts (key, question, verdict, evidence, scope, method, revisit_when, decided_on, decided_by)
values
  ('residual.free-data',
   'Does Google miss enough places that open data has to reach the app?',
   'No. Free data stays in the back office.',
   '{"osm_named": 114, "on_google_at_150m": 93, "rescued_at_400m_to_2500m": 14, "genuine_residual": 7, "credible_residual": 0, "credible_rate_pct": 0, "threshold_pct": 5}'::jsonb,
   'SL5, 4 km box, 19 Sep 2026',
   'Every named OpenStreetMap place asked of Google by name on the IDs Only mask, at a 150 m fence and then again at 400 m, 1 km and 2.5 km.',
   'A district where the credible residual clears 5%, or a country outside the UK where OpenStreetMap is stronger than Google.',
   date '2026-09-19', 'owner'),
  ('pages.thin',
   'How often is what a household opens too thin to be worth showing?',
   'Two per cent. V2 enrichment does not reopen.',
   '{"places": 102, "no_hours": 5, "no_photo": 0, "no_summary": 63, "thin_two_of_three": 2, "thin_rate_pct": 2, "threshold_pct": 15}'::jsonb,
   'SL5, 4 km box, 19 Sep 2026',
   'Six display searches, counting how many of hours, a photograph and a summary each returned place is missing. Thin is missing two of the three.',
   'A thin rate above 15% on what households actually open, measured from the search log rather than from a sample.',
   date '2026-09-19', 'owner')
on conflict (key) do nothing;
