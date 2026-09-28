-- A collection whose household rule (`predicate`) still names one of the
-- graded axes retired by migration 246 stays off, whatever its desk rule
-- says (the owner's rule, 25 Sep 2026: the axes are dropped, and a rule that
-- names one cannot run). A follow-on, never an edit: 272 has run.
--
-- 272 switched on the handover's collections because the design lists every
-- row as live. For those whose `predicate` was rewritten (still light, quiet)
-- that holds. For the rest the desk reads the new `rule`, but the household
-- side of a collection is still its `predicate`, and that names a retired
-- axis — so they go back off until either the predicate is rewritten or the
-- household app reads `rule`. That is the owner's call, and the report says so.
update browse_rows
   set active = false
 where active
   and predicate::text ~ '"(how-thrilling|how-much-walking|how-much-planning|how-new|how-busy-and-loud|how-much-you-learn|how-smart|how-long-a-day)"';
