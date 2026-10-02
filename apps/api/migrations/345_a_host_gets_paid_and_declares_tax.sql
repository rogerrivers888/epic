-- The Host tab's Money screen needs two things the host record never held
-- (Settings revised v2, owner 1 Oct 2026):
--
--   · pay_schedule — when payouts land (SX17): 'weekly' = every Friday,
--     'weekday' = every weekday, 'monthly' = on the 1st. A date's money is
--     released two days after it runs, then paid on the next payout day; the
--     schedule only chooses the day.
--   · tax_is_company / company_number — "Hosting as a company" (SX19). When on,
--     earnings are reported under the company, and Companies House's 8-digit
--     number is captured. `tax_reference` (UTR or NI) already exists on the
--     host and is unchanged.
--
-- The UTR-or-NI rule and the trust-level fee thresholds are enforced in code /
-- config (they are placeholders the business sets), not here. Additive.

alter table hosts add column if not exists pay_schedule   text    not null default 'weekly';
alter table hosts add column if not exists tax_is_company  boolean not null default false;
alter table hosts add column if not exists company_number  text;
-- Tax identity is its own record (SX19): the legal name HMRC sees and the
-- registered/tax address are NOT the guest-facing host name or the operational
-- hosting location, and editing one must never change the other (Codex).
alter table hosts add column if not exists legal_name   text;
alter table hosts add column if not exists tax_address  text;

alter table hosts drop constraint if exists hosts_pay_schedule_check;
alter table hosts add  constraint hosts_pay_schedule_check
  check (pay_schedule in ('weekly', 'weekday', 'monthly'));
