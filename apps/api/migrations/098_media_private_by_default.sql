-- Media is private unless somebody says otherwise (Codex, 13 Sep 2026).
--
-- 097 added `is_private` and marked the rows Casual meet ups was pointing at.
-- That was not enough. Recording a hello a second time replaced the match's
-- media id without deleting the first row, so a superseded hello kept
-- `is_private = false` and stayed downloadable from the public reader — and
-- the same shape of mistake was waiting for whatever gets uploaded next.
--
-- So the default is turned round. Public is the deliberate act now, and the
-- only place that makes it is `POST /api/host/media`, whose uploads are what a
-- public listing draws. Everything that is not reachable from a public page is
-- made private here, which also covers a host's evidence — a qualification
-- document the back office reads and nobody else ever should have.
--
-- One consequence, stated rather than hidden: media uploaded before today and
-- never attached to a host or an offer becomes private. That is a photograph
-- somebody picked and abandoned mid-wizard; if one is attached later it will
-- not draw and has to be uploaded again. A picture that does not show is the
-- right way for this to fail.

alter table host_media alter column is_private set default true;

update host_media set is_private = true
 where is_private = false
   and id not in (
     select intro_video_id from hosts where intro_video_id is not null
     union select photo_id from hosts where photo_id is not null
     union select video_id from host_offers where video_id is not null
     union select doc_id from host_offers where doc_id is not null
     union select photo_id from host_reviews where photo_id is not null
     -- An offer's photographs are a json array of ids, and its featured people
     -- each carry one: both are drawn on the listing page.
     union select p.id::uuid
            from host_offers o, lateral jsonb_array_elements_text(coalesce(o.photo_ids, '[]'::jsonb)) as p(id)
           where p.id ~ '^[0-9a-f-]{36}$'
     union select (fp.person ->> 'photoId')::uuid
            from host_offers o, lateral jsonb_array_elements(coalesce(o.featured_people, '[]'::jsonb)) as fp(person)
           where fp.person ->> 'photoId' ~ '^[0-9a-f-]{36}$'
   );
