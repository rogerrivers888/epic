-- The words from before polarity, cleared out.
--
-- Migration 208 added the three polarity counts and the extraction that fills
-- them. The candidates raised by the sweeps run before it have all three at
-- nought — nothing asserted them, denied them or asked about them, because
-- there was nothing to record it with.
--
-- They are not merely unlabelled, they are wrong: the same sweeps ran before
-- phrase extraction stopped a run of words crossing a full stop, so they
-- include `stepfree wheelchair wheelchairtoilet` and `museum stepfree` —
-- three tags concatenated into a phrase no human wrote. One of them had
-- already been classified as a feature, which is how a question nobody could
-- answer gets into a set.
--
-- A word whose text said nothing about it cannot have come from the extraction
-- that exists now, so the test is exact. Anything a person has decided —
-- promoted or ignored — is left alone: an ignored word must stay ignored for
-- ever, which is the whole point of that status.
delete from harvest_candidates
 where status in ('new', 'unresolved')
   and asserts = 0 and denies = 0 and asks = 0;
