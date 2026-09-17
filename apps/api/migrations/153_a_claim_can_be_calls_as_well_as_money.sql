-- Tripadvisor's ceiling is counted in calls, so a claim has to be too.
--
-- Migration 152 made the money ceiling one that two runs cannot walk through
-- at once. Tripadvisor's is a hard monthly count of locations rather than a
-- sum of money, and it was still enforced by an unlocked read — so the same
-- race applied to the one limit that is contractual rather than budgetary
-- (Codex, 17 Sep 2026).

alter table spend_reservations add column if not exists provider text;
alter table spend_reservations add column if not exists calls integer not null default 0;
