-- A doubtful match is set aside (owner, 1 Oct 2026: "when a live Google name
-- is fetched, compare it in memory with the owned name; a material difference
-- marks the owned match as suspect (re-match, don't trust its coordinates),
-- storing only the flag, never Google's name").
--
-- Migration 310 put `suspect` and `suspect_reason` on owned_points. A suspect
-- row left in that table is still read by every place that reads it — the
-- trigger that stamps every copy, the point readers, the index, the ring and
-- reach queries, the coordinate report — so "don't trust its coordinates"
-- would need each of them to learn to skip it, and the first one that did not
-- would go on trusting it. Instead a doubtful match leaves owned_points and is
-- written down here: every reader stops trusting it at once, and
-- recordOwnedPoint refuses to write the same match back (sources/ownedPoints.js).
-- Nothing in this table is a provider's name: the reason is a score and the
-- owned source's own identifier.
create table if not exists owned_point_suspects (
  venue_ref         text not null,
  source            text not null,     -- the owned source the doubtful match was to
  source_ref        text not null,     -- that source's own identifier ('' where it had none)
  score             real,              -- how alike the two names were (sources/openMatch.js nameScore)
  reason            text not null,
  created_at        timestamptz not null default now(),
  checked_at        timestamptz not null default now(),
  -- What the place was matched to instead, where the live name found it.
  rematched_source  text,
  rematched_ref     text,
  primary key (venue_ref, source, source_ref)
);
create index if not exists owned_point_suspects_created_idx on owned_point_suspects (created_at);

-- What the name-check did, one row per outcome, for the Monday summary
-- (ukCensus.weeklySummary): counted from what happened, not reconstructed
-- from rows that later change (Codex, 2 Oct 2026). A reference, an outcome and
-- the owned source involved — never a name. Kept ninety days.
create table if not exists name_checks (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  venue_ref   text not null,
  outcome     text not null check (outcome in ('agreed', 'doubted', 'rematched', 'first-sight')),
  source      text
);
create index if not exists name_checks_at_idx on name_checks (at);

-- The two columns nothing ever wrote, and their index. `checked_at` stays: it
-- is when a live name last agreed with the match.
drop index if exists owned_points_suspect_idx;
alter table owned_points drop column if exists suspect;
alter table owned_points drop column if exists suspect_reason;
