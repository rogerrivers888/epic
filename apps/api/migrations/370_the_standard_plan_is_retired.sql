-- The £0 "Standard" plan is retired (Roger, 3 Oct 2026).
--
-- It was seeded on 13 Sep (034) as "A paying household. Set its price and it
-- appears in revenue." — a placeholder from before the Solo, Household and Pro
-- tiers (200). Nothing reads it and, checked on production the same day, no
-- account is on it. Marked inactive, never deleted: a plan row is history
-- (account_plan_history names it), and an inactive plan is one nobody can be
-- put on.
--
-- If an account is on it after all, it is left active and the migration says
-- so: that household is moved to the right plan by a person first, never by a
-- migration guessing which.

do $$
declare on_it int;
begin
  select count(*) into on_it from accounts where plan = 'standard';
  if on_it > 0 then
    raise notice 'standard plan left active: % account(s) on it — move them first', on_it;
  else
    update plans set active = false where key = 'standard';
  end if;
end $$;
