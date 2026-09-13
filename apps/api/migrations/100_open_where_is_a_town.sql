-- An entry's place is a town, and anything older than that rule is dropped
-- (Codex, 13 Sep 2026).
--
-- `open_entries.where_label` used to default to the household's `home_label`,
-- which is whatever they typed — often the house, the street and the postcode.
-- That label is what the guest is told as the town, so rows written before
-- `townFor` existed carry an address into an introduction.
--
-- The code refuses them at the gate (`domain/openTo.js placeName`), and this
-- clears them at the source: a label that is not already one clean place name
-- becomes nothing, and the entry carries no town until it is saved again.
-- Nothing is salvaged by splitting — that was six passes of getting an address
-- parser wrong, and an entry with no town is only a disappointment.

update open_entries
   set where_label = null,
       updated_at = now()
 where where_label is not null
   and (where_label like '%,%' or where_label ~ '[0-9]');
