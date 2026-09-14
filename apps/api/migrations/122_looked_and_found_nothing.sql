-- Looked at, and nothing came back.
--
-- 123 of the 465 tags produce no Wikidata candidate at all — pottery throwing,
-- den building, the very specific crafts — so a run proposes nothing for them
-- and they stayed counted as "not looked up". That sent every later run back
-- over the same 123 for nothing, and told the back office there was work left
-- when there was not (14 Sep 2026: first read as a rate limit, which it is not
-- — a pause made no difference at all).
alter table host_skill_tags
  add column if not exists searched_at timestamptz;

comment on column host_skill_tags.searched_at is
  'When a proposal run last asked about this tag, whether or not anything came back.';
