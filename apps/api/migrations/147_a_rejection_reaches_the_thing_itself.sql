-- A moderator's rejection has to reach the content, not just the queue row.
--
-- The back office could reject a review, a conversation or an offer and the
-- only thing that changed was a row in `content_queue` — which nothing that
-- publishes those things has ever heard of. An abusive host review went public
-- the moment its fourteen-day hold expired, having been rejected a week
-- earlier (Codex, 17 Sep 2026).
--
-- `hidden` rather than a delete or a state flip, deliberately: a moderation
-- decision is not an erasure, the words stay exactly as they were written so
-- the decision can be looked at again, and approving afterwards is one flag
-- back the other way rather than a guess at what the row used to say.

alter table host_reviews add column if not exists hidden boolean not null default false;
alter table chat_topics  add column if not exists hidden boolean not null default false;
alter table open_entries add column if not exists hidden boolean not null default false;
