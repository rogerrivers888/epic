/**
 * Every statement about staff — the people who log in to the back office.
 *
 * A staff member is not a second kind of table. It is an `accounts` row whose
 * role opens the admin door (migration 034), with no household of its own
 * (migration 310). So this file is a thin set of reads and one insert over
 * `accounts` and `roles`; everything a staff member has in common with a
 * customer — a sign-in link, a session, the sign-in counter — is already in
 * `repositories/accounts.js`, and the staff routes call both.
 *
 * Rule 1 of the estate's engineering standard: all SQL lives in `repositories/`.
 */

import { query, withTransaction } from '../db.js';
import { normaliseEmail } from './accounts.js';

/**
 * The roles a staff member can be given: the back-office roles, which are the
 * ones whose `doors` include 'admin'. The owner role is left out — it is not a
 * role anybody is *granted*, and only one account ever holds it (033) — so what
 * is returned is the set the Add-staff and change-role pickers show.
 *
 * Each carries its own `description` (034 writes one per role), which is what the
 * picker shows under the role name: "generated from its doors" in the handover
 * is exactly this column, written when the role was.
 */
export async function backOfficeRoles() {
  const { rows } = await query(
    `select id, key, label, description, doors
       from roles
      where 'admin' = any(doors) and is_owner = false
      order by position, created_at`,
  );
  return rows;
}

// Everything the Staff list and one-person views read. No household figures and
// no provider usage: a staff member administers Epic, they do not use it, so the
// columns the Accounts screen cares about are not asked for here.
const STAFF_COLUMNS = `a.id, a.email, a.name, a.status, a.role as legacy_role, a.household_id,
                       a.invited_at, a.activated_at, a.last_seen_at, a.sign_in_count, a.created_at,
                       r.id as role_id, r.key as role_key, r.label as role_label,
                       r.description as role_description, r.is_owner as role_is_owner`;

// A staff row is the owner (by the legacy column, which still names the founding
// account), or any account whose role opens the admin door.
const STAFF_WHERE = `a.role = 'owner' or (r.id is not null and 'admin' = any(r.doors))`;
// Owner first, then oldest first — the same order the Accounts list uses.
const STAFF_ORDER = `order by (a.role = 'owner' or r.is_owner) desc, a.created_at`;

/** Everybody who can log in to the back office, owner first. */
export async function listStaff() {
  const { rows } = await query(
    `select ${STAFF_COLUMNS}
       from accounts a
       left join roles r on r.id = a.role_id
      where ${STAFF_WHERE}
      ${STAFF_ORDER}`,
  );
  return rows;
}

/** One staff member, or null if that id is not on staff. */
export async function staffById(id) {
  const { rows } = await query(
    `select ${STAFF_COLUMNS}
       from accounts a
       left join roles r on r.id = a.role_id
      where a.id = $1 and (${STAFF_WHERE})`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * A new back-office account: an e-mail, a name, a role, and no household.
 *
 * `role_id` is the back-office role chosen; the legacy `role` column stays
 * 'customer' (its default), because the legacy value only ever means "owner" or
 * "not the owner" and a staff member is not the owner. `status` is 'invited'
 * until they first follow a link, exactly as a customer's is.
 */
export async function createStaffAccount({ email, name, roleId }) {
  const { rows } = await query(
    `insert into accounts (household_id, email, name, role, role_id, status, plan, invited_at)
     values (null, $1, $2, 'customer', $3, 'invited', 'trial', now())
     returning id`,
    [normaliseEmail(email), name || null, roleId],
  );
  return staffById(rows[0].id);
}

/**
 * Change a staff member's role. One caller: the role picker on an account that is
 * already staff. It does not touch `prior_role_id` — that still remembers the
 * customer role from before they were staff, if there was one.
 */
export async function setStaffRole(id, roleId) {
  await query('update accounts set role_id = $2, updated_at = now() where id = $1', [id, roleId]);
  return staffById(id);
}

/**
 * Give an existing *customer* account a back-office role, remembering the role it
 * held so removal can put it back. `coalesce` so that re-granting (if they were
 * made staff, removed, and added again) does not overwrite a prior already kept.
 */
export async function grantStaffRole(id, roleId) {
  await query(
    'update accounts set prior_role_id = coalesce(prior_role_id, role_id), role_id = $2, updated_at = now() where id = $1',
    [id, roleId],
  );
  return staffById(id);
}

/**
 * Take the back-office role away, and leave the account exactly as able to log
 * in as a customer as it was before — or no account at all if there was never a
 * household behind it.
 *
 * A staff member added here has `household_id` null (318): there is nothing to
 * keep, so the row goes. Somebody who was a customer first and was given
 * back-office access keeps their household, their trips and their ratings, and
 * simply loses the admin door — restored to the role they held *before* they
 * were staff (`prior_role_id`), which is the member role for most but may be a
 * custom client role; the fallback is the member role. The routes decide delete
 * vs restore, having looked at the household; this does what it is told.
 */
export async function removeStaffRole(id, { memberRoleId }) {
  await query(
    'update accounts set role_id = coalesce(prior_role_id, $2), prior_role_id = null, updated_at = now() where id = $1',
    [id, memberRoleId ?? null],
  );
}

export function deleteStaffAccount(id) {
  return query('delete from accounts where id = $1', [id]);
}

/**
 * Make every still-live link for an account unusable.
 *
 * "Send a new login link makes every older unused link for that account
 * invalid" (handover). Expiring them rather than deleting keeps the record of
 * what was sent and when; `consumeSignInLink` already refuses an expired one.
 */
export function invalidateUnusedLinks(accountId) {
  return query(
    `update sign_in_links set expires_at = now()
      where account_id = $1 and used_at is null and expires_at > now()`,
    [accountId],
  );
}
