-- The closed check's review count, one row a day (decision C57, owner, 29 Sep
-- 2026: "The 384 review items: don't queue them for me … Show the count on
-- Overview only if it's growing").
--
-- Review settles itself — when a place is researched, when Google details
-- are fetched, when a family goes — so the count should fall. The desk
-- Overview says so only when it is *rising*: today's count above the count a
-- week before. With no count from a week ago there is nothing to compare, and
-- the Overview says nothing rather than a number that happens to be growth.
--
-- Its own table: nothing here reads `place_status`, so it can be created in
-- any order beside migration 298.

create table if not exists closed_review_days (
  day        date primary key,
  review     integer not null,
  taken_at   timestamptz not null default now()
);
