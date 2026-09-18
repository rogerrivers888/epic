-- Two different acts were writing one column.
--
-- A host can take a question off their own offer (`/faq/:id/withdraw`), and a
-- moderator rejecting the conversation it came from now withdraws it too. When
-- a rejection is reversed, only the moderator's withdrawal is the one to undo —
-- putting back a question the host had deliberately taken down would be
-- overruling them with no trace (Codex, 18 Sep 2026).
alter table chat_faq_entries add column if not exists withdrawn_by text;

-- Everything withdrawn before this was a host's own doing: moderation could not
-- reach this table until today.
update chat_faq_entries set withdrawn_by = 'host'
 where withdrawn_at is not null and withdrawn_by is null;
