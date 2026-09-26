-- A word set aside says why (owner, 26 Sep 2026, C27).
--
-- "Set aside pure boilerplate (gift voucher, etc.) with a reason." Ignoring a
-- candidate recorded who and when, never why — so a list of set-aside words
-- read the same whether a word was boilerplate, failed the day-out test (C23),
-- was a fact about one place, or was a members-only signal (C26). The reason
-- is a sentence beside the decision; it is shown, never parsed.
alter table harvest_candidates add column if not exists decision_reason text;

comment on column harvest_candidates.decision_reason is
  'Why a word was set aside, promoted onto a global question, or filed — in the owner''s terms (C23 day-out test, C24 filing, boilerplate, …). Shown, never parsed.';
