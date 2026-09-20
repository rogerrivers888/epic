-- A coordinate leaving is written down.
--
-- Owner, 20 Sep 2026: "Without it, 2,763 places quietly leaving the matrix in
-- October becomes a mystery in November."
--
-- The expiry sweep nulls `lat`, `lng`, `cell`, `coords_at` and `coords_from`
-- together, which is the policy working correctly — a sector derived from a
-- Google coordinate is still location data from Google. The cost of doing it
-- properly is that an expired row becomes indistinguishable from a census row
-- that never had a coordinate at all: both have no point, no cell and no
-- source. So the fact has to be recorded as it happens or it cannot be
-- recovered afterwards.
--
-- Deliberately a count and not a list of places. Keeping the refs of everything
-- whose coordinate expired would be keeping a Google-derived collection past
-- its thirty days by another name, which is the rule this table exists to
-- support rather than to route around. A count, a date and nothing else.
--
-- It cannot be attributed to an area, for the same reason: the cell is gone by
-- the time the row is written. The board says so rather than implying the
-- figure is local.

create table if not exists coordinate_expiries (
  id       uuid primary key default gen_random_uuid(),
  at       timestamptz not null default now(),
  expired  integer not null,          -- rows whose point was dropped
  cells    integer not null default 0 -- place_cells rows dropped with them
);
create index if not exists coordinate_expiries_at_idx on coordinate_expiries (at desc);
