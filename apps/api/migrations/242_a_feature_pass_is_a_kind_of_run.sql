-- A feature pass is a kind of run, and the table did not know the word.
--
-- `vocabulary_runs.kind` allowed free, google and probe. The feature pass — one
-- call per drawer asking what recurs across it, which replaces the per-word
-- extractor — is a fourth, and starting one failed the check constraint before
-- it had spent anything.
--
-- Worth saying that it failed *well*: the run is recorded before the first call
-- is made, so the constraint caught it at the door rather than after forty
-- model calls had been paid for. A run that writes its row last would have
-- spent the money and then lost the record of having spent it.
--
-- The three existing kinds are unchanged. `features` is added rather than the
-- check being dropped, because the column is what the Runs screen reads to
-- name a run, and an unconstrained one would let a typo become a run type
-- nobody can find again.
alter table vocabulary_runs drop constraint if exists vocabulary_runs_kind_check;
alter table vocabulary_runs
  add constraint vocabulary_runs_kind_check
  check (kind = any (array['free', 'google', 'probe', 'features']));
