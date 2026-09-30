-- A wording key can be looked at and left the same (Markets design v2.2, owner
-- 29 Sep 2026; the wording screen).
--
-- Blank en-US now means one thing only: someone looked and judged the two the
-- same. An untouched key is "Not looked at", not blank. To tell those apart we
-- record when a key was looked at — set by "Same in both", by typing an
-- American version, or by a status that already counts as looked at (Changed,
-- drift). This is the field that answers the never-examined question without a
-- fourth status.

alter table market_wording add column if not exists looked_at    timestamptz;
alter table market_wording add column if not exists looked_at_by  text;
