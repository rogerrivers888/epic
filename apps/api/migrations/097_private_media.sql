-- Media that must never be served publicly (Codex, 13 Sep 2026).
--
-- `GET /api/media/:id` is public on purpose: "the page it plays on is public,
-- and the id is unguessable". That reasoning holds for a host's photograph and
-- a listing's video. It does not hold for the two things Casual meet ups puts
-- in the same table:
--
--   * a twenty-second hello, which is held for one decision, seen once by one
--     person, and deleted;
--   * a photograph of somebody's passport and a selfie, at the one gate.
--
-- Guarding the new endpoints was not enough while the same rows stayed
-- downloadable, uncached-for-a-year, through the old address. This column is
-- what the public handler refuses, so the door is shut at the door.

alter table host_media add column if not exists is_private boolean not null default false;

-- Anything already written by Casual meet ups is private in retrospect: the
-- hellos on a match, and both images on an ID check.
update host_media set is_private = true
 where id in (
   select host_video_id from open_matches where host_video_id is not null
   union select guest_video_id from open_matches where guest_video_id is not null
   union select doc_media_id from open_id_checks where doc_media_id is not null
   union select selfie_media_id from open_id_checks where selfie_media_id is not null
 );
