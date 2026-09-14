-- A place on the not-sure list carries where it is, and any parent proposed.
--
-- Codex, 14 Sep 2026: without an address a research run cannot tell the Bristol
-- one from the Sunningdale one, and a confidently sourced answer about the
-- wrong place is worse than no answer. And a proposed parent arrives as a name,
-- which is not a venue reference and must not be written as if it were.

alter table not_sure add column if not exists address text;
alter table not_sure add column if not exists part_of_name text;
