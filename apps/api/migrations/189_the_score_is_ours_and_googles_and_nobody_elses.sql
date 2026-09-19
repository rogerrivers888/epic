-- The score is ours and Google's, and nobody else's.
--
-- Experiment 3 settled it (migration 188): Tripadvisor matched 33% of what a
-- display search shows, held a quarter of Google's review depth, carried no
-- family signal at all, and moved three of the top ten the wrong way — out went
-- Ascot Racecourse, the Savill Garden and Lightwater Country Park, in came
-- three pubs and a curry house, because their weight is in restaurants.
--
-- So (owner, 19 Sep 2026):
--
--   · **No Tripadvisor input to the Epic score.** It is Google's rating and
--     review count, and Epic's own signals — visits, household ratings, rank,
--     recency. `had_tripadvisor` on `epic_scores` is retired rather than
--     dropped: the column is cheap and a migration that removes one is not, and
--     a reader finding it should be told why it is always false.
--   · **No mapping on the search path.** Nothing looks a place up at
--     Tripadvisor while composing a set of results.
--   · **The drawer, live, on open.** Matched on latLong at the shared 400 m
--     fence, failing closed. If the owner confirms their terms allow it, the
--     location id is kept after the first open so the second costs one call
--     instead of two; until then every open looks it up again.

comment on column epic_scores.had_tripadvisor is
  'Retired 19 Sep 2026 and always false. Tripadvisor is not an input to the Epic score — see data_verdicts.tripadvisor.second-opinion. Kept so a reader finding it is told why rather than guessing.';

comment on table provider_ids is
  'Identifiers only, and written only from a drawer open — never from the search path. Storing a Tripadvisor location id is gated on the owner confirming their terms; until then the drawer looks it up each time and nothing lands here for that provider.';

-- The trigger, made specific. A verdict with a vague trigger is one nobody can
-- act on: this one is a number, on a named re-run.
update data_verdicts
   set revisit_when = 'A re-run of experiment 3 that matches above 50% of what a display search shows — on latLong at the 400 m fence, which is the only comparable method. Separately: a country where Tripadvisor is stronger than Google, or a Growth plan whose rankings and awards are worth measuring on their own.',
       verdict = 'Drawer only. Live on open, matched on latLong at the fence, failing closed. No input to the Epic score and no lookup on the search path.'
 where key = 'tripadvisor.second-opinion';
