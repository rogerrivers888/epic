-- A place we have never swept can still be scored, and the score has to stay.
--
-- The rescore endpoint exists for exactly the claimed-but-never-swept place: a
-- household saved it, we researched it from its own page and the open sources,
-- and there is no `scout_places` row anywhere. `rescoreOne` wrote the Epic
-- score onto the record and had nowhere at all to put the owned score — so the
-- POST answered "saved" and the next GET read the stored score off the sweep,
-- found nothing, and showed the recalculation as never having happened (Codex,
-- 18 Sep 2026).
--
-- One column, beside the Epic score it belongs with.
alter table place_records add column if not exists owned_score real;
alter table place_records add column if not exists scored_at timestamptz;
