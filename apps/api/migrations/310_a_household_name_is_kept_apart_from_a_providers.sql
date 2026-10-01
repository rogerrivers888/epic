-- A household's own name for a place is kept apart from a provider's (owner,
-- 1 Oct 2026: "keep user-typed nicknames separately with a marker so they're
-- never confused with provider names").
--
-- Until now household_places.label held whatever named the place: Google's
-- display name at save time, or the household's own if they typed one — with
-- nothing to tell them apart. A nickname is an owned annotation Epic may keep;
-- a provider's name is rented and must not be stored. So the household's own
-- name moves to its own column, written only when a person types it, and the
-- display name is otherwise resolved at read time (owned → live → research).
alter table household_places add column if not exists nickname text;

-- And a place whose owned point may be wrong: when a live Google name is
-- fetched for a place we matched to an owned source, a name that differs
-- materially from the matched source's says the match is suspect — its
-- coordinates are not to be trusted and it is re-matched (owner, 1 Oct 2026).
-- Only the flag is kept; Google's name never is.
alter table owned_points add column if not exists suspect boolean not null default false;
alter table owned_points add column if not exists suspect_reason text;
alter table owned_points add column if not exists checked_at timestamptz;
create index if not exists owned_points_suspect_idx on owned_points (suspect) where suspect;
