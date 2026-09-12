-- A photograph the household took of a place, kept for that household.
--
-- Owner, 12 Sep 2026: "I might want to just take a photograph of somewhere
-- that looks cool and just add it." The picture is theirs, so it is the best
-- picture there is of that place *for them* — above a mark from the venue's
-- website, above a Commons frame, and above anything rented.
--
-- It is deliberately not an `image_links` row. That table is the library's,
-- and a hero there is drawn for every household that holds the place; a
-- family's photograph of their table is not a card for strangers. The asset
-- itself still lands in `image_assets` pending a person's look, exactly as
-- the schema promised for an upload, and the back office can promote it from
-- there if it is a picture worth everybody having.
create table if not exists household_place_photos (
  household_id uuid not null references households(id) on delete cascade,
  venue_ref    text not null,
  image_id     uuid not null references image_assets(id) on delete cascade,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  primary key (household_id, venue_ref, image_id)
);
create index if not exists household_place_photos_place_idx on household_place_photos (household_id, venue_ref, position);
