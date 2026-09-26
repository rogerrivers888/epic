-- No second Google pass on the vocabulary harvest.
--
-- The owner, 26 Sep 2026: "No second Google pass. The 21 Sep run is
-- conclusive — 41,816 words, nought promotable, and the commonest are staff,
-- delicious, friendly. Record that verdict so nobody proposes it a third time."
--
-- The run this is about: 21 Sep 2026 07:51, 295 Text Search requests at the
-- Enterprise + Atmosphere tier (`places.id,places.reviewSummary`), 5,434
-- places across 59 subcategories and five regions, $11.80. Review summaries
-- were read in memory and discarded, as the policy requires; what was kept was
-- 41,816 normalised words with counts. Sorted from the common end (the
-- `sort=common` reading added on 25 Sep) the top of the pile is `staff 94/100`,
-- `delicious 90/100`, `highlight`, `friendly`, `attentive`, `atmosphere` —
-- review boilerplate and opinion, and opinion is the Epic score's job. Nought
-- of the 41,816 became a question.
--
-- What replaced it the same morning is `sources/featureHarvest.js`: pool a
-- drawer's *owned* text, ask once which physical features recur, count the
-- sightings ourselves. Its first complete run (26 Sep, 40 calls, 641 places,
-- £0.89) found swimming pool, sauna, steam room, waterfall, trig point, motte
-- and bailey, stone circle, roller coaster — things, not adjectives.
--
-- `sources/vocabulary.js googleHarvest` reads this row and refuses while it
-- stands. Reversing it is a new row that names this one in `supersedes`, with
-- its own evidence — never an edit here, and never a deleted line there.
insert into data_verdicts (key, question, verdict, evidence, scope, method, revisit_when, decided_on, decided_by)
values
  ('harvest.google-pass',
   'Should the vocabulary harvest read Google review summaries again, to find the words a question set should ask?',
   'No. One pass was conclusive: review summaries yield opinion and boilerplate, not features. The drawer-level feature harvest over owned text replaces it.',
   '{"run_on": "2026-09-21", "requests": 295, "places": 5434, "subcategories": 59, "regions": 5, "usd": 11.80, "words_raised": 41816, "promotable": 0, "commonest": ["staff 94/100", "delicious 90/100", "highlight", "friendly", "attentive", "atmosphere"], "successor": "sources/featureHarvest.js", "successor_first_full_run": {"on": "2026-09-26", "calls": 40, "places": 641, "gbp": 0.89, "proposed": 215, "kept_above_floor": 90}}'::jsonb,
   '59 subcategories, five regions (South East, London, South West, North, Midlands), 21 Sep 2026',
   'One Text Search per subcategory per region on the places.id,places.reviewSummary mask; phrases extracted in memory, normalised, counted per place; text discarded.',
   'A Google summary field that reports facilities rather than sentiment, or a drawer whose owned text is too thin for the feature harvest across two full runs and whose census exceeds 500 places.',
   '2026-09-26',
   'the owner')
on conflict (key) do nothing;
