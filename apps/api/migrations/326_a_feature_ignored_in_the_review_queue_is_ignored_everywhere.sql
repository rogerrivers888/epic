-- A feature ignored in the review queue is ignored for good, everywhere (C30/C61,
-- Codex 2 Oct 2026).
--
-- The review queue's Ignore is a decision about a *word* ("we never track ball
-- pits"), so a later search that re-spots it in a drawer it was never seen in
-- before must not raise it again. The first cut inferred that global scope from a
-- Google-sourced candidate sitting at status 'ignored' — but `ignoreCandidate`,
-- the ordinary question-harvest Ignore, sets exactly the same status for a single
-- drawer, so ignoring one drawer's candidate would silently suppress the feature
-- in every other drawer. Scope cannot be read from status and source alone.
--
-- So a norm-level Ignore is recorded explicitly here. `ignoreFeature` writes a row;
-- `spotFromDetail` checks it before raising anything; `approveFeature` clears it
-- (a word approved into a fact is no longer ignored). `ignoreCandidate` never
-- touches this table — its decision stays per-subcategory, as it always was.
create table if not exists feature_tombstones (
  norm        text primary key,
  decided_by  text,
  reason      text,
  decided_at  timestamptz not null default now()
);
