/**
 * Staff: who can log in to the back office, and what their role lets them open.
 *
 * Signed off 1 Oct 2026 (Supporting docs › EPIC staff management). The owner adds
 * a colleague, gives them a back-office role and issues a single-use login link;
 * from then on he can change their role, send a new link, log them out
 * everywhere, suspend them or remove them.
 *
 * Every route is behind the admin door (server.js `requireDoor`) and the
 * `manage_staff` capability, which only the owner holds by default (access.js):
 * reading the staff list and acting on it are the same privilege, because there
 * is no colleague who should see who can administer Epic but not be able to.
 *
 * A staff member is an `accounts` row with a back-office role and no household
 * (migration 310). The things it shares with a customer — a sign-in link, a
 * session, the sign-in counter — are already in `repositories/accounts.js`, so
 * this file leans on both repositories and writes no SQL of its own.
 */

import express from 'express';
import { requires, areasFor, accessOf, isPersonalSession, OWNER_ONLY_CAPABILITIES } from '../access.js';
import {
  backOfficeRoles, createStaffAccount, deleteStaffAccount, grantStaffRole,
  listStaff, removeStaffRole, setStaffRole, staffById,
} from '../repositories/staff.js';
import {
  accountByEmail, accountById, createAccountOnHousehold, markLinkSent,
  normaliseEmail, ownerAccount, replaceSignInLink, revokeAccountSessions, updateAccount,
} from '../repositories/accounts.js';
import { firstHousehold } from '../repositories/households.js';
import { roleById, roleByKey, setAccountRole, writeAudit } from '../repositories/roles.js';
import { loginLinkEmail, mailStatus, sendMail, staffInviteEmail, webUrl } from '../sources/mail.js';

const router = express.Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bad = (message, code = 'bad_request', status = 400) => Object.assign(new Error(message), { status, code });

/**
 * Giving somebody a role that itself carries an owner-only capability
 * (manage_staff) is the owner's alone — even for a delegate the owner trusted
 * with manage_staff. Without this, that delegate could add or re-role a colleague
 * onto a manage_staff-bearing role and propagate the owner-only privilege
 * (Codex, 1 Oct 2026). Checked wherever a role is chosen here.
 */
function refuseOwnerOnlyRole(req, role) {
  if ((role?.capabilities ?? []).some((c) => OWNER_ONLY_CAPABILITIES.has(c)) && !accessOf(req).isOwner) {
    throw bad('Only the owner can grant staff management.', 'owner_only', 403);
  }
}

/** Who is doing this. The shared passcode has no account row behind it. */
const actor = (req) => ({ actorId: req.account?.id ?? null, actorLabel: req.account?.email ?? 'the owner (passcode)' });

/**
 * Managing staff is a personal act. The shared passcode may read the list and
 * claim the owner account (the bootstrap below), but adding, re-roling,
 * suspending or removing staff needs a real sign-in — so a leaked passcode, an
 * invitation session, or a coding agent that happens to hold manage_staff,
 * cannot create back-office access. Personal is the allowlist in access.js — a
 * magic link, or Google — never "anything but the passcode" (Codex, 1 Oct 2026).
 */
function requirePersonal(req, res, next) {
  if (!isPersonalSession(req.session)) {
    return res.status(403).json({
      error: 'needs_personal',
      message: 'Sign in as yourself to manage staff. Claim your owner account and follow the login link.',
    });
  }
  return next();
}

/** What the owner sees for one staff member. Never a token, never a link. */
const staffView = (row) => {
  const isOwner = row.role_is_owner === true || row.legacy_role === 'owner';
  return {
    id: row.id,
    name: row.name ?? null,
    email: row.email ?? null,
    roleId: isOwner ? null : (row.role_id ?? null),
    role: isOwner ? 'Owner' : (row.role_label ?? null),
    roleKey: isOwner ? 'owner' : (row.role_key ?? null),
    isOwner,
    // The owner is always able to get in; nobody can suspend the row. For
    // everybody else it is the account's own status.
    status: isOwner ? 'active' : row.status,
    invitedAt: row.invited_at ?? null,
    activatedAt: row.activated_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    signInCount: row.sign_in_count ?? 0,
    // Whether taking the back-office role away leaves a customer behind or an
    // empty account to delete (handover). Only the routes need it.
    hasHousehold: row.household_id != null,
  };
};

/** The back-office roles the pickers show, each with its own description. */
const rolesForScreen = async () => (await backOfficeRoles()).map((r) => ({
  id: r.id, key: r.key, label: r.label, description: r.description ?? null,
}));

/** One staff member in the shape the list uses, so an action can drop its answer straight into the row. */
async function enriched(id) {
  const row = await staffById(id);
  return row ? staffView(row) : null;
}

/**
 * Mint a link for a staff account and send it, saying what happened either way.
 *
 * Every older unused link for the account is invalidated first, so "send a new
 * login link" leaves exactly one that works (handover). With no sender
 * configured the link still comes back in the response, and the owner copies it
 * out of the screen (ST4).
 */
async function issueLink(req, account, { fresh = false } = {}) {
  // Seven days for a staff invite — the table default, and what the handover
  // asks for ("Expires 8 Oct 2026" for a link sent on 1 Oct). replaceSignInLink
  // voids any older unused link and mints this one atomically.
  const { token, link } = await replaceSignInLink(account.id, { requestedBy: 'owner' });
  const url = `${webUrl(req)}/?signin=${token}`;
  const mail = mailStatus();
  let delivery = mail.configured ? 'email' : 'no_sender';
  let error = mail.configured ? null : mail.message;

  if (mail.configured) {
    const role = account.role_id ? await roleById(account.role_id) : null;
    const body = staffInviteEmail({
      name: account.name,
      url,
      roleLabel: role?.label ?? 'staff',
      opens: areasFor(role?.capabilities ?? []),
      expiresAt: link.expires_at,
    });
    const sent = await sendMail({ to: account.email, ...body, purpose: 'staff_invitation' });
    if (!sent.sent) { delivery = sent.reason ?? 'send_failed'; error = sent.message ?? null; }
  }

  await markLinkSent(link.id, { delivery, error });
  return {
    url,
    expiresAt: link.expires_at,
    delivery,
    fresh,
    message: delivery === 'email'
      ? `Sent to ${account.email}. The link works once, and expires ${new Date(link.expires_at).toDateString()}.`
      : error,
  };
}

// ---------------------------------------------------------------------------
// the list
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/staff — everybody who can log in to the back office.
 *
 * Carries the roles the pickers show and whether a mail sender exists, so the
 * drawer can decide between "we've emailed them" (ST3) and "copy the link
 * yourself" (ST4) without a second request.
 */
router.get('/', requires('manage_staff'), async (req, res, next) => {
  try {
    let staff = (await listStaff()).map(staffView);
    // The owner always appears, even before he has claimed an account: on the
    // shared passcode there is no row, so a placeholder stands in — it has no
    // actions and no role picker, which is exactly what the owner's row is.
    if (!staff.some((s) => s.isOwner)) {
      staff = [{
        id: 'owner', name: 'You', email: null, roleId: null, role: 'Owner', roleKey: 'owner',
        isOwner: true, status: 'active', invitedAt: null, activatedAt: null, lastSeenAt: null,
        signInCount: null, hasHousehold: false, synthetic: true,
      }, ...staff];
    }
    res.json({
      staff,
      roles: await rolesForScreen(),
      mail: mailStatus(),
      // Whether a real owner account exists yet, and whether this session may
      // actually manage staff (a personal sign-in, not the shared passcode). The
      // screen uses these to offer the owner-claim bootstrap and to explain why
      // "Add staff" is waiting on a personal sign-in.
      ownerClaimed: staff.some((s) => s.isOwner && !s.synthetic),
      // The same allowlist the mutations enforce — a flag that said "personal"
      // while requirePersonal refused would draw controls that always fail.
      personal: isPersonalSession(req.session),
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/staff/claim-owner — the one-time bootstrap.
 *
 * The owner starts on the shared passcode with no account of his own, and
 * managing staff needs a personal sign-in (requirePersonal). This is the door
 * out of that: on the passcode he claims the owner account against the founding
 * household — once, guarded by the single-owner index — and is sent a login link.
 * Following it signs him in personally, and from then on he manages staff as
 * himself. It is NOT behind requirePersonal, by design — it is how a personal
 * session is first obtained. (Replaces the Settings "Include mine" claim, which
 * is not reachable from the menu.)
 */
router.post('/claim-owner', requires('manage_staff'), async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    if (!email || !EMAIL.test(email)) throw bad("That email doesn't look right.", 'bad_email');
    if (await ownerAccount()) throw bad('There is already an owner account.', 'owner_exists', 409);
    if (await accountByEmail(email)) throw bad('That email already has an Epic account.', 'account_exists', 409);
    const founding = await firstHousehold();
    if (!founding) throw bad('There is no household to own yet.', 'no_household', 409);

    const created = await createAccountOnHousehold(founding.id, {
      email, name: String(req.body?.name || '').trim() || null, role: 'owner', plan: 'owner',
    });
    const ownerRole = await roleByKey('owner');
    if (ownerRole) await setAccountRole(created.id, ownerRole.id);
    await writeAudit({ ...actor(req), action: 'staff.claim_owner', subjectType: 'account', subjectId: created.id, subjectLabel: email });

    const invitation = await issueLink(req, await accountById(created.id), { fresh: true });
    res.status(201).json({ staff: await enriched(created.id), invitation });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// adding somebody
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/staff — a colleague, a back-office role, and a login link.
 *
 * An e-mail that already belongs to a customer is not an error: that account is
 * given the back-office role and a link, and keeps its household — one e-mail is
 * one account (handover). An e-mail already on staff is refused.
 */
router.post('/', requires('manage_staff'), requirePersonal, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const email = normaliseEmail(b.email);
    if (!name) throw bad('Add their name.', 'no_name');
    if (!email || !EMAIL.test(email)) throw bad("That email doesn't look right.", 'bad_email');
    const role = await roleById(b.roleId);
    if (!role || !Array.isArray(role.doors) || !role.doors.includes('admin') || role.is_owner) {
      throw bad('That is not a back-office role.', 'bad_role');
    }
    refuseOwnerOnlyRole(req, role);

    const existing = await accountByEmail(email);
    let account;
    let existedAsCustomer = false;
    if (existing) {
      // Already able to open the back office? Then they are already on staff.
      if (await staffById(existing.id)) {
        return res.status(409).json({ error: 'already_staff', message: 'Already on staff.', staff: await enriched(existing.id) });
      }
      // A suspended customer cannot be handed a working link — consumeSignInLink
      // refuses every link while an account is suspended — so granting the role
      // and reporting an invitation sent would be a lie. Refuse, and say what to
      // do: let them back in first, on the Accounts screen.
      if (existing.status === 'suspended') {
        throw bad('That account is suspended. Make it active on the Accounts screen before adding them to staff.', 'suspended', 409);
      }
      // A customer being given back-office access. Keep everything they have;
      // add the door, and remember the role they held so removal restores it.
      account = await grantStaffRole(existing.id, role.id);
      existedAsCustomer = true;
      await writeAudit({
        ...actor(req), action: 'staff.grant', subjectType: 'account', subjectId: existing.id, subjectLabel: email,
        after: { role: role.label },
      });
    } else {
      const created = await createStaffAccount({ email, name, roleId: role.id });
      account = created;
      await writeAudit({
        ...actor(req), action: 'staff.create', subjectType: 'account', subjectId: created.id, subjectLabel: email,
        after: { role: role.label },
      });
    }

    // issueLink needs the account's role_id and name — read the raw account row.
    const row = await accountById(account.id);
    const invitation = await issueLink(req, row, { fresh: true });
    await writeAudit({ ...actor(req), action: 'staff.invite', subjectType: 'account', subjectId: account.id, subjectLabel: email, after: { delivery: invitation.delivery } });
    res.status(201).json({ staff: await enriched(account.id), invitation, existedAsCustomer });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// one person
// ---------------------------------------------------------------------------

/** PATCH /api/admin/staff/:id/role — change the role, applied at once. */
router.patch('/:id/role', requires('manage_staff'), requirePersonal, async (req, res, next) => {
  try {
    const row = await staffById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That person is not on staff.' });
    if (row.role_is_owner || row.legacy_role === 'owner') throw bad("The owner's role can't be changed.", 'owner', 409);
    const role = await roleById(req.body?.roleId);
    if (!role || !Array.isArray(role.doors) || !role.doors.includes('admin') || role.is_owner) throw bad('That is not a back-office role.', 'bad_role');
    refuseOwnerOnlyRole(req, role);
    const before = row.role_label;
    const updated = await setStaffRole(row.id, role.id);
    await writeAudit({
      ...actor(req), action: 'staff.role', subjectType: 'account', subjectId: row.id, subjectLabel: row.email,
      before: { role: before }, after: { role: role.label },
    });
    res.json({ staff: staffView(updated) });
  } catch (err) { next(err); }
});

/** POST /api/admin/staff/:id/link — a fresh link; every older unused one is made invalid. */
router.post('/:id/link', requires('manage_staff'), requirePersonal, async (req, res, next) => {
  try {
    const row = await staffById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That person is not on staff.' });
    if (row.role_is_owner || row.legacy_role === 'owner') throw bad("The owner signs in with the passcode.", 'owner', 409);
    if (row.status === 'suspended') throw bad('That person is suspended. Let them back in first.', 'suspended', 409);
    const invitation = await issueLink(req, await accountById(row.id), { fresh: true });
    await writeAudit({ ...actor(req), action: 'staff.invite', subjectType: 'account', subjectId: row.id, subjectLabel: row.email, after: { delivery: invitation.delivery } });
    res.json({ staff: await enriched(row.id), invitation });
  } catch (err) { next(err); }
});

/** POST /api/admin/staff/:id/logout-all — every device that account is signed in on. */
router.post('/:id/logout-all', requires('manage_staff'), requirePersonal, async (req, res, next) => {
  try {
    const row = await staffById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That person is not on staff.' });
    if (row.role_is_owner || row.legacy_role === 'owner') throw bad("The owner can't be logged out from here.", 'owner', 409);
    await revokeAccountSessions(row.id);
    await writeAudit({ ...actor(req), action: 'staff.logout_all', subjectType: 'account', subjectId: row.id, subjectLabel: row.email });
    res.json({ staff: await enriched(row.id), loggedOut: true });
  } catch (err) { next(err); }
});

/** POST /api/admin/staff/:id/suspend — sessions revoked, links refused, data untouched. */
router.post('/:id/suspend', requires('manage_staff'), requirePersonal, async (req, res, next) => {
  try {
    const row = await staffById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That person is not on staff.' });
    if (row.role_is_owner || row.legacy_role === 'owner') throw bad('The owner can\'t be suspended.', 'owner', 409);
    await updateAccount(row.id, { status: 'suspended' });
    await revokeAccountSessions(row.id);
    await writeAudit({ ...actor(req), action: 'staff.suspend', subjectType: 'account', subjectId: row.id, subjectLabel: row.email });
    res.json({ staff: await enriched(row.id) });
  } catch (err) { next(err); }
});

/** POST /api/admin/staff/:id/unsuspend — back to active, or invited if they never signed in. */
router.post('/:id/unsuspend', requires('manage_staff'), requirePersonal, async (req, res, next) => {
  try {
    const row = await staffById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That person is not on staff.' });
    if (row.role_is_owner || row.legacy_role === 'owner') throw bad('The owner is not suspended.', 'owner', 409);
    await updateAccount(row.id, { status: row.sign_in_count > 0 ? 'active' : 'invited' });
    await writeAudit({ ...actor(req), action: 'staff.unsuspend', subjectType: 'account', subjectId: row.id, subjectLabel: row.email });
    res.json({ staff: await enriched(row.id) });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/admin/staff/:id — take the back-office role away.
 *
 * Somebody who was a customer first keeps their household and becomes a customer
 * again (the member role); somebody added only as staff has no household to
 * keep, so the account goes. Either way their sessions are revoked and it is
 * written to the audit trail.
 */
router.delete('/:id', requires('manage_staff'), requirePersonal, async (req, res, next) => {
  try {
    const row = await staffById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That person is not on staff.' });
    if (row.role_is_owner || row.legacy_role === 'owner') throw bad("The owner can't be removed.", 'owner', 409);
    await revokeAccountSessions(row.id);
    const keptAsCustomer = row.household_id != null;
    await writeAudit({
      ...actor(req), action: keptAsCustomer ? 'staff.revoke' : 'staff.delete',
      subjectType: 'account', subjectId: row.id, subjectLabel: row.email,
      before: { role: row.role_label, household: row.household_id },
    });
    if (keptAsCustomer) {
      const member = await roleByKey('member');
      await removeStaffRole(row.id, { memberRoleId: member?.id ?? null });
    } else {
      await deleteStaffAccount(row.id);
    }
    res.json({ removed: true, keptAsCustomer, message: `${row.name || row.email} removed from staff.` });
  } catch (err) { next(err); }
});

export default router;
