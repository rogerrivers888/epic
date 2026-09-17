-- Claimed counted as owned, and they are different facts.
--
-- Three kinds of ownership: identified (somebody has returned it and we hold
-- nothing of our own), claimed (a household saved it, so it matters, but we
-- still hold nothing), and owned (we hold our own research on it, and it
-- survives every provider going dark).
--
-- The rollups counted owned as "not identified", which put claimed places in
-- the Owned total — and Owned is the figure the screen defines as holding our
-- own research. So coverage read better than it was, and the places most worth
-- curating were the ones hidden by it (Codex, 17 Sep 2026).

alter table area_stats add column if not exists claimed integer not null default 0;
