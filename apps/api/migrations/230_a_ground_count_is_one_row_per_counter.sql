-- A ground count is one row per counter.
--
-- Codex, 21 Sep 2026: "For a tile selected because `fhrs_at` is older than
-- `staleDays`, `contributorsTo()` still returns every council from the previous
-- sweep. The loop then sees all wanted councils in `have`, calls `settle()`,
-- and merely refreshes `fhrs_at` without downloading or recounting anything, so
-- FHRS ground counts never change after their first successful sweep."
--
-- True, and the second fault in a row from the same source: a count held as one
-- number with a list of who contributed to it cannot be re-counted, because
-- adding is the only safe thing to do to it and adding again would double it.
-- 219 made it additive, 226 made it wait for every council, and both were
-- working around the shape rather than fixing it.
--
-- So the row is per counter. A tile's ground count for a drawer is the sum of
-- its counters' rows: `sum(places) group by grid_key, source, subcategory`. A
-- council re-counted replaces its own row and nobody else's, which makes a
-- refresh the same operation as a first count, and a boundary tile correct by
-- construction rather than by accumulation. It also means a number can be shown
-- with its working — Southwark 412, Lambeth 88 — which no single total could.
--
-- The open map has one counter, `box`: Overpass answers about the rectangle
-- itself and no second machine has anything to add.
alter table ground_counts add column if not exists contributor text;

-- The counts taken before this shape existed. An OSM row was always the whole
-- box; an FHRS row was one or more councils added together and there is no
-- honest way to split it back up, so those go and the sweep takes them again —
-- which is free, and is a day's work for a background loop rather than a
-- decision anybody has to make.
update ground_counts set contributor = 'box' where source = 'osm' and contributor is null;
delete from ground_counts where source = 'fhrs';
update census_tiles set fhrs_at = null;

alter table ground_counts alter column contributor set default 'box';
alter table ground_counts alter column contributor set not null;
alter table ground_counts drop constraint if exists ground_counts_pkey;
alter table ground_counts add primary key (grid_key, source, subcategory, contributor);
alter table ground_counts drop column if exists contributors;
