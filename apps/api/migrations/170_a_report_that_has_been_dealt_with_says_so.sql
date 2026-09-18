-- A report is dealt with, and the fact that it happened is kept.
--
-- `reported` meant two things at once: "somebody complained about this" and
-- "this is urgent". So deciding a reported thing left the flag standing, and a
-- later edit — which rightly sends the words back to be read again — carried the
-- old, answered report into the urgent lane with it (Codex, 18 Sep 2026).
--
-- One column says when it was dealt with. The flag, the reason and who raised it
-- all stay: that is the record, and the lane reads the pair.
alter table content_queue add column if not exists report_cleared_at timestamptz;
