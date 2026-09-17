-- A place whose country nobody has told us is not British by default.
--
-- `place_index.country_code` was NOT NULL DEFAULT 'GB', so a place first noted
-- with nothing said — a reverse geocode that failed, a record made before the
-- research ran — was filed under Great Britain. And because the country is
-- deliberately never changed once set (two earlier rules leaked: a default that
-- could be overwritten, then a confirmed value that could not be told from the
-- default), that guess was permanent (Codex, 17 Sep 2026).
--
-- Null is the honest third state: nobody has said. The first source that knows
-- fills it and nothing overwrites it afterwards, so there is no leak either
-- way. The country rows in `place_areas` already skip a null.

alter table place_index alter column country_code drop not null;
alter table place_index alter column country_code drop default;
