-- An atlas place matched to the open map (decision C57, owner, 29 Sep 2026:
-- "Unconfirmed: run the free matching pass against the local OSM extract
-- (name + position) first, then re-count").
--
-- The first dry run left 11,948 atlas places unconfirmed: known to Wikidata
-- and Wikipedia and nothing current. Many are on the open map under the same
-- name a few metres away; the atlas row simply never carried the link. This
-- is that link, found by the closed check from our own copy of the extract
-- (`osm_features`), free, and ours to keep (ODbL).
--
-- Its own table rather than `attractions.osm_ref`, on purpose: that column
-- decides the ref Inspire draws an atlas place by (`osm:` before
-- `wikidata:`), so writing it would re-key places families have already
-- saved or linked to. A match here only *confirms* a place — it can show one
-- that was unconfirmed, never hide one — so it is written at once, dry run
-- or not.

create table if not exists atlas_osm_matches (
  attraction_id uuid primary key references attractions(id) on delete cascade,
  osm_ref       text not null,              -- 'node/123', 'way/45', 'relation/6'
  osm_name      text,
  metres        real not null,
  how           text not null,              -- 'same_name' | 'name_agrees'
  check_id      uuid,
  matched_at    timestamptz not null default now()
);
create index if not exists atlas_osm_matches_ref on atlas_osm_matches (osm_ref);
