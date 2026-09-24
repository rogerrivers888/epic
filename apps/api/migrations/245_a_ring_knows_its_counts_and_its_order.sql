-- A ring knows its counts and its order.
--
-- The owner, 20 Sep 2026: "Store the counts and the ranking — place IDs by Epic
-- score, per category per band — as owned data, refreshed on the 30-day census
-- cycle. The count on Inspire should be read from that table, instantly, every
-- time, never computed while the household waits. It is our own arithmetic over
-- our own rows and it costs nothing."
--
-- Both tables are keyed on the ring, not the household: a ring is a sector, a
-- way of travelling and a number of minutes, and every household whose home
-- snaps to that sector reads the same rows. Nothing rented is in either — a
-- count of our own census, and place identifiers ordered by a score that is
-- ours because it is derived (data policy, 19 Sep 2026).

create table if not exists ring_counts (
  cell        text not null,
  mode        text not null,
  minutes     integer not null,
  category    text not null,
  -- Distinct places the census placed inside the band, per category.
  places      integer not null,
  -- Places in a box that crosses the band's edge: in or out, and only a finer
  -- census can say. Never dropped — carried so the count can be shown as a
  -- floor rather than silently undercounting (owner, 20 Sep 2026).
  unresolved  integer not null default 0,
  -- Whether `places` may be printed plain or only with a plus on it: true where
  -- anything is unresolved or a district in the band was never censused.
  floor       boolean not null default false,
  computed_at timestamptz not null default now(),
  primary key (cell, mode, minutes, category)
);

create table if not exists ring_rankings (
  cell        text not null,
  mode        text not null,
  minutes     integer not null,
  category    text not null,
  venue_ref   text not null,
  epic_score  real not null,
  rank        integer not null,
  computed_at timestamptz not null default now(),
  primary key (cell, mode, minutes, category, venue_ref)
);

create index if not exists ring_rankings_order_idx
  on ring_rankings (cell, mode, minutes, category, rank);

-- The 30-day cycle reads this: which rings are due.
create index if not exists ring_counts_age_idx on ring_counts (computed_at);
