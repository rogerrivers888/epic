-- A moderator's decision is about the words that were in front of them.
--
-- A topic, a reply's parent question and an open entry's own sentence can all
-- be rewritten after somebody has looked at them, and the queue row went on
-- saying "approved" about text that is no longer there — so an edit was a way
-- past a decision (Codex, 18 Sep 2026).
--
-- `updated_at` cannot answer this: it moves when a topic is pinned or an entry's
-- preferences change, and neither is a reason to look again. This says the words
-- themselves changed, and the queue reads it against `decided_at`.
alter table chat_topics  add column if not exists rewritten_at timestamptz;
alter table open_entries add column if not exists rewritten_at timestamptz;
