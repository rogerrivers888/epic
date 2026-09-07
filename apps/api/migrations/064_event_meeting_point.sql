-- Where to meet is an address, not a line in a note (owner, 7 Sep 2026: "'Where
-- to meet' is 1 row with an actual search for an address… and then maybe 'any
-- other details' is another details box"). The note keeps everything else.
alter table group_items
  add column if not exists meet_label text,
  add column if not exists meet_lat    double precision,
  add column if not exists meet_lng    double precision;

-- Things the organiser has taken off the group's list. The list is kept in step
-- with the trip — an activity added to the trip appears on it (owner, 7 Sep
-- 2026: "I have now added 2 activities… but when I get to what's on the trip,
-- there are no activities listed") — and this is how something removed on
-- purpose stays removed.
alter table trip_groups
  add column if not exists dropped_refs jsonb not null default '[]'::jsonb;
