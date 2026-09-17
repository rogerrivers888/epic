-- What each origin's neighbours were actually worked out to.
--
-- The matrix's completeness was being inferred from `max(minutes)` over the
-- whole table, and that number is not the cap anybody built to (Codex,
-- 17 Sep 2026). It is wrong in both directions: a complete build over a sparse
-- set of cells may simply have no pair ninety-five minutes away and reads as
-- short, and a rebuild interrupted a tenth of the way through reads as finished
-- the moment one origin produces a single far-off row.
--
-- Builds update one origin at a time on purpose, so that an interrupted run
-- leaves a table that is short rather than one that is wrong. The cost of that
-- is that "how far is this one built to" is a fact about each origin, and has
-- to be written down per origin rather than guessed from the rows.
create table if not exists cell_builds (
  from_cell   text     not null references geo_cells(code) on delete cascade,
  mode        text     not null,
  cap_minutes smallint not null,
  pairs       integer  not null default 0,
  method      text     not null default 'estimate',
  at          timestamptz not null default now(),
  primary key (from_cell, mode)
);
create index if not exists cell_builds_mode_idx on cell_builds (mode, cap_minutes);
