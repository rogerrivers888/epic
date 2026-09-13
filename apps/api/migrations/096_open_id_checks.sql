-- The one ID check (Casual meet ups, O9; owner, 13 Sep 2026).
--
-- Asked once, of both sides, *after* two yeses and *before* anything is
-- exchanged — never to be in the pool. The screen promises "we check it and
-- keep nothing but the result", and that is what this table is for: the two
-- images live here only until somebody decides, and the decision is what
-- survives them.
--
-- Nobody verifies themselves. A submission is `pending` until the back office
-- passes or fails it, which is the same place a host's trust is set and never
-- the person's own doing. Until both sides pass, the match does not reach
-- `chat` and no details are exchanged.

create table if not exists open_id_checks (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references open_matches (id) on delete cascade,
  household_id    uuid not null references households (id) on delete cascade,
  -- Which side of the introduction this is, so a decision cannot be applied to the wrong one.
  side            text not null check (side in ('host', 'guest')),

  -- The two images, while they are needed. Both are cleared the moment the
  -- check is decided: what is kept is the result, not the passport.
  doc_media_id    uuid references host_media (id) on delete set null,
  selfie_media_id uuid references host_media (id) on delete set null,

  state           text not null default 'draft' check (state in ('draft', 'pending', 'passed', 'failed')),
  submitted_at    timestamptz,
  decided_at      timestamptz,
  decided_by      text,
  -- Why it failed, in the words the person is told. Null on a pass.
  note            text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One check per side of a match: submitting twice corrects the same row.
create unique index if not exists open_id_checks_side_idx on open_id_checks (match_id, side);
-- The back office's queue: oldest first, so nobody waits behind a newer one.
create index if not exists open_id_checks_pending_idx on open_id_checks (state, submitted_at) where state = 'pending';
