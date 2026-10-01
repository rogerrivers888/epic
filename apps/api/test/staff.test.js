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
const mail = await import('../src/sources/mail.js');
const access = await import('../src/access.js');
const staffRoutes = (await import('../src/routes/staff.js')).default;
const sessionRouter = (await import('../src/routes/session.js')).default;

// A tiny back office: the real router, behind a stand-in for the owner's session.
// The door and the manage_staff capability are what server.js puts in front of
// it; here they are simply granted, because what is under test is the router.
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.account = { id: null, email: 'owner@epic.day' };
  req.access = { isOwner: true, doors: ['client', 'admin'], capabilities: new Set(['manage_staff']) };
  next();
});
app.use('/api/admin/staff', staffRoutes);
app.use('/api', sessionRouter);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));

const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test.after(() => { server.close(); return pool.end(); });

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

test('the owner cannot be suspended, re-roled or removed through staff', async () => {
  // Claim the owner account so there is a real row to aim at.
  const founding = await query('insert into households (name) values ($1) returning id', ['Founding']);
  const owner = await accounts.createAccountOnHousehold(founding.rows[0].id, { email: 'roger@epic.day', name: 'Roger', role: 'owner', plan: 'owner' });
  await query('update accounts set role_id = (select id from roles where key = $1) where id = $2', ['owner', owner.id]);
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
