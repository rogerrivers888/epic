-- The review queue's state (C30/C61): a feature ignored in it is ignored for good,
-- everywhere (Codex 2 Oct 2026); facts owed a question; and the spotting tallies.
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

-- An approved feature seen in a drawer that has no question set yet (owner, 2 Oct
-- 2026: "create the fact anyway and start asking once a set is attached"). The
-- fact is made at once; this row remembers which drawer is still owed the question,
-- and attaching a set to that drawer asks it and clears the row.
create table if not exists feature_pending_asks (
  attribute_key    text not null references place_attributes(key) on delete cascade,
  subcategory_key  text not null references shelf_subcategories(key) on delete cascade,
  approved_at      timestamptz not null default now(),
  primary key (attribute_key, subcategory_key)
);

-- One row per review-spotting pass over a place's Google detail: counts only, never
-- any of the text. It is what lets the owner's report say how many phrases the
-- concrete-feature filter dropped (opinions, service words, fragments) beside how
-- many features it queued — nothing else records the dropped side.
create table if not exists review_spotting_tallies (
  id           bigserial primary key,
  venue_ref    text not null,
  raised       integer not null,
  filtered     integer not null,
  tombstoned   integer not null,
  queued       integer not null,
  spotted_at   timestamptz not null default now()
);
create index if not exists review_spotting_tallies_at on review_spotting_tallies (spotted_at);
