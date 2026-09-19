-- Tripadvisor is a second opinion, not a second source.
--
-- Experiment 3, twice (19 Sep 2026). The first run matched on `geo_name:
-- 'Ascot'` and found nothing for fifty-three of sixty places — a match rate
-- about the question rather than about their coverage, the same lesson
-- experiment 1 had just taught about a 150 m fence. Asked again on `latLong` at
-- the 400 m fence every other by-name lookup uses, with the name checked the
-- same way: **34 of 102, or 33%.**
--
-- The owner's rule before it ran: under 50% and the drawer stays the only use.
-- It is 33%, so that is the answer, and there are three further findings that
-- all point the same way:
--
--   · Tripadvisor holds more reviews than Google for 2 places in 34. The median
--     is 267 against Google's 1,020 — about a quarter of the evidence.
--   · Not one of the 34 carried a family signal, which is the single thing Epic
--     would most want from them.
--   · Folding it in moves 3 of the top 10, and moves them the wrong way: out go
--     Ascot Racecourse, the Savill Garden and Lightwater Country Park, in come
--     three pubs and a curry house. Their review depth is in restaurants, so
--     blending their score demotes exactly the attractions a family day out is
--     built around.
--
-- So no Tripadvisor rating is folded into the Epic score. It is fetched live
-- when a place is opened, shown beside Google's under their display terms, and
-- that is all. Nothing was stored to reach this: the whole of experiment 3 ran
-- in memory, inside the free allowance, because the identifier point in their
-- terms is still the owner's to confirm.

insert into data_verdicts (key, question, verdict, evidence, scope, method, revisit_when, decided_on, decided_by)
values
  ('tripadvisor.second-opinion',
   'Should Tripadvisor be folded into the Epic score, or only shown in the drawer?',
   'Only the drawer. Their UK coverage of what we show is thin and their weight is in restaurants.',
   '{"sample": 102, "matched": 34, "match_rate_pct": 33, "threshold_pct": 50, "no_candidate_in_fence": 39, "failed_name_or_fence": 29, "more_reviews_than_google": 2, "median_reviews_google": 1020, "median_reviews_tripadvisor": 267, "family_signal": 0, "top_ten_moved": 3, "top_ten_demoted": ["Ascot Racecourse", "The Savill Garden", "Lightwater Country Park"], "locations_billed": 222, "written": "nothing"}'::jsonb,
   'SL5, 4 km box, 19 Sep 2026',
   'Six display searches for the places; Tripadvisor Location Search on latLong at the 400 m fence, name checked with the shared rule, then Location Details. Held in memory and written nowhere.',
   'A country where Tripadvisor is stronger than Google, or a Growth plan whose rankings and awards are worth measuring separately. Their terms on storing a location id are still unconfirmed.',
   date '2026-09-19', 'owner')
on conflict (key) do nothing;
