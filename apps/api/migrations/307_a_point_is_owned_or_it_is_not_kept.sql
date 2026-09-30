-- A point is owned or it is not kept (owner, C59, 30 Sep 2026).
--
-- "Close the four holes: tables reference the owned point instead of copying
-- Google's; the rebuild and ring re-stamp never copy Google points; the true
-- source is recorded per point, not guessed from the ID prefix." And the fifth:
-- a place record saving a Google point and name.
--
-- 1. owned_points: one permanent point per place, from a source we may keep
--    for good, with the source, its own identifier and its licence. This is
--    what every table refers to instead of a copy of Google's.
-- 2. point_from on every table that holds a place's point, saying whose point
--    it is: an owned source, 'census-box' (the centre of the box the census
--    found the place in, for a saved or visited place with nothing better), or
--    null where nothing is held.
-- 3. A trigger on each of those tables that refuses a rented point on the way
--    in, whoever writes it: it puts the owned point in its place, or the
--    census box where a household needs one, or nothing. One door rather than
--    fifteen writers each remembering.
-- 4. The expiry log says which table each purge touched.

create table if not exists owned_points (
  venue_ref   text primary key,
  lat         double precision not null,
  lng         double precision not null,
  source      text not null check (source in ('wikidata', 'fsa', 'historic-england', 'os-open-names', 'osm', 'household')),
  source_ref  text,               -- Q-id, FHRSID, list entry, OS id, node/123
  licence     text not null,      -- 'CC0-1.0', 'OGL-UK-3.0', 'ODbL-1.0', 'the household''s own'
  method      text not null,      -- how the match was made: 'reference', 'name+distance', ...
  distance_m  real,               -- from the point it was matched against, where there was one
  matched_at  timestamptz not null default now()
);
create index if not exists owned_points_source_idx on owned_points (source);

-- Kept for good. Everything else a table holds on a place reference is either
-- one of these or a rented point, and a rented point is never written.
create or replace function epic_owned_sources() returns text[] language sql immutable as
$$ select array['osm', 'atlas', 'wikidata', 'own', 'household', 'fsa', 'historic-england', 'os-open-names', 'fixtures'] $$;

-- The licensed providers whose points are rented: Google, and the others the
-- data policy names. A reference from anywhere else is not judged here.
create or replace function epic_rented_sources() returns text[] language sql immutable as
$$ select array['google', 'tripadvisor', 'yelp', 'foursquare'] $$;

-- Whose a reference's own point is, by the reference: the fallback when the
-- row does not say. A photo place is a household's own pin.
create or replace function epic_ref_point_source(ref text) returns text language sql immutable as
$$ select case split_part(coalesce(ref, ''), ':', 1) when '' then null when 'photo' then 'household' else split_part(ref, ':', 1) end $$;

-- The same, knowing that an atlas reference on an unmatched activity-sweep
-- row stands in for a Google place: its point and name are Google's (Codex,
-- 30 Sep 2026).
create or replace function epic_ref_true_source(ref text) returns text language sql stable as
$$ select case when coalesce(ref, '') ~ '^atlas:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and exists (
                   select 1 from attractions g where g.id = substr(ref, 7)::uuid
                      and (g.display_source = 'google' or (g.source = 'google' and g.osm_ref is null)))
               then 'google' else epic_ref_point_source(ref) end $$;

alter table household_places add column if not exists point_from text;
alter table trip_shortlist   add column if not exists point_from text;
alter table trip_stops       add column if not exists point_from text;
alter table visits           add column if not exists point_from text;
alter table scout_places     add column if not exists point_from text;
alter table attractions      add column if not exists point_from text;
alter table place_records    add column if not exists point_from text;

create or replace function epic_keep_owned_point() returns trigger language plpgsql as $$
declare
  -- 'household': a saved or visited place, which falls back to its census box.
  -- 'store': a source the index and the ring read, which never holds a box
  -- centre, because a box centre read as a point beats the box it came from.
  mode   text := TG_ARGV[0];
  ref    text;
  said   text;
  src    text;
  op     record;
  b      text[];
begin
  -- Half a point is no point: a latitude kept beside another source's
  -- longitude would be a place nobody put anywhere (Codex, 30 Sep 2026).
  if (NEW.lat is null) <> (NEW.lng is null) then NEW.lat := null; NEW.lng := null; end if;
  -- What the writer said, unless the point itself moved: an update that brings
  -- a new position with the old row's label on it would otherwise keep a
  -- rented point under an owned name.
  said := NEW.point_from;
  if TG_OP = 'UPDATE' and (NEW.lat is distinct from OLD.lat or NEW.lng is distinct from OLD.lng) then said := null; end if;
  if said = 'census-box' then said := null; end if;
  -- Each table on its own: PL/pgSQL resolves every field an expression names,
  -- so one CASE across tables fails on the columns another table lacks.
  if TG_TABLE_NAME = 'attractions' then
    ref := coalesce(NEW.venue_ref, 'atlas:' || NEW.id::text);
    -- The activity sweep's unmatched Google rows are Google's point; a matched
    -- one holds OSM's; every other attraction is the atlas (Wikidata/Commons).
    if NEW.display_source = 'google' or (NEW.source = 'google' and NEW.osm_ref is null) then src := 'google';
    elsif NEW.source = 'google' then src := 'osm';
    else src := 'atlas';
    end if;
  elsif TG_TABLE_NAME = 'scout_places' then
    ref := NEW.venue_ref;
    -- A sweep row twinned with the open map keeps OSM's point under Google's reference.
    if coalesce(NEW.from_sources, '[]'::jsonb) ? 'osm' then src := 'osm'; else src := epic_ref_point_source(ref); end if;
  elsif TG_TABLE_NAME = 'place_records' then
    ref := NEW.venue_ref;
    -- An owned record's point is composed from owned sources, and its
    -- provenance says which; a record matched to the open map is OSM's.
    if (NEW.provenance ->> 'lat') = any(epic_owned_sources()) then src := NEW.provenance ->> 'lat';
    elsif NEW.osm_ref is not null then src := 'osm';
    else src := coalesce(said, epic_ref_true_source(ref));
    end if;
  else
    ref := NEW.venue_ref;
    src := coalesce(said, epic_ref_true_source(ref));
  end if;

  -- Google's name for a place the open map never gave is rented like its
  -- point (owner, 30 Sep 2026: "Google names fall under the same rule: don't
  -- keep them"). Every reader already refuses to show or search it.
  if TG_TABLE_NAME = 'scout_places' and src = any(epic_rented_sources()) then
    NEW.name := null;
  end if;

  -- A place's owned point, where one has landed, is its one point: every copy
  -- takes it, so a correction or a better source reaches them all (Codex, 30
  -- Sep 2026). A household's own pin on a photo place has none, and keeps its own.
  select o.lat, o.lng, o.source into op from owned_points o where o.venue_ref = ref;
  if found then
    NEW.lat := op.lat; NEW.lng := op.lng; NEW.point_from := op.source;
    return NEW;
  end if;

  if NEW.lat is not null and NEW.lng is not null and not (src = any(epic_rented_sources())) then
    NEW.point_from := src;
    return NEW;
  end if;

  -- A saved or visited place keeps working through its census box until its
  -- owned point lands (owner, C59: "Saved/visited places keep working through
  -- their census box until their owned point lands").
  if mode = 'household' then
    select string_to_array(pi.slice, ',') into b from place_index pi where pi.venue_ref = ref;
    if b is not null and array_length(b, 1) = 4 then
      NEW.lat := (b[1]::double precision + b[3]::double precision) / 2;
      NEW.lng := (b[2]::double precision + b[4]::double precision) / 2;
      NEW.point_from := 'census-box';
      return NEW;
    end if;
  end if;

  -- Nothing we may keep. A row that arrived without a point stays without one.
  if NEW.lat is not null and src = any(epic_rented_sources()) then
    NEW.lat := null; NEW.lng := null;
  end if;
  NEW.point_from := case when NEW.lat is null then null else src end;
  return NEW;
end $$;

drop trigger if exists keep_owned_point on household_places;
create trigger keep_owned_point before insert or update on household_places for each row execute function epic_keep_owned_point('household');
drop trigger if exists keep_owned_point on trip_shortlist;
create trigger keep_owned_point before insert or update on trip_shortlist for each row execute function epic_keep_owned_point('household');
drop trigger if exists keep_owned_point on trip_stops;
create trigger keep_owned_point before insert or update on trip_stops for each row execute function epic_keep_owned_point('household');
drop trigger if exists keep_owned_point on visits;
create trigger keep_owned_point before insert or update on visits for each row execute function epic_keep_owned_point('household');
drop trigger if exists keep_owned_point on scout_places;
create trigger keep_owned_point before insert or update on scout_places for each row execute function epic_keep_owned_point('store');
drop trigger if exists keep_owned_point on attractions;
create trigger keep_owned_point before insert or update on attractions for each row execute function epic_keep_owned_point('store');
drop trigger if exists keep_owned_point on place_records;
create trigger keep_owned_point before insert or update on place_records for each row execute function epic_keep_owned_point('store');

-- Where a saved, planned or visited place is, for whoever reads it: the
-- table's own point where it is owned; otherwise the index's current point,
-- which is either owned or Google's for at most thirty days (the hourly expiry
-- sees to that); otherwise the table's census box. The tables refer to the
-- place rather than keeping a copy of Google's point (C59), and a place a
-- family looked at this month still sits where it is, not in the middle of
-- its box. Both halves from the same source, never a latitude from one and a
-- longitude from another. A row's own point is read only when it is owned, a
-- census box, or unlabelled on a reference that is not rented: a copy of
-- Google's point written before this migration is never read back once the
-- index's own has expired (Codex, 30 Sep 2026); the purge then removes it.
create or replace function epic_point_lat(ref text, lat double precision, point_from text) returns double precision
language sql stable as $$
  select case when lat is not null and point_from = any(epic_owned_sources()) then lat
              else coalesce((select pi.lat from place_index pi where pi.venue_ref = ref and pi.lat is not null and pi.lng is not null),
                            case when (point_from = 'census-box' or (point_from is null and not (coalesce(epic_ref_true_source(ref), '') = any(epic_rented_sources())))) then lat end,
                            -- The census box as it stands now, learned after the copy was written (Codex).
                            (select (split_part(pi.slice, ',', 1)::double precision + split_part(pi.slice, ',', 3)::double precision) / 2
                               from place_index pi where pi.venue_ref = ref and pi.slice ~ '^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$')) end $$;
create or replace function epic_point_lng(ref text, lng double precision, point_from text) returns double precision
language sql stable as $$
  select case when lng is not null and point_from = any(epic_owned_sources()) then lng
              else coalesce((select pi.lng from place_index pi where pi.venue_ref = ref and pi.lat is not null and pi.lng is not null),
                            case when (point_from = 'census-box' or (point_from is null and not (coalesce(epic_ref_true_source(ref), '') = any(epic_rented_sources())))) then lng end,
                            (select (split_part(pi.slice, ',', 2)::double precision + split_part(pi.slice, ',', 4)::double precision) / 2
                               from place_index pi where pi.venue_ref = ref and pi.slice ~ '^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$')) end $$;

alter table coordinate_expiries add column if not exists table_name text;
alter table coordinate_expiries add column if not exists detail jsonb;
