-- A place's country comes from owned data, not a rented coordinate (owner, 1 Oct
-- 2026; Option C). A place is stamped with its country once and keeps it:
-- coordinates expire at 30 days (migration 184) but the country does not, because
-- it never depended on them. The owned, permanent signal is the durable postcode
-- (place_records.postcode, "a fact of ours", migration 162) — its outcode's
-- locality carries the country ONS puts it in (localities, migration 048,
-- country_code). That beats a country_code copied from whatever source area first
-- mentioned the place, so where the two disagree the postcode wins, and where the
-- stamp was null it fills it.
--
-- This one-time pass corrects a DB that already has the ONS postcode load in.
-- backfillCountriesFromPostcodes() (repositories/placeIndex.js) runs the same two
-- steps after `npm run postcodes`, which is where it takes effect on a fresh install
-- (migrations run before that load, so `postcodes` is empty here and this matches
-- nothing — Codex). settleCountryFromPostcode() then keeps new places right going
-- forward (settle step 0a). The outward-code expression is the one settle uses.
--
-- Correcting the stamp is not enough on its own: a placed row's old country sits in
-- place_areas and area_stats too, and settle only refiles rows whose placed_at is
-- null. So a corrected row is requeued (placed_at, settle_tried_at nulled) and the
-- next settle pass refiles it under the right country and refreshes the boards
-- (Codex). Only the rows that actually changed are requeued — the WHERE sees to that.

-- Which postcode release the country backfill has caught up to. When it lags
-- `loaded_release` the backfill is pending, and the next settle pass (under the build
-- lock) applies it — so a post-load backfill the build lock made it defer is never
-- lost, not even until a reindex (Codex).
alter table postcode_releases add column if not exists country_backfilled_release text;

-- First, undo the legacy damage the backfill would otherwise trust and spread. The
-- old admin postcode edit created a new outcode's locality with the place's current
-- country_code — so an IE-stamped place moved to a UK outcode could leave that
-- outcode's locality stamped IE (Codex). The authoritative source of which outcodes
-- are British is the ONS postcode load (`postcodes`, migration 253), which is
-- GB-only — NOT the outward-code *syntax*, because valid Eircode routing keys like
-- D02 and D6W share that shape and would be wrongly reclassified. So a postcode
-- locality is corrected to GB only where its slug is a real GB outcode ONS knows;
-- an Irish routing key is not in `postcodes` and is left as it is.
update localities loc
   set country_code = 'GB'
 where loc.kind = 'postcode'
   and upper(loc.country_code) <> 'GB'
   -- p.outcode = upper(slug), not lower(p.outcode) = slug, so the postcodes(outcode)
   -- index is used rather than scanning 1.7M rows for an unknown outcode (Codex).
   and exists (select 1 from postcodes p where p.outcode = upper(loc.slug));

update place_index pi
   set country_code = upper(loc.country_code),
       placed_at = null,
       settle_tried_at = null
  from place_records r
  join localities loc
    on loc.kind = 'postcode'
   and loc.slug = lower(case
         when btrim(upper(r.postcode)) ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$' then btrim(upper(r.postcode))
         when position(' ' in btrim(r.postcode)) > 0 then split_part(btrim(upper(r.postcode)), ' ', 1)
         else left(upper(btrim(r.postcode)), greatest(0, length(btrim(r.postcode)) - 3))
       end)
 where pi.venue_ref = r.venue_ref
   and r.postcode is not null
   and loc.country_code is not null
   and upper(pi.country_code) is distinct from upper(loc.country_code);

-- This pass has caught the backfill up to whatever release is in, so settle does not
-- redo it. Null on a fresh install (no load yet); the load stamps it when it runs.
update postcode_releases set country_backfilled_release = loaded_release where one;
