-- Where a cell was when its neighbours were worked out.
--
-- A sector's centre is the running mean of the postcodes seen inside it, so it
-- moves every time a place is stamped. The first attempt at noticing that
-- compared each adjustment against a threshold, which is the wrong measurement:
-- forty stamps that each move the centre twenty metres never trip a
-- two-hundred-and-fifty-metre step, and the cell ends up eight hundred metres
-- from where every one of its travel times was calculated, with a marker that
-- still reads as current (Codex, 17 Sep 2026).
--
-- So the marker remembers the centre the build actually used, and the question
-- becomes "how far is this cell from where it was when we last worked it out",
-- which is the question that was meant all along.
alter table cell_builds add column if not exists built_lat double precision;
alter table cell_builds add column if not exists built_lng double precision;
