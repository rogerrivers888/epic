-- The fourth thing a household can rewrite after somebody has read it.
--
-- A visit's note is moderated like any other words, and `PATCH /api/visits/:id`
-- can replace it — after which the queue row went on holding a decision about
-- text that is no longer there, exactly as it did for host reviews, questions
-- and offers before migrations 165 and 166 (Codex, 18 Sep 2026).
--
-- `visits` has no `updated_at`, and would not help if it did: the rating, the
-- attendees and the date all change without the words changing.
alter table visits add column if not exists note_rewritten_at timestamptz;
