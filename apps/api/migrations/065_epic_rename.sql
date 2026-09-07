-- Roam became Epic (owner, 7 Sep 2026), and the old name is in the schema in
-- three places. This is the only part of the rebrand a database has to be told
-- about; everything else is pixels and strings.
--
--   1. `roam_score` — the composite we work out ourselves and are allowed to
--      keep, on the three tables that hold one.
--   2. The image search functions, which are prefixed rather than named after
--      anything. These cannot be renamed with ALTER: `roam_reindex_image` and
--      `roam_reindex_after` name `roam_image_search` inside their own bodies,
--      and a rename does not rewrite a body — it would leave two triggers
--      calling a function that no longer exists, on every write to the image
--      library. They are recreated instead, the triggers re-pointed, and the
--      old three dropped once nothing refers to them.
--   3. `'roam'` as a stored value of `payment_mode` and `book_where`, meaning
--      "we collect" and "book it through us". A device running an older bundle
--      can still send the old word for a while, so `routes/groups.js` accepts
--      both and writes only `epic`; this is what fixes the rows already there.
--
-- Written to be safe to run twice: every step checks first, because a rename is
-- the one kind of migration where a half-applied database is worse than none.

-- 1. the score --------------------------------------------------------------

-- `rename column` has no `if exists`, and it throws rather than shrugging when
-- the column has already moved, so each one is asked for first.
do $$
declare t text;
begin
  foreach t in array array['attractions', 'scout_places', 'scout_score_history'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = t and column_name = 'roam_score') then
      execute format('alter table %I rename column roam_score to epic_score', t);
    end if;
  end loop;
end $$;

-- 2. the image search index -------------------------------------------------

-- Same body as migration 036, under the new name.
create or replace function epic_image_search(img_id uuid) returns tsvector language sql stable as $$
  select setweight(to_tsvector('english', coalesce(i.title, '')), 'A')
      || setweight(to_tsvector('english', array_to_string(i.tags, ' ')), 'A')
      || setweight(to_tsvector('english', coalesce(i.caption, '')), 'B')
      || setweight(to_tsvector('english', coalesce(string_agg(distinct a.name, ' '), '')), 'B')
      || setweight(to_tsvector('english', coalesce(string_agg(distinct r.name || ' ' || r.nation, ' '), '')), 'C')
      || setweight(to_tsvector('english', coalesce(i.creator, '') || ' ' || coalesce(i.licence, '') || ' ' || coalesce(i.source, '')), 'D')
    from image_assets i
    left join image_links l on l.image_id = i.id
    left join attractions a on l.subject_type = 'attraction' and a.id::text = l.subject_id
    left join regions r on (l.subject_type = 'region' and r.slug = l.subject_id)
                        or (a.region_slug is not null and r.slug = a.region_slug)
   where i.id = img_id
   group by i.id
$$;

create or replace function epic_reindex_image() returns trigger language plpgsql as $$
begin
  update image_assets set search = epic_image_search(new.image_id) where id = new.image_id;
  return null;
end $$;

create or replace function epic_reindex_after() returns trigger language plpgsql as $$
begin
  update image_assets set search = epic_image_search(new.id) where id = new.id and search is distinct from epic_image_search(new.id);
  return null;
end $$;

-- A trigger holds the function by identity, not by name, so both have to be
-- rebuilt to move across. Dropping first keeps the window where neither the old
-- nor the new one is attached down to this statement pair.
drop trigger if exists image_assets_reindex on image_assets;
create trigger image_assets_reindex after insert or update of title, caption, tags, creator, licence, source
  on image_assets for each row execute function epic_reindex_after();

drop trigger if exists image_links_reindex on image_links;
create trigger image_links_reindex after insert or update or delete
  on image_links for each row execute function epic_reindex_image();

drop function if exists roam_reindex_after();
drop function if exists roam_reindex_image();
drop function if exists roam_image_search(uuid);

-- 3. the stored values ------------------------------------------------------

update trip_groups set payment_mode = 'epic' where payment_mode = 'roam';
update group_items  set payment_mode = 'epic' where payment_mode = 'roam';
update group_items  set book_where   = 'epic' where book_where   = 'roam';
