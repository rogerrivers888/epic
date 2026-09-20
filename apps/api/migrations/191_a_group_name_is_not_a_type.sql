-- A group name is not a type.
--
-- `place_of_worship` and `landmark` are what Google calls its own *groups* in
-- Table A, not types you may ask for. Both came back 400 on every census slice
-- that used them — twice per outcode, seventy-eight wasted requests across the
-- thirty-nine-outcode ring, and two subcategories quietly never asking one of
-- their questions until the slice started failing loudly (19–20 Sep 2026).
--
-- The owner asked for them fixed "with valid Table A types or text queries".
-- Text queries turned out to be unsafe on the IDs Only mask — there is no
-- `types` field to check an answer against, so a search for "landmark" would
-- count anything merely *named* Landmark (Codex, 19 Sep 2026). That leaves
-- valid types, and both groups are already fully covered by their own members:
--
--   place_of_worship -> buddhist_temple, church, hindu_temple, mosque,
--                       shinto_shrine, synagogue — all six already taught.
--   landmark         -> cultural_landmark, historical_landmark, historical_place,
--                       monument, sculpture, fountain — all six already taught.
--
-- So the group name is dropped and nothing is lost: every place it would have
-- stood for is asked about by name. A rule left with no Google label at all
-- would be a rule that no longer reaches the census, so those are removed
-- whole rather than left as an empty question.

delete from shelf_rules
 where scope = 'labels'
   and labels <@ array['google:place_of_worship', 'google:landmark'];

update shelf_rules
   set labels = array(select unnest(labels) except select unnest(array['google:place_of_worship', 'google:landmark'])),
       updated_at = now()
 where scope = 'labels'
   and labels && array['google:place_of_worship', 'google:landmark'];
