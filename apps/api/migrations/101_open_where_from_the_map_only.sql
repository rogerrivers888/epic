-- Every place on an entry comes from the map, and none of the old ones did
-- (Codex, 13 Sep 2026).
--
-- 100 cleared the labels with a comma or a digit in them, which left the ones
-- that are all words — "Manor House", "Rose Villas", "Church Lane". Those read
-- as place names to any validator, and they are somebody's house.
--
-- Trying to tell a house from a town by its words is what six passes at an
-- address parser already failed to do. This does not try. Every label written
-- before `townFor` existed was copied from whatever the household typed as
-- home, so none of them is trustworthy and all of them go. The entry carries
-- no town until it is saved again, and the screens say nothing rather than
-- something that might be a front door.

update open_entries
   set where_label = null,
       updated_at = now()
 where where_label is not null;
