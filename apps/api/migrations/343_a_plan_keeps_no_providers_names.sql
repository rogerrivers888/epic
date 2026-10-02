-- A plan keeps no provider's names (owner, 2 Oct 2026: "Plan sessions: include
-- them. Strip provider names from stored plan-session search results (keep
-- place IDs; names come from the resolver on read), add plan_sessions to the
-- stop-storing trigger, and count it in the purge quote").
--
-- A session's `state` is the planner's working JSON: the search pool, the
-- options, the anchors. Any object in it that names a licensed provider's
-- place — by `source` + `sourcePlaceId`, or a `venueRef`, `ref` or `key` that
-- is a provider's reference (epic_ref_true_source) — has its name fields
-- emptied on the way in. The identifiers stay, so the planner and the screen
-- still know which place it is; repositories/planSessions.js names it again
-- on read (sources/displayNames.js).
create or replace function epic_strip_rented_names(j jsonb) returns jsonb language plpgsql stable as $$
declare
  out jsonb;
  ref text;
  k   text;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'array' then
    select coalesce(jsonb_agg(epic_strip_rented_names(e) order by o), '[]'::jsonb) into out
      from jsonb_array_elements(j) with ordinality t(e, o);
    return out;
  end if;
  if jsonb_typeof(j) <> 'object' then return j; end if;
  select coalesce(jsonb_object_agg(key, epic_strip_rented_names(value)), '{}'::jsonb) into out from jsonb_each(j);
  -- Every reference the object carries is asked, not only the first: a fixed
  -- stop is {source: 'anchor', …, key: 'google:…'} (Codex, 2 Oct 2026).
  select r into ref from unnest(array[
    case when jsonb_typeof(out -> 'source') = 'string' and jsonb_typeof(out -> 'sourcePlaceId') = 'string'
         then (out ->> 'source') || ':' || (out ->> 'sourcePlaceId') end,
    case when jsonb_typeof(out -> 'venueRef') = 'string' then out ->> 'venueRef' end,
    case when jsonb_typeof(out -> 'ref') = 'string' and (out ->> 'ref') ~ '^[a-z]+:' then out ->> 'ref' end,
    case when jsonb_typeof(out -> 'key') = 'string' and (out ->> 'key') ~ '^[a-z]+:' then out ->> 'key' end]) r
   where r is not null and coalesce(epic_ref_true_source(r), '') = any(epic_rented_sources())
   limit 1;
  if ref is not null then
    foreach k in array array['name', 'venueName', 'venueLabel', 'venue_name', 'venue_label'] loop
      if jsonb_typeof(out -> k) = 'string' then out := jsonb_set(out, array[k], 'null'::jsonb); end if;
    end loop;
  end if;
  return out;
end $$;

create or replace function epic_no_rented_names_in_plan() returns trigger language plpgsql as $$
begin
  NEW.state := epic_strip_rented_names(NEW.state);
  return NEW;
end $$;

drop trigger if exists no_rented_name on plan_sessions;
create trigger no_rented_name before insert or update of state on plan_sessions
  for each row execute function epic_no_rented_names_in_plan();
