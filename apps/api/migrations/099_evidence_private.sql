-- A host's evidence is never public (Codex, 13 Sep 2026).
--
-- 098 turned the default round and made private everything not reachable from
-- a public page, which included evidence. But the upload endpoint still said
-- `isPrivate: false` for everything that came through it, and the evidence
-- step uses that same endpoint — so any certificate or licence uploaded
-- between 098 running and this version deploying went back to being public.
--
-- A migration cannot depend on when the code around it shipped, so this states
-- the thing that is always true: a row referenced by `host_evidence.media_id`
-- is a qualification or a licence, the wizard promises "nothing here is shown
-- to guests", and it is private. Whenever it ran, and whatever the endpoint
-- said at the time.

update host_media set is_private = true
 where is_private = false
   and id in (select media_id from host_evidence where media_id is not null);
