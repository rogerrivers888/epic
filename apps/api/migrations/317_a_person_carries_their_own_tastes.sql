-- The person profile, revised (Settings revised v2, owner 1 Oct 2026). Three
-- facts move onto the person because the redesign asks them per person, not per
-- household:
--
-- 1. `access` — the access needs that used to be one household-level toggle
--    (`households.access_needs`). The toggle is retired; each person carries
--    their own list. Step-free filters; the rest rank (SX4). We do NOT guess
--    which needs a household that had the old flag on actually meant, so every
--    person starts empty and the change shows on their profile next open.
-- 2. `never_learn` — words a person has told Epic to Forget (SX5). The learner
--    checks this list before proposing anything, and forgetting is permanent.
-- 3. `ratings_view` — whose ratings a Places row shows, now a per-person
--    setting (SE11), seeded to "everyone" because the old "Ratings shown as"
--    value was only ever held on the device, not the server.
--
-- All three are additive and independently revertible: dropping the columns
-- restores the previous shape exactly.

alter table members add column if not exists access       jsonb not null default '[]'::jsonb;
alter table members add column if not exists never_learn  jsonb not null default '[]'::jsonb;
alter table members add column if not exists ratings_view jsonb not null default '{"mode":"all","who":[]}'::jsonb;

-- The person's private note: free-text allergens and free-text diets that can't
-- be mapped to a filter land here and never filter (owner, 1 Oct 2026 — "the
-- same as free-text allergens"). Added here so both the diet and the allergen
-- migrations can write to it; it keeps the name `allergen_note` the client and
-- API already use.
alter table members add column if not exists allergen_note text;

-- Where the data migrations below write their before/after counts, so they can
-- be read back after the deploy rather than scraped from a log (owner, 1 Oct
-- 2026 — "each one logs before/after counts when it runs"). Insert-only.
create table if not exists settings_v2_migration_report (
  id         bigserial primary key,
  migration  text not null,
  metric     text not null,
  value      bigint not null,
  at         timestamptz not null default now()
);
