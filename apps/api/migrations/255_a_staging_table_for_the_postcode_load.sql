-- Where a postcode load lands before it is the table the census reads.
--
-- The loader (src/loadPostcodes.js) fills this and swaps the whole snapshot
-- into `postcodes` in one transaction, so a run that stops half way never
-- leaves the roll-up placing boxes against half a country. Made here rather
-- than by the loader at run time, because schema is made by migrations only.

create table if not exists postcodes_staging (like postcodes including all);
