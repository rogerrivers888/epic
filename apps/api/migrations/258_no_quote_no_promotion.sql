-- No quote, no promotion (C21); the material, not the prompt (C22).
--
-- The owner, 26 Sep 2026, after a sample of twenty words the classifier had
-- called unclear: sixteen were fragments and review boilerplate — "freshly",
-- "especially", "along", "provides", "guests" — and four would have settled
-- with the drawer named. "Your own sample shows the material is the cause
-- (16 of 20), not the missing drawer. Re-classifying Google n-grams per drawer
-- is better prompting of the wrong material."
--
-- The same material had put 8,770 bare n-grams on the promotable list as
-- features — `cafe`, `parking`, `food`, `drink`, `room` — every one called
-- without a drawer and without a sentence to show for it, beside 101 words
-- the feature harvest had found in owned text, 86 of them with a quote.
--
-- The rule from here: **promotable means harvest-found and carrying an
-- evidence quote from owned text. A Google-raised word is never promoted on a
-- classifier verdict alone.** The repository derives status by it now
-- (`quotedBy`, `PROMOTABLE_SQL`); this puts the rows that were written before
-- the rule where the rule would have put them.
--
-- Nothing is re-asked and nothing is spent: `classified_at` and
-- `classified_seen` are kept, so a word goes back to the classifier only if a
-- later harvest raises its count. Ignored stays ignored; promoted stays
-- promoted.

-- A feature verdict on a word the feature harvest never found: back to
-- unclear, in the pen, its verdict noted as the count it was made at.
update harvest_candidates
   set kind = 'unclear', status = 'unresolved'
 where status = 'new'
   and not (sources ? 'features');

-- Harvest-found but never quoted: the kind stands, the word is not promotable.
update harvest_candidates
   set status = 'unresolved'
 where status = 'new'
   and (sources ? 'features')
   and evidence is null;

-- What promotable means, said once where the data lives.
comment on column harvest_candidates.status is
  'new = promotable: kind feature, found by the feature harvest (sources ? ''features'') and carrying an evidence quote from owned text. unresolved = the pen (unclear) or a decided non-question (condition, opinion) or an unquoted feature. ignored is permanent. promoted names its question.';
