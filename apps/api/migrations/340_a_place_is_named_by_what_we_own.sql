-- A place is named by what we own (owner, 1–2 Oct 2026: "our own name … stored
-- permanently with its source"; "no stored provider names anywhere").
--
-- The display resolver (sources/displayNames.js) and every reader that names a
-- place in SQL — the activity feed, the back-office lists, the searches — must
-- give the same answer, so the answer lives here, once:
--
--   epic_owned_point_name(source, source_ref) — the name the owned source a
--     point was matched to holds itself (FSA, Historic England, OS Open Names,
--     the open map), from our own copy of it, live load first.
--   epic_owned_name(ref, household) — a place's owned name and its source, in
--     the resolver's order: the household's own nickname, a photo place's own
--     label, our research's name, an owned atlas place, the owned point's
--     source, the open map on an open reference. No row when none is owned:
--     the caller then fetches Google's live (in memory only) or says "a place".

create or replace function epic_owned_point_name(src text, src_ref text) returns text
language sql stable as $$
  select case src
    when 'fsa' then (select f.name from fsa_establishments f
                      where src_ref ~ '^[0-9]+$' and f.fhrsid = src_ref::bigint
                      order by (f.load_id = (select live_load from owned_source_loads where source = 'fsa')) desc limit 1)
    when 'historic-england' then (select h.name from heritage_entries h
                      where split_part(src_ref, ':', 2) ~ '^[0-9]+$'
                        and h.list_entry = split_part(src_ref, ':', 2)::bigint and h.layer = split_part(src_ref, ':', 1)
                      order by (h.load_id = (select live_load from owned_source_loads where source = 'historic-england')) desc limit 1)
    when 'os-open-names' then (select n.name from os_names n where n.id = src_ref
                      order by (n.load_id = (select live_load from owned_source_loads where source = 'os-open-names')) desc limit 1)
    when 'osm' then (select x.name from osm_features x where x.ref = src_ref)
  end $$;

create or replace function epic_owned_name(ref text, household uuid)
returns table (name text, source text)
language sql stable as $$
  select n.name, n.source from (
    -- the household's own typed name
    select hp.nickname as name, 'household'::text as source, 0 as pri
      from household_places hp where hp.venue_ref = ref and hp.household_id = household and hp.nickname is not null
    union all
    -- the label a household gave a photo place when they added it
    select hp.label, 'household', 1
      from household_places hp
     where hp.venue_ref = ref and hp.household_id = household and ref like 'photo:%' and hp.label is not null and hp.label <> hp.venue_ref
    union all
    -- our research's name, under the source its provenance records
    select r.name, coalesce(r.provenance ->> 'name', 'own'), 2
      from place_records r where r.venue_ref = ref and r.name is not null and (r.provenance ->> 'name') is not null
    union all
    -- an owned atlas place, by any of the three references it answers to — but
    -- never an unmatched sweep placeholder (source google, no osm_ref)
    select a.name, case when a.osm_ref is not null then 'osm' else 'atlas' end, 3
      from attractions a
     where a.venue_ref = ref and a.name is not null and a.display_source is distinct from 'google' and not (a.source = 'google' and a.osm_ref is null)
    union all
    select a.name, case when a.osm_ref is not null then 'osm' else 'atlas' end, 3
      from attractions a
     where a.external_ref = ref and a.name is not null and a.display_source is distinct from 'google' and not (a.source = 'google' and a.osm_ref is null)
    union all
    select a.name, case when a.osm_ref is not null then 'osm' else 'atlas' end, 3
      from attractions a
     where ref like 'atlas:%' and a.id = epic_try_uuid(substr(ref, 7)) and a.name is not null
       and a.display_source is distinct from 'google' and not (a.source = 'google' and a.osm_ref is null)
    union all
    -- the name the owned source a point was matched to holds itself
    select epic_owned_point_name(o.source, o.source_ref), o.source, 4
      from owned_points o where o.venue_ref = ref and epic_owned_point_name(o.source, o.source_ref) is not null
    union all
    -- the open map's name, on an open reference only
    select s.name, 'osm', 5
      from scout_places s
     where s.venue_ref = ref and s.name is not null
       and (ref like 'osm:%' or ref like 'atlas:%' or ref like 'wikidata:%' or ref like 'own:%')
  ) n order by n.pri limit 1 $$;

-- What a reader shows where it must show something and cannot ask Google:
-- the owned name, else the household's own words for a reference that is not
-- a provider's, else nothing — the caller says "a place".
create or replace function epic_shown_name(ref text, household uuid, stored text) returns text
language sql stable as $$
  select coalesce(
    (select n.name from epic_owned_name(ref, household) n),
    case when stored is not null and stored <> ref
          and not (coalesce(epic_ref_true_source(ref), '') = any(epic_rented_sources())) then stored end) $$;
