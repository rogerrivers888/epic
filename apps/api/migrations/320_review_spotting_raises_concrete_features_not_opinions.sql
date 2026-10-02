-- Review-spotting raises concrete features, and only those (C61, owner 2 Oct 2026).
--
-- The owner reopens — in part — what the 21 Sep verdict (migration 251,
-- `harvest.google-pass`) closed. That pass bought 41,816 words and nought were
-- promotable because it harvested *every* word: staff, delicious, friendly —
-- opinion and boilerplate drowned the signal. C61's change is to harvest
-- concrete features only — physical things, facilities, activities (splash pad,
-- toddler pool, mini race track) — and filter opinions, adjectives and service
-- words out (`sources/reviewSpotting.js looksLikeFeature`).
--
-- And it spends nothing: it reads the review text a real search already fetched
-- (`compare.js detailFor` on Lookup, compare, compare-all, prefetch), in memory,
-- for free. It stores only our own derived output — the feature, the place, the
-- polarity — never Google's text (`recordCandidates` keeps no quote for a rented
-- source). A Google-raised word lands in the holding pen (`unresolved`) and is
-- never promoted on Google alone: it waits for the owned feature harvest to quote
-- it, or for a human to approve a new one in the back office.
--
-- What stays refused: the **paid bulk `googleHarvest`** and **open-ended n-gram
-- mining**. So `harvest.google-pass` is NOT superseded here — it keeps standing,
-- and `sources/vocabulary.js googleHarvest` keeps refusing while it does. This
-- is a separate, positive verdict that records the narrow exception beside it.
-- (Leaving `supersedes` null is deliberate: a row that named `harvest.google-pass`
-- in `supersedes` would make `verdictAgainst('harvest.google-pass')` return
-- nothing and reopen the paid pass, which C61 keeps shut.)
insert into data_verdicts (key, question, verdict, evidence, scope, method, revisit_when, decided_on, decided_by, supersedes)
values
  ('harvest.review-spotting',
   'May a search read a Google place detail it already fetched, in memory and for free, to raise candidate features for the harvest?',
   'Yes, for concrete features only. Spend-free in-memory spotting on a detail a search already fetched raises physical things, facilities and activities and filters opinions, adjectives and service words out. It stores only the feature, the place and the polarity — never Google text; a Google-raised word lands in the holding pen and is never promoted without an owned quote or a human approval. This narrows the 21 Sep verdict (harvest.google-pass), which stays standing: the paid bulk googleHarvest and open-ended n-gram mining remain refused.',
   '{"supersedes_in_part": "harvest.google-pass", "why_21_sep_failed": "harvested every word, so opinions drowned the signal", "words_raised_21_sep": 41816, "promotable_21_sep": 0, "c61_change": "concrete features only, opinions/adjectives/service words filtered", "spend": "none, reads detail a search already fetched", "stored": "feature + place + polarity, never Google text", "new_features": "back-office review queue, human approval before they become facts", "still_refused": ["paid bulk googleHarvest", "open-ended n-gram mining"]}'::jsonb,
   'Every back-office search that fetches a Google detail with reviews (Lookup, compare, compare-all, prefetch), nationwide',
   'In-memory extraction of concrete features from the reviews a search already fetched; opinions/adjectives/service words filtered (reviewSpotting.js looksLikeFeature); stored as harvest_candidates with source google and no quote; text discarded.',
   'If the pen fills with opinions despite the filter, or if the yield of promotable features over a quarter is nought, tighten the filter or close it again with a row that supersedes this one.',
   '2026-10-02',
   'the owner (C61)',
   null)
on conflict (key) do nothing;
