-- How Epic plans, as the revised Settings draws it (owner 1 Oct 2026). The
-- four "How Epic plans" rows (SE7–SE10) need more than the household carried:
--
--   · close_to_home_minutes — "Close to home" is now a time, not a radius
--     (Up to 30 min / 1 hr / 1½ hrs / 2 hrs, or NULL = any distance). A place
--     counts as close if ANY ticked travel mode reaches it inside the time.
--   · travel_modes — "Getting there" is multi-select now (Car / Train / Bus /
--     Walking / Bike), not the single `travel_mode`. Backfilled from it:
--     driving→[car], transit→[train,bus], walking→[walking], cycling→[bike].
--   · day_start / day_end — "When your day runs" (start 7–12, finish 14–22,
--     at least four hours apart). The old scroll had no day window at all.
--
-- `default_intensity` (relaxed/balanced/packed) already carries "How busy a
-- day" and is untouched. The single `travel_mode` column stays for any legacy
-- reader; the new UI reads `travel_modes`. Additive + backfill.

-- Default "Up to 1 hr" (SE7's default). Nullable, and NULL means a deliberate
-- "Any distance" — never an unset new row, which the default keeps at 60.
alter table households add column if not exists close_to_home_minutes integer default 60;
alter table households add column if not exists travel_modes          jsonb   not null default '[]'::jsonb;
alter table households add column if not exists day_start             smallint not null default 10;
alter table households add column if not exists day_end               smallint not null default 18;

-- Close to home defaults to "Up to 1 hr" where nothing was set.
update households set close_to_home_minutes = 60 where close_to_home_minutes is null;

-- Carry the single mode forward into the multi-select vocabulary.
update households set travel_modes = case travel_mode
    when 'driving' then '["car"]'::jsonb
    when 'transit' then '["train","bus"]'::jsonb
    when 'walking' then '["walking"]'::jsonb
    when 'cycling' then '["bike"]'::jsonb
    else '["car"]'::jsonb
  end
 where travel_modes = '[]'::jsonb;

alter table households drop constraint if exists households_day_window_check;
alter table households add  constraint households_day_window_check
  check (day_start between 7 and 12 and day_end between 14 and 22 and day_end - day_start >= 4);

-- How many households had the old household-level access-needs toggle on — the
-- people in them now start with an empty per-person list and see the change on
-- their profile next open (migration 317). Recorded for the post-deploy report.
insert into settings_v2_migration_report (migration, metric, value)
  values ('access', 'access.households_had_toggle_on', (select count(*) from households where access_needs is true));
