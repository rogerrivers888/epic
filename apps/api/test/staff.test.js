/**
 * Staff — the people who can log in to the back office.
 *
 * The quiet failure here is the same one the whole door exists to prevent: a
 * staff account that is really a household (so a household route serves it
 * somebody's data), or a colleague who can read the staff list but was never
 * meant to manage it. So the tests pin the two decisions the feature turns on —
 * a staff account has no household (310), and managing staff is owner-only
 * (access.js) — and then walk the owner's actual journey: add, invite, change a
 * role, suspend, let back in, remove.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();

const staffRepo = await import('../src/repositories/staff.js');
const accounts = await import('../src/repositories/accounts.js');
const rolesRepo = await import('../src/repositories/roles.js');
const insights = await import('../src/repositories/insights.js');
const activity = await import('../src/repositories/activity.js');
const mail = await import('../src/sources/mail.js');
const access = await import('../src/access.js');
const staffRoutes = (await import('../src/routes/staff.js')).default;
const sessionRouter = (await import('../src/routes/session.js')).default;
const adminRoutes = (await import('../src/routes/admin.js')).default;

// A tiny back office: the real router, behind a stand-in for the owner's session.
// The door and the manage_staff capability are what server.js puts in front of
// it; here they are simply granted, because what is under test is the router.
const OWNER_STAFF = { isOwner: true, doors: ['client', 'admin'], capabilities: new Set(['manage_staff']) };
let staffAccess = OWNER_STAFF; // most tests act as the owner; a few flip this per call.
let staffSession = { auth_method: 'link' }; // personal by default; a test flips it to the passcode.
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.account = { id: null, email: 'owner@epic.day' };
  req.access = staffAccess;
  req.session = staffSession;
  next();
});
app.use('/api/admin/staff', staffRoutes);
app.use('/api', sessionRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));

// A second back office, for the roles endpoints, behind a session the tests set —
// to prove an Administrator (manage_roles, not the owner) cannot grant the
// owner-only manage_staff.
let adminAccess = { isOwner: true, doors: ['client', 'admin'], capabilities: new Set() };
let adminSession = { auth_method: 'link' }; // personal by default; a test flips it.
const adminApp = express();
adminApp.use(express.json());
adminApp.use((req, _res, next) => { req.account = { id: null, email: 'actor@epic.day' }; req.access = adminAccess; req.session = adminSession; next(); });
adminApp.use('/api/admin', adminRoutes);
adminApp.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));
const adminServer = adminApp.listen(0);
await new Promise((r) => adminServer.on('listening', r));
const adminBase = `http://127.0.0.1:${adminServer.address().port}`;
const adminCall = async (method, path, body, acc, sess) => {
  adminAccess = acc;
  adminSession = sess ?? { auth_method: 'link' }; // personal unless a test says otherwise.
  const res = await fetch(adminBase + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const ROLES_ADMIN = { isOwner: false, doors: ['client', 'admin'], capabilities: new Set(['manage_roles', 'view_accounts']) };
const OWNER = { isOwner: true, doors: ['client', 'admin'], capabilities: new Set(access.CAPABILITIES.map((c) => c.key)) };

const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body, acc, sess) => {
  staffAccess = acc ?? OWNER_STAFF; // default: act as the owner; reset every call.
  staffSession = sess ?? { auth_method: 'link' }; // default: a personal session.
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test.after(() => { server.close(); adminServer.close(); return pool.end(); });

const roleId = async (key) => (await rolesRepo.roleByKey(key)).id;

// ---------------------------------------------------------------------------
// the capability
// ---------------------------------------------------------------------------

test('managing staff is a capability, and it is not in any role seed — only the owner has it', async () => {
  assert.ok(access.CAPABILITY_KEYS.has('manage_staff'));
  // Every seeded role resolved, none of them carries it.
  for (const key of ['admin', 'support', 'analyst']) {
    const role = await rolesRepo.roleByKey(key);
    assert.ok(!role.capabilities.includes('manage_staff'), `${key} must not manage staff`);
  }
});

// ---------------------------------------------------------------------------
// the roles the pickers show
// ---------------------------------------------------------------------------

test('the role pickers show the back-office roles and not the owner or a member', async () => {
  const keys = (await staffRepo.backOfficeRoles()).map((r) => r.key);
  assert.deepEqual(keys.sort(), ['admin', 'analyst', 'support']);
  assert.ok(!keys.includes('owner') && !keys.includes('member'));
});

// ---------------------------------------------------------------------------
// the owner always shows, even unclaimed
// ---------------------------------------------------------------------------

test('the staff list shows the owner even before an owner account exists', async () => {
  const { status, body } = await call('GET', '/api/admin/staff');
  assert.equal(status, 200);
  const owner = body.staff.find((s) => s.isOwner);
  assert.ok(owner, 'the owner is always on the list');
  assert.equal(owner.role, 'Owner');
  assert.deepEqual(body.roles.map((r) => r.key).sort(), ['admin', 'analyst', 'support']);
  assert.ok(body.roles.every((r) => r.description), 'each role option carries its description');
  assert.equal(body.ownerClaimed, false, 'no owner account yet');
});

test('on the passcode, managing staff is blocked but claiming the owner account is not', async () => {
  const PASSCODE = { auth_method: 'passcode' };
  // claim-owner binds to the founding household, so one must exist.
  await query('insert into households (name) values ($1)', ['Founding']);
  // A mutation on the shared passcode is refused — managing staff is personal.
  const blocked = await call('POST', '/api/admin/staff',
    { name: 'Nope', email: 'nope@epic.day', roleId: await roleId('support') }, OWNER_STAFF, PASSCODE);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, 'needs_personal');

  // The claim bootstrap works on the passcode, creates the owner, and sends a link.
  const claim = await call('POST', '/api/admin/staff/claim-owner',
    { email: 'roger@epic.day', name: 'Roger' }, OWNER_STAFF, PASSCODE);
  assert.equal(claim.status, 201);
  assert.match(claim.body.invitation.url, /\/\?signin=/);
  const owner = await accounts.ownerAccount();
  assert.ok(owner && owner.email === 'roger@epic.day', 'the owner account now exists');

  // Once only.
  const again = await call('POST', '/api/admin/staff/claim-owner',
    { email: 'other@epic.day' }, OWNER_STAFF, PASSCODE);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'owner_exists');

  // The list now reports the owner as claimed, and a personal session may manage.
  const after = await call('GET', '/api/admin/staff');
  assert.equal(after.body.ownerClaimed, true);
  assert.equal(after.body.personal, true);
});

// ---------------------------------------------------------------------------
// adding somebody
// ---------------------------------------------------------------------------

test('adding a colleague creates an account with a role, no household, and a link', async () => {
  const support = await roleId('support');
  const { status, body } = await call('POST', '/api/admin/staff', { name: 'Ana Ribeiro', email: 'Ana@Epic.day', roleId: support });
  assert.equal(status, 201);
  assert.equal(body.staff.role, 'Support');
  assert.equal(body.staff.status, 'invited');
  assert.equal(body.staff.email, 'ana@epic.day', 'the e-mail is lowercased');
  assert.equal(body.existedAsCustomer, false);
  // No sender configured in the test, so the link comes back for the owner to copy (ST4).
  assert.equal(body.invitation.delivery, 'no_sender');
  assert.match(body.invitation.url, /\/\?signin=/);

  const { rows } = await query('select household_id, role, status from accounts where lower(email) = $1', ['ana@epic.day']);
  assert.equal(rows[0].household_id, null, 'a staff account has no household');
  assert.notEqual(rows[0].role, 'owner', 'and never the legacy owner value');
});

test('the same e-mail cannot be added to staff twice', async () => {
  const support = await roleId('support');
  const { status, body } = await call('POST', '/api/admin/staff', { name: 'Ana Again', email: 'ana@epic.day', roleId: support });
  assert.equal(status, 409);
  assert.equal(body.error, 'already_staff');
});

test('validation: a name, a real e-mail, and a back-office role', async () => {
  const support = await roleId('support');
  const member = await roleId('member');
  assert.equal((await call('POST', '/api/admin/staff', { name: '', email: 'x@epic.day', roleId: support })).body.error, 'no_name');
  assert.equal((await call('POST', '/api/admin/staff', { name: 'X', email: 'nope', roleId: support })).body.error, 'bad_email');
  assert.equal((await call('POST', '/api/admin/staff', { name: 'X', email: 'x@epic.day', roleId: member })).body.error, 'bad_role');
});

test('an e-mail that is already a customer is given back-office access, not refused', async () => {
  const customer = await accounts.createAccount({ email: 'jo@home.test', name: 'Jo Bennett' });
  const support = await roleId('support');
  const { status, body } = await call('POST', '/api/admin/staff', { name: 'Jo Bennett', email: 'jo@home.test', roleId: support });
  assert.equal(status, 201);
  assert.equal(body.existedAsCustomer, true);
  // Same account, same household — the door was added, nothing was taken away.
  const { rows } = await query('select id, household_id from accounts where lower(email) = $1', ['jo@home.test']);
  assert.equal(rows[0].id, customer.id);
  assert.equal(rows[0].household_id, customer.household_id);
  assert.ok(await staffRepo.staffById(customer.id), 'they are on staff now');
});

test('a suspended customer is refused, not handed a link that cannot work', async () => {
  const customer = await accounts.createAccount({ email: 'sus@home.test', name: 'Sus' });
  await accounts.updateAccount(customer.id, { status: 'suspended' });
  const support = await roleId('support');
  const { status, body } = await call('POST', '/api/admin/staff', { name: 'Sus', email: 'sus@home.test', roleId: support });
  assert.equal(status, 409);
  assert.equal(body.error, 'suspended');
  assert.equal(await staffRepo.staffById(customer.id), null, 'no back-office role was granted');
});

test('a staff account does not count as a customer in estate reporting', async () => {
  // A staff account carries a plan but no household (migration 318); the estate
  // figures count customers, so adding staff must not move them (Codex, P2).
  const support = await roleId('support');
  const before = await insights.estateTotals();
  await call('POST', '/api/admin/staff', { name: 'Counted?', email: 'counted@epic.day', roleId: support });
  const afterStaff = await insights.estateTotals();
  assert.equal(afterStaff.accounts, before.accounts, 'a staff member is not a customer account');
  assert.equal(afterStaff.invited, before.invited, 'nor an invited customer');
  // A real customer does move the figure, so the test is not vacuous.
  await accounts.createAccount({ email: 'real@home.test', name: 'Real' });
  const afterCustomer = await insights.estateTotals();
  assert.equal(afterCustomer.accounts, before.accounts + 1, 'a customer still counts');
});

test('a staff account is not a zero-activity leader in engagement reporting', async () => {
  // engagementByAccount once returned every staff row as a household (Codex, P2).
  const support = await roleId('support');
  const added = (await call('POST', '/api/admin/staff', { name: 'Quiet', email: 'quiet@epic.day', roleId: support })).body;
  const rows = await activity.engagementByAccount();
  assert.ok(!rows.some((r) => r.account_id === added.staff.id), 'no staff row in engagement');
});

// ---------------------------------------------------------------------------
// one person
// ---------------------------------------------------------------------------

test('a role change, a new link that voids the old one, suspend, unsuspend, remove', async () => {
  const support = await roleId('support');
  const analyst = await roleId('analyst');
  const created = (await call('POST', '/api/admin/staff', { name: 'Tom Okafor', email: 'tom@epic.day', roleId: support })).body;
  const id = created.staff.id;
  const firstToken = new URL(created.invitation.url).searchParams.get('signin');

  // change the role
  const changed = await call('PATCH', `/api/admin/staff/${id}/role`, { roleId: analyst });
  assert.equal(changed.body.staff.role, 'Analyst');

  // a new link makes the first one unusable
  const relink = await call('POST', `/api/admin/staff/${id}/link`);
  assert.equal(relink.status, 200);
  assert.equal(await accounts.consumeSignInLink(firstToken), null, 'the first link is void once a new one is sent');

  // suspend: the live link is refused and the row says suspended
  const live = new URL(relink.body.invitation.url).searchParams.get('signin');
  const suspended = await call('POST', `/api/admin/staff/${id}/suspend`);
  assert.equal(suspended.body.staff.status, 'suspended');
  assert.equal(await accounts.consumeSignInLink(live), null, 'a suspended account opens nothing');

  // a new link cannot be sent while suspended
  assert.equal((await call('POST', `/api/admin/staff/${id}/link`)).status, 409);

  // unsuspend → invited, because they never signed in
  const back = await call('POST', `/api/admin/staff/${id}/unsuspend`);
  assert.equal(back.body.staff.status, 'invited');

  // remove: no household behind it, so the account goes
  const removed = await call('DELETE', `/api/admin/staff/${id}`);
  assert.equal(removed.body.removed, true);
  assert.equal(removed.body.keptAsCustomer, false);
  assert.equal(await accounts.accountById(id), null, 'the account is gone');
});

test('removing a colleague who was a customer first leaves the customer behind', async () => {
  const customer = await accounts.createAccount({ email: 'dual@home.test', name: 'Dual' });
  const support = await roleId('support');
  await call('POST', '/api/admin/staff', { name: 'Dual', email: 'dual@home.test', roleId: support });
  const removed = await call('DELETE', `/api/admin/staff/${customer.id}`);
  assert.equal(removed.body.keptAsCustomer, true);
  const after = await accounts.accountById(customer.id);
  assert.ok(after, 'the account stays');
  assert.equal(after.household_id, customer.household_id, 'with its household');
  assert.equal(await staffRepo.staffById(customer.id), null, 'but off staff');
});

test('a dual-use customer gets their original role back when removed from staff', async () => {
  // A customer on a custom client role, made staff, then removed, must return to
  // that role — not be flattened to member (Codex, P2).
  const custom = await rolesRepo.createRole({ key: 'power_user', label: 'Power user', doors: ['client'], capabilities: [] });
  const customer = await accounts.createAccount({ email: 'power@home.test', name: 'Power' });
  await rolesRepo.setAccountRole(customer.id, custom.id);
  const support = await roleId('support');
  await call('POST', '/api/admin/staff', { name: 'Power', email: 'power@home.test', roleId: support });
  // While staff, they hold the staff role, and the prior role is remembered.
  assert.equal((await accounts.accountById(customer.id)).role_id, support);
  await call('DELETE', `/api/admin/staff/${customer.id}`);
  const after = await accounts.accountById(customer.id);
  assert.equal(after.role_id, custom.id, 'their original client role is restored, not member');
});

test('an Administrator cannot grant themselves staff management; the owner can', async () => {
  // manage_staff is in the vocabulary so the roles screen can show it, but
  // granting it is the owner's alone — a manage_roles holder writing it onto a
  // role would bypass the owner-only rule (Codex, P1).
  const refused = await adminCall('POST', '/api/admin/roles',
    { key: 'sneaky', label: 'Sneaky', doors: ['client', 'admin'], capabilities: ['view_accounts', 'manage_staff'] }, ROLES_ADMIN);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'owner_only');
  assert.equal(await rolesRepo.roleByKey('sneaky'), null, 'the role was not created');

  const allowed = await adminCall('POST', '/api/admin/roles',
    { key: 'deputy', label: 'Deputy', doors: ['client', 'admin'], capabilities: ['view_accounts', 'manage_staff'] }, OWNER);
  assert.equal(allowed.status, 201);
  assert.ok((await rolesRepo.roleByKey('deputy')).capabilities.includes('manage_staff'), 'the owner may grant it');
});

test('an Administrator cannot assign a manage_staff role to anyone either', async () => {
  // The same escalation by the back door: assigning an existing role that holds
  // an owner-only capability is as owner-only as granting it (Codex, 1 Oct 2026).
  const deputy = (await rolesRepo.roleByKey('deputy')) ?? await rolesRepo.createRole({ key: 'deputy', label: 'Deputy', doors: ['client', 'admin'], capabilities: ['manage_staff'] });
  const target = await accounts.createAccount({ email: 'target@home.test', name: 'Target' });
  const refused = await adminCall('PATCH', `/api/admin/people/${target.id}/role`, { roleId: deputy.id }, ROLES_ADMIN);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'owner_only');
  const allowed = await adminCall('PATCH', `/api/admin/people/${target.id}/role`, { roleId: deputy.id }, OWNER);
  assert.equal(allowed.status, 200);
});

test('removing a suspended staff member returns them to a customer who can log in', async () => {
  // Suspended then removed must not leave a customer who cannot sign in (Codex, P2).
  const customer = await accounts.createAccount({ email: 'back@home.test', name: 'Back' });
  const support = await roleId('support');
  await call('POST', '/api/admin/staff', { name: 'Back', email: 'back@home.test', roleId: support });
  await call('POST', `/api/admin/staff/${customer.id}/suspend`);
  assert.equal((await accounts.accountById(customer.id)).status, 'suspended');
  const removed = await call('DELETE', `/api/admin/staff/${customer.id}`);
  assert.equal(removed.body.keptAsCustomer, true);
  assert.notEqual((await accounts.accountById(customer.id)).status, 'suspended', 'they can log in again as a customer');
});

test('the owner cannot be suspended, re-roled or removed through staff', async () => {
  // The owner account was claimed earlier in this file; reuse it (claim it here
  // if this test is run on its own).
  let owner = await accounts.ownerAccount();
  if (!owner) {
    const founding = await query('insert into households (name) values ($1) returning id', ['Founding']);
    owner = await accounts.createAccountOnHousehold(founding.rows[0].id, { email: 'roger@epic.day', name: 'Roger', role: 'owner', plan: 'owner' });
    await query('update accounts set role_id = (select id from roles where key = $1) where id = $2', ['owner', owner.id]);
  }
  for (const path of [`/api/admin/staff/${owner.id}/suspend`, `/api/admin/staff/${owner.id}/link`, `/api/admin/staff/${owner.id}/logout-all`]) {
    assert.equal((await call('POST', path)).status, 409, `${path} must refuse the owner`);
  }
  assert.equal((await call('DELETE', `/api/admin/staff/${owner.id}`)).status, 409);
  assert.equal((await call('PATCH', `/api/admin/staff/${owner.id}/role`, { roleId: await roleId('support') })).status, 409);
});

// ---------------------------------------------------------------------------
// the self-serve login link (L1 → L2)
// ---------------------------------------------------------------------------

test('asking for a login link mints a 15-minute self link and never reveals the account', async () => {
  const acct = await accounts.createAccount({ email: 'cust@home.test', name: 'Cust' });
  const known = await call('POST', '/api/session/request-link', { email: 'cust@home.test' });
  assert.match(known.body.message, /15 minutes/);
  const unknown = await call('POST', '/api/session/request-link', { email: 'nobody@nowhere.test' });
  assert.deepEqual(unknown.body, known.body, 'the answer is identical whether or not the account exists');

  const { rows } = await query(
    `select requested_by, extract(epoch from (expires_at - now())) as ttl
       from sign_in_links where account_id = $1 order by created_at desc limit 1`, [acct.id]);
  assert.equal(rows[0].requested_by, 'self');
  assert.ok(rows[0].ttl > 12 * 60 && rows[0].ttl <= 15 * 60, `a self link lives ~15 minutes, saw ${rows[0].ttl}s`);
});

test('a mobile-only account still gets a link minted, by text — not silently nothing', async () => {
  // Migration 056: an account may have a mobile and no e-mail. Dropping its path
  // would lock it out once its first link is spent (Codex, P1).
  const acct = await accounts.createGuestAccount({ name: 'Mo', mobile: '+447700900123' });
  const res = await call('POST', '/api/session/request-link', { mobile: '+447700900123' });
  assert.match(res.body.message, /by text/);
  const { rows } = await query(
    `select requested_by, channel from sign_in_links where account_id = $1 order by created_at desc limit 1`, [acct.id]);
  assert.ok(rows[0], 'a link was minted for the mobile-only account');
  assert.equal(rows[0].requested_by, 'self');
  assert.equal(rows[0].channel, 'sms', 'its channel is text, not e-mail');
});

// ---------------------------------------------------------------------------
// the e-mails
// ---------------------------------------------------------------------------

test('the staff invite names the role and what it opens, and expires', () => {
  const expiresAt = new Date('2026-10-08T09:00:00Z').toISOString();
  const { subject, text, html } = mail.staffInviteEmail({
    name: 'Jo Bennett', url: 'https://epic.day/?signin=abc', roleLabel: 'Support',
    opens: access.areasFor(['view_accounts', 'manage_accounts', 'view_activity']), expiresAt,
  });
  assert.match(subject, /added to the Epic back office/i);
  assert.match(text, /You're on the team, Jo\./);
  assert.match(text, /back-office login as Support/);
  assert.match(text, /expires on 8 October/);
  assert.match(html, /You're on the team, Jo\./);
  assert.match(html, /signin=abc/);
});

test('the login link e-mail says fifteen minutes and nothing about the account', () => {
  const { subject, text } = mail.loginLinkEmail({ url: 'https://epic.day/?signin=xyz' });
  assert.match(subject, /Your login link/);
  assert.match(text, /works once, for 15 minutes/);
  assert.match(text, /Didn't ask for this/);
});

test('areasFor lists the sections a set of capabilities opens, in order', () => {
  assert.deepEqual(access.areasFor(['view_activity', 'view_accounts']), ['People', 'Behaviour']);
  assert.deepEqual(access.areasFor([]), []);
});

test('a manage_staff delegate cannot propagate staff management through the staff routes', async () => {
  // Even a delegate the owner trusted with manage_staff cannot hand the owner-only
  // capability to anyone else — through add or re-role (Codex, 1 Oct 2026).
  const DELEGATE = { isOwner: false, doors: ['client', 'admin'], capabilities: new Set(['manage_staff']) };
  const deputy = (await rolesRepo.roleByKey('deputy')) ?? await rolesRepo.createRole({ key: 'deputy', label: 'Deputy', doors: ['client', 'admin'], capabilities: ['manage_staff'] });
  const add = await call('POST', '/api/admin/staff', { name: 'Prop', email: 'prop@epic.day', roleId: deputy.id }, DELEGATE);
  assert.equal(add.status, 403);
  assert.equal(add.body.error, 'owner_only');

  const tom = (await call('POST', '/api/admin/staff', { name: 'Tomm', email: 'tomm@epic.day', roleId: await roleId('support') })).body;
  const rerole = await call('PATCH', `/api/admin/staff/${tom.staff.id}/role`, { roleId: deputy.id }, DELEGATE);
  assert.equal(rerole.status, 403);
  // The owner may.
  const ok = await call('PATCH', `/api/admin/staff/${tom.staff.id}/role`, { roleId: deputy.id });
  assert.equal(ok.status, 200);
});

test('manage_roles alone cannot open back-office access; that needs manage_staff', async () => {
  // Whether a role or an account carries the admin door is a staff decision — a
  // manage_roles delegate without manage_staff cannot make anybody staff (Codex).
  const support = await roleId('support'); // a back-office role (admin door)
  const cust = await accounts.createAccount({ email: 'bo@home.test', name: 'BO' });
  const assign = await adminCall('PATCH', `/api/admin/people/${cust.id}/role`, { roleId: support }, ROLES_ADMIN);
  assert.equal(assign.status, 403);
  assert.equal(assign.body.error, 'needs_manage_staff');

  const create = await adminCall('POST', '/api/admin/roles',
    { key: 'bo_role', label: 'BO role', doors: ['client', 'admin'], capabilities: ['view_accounts'] }, ROLES_ADMIN);
  assert.equal(create.status, 403);

  const clientRole = await rolesRepo.createRole({ key: 'plain_client', label: 'Plain', doors: ['client'], capabilities: [] });
  const openDoor = await adminCall('PATCH', `/api/admin/roles/${clientRole.id}`, { doors: ['client', 'admin'] }, ROLES_ADMIN);
  assert.equal(openDoor.status, 403);

  // Deleting a back-office role closes access for everyone on it — also a staff
  // decision (clientRole gains the admin door below, so delete it last).
  assert.equal((await adminCall('PATCH', `/api/admin/roles/${clientRole.id}`, { doors: ['client', 'admin'] }, OWNER)).status, 200);
  assert.equal((await adminCall('DELETE', `/api/admin/roles/${clientRole.id}`, undefined, ROLES_ADMIN)).status, 403);

  // The owner may do all of them.
  assert.equal((await adminCall('PATCH', `/api/admin/people/${cust.id}/role`, { roleId: support }, OWNER)).status, 200);
  assert.equal((await adminCall('POST', '/api/admin/roles', { key: 'bo_role2', label: 'BO2', doors: ['client', 'admin'], capabilities: ['view_accounts'] }, OWNER)).status, 201);
  assert.equal((await adminCall('DELETE', `/api/admin/roles/${clientRole.id}`, undefined, OWNER)).body.removed, true);

  // And the prior-role bookkeeping holds through the general endpoint: a customer
  // on a custom client role, made staff here, is restored to it on removal.
  const power = await rolesRepo.createRole({ key: 'power2', label: 'Power2', doors: ['client'], capabilities: [] });
  const dual = await accounts.createAccount({ email: 'dual2@home.test', name: 'Dual2' });
  await rolesRepo.setAccountRole(dual.id, power.id);
  await adminCall('PATCH', `/api/admin/people/${dual.id}/role`, { roleId: support }, OWNER);
  assert.equal((await accounts.accountById(dual.id)).role_id, support, 'now staff');
  await call('DELETE', `/api/admin/staff/${dual.id}`); // personal owner session
  assert.equal((await accounts.accountById(dual.id)).role_id, power.id, 'restored to their client role, not member');
});

test('the passcode cannot open the back office through the roles endpoints either', async () => {
  // A real-browser passcode session holds every capability (the owner's old way
  // in), so the roles endpoints were a bypass of the personal-sign-in boundary
  // the staff routes enforce (Codex, 1 Oct 2026). Same session, same refusal.
  const PASSCODE = { auth_method: 'passcode' };
  const support = await roleId('support');
  const cust = await accounts.createAccount({ email: 'viapasscode@home.test', name: 'Via' });
  const assign = await adminCall('PATCH', `/api/admin/people/${cust.id}/role`, { roleId: support }, OWNER, PASSCODE);
  assert.equal(assign.status, 403);
  assert.equal(assign.body.error, 'needs_personal');
  const create = await adminCall('POST', '/api/admin/roles',
    { key: 'pc_role', label: 'PC', doors: ['client', 'admin'], capabilities: [] }, OWNER, PASSCODE);
  assert.equal(create.status, 403);
  assert.equal(create.body.error, 'needs_personal');
  // A pure client role is still the passcode's to edit — only the admin door is personal.
  const client = await adminCall('POST', '/api/admin/roles',
    { key: 'pc_client', label: 'PC client', doors: ['client'], capabilities: [] }, OWNER, PASSCODE);
  assert.equal(client.status, 201);
});

test('personal is an allowlist: an invitation session cannot manage staff', async () => {
  // auth_method 'invite' is nobody's personal sign-in; a denylist of just the
  // passcode would have let it through (Codex, 1 Oct 2026).
  const support = await roleId('support');
  const res = await call('POST', '/api/admin/staff',
    { name: 'Inv', email: 'inv@epic.day', roleId: support }, OWNER_STAFF, { auth_method: 'invite' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'needs_personal');
  // And the list tells the screen the same thing, so no control is drawn that
  // would only ever answer needs_personal.
  const list = await call('GET', '/api/admin/staff', undefined, OWNER_STAFF, { auth_method: 'invite' });
  assert.equal(list.body.personal, false);
});

test('asking for a self-serve login link voids an older unused link', async () => {
  // The single-current-link invariant reaches the /login path too: an outstanding
  // seven-day invite cannot still open a session after a replacement (Codex, P1).
  const acct = await accounts.createAccount({ email: 'void@home.test', name: 'Void' });
  const { token: older } = await accounts.createSignInLink(acct.id, { requestedBy: 'owner' });
  await call('POST', '/api/session/request-link', { email: 'void@home.test' });
  assert.equal(await accounts.consumeSignInLink(older), null, 'the older link no longer works');
});
