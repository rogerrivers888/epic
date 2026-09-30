-- A mail row is 'sending' until Postmark answers (mail.js). That state was
-- added by editing 090 after it had already run on production, so production
-- kept the first check — without 'sending' — and every row the sender tried to
-- write was refused: the Mail screen stayed empty while mail went out
-- (found 30 Sep 2026: "violates check constraint mail_messages_status_check").
-- Never edit a migration that has run; this is the follow-on.
alter table mail_messages drop constraint if exists mail_messages_status_check;
alter table mail_messages add constraint mail_messages_status_check
  check (status in ('sending', 'sent', 'delivered', 'opened', 'bounced', 'soft_bounced', 'complained', 'failed'));
alter table mail_messages alter column status set default 'sending';
