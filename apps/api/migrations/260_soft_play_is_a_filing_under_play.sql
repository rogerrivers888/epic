-- Soft play is a filing under Play, not a question on Water (C24).
--
-- The owner, 26 Sep 2026, on the one flag in the promoted list: "Soft play:
-- make it a filing under Play, not a Water question (C24)." It had been
-- promoted onto Water because it was not on the list of nine drawer names
-- approved as filings — but "Play & soft play" is a drawer, and a lido with a
-- soft play area is *also in* Play rather than answering a question about it.
--
-- So the question comes off Water (switched off, never deleted — a question
-- that existed says so), and the candidate is decided as a filing under
-- `play`, its quote kept, its examples gone as with every decision.

update questions q
   set active = false, updated_at = now()
  from place_attributes a
 where q.attribute_key = a.key and a.key = 'soft-play' and q.scope = 'set' and q.set_key = 'water';

update harvest_candidates
   set status = 'unresolved', kind = 'filing', files_under = 'play',
       question_id = null, decided_by = 'the owner', decided_at = now(), examples = '{}'
 where norm = 'soft play' and subcategory = 'lidos' and status = 'promoted';
