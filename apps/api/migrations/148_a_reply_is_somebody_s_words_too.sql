-- A reply is moderated the same way a topic is.
--
-- Migration 147 gave host reviews, conversations and open entries a `hidden`
-- flag so a rejection reaches the content. Replies were left out, and abuse is
-- more often in a reply than in the question it hangs off — so a reported reply
-- could be rejected in the back office and stay on the screen (Codex, 17 Sep
-- 2026).

alter table chat_replies add column if not exists hidden boolean not null default false;
