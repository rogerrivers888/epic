-- The back office records a market change (Markets tab, step 4).
--
-- `bo_changes.area` is checked against a fixed list (migration 266); the Markets
-- tab is a new area, so a market or wording edit logged there failed the check.
-- A follow-on rather than an edit to 266, which has already run everywhere
-- (never edit a migration that has run). The list gains 'Markets'.

alter table bo_changes drop constraint if exists bo_changes_area_check;
alter table bo_changes add constraint bo_changes_area_check
  check (area in ('Categories','Subcategories','Facts','Mapping','Defaults','Collections','Fact automations','Markets'));
