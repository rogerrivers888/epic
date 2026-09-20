-- A proposal can be about a Wikidata type.
--
-- 212 allowed a proposal to be about a provider word or one of our
-- subcategories, because those were the two things the signals talked about.
-- Most of what the cleanup brief names turns out to be neither: Landmarks &
-- monuments held 25 rules and 19 were `kind` scope, so "exclude arch bridge"
-- means Q158438 and not `google:arch_bridge` (20 Sep 2026).
--
-- The constraint caught it on the first run against production, which is what
-- it is for. Widened rather than dropped.
--
-- Numbered 222 because another session took 218 while this was being written,
-- and the runner's duplicate-number guard caught that too. Idempotent, so
-- re-running it under the new number costs nothing.
alter table taxonomy_proposals drop constraint if exists taxonomy_proposals_subject_kind_check;
alter table taxonomy_proposals add constraint taxonomy_proposals_subject_kind_check
  check (subject_kind in ('word', 'subcategory', 'kind'));
