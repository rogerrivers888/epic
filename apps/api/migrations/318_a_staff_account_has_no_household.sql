-- Staff in the back office: people who log in to administer Epic, not to use it
-- as a household.
--
-- Signed off 1 Oct 2026 (Supporting docs › EPIC staff management). The owner can
-- add people to the back office, give each a role and issue a single-use login
-- link; from then on he can change their role, send a new link, log them out
-- everywhere, suspend them or remove them.
--
-- A staff member is an `accounts` row whose role opens the admin door (034), and
-- the one thing that row must not have is a household. `accounts.household_id`
-- was NOT NULL from the first migration (033), on the assumption that every
-- account is a family using Epic. A staff account is not: giving each one an
-- empty household would mean `currentHousehold()` resolved to a real, if empty,
-- row for them — and a household route would answer rather than refuse. So the
-- column becomes nullable (option (a) of the handover), and a staff account
-- carries null. `currentHousehold()` already throws `no_household` for an
-- account whose household cannot be found (routes/household.js), which is exactly
-- the refusal a staff member should get from a household route.
--
-- Nothing else changes shape. The capability that gates the Staff screen,
-- `manage_staff`, is declared in code (access.js) and held only by the owner —
-- it is not granted to any role here, so no back-office role can manage staff
-- until the owner says so by granting it in Admin › Roles.

alter table accounts alter column household_id drop not null;

-- The single-owner guarantee (033) is untouched: a staff account never takes the
-- legacy `role = 'owner'` value, so `accounts_single_owner_idx` still admits
-- exactly one owner. Staff are distinguished by `role_id` pointing at a role
-- whose `doors` include 'admin', which is what `accessFor` already reads.

-- When an existing customer is given back-office access, their customer role is
-- overwritten by the staff role (an account holds one role at a time). This
-- remembers what it was, so removing staff access later restores their original
-- role rather than flattening everyone to the default member role. Null for a
-- plain staff account (nothing to restore — it is deleted on removal) and for a
-- customer who had no explicit role.
alter table accounts add column if not exists prior_role_id uuid references roles(id) on delete set null;
