-- An identifier, proposed rather than written.
--
-- 465 skill tags carry no identifier, and attaching them one at a time is 465
-- separate acts by a person. But Wikidata is not allowed to write here
-- unattended: *foraging* has a human-activity sense and an animal-behaviour
-- one, and *fossil collector* outranks *fossil collecting* on a plain search.
-- So a run proposes, and a person accepts. The proposal sits beside the real
-- identifier and never becomes it without a tap.
alter table host_skill_tags
  add column if not exists proposed_id     text,        -- the QID a run put forward
  add column if not exists proposed_label  text,        -- what Wikidata calls it
  add column if not exists proposed_note   text,        -- Wikidata's description, so the senses can be told apart
  add column if not exists proposed_exact  boolean,     -- the wording matched, letter for letter
  add column if not exists proposed_at     timestamptz;

-- Only the ones still waiting are ever listed, so the list is the work left.
create index if not exists host_skill_tags_proposed_idx
  on host_skill_tags (proposed_exact desc, key) where proposed_id is not null and external_id is null;
