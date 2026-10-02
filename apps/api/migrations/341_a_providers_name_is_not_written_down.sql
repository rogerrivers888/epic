-- A provider's name is not written down (owner, 1–2 Oct 2026: "no stored
-- provider names anywhere"; Stage C, step two: "the stop-storing trigger").
--
-- One door rather than a dozen writers each remembering, as migration 307 did
-- for points: on every table that keeps a name beside a place reference, a row
-- whose reference is a licensed provider's (epic_ref_true_source — an atlas
-- reference to an activity-sweep row is Google's) has its name replaced on the
-- way in — by the reference itself where the column may not be empty (the
-- existing "unnamed" convention: label = venue_ref), else by nothing. Readers
-- name the place by what we own (migration 340), or Google's live, or a neutral
-- word. A household's own pin, an open reference (the map, a fixture, a typed
-- stop) and a host's own words are left exactly as written.
--
-- A household's own name for a place is kept in household_places.nickname
-- (migration 310), which this never touches.

-- Two tables keep a person's own words beside a place reference as well as a
-- copy of a place's name, so they say which a label is (Codex, 2 Oct 2026):
-- a group checklist item copied from the trip ('trip') or written by the
-- organiser ('own'); a host's offer venue that came with a picked place
-- ('place') or that the host wrote ('host'). Only a copy is ever cleared.
alter table group_items add column if not exists label_from text check (label_from in ('trip', 'own'));
alter table host_offers add column if not exists venue_label_from text check (venue_label_from in ('place', 'host'));

-- The items already written, judged on the evidence while it is still there:
-- an item whose label is the name the same trip's shortlist or stop holds for
-- that place was copied from the trip; any other item on a place is the
-- organiser's own words (Codex, 2 Oct 2026). Items with no place stay as they are.
create or replace function epic_judge_group_item_provenance() returns integer language sql as $$
  with judged as (
    update group_items i set label_from = case when
        exists (select 1 from trip_groups g join trip_shortlist sl on sl.trip_id = g.trip_id
                 where g.id = i.group_id and sl.venue_ref = i.venue_ref and sl.venue_label = i.label)
        or exists (select 1 from trip_groups g join trip_stops ts on ts.trip_id = g.trip_id
                 where g.id = i.group_id and ts.venue_ref = i.venue_ref and ts.venue_name = i.label)
      then 'trip' else 'own' end
     where i.label_from is null and i.venue_ref is not null
    returning 1)
  select count(*)::int from judged $$;
select epic_judge_group_item_provenance();

create or replace function epic_no_rented_name() returns trigger language plpgsql as $$
declare
  name_col text := TG_ARGV[0];
  ref_col  text := TG_ARGV[1];
  mode     text := TG_ARGV[2];          -- 'ref' (the column may not be empty) or 'null'
  from_col text := case when TG_NARGS > 3 then TG_ARGV[3] end;   -- whose words, where a table says
  own_word text := case when TG_NARGS > 4 then TG_ARGV[4] end;   -- the value that means "a person's own"
  rec      jsonb := to_jsonb(NEW);
  ref      text := rec ->> ref_col;
  nm       text := rec ->> name_col;
begin
  if ref is null or nm is null then return NEW; end if;
  -- A person's own words are never a provider's, whatever the reference.
  if from_col is not null and (rec ->> from_col) is not distinct from own_word then return NEW; end if;
  if not (coalesce(epic_ref_true_source(ref), '') = any(epic_rented_sources())) then return NEW; end if;
  if mode = 'ref' then
    if nm = ref then return NEW; end if;
    NEW := jsonb_populate_record(NEW, jsonb_build_object(name_col, ref));
  else
    NEW := jsonb_populate_record(NEW, jsonb_build_object(name_col, null));
  end if;
  return NEW;
end $$;

drop trigger if exists no_rented_name on household_places;
create trigger no_rented_name before insert or update of label, venue_ref on household_places
  for each row execute function epic_no_rented_name('label', 'venue_ref', 'ref');
drop trigger if exists no_rented_name on trip_stops;
create trigger no_rented_name before insert or update of venue_name, venue_ref on trip_stops
  for each row execute function epic_no_rented_name('venue_name', 'venue_ref', 'ref');
drop trigger if exists no_rented_name on trip_shortlist;
create trigger no_rented_name before insert or update of venue_label, venue_ref on trip_shortlist
  for each row execute function epic_no_rented_name('venue_label', 'venue_ref', 'ref');
drop trigger if exists no_rented_name on visits;
create trigger no_rented_name before insert or update of venue_label, venue_ref on visits
  for each row execute function epic_no_rented_name('venue_label', 'venue_ref', 'ref');
drop trigger if exists no_rented_name on group_items;
create trigger no_rented_name before insert or update of label, venue_ref, label_from on group_items
  for each row execute function epic_no_rented_name('label', 'venue_ref', 'ref', 'label_from', 'own');
drop trigger if exists no_rented_name on trip_messages;
create trigger no_rented_name before insert or update of venue_label, venue_ref on trip_messages
  for each row execute function epic_no_rented_name('venue_label', 'venue_ref', 'null');
drop trigger if exists no_rented_name on host_offers;
create trigger no_rented_name before insert or update of venue_label, venue_ref, venue_label_from on host_offers
  for each row execute function epic_no_rented_name('venue_label', 'venue_ref', 'null', 'venue_label_from', 'host');
drop trigger if exists no_rented_name on orders;
create trigger no_rented_name before insert or update of venue_label, venue_ref on orders
  for each row execute function epic_no_rented_name('venue_label', 'venue_ref', 'null');
drop trigger if exists no_rented_name on menus;
create trigger no_rented_name before insert or update of venue_label, venue_ref on menus
  for each row execute function epic_no_rented_name('venue_label', 'venue_ref', 'null');
drop trigger if exists no_rented_name on place_menus;
create trigger no_rented_name before insert or update of venue_label, venue_ref on place_menus
  for each row execute function epic_no_rented_name('venue_label', 'venue_ref', 'null');
drop trigger if exists no_rented_name on rule_overrides;
create trigger no_rented_name before insert or update of venue_label, venue_ref on rule_overrides
  for each row execute function epic_no_rented_name('venue_label', 'venue_ref', 'null');
drop trigger if exists no_rented_name on content_queue;
create trigger no_rented_name before insert or update of place_label, venue_ref on content_queue
  for each row execute function epic_no_rented_name('place_label', 'venue_ref', 'null');

-- A saved or shortlisted place's snapshot (`venue`) is kept for an open source
-- only — the data policy: a provider's details are "never written to
-- household_places.venue for a licensed ref". The writers already hold to it;
-- a snapshot copied from an older row is caught here (Codex, 2 Oct 2026).
drop trigger if exists no_rented_venue on household_places;
create trigger no_rented_venue before insert or update of venue, venue_ref on household_places
  for each row execute function epic_no_rented_name('venue', 'venue_ref', 'null');
drop trigger if exists no_rented_venue on trip_shortlist;
create trigger no_rented_venue before insert or update of venue, venue_ref on trip_shortlist
  for each row execute function epic_no_rented_name('venue', 'venue_ref', 'null');

-- A chat topic about a stop keeps its anchor's label only as a fallback for
-- when the stop has gone; a provider's name is not that fallback.
create or replace function epic_no_rented_tag_label() returns trigger language plpgsql as $$
begin
  if NEW.tag_kind = 'stop' and NEW.tag_label is not null and NEW.tag_ref is not null
     and coalesce(epic_ref_true_source(NEW.tag_ref), '') = any(epic_rented_sources()) then
    NEW.tag_label := null;
  end if;
  return NEW;
end $$;
drop trigger if exists no_rented_name on chat_topics;
create trigger no_rented_name before insert or update of tag_label, tag_ref, tag_kind on chat_topics
  for each row execute function epic_no_rented_tag_label();
