-- "Not this" has to survive.
--
-- Clearing a proposal put the tag straight back in the queue, so the next run
-- proposed the same top candidate again and the decision could never be made
-- to stick (Codex, 14 Sep 2026). A tag with no identifier is a legitimate
-- answer, and this is where that answer is kept.
alter table host_skill_tags
  add column if not exists no_identifier boolean not null default false;

comment on column host_skill_tags.no_identifier is
  'A person looked and said nothing fits. Proposal runs skip it.';
