-- When the postcode directory was last checked, and which release is loaded.
--
-- Owner, 26 Sep 2026: "Schedule the ONS refresh. A quarterly source nobody
-- refreshes goes stale silently, and it now decides where every place in the
-- country is counted. Monthly check, quarterly load." One row: the check is
-- monthly, the load happens when the ONS lists a newer directory than the
-- one loaded (sources/postcodeRefresh.js).

create table if not exists postcode_releases (
  one             boolean primary key default true check (one),
  checked_at      timestamptz,
  latest_release  text,            -- '2026-08', as the ONS names it
  latest_item     text,            -- the geoportal item the archive is downloaded from
  loaded_release  text,
  loaded_at       timestamptz,
  loading_since   timestamptz,
  last_error      text
);
insert into postcode_releases (one) values (true) on conflict do nothing;
