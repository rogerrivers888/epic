/**
 * Email + password (routes/authPassword.js; migration 325).
 *
 * What is pinned here is what a password door can quietly get wrong:
 *
 *  - **It tells a stranger who has an account.** Every failed log-in answers the
 *    same body, and "forgot" always answers 200 and mails nobody it does not know.
 *  - **The secret leaks.** `password_hash` is never in an answer.
 *  - **The links cross doors.** An invite or reset link is spent only by the
 *    credentials door, and the magic-link door cannot spend one — or the other way
 *    round — so nobody gets in through a link without setting the password it was
 *    sent to set, and a fifteen-minute magic link cannot set a password.
 *  - **A reset leaves the attacker in.** Saving a reset revokes every other session.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase, aHousehold } from './helpers/db.js';

// Many bad attempts on purpose; the guard must not lock this file's own process
// out part-way (signInGuard.js reads this once, at the import below). The lockout
// itself is pinned in authPasswordLockout.test.js.
process.env.EPIC_SIGNIN_MAX_FAILURES = '1000';

const { query, pool } = await testDatabase();

const accounts = await import('../src/repositories/accounts.js');
const rolesRepo = await import('../src/repositories/roles.js');
const passwords = await import('../src/passwords.js');
const mail = await import('../src/sources/mail.js');
const { openSession } = await import('../src/auth.js');
const authPassword = (await import('../src/routes/authPassword.js')).default;
const sessionRoutes = (await import('../src/routes/session.js')).default;

const supportRoleId = (await rolesRepo.roleByKey('support')).id;
const { household } = await aHousehold(query);

async function makeAccount({ email, name = null, staff = false, status = 'active', password = null }) {
  const { rows } = await query(
    `insert into accounts (household_id, email, name, role_id, status)
     values ($1, $2, $3, $4, $5) returning id, email`,
    [staff ? null : household.id, email, name ?? email.split('@')[0], staff ? supportRoleId : null, status],
  );
  if (password) await accounts.setPassword(rows[0].id, await passwords.hashPassword(password));
  return rows[0];
}

const app = express();
app.use(express.json());
app.use('/api', authPassword);
app.use('/api', sessionRoutes);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { server.close(); await new Promise((r) => setTimeout(r, 50)); await pool.end(); });

// A browser user-agent, so a sign-in on an account is a device session
// (sessionKindFor). A fresh caller address each time, so the per-caller sign-in
// limit (limits.js, ten a quarter-hour) does not trip across the file.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
let caller = 0;
const headers = () => ({ 'content-type': 'application/json', 'user-agent': BROWSER_UA, 'x-forwarded-for': `198.51.100.${(caller++ % 250) + 1}` });
const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), raw: res };
};
const get = async (path) => {
  const res = await fetch(base + path, { headers: headers() });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** "forgot" answers before it works; wait for what it does. */
async function eventually(check, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** The link "forgot" logs when no sender is configured — the only place its token is. */
function captureLog() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.log = original; } };
}
const tokenIn = (line) => line.match(/\/in\/([A-Za-z0-9_-]+)/)?.[1] ?? null;

// ---------------------------------------------------------------------------
// hashing
// ---------------------------------------------------------------------------

test('a password hashes and verifies, under argon2id and scrypt alike', async () => {
  const scrypt = await passwords.hashWithScrypt('correct horse battery');
  assert.match(scrypt, /^scrypt\$N=32768,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await passwords.verifyPassword('correct horse battery', scrypt), true);
  assert.equal(await passwords.verifyPassword('correct horse batterz', scrypt), false);

  if (passwords.hasArgon2()) {
    const argon = await passwords.hashWithArgon2('correct horse battery');
    assert.match(argon, /^argon2id\$m=19456,t=2,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    assert.equal(await passwords.verifyPassword('correct horse battery', argon), true);
    assert.equal(await passwords.verifyPassword('wrong', argon), false);
    // New hashes are scrypt everywhere, so a hash written on one Node always verifies on another.
    assert.match(await passwords.hashPassword('x'.repeat(12)), /^scrypt\$/, 'new hashes are scrypt on every runtime');
  } else {
    assert.match(await passwords.hashPassword('x'.repeat(12)), /^scrypt\$/);
  }

  // Two hashes of one password differ (a fresh salt each time).
  assert.notEqual(await passwords.hashWithScrypt('same'), await passwords.hashWithScrypt('same'));
  // Anything that is not a hash is a "no", never a throw.
  for (const stored of [null, '', 'plain', 'bcrypt$x$y$z', 'scrypt$N=abc$x$y', 'argon2id$$$']) {
    assert.equal(await passwords.verifyPassword('anything', stored), false, String(stored));
  }
});

// ---------------------------------------------------------------------------
// L1: log in
// ---------------------------------------------------------------------------

test('the right email and password sign in, as a personal device session, and never return the hash', async () => {
  const acct = await makeAccount({ email: 'pw@example.com', name: 'Pat Wood', password: 'a long enough secret' });

  const ok = await post('/api/auth/login', { email: '  PW@Example.com ', password: 'a long enough secret', label: 'a test device' });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.token, 'a session token comes back');
  assert.equal(ok.body.account.id, acct.id);
  assert.equal(ok.body.account.email, 'pw@example.com');
  assert.equal(ok.body.isOwner, false);
  assert.ok(ok.body.access && Array.isArray(ok.body.access.doors), 'the doors come back, as from every other door');
  assert.equal(ok.body.access.elevated, false, 'a customer is never elevated');

  // The hash is a secret: nowhere in the answer, under any name.
  const { rows: [stored] } = await query('select password_hash from accounts where id = $1', [acct.id]);
  const text = JSON.stringify(ok.body);
  assert.ok(!text.includes('password_hash') && !text.includes(stored.password_hash) && !/argon2id\$|scrypt\$/.test(text));

  const signIns = await query('select method, label from account_sign_ins where account_id = $1', [acct.id]);
  assert.deepEqual(signIns.rows, [{ method: 'password', label: 'a test device' }]);
  const sess = await query('select kind, auth_method from api_sessions where account_id = $1', [acct.id]);
  assert.deepEqual(sess.rows, [{ kind: 'device', auth_method: 'password' }]);

  // And the session works.
  const me = await fetch(`${base}/api/session`, { headers: { authorization: `Bearer ${ok.body.token}` } }).then((r) => r.json());
  assert.equal(me.signedIn, true);
  assert.equal(me.account.id, acct.id);
});

test('a staff member signs in with a password and holds the admin door', async () => {
  await makeAccount({ email: 'staffpw@epic.day', staff: true, password: 'staff password 1' });
  const ok = await post('/api/auth/login', { email: 'staffpw@epic.day', password: 'staff password 1' });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.access.doors.includes('admin'));
});

test('every way of failing answers the same, and is written down', async () => {
  await makeAccount({ email: 'right@example.com', password: 'the right password' });
  await makeAccount({ email: 'nopw@example.com' }); // Google-only, or never set up
  await makeAccount({ email: 'gone@example.com', status: 'suspended', password: 'the right password' });

  const before = (await query("select count(*)::int n from sign_in_failures where kind = 'password'")).rows[0].n;
  const answers = [
    await post('/api/auth/login', { email: 'right@example.com', password: 'the wrong password' }),
    await post('/api/auth/login', { email: 'nobody@example.com', password: 'the right password' }),
    await post('/api/auth/login', { email: 'nopw@example.com', password: 'the right password' }),
    await post('/api/auth/login', { email: 'gone@example.com', password: 'the right password' }),
    await post('/api/auth/login', { email: '', password: '' }),
    await post('/api/auth/login', {}),
  ];
  for (const a of answers) {
    assert.equal(a.status, 401);
    assert.deepEqual(a.body, { error: 'wrong_credentials', message: 'Wrong email or password.' });
  }
  const after = (await query("select count(*)::int n from sign_in_failures where kind = 'password'")).rows[0].n;
  assert.equal(after - before, answers.length, 'each failure is a row the lockout counts');
  const { rows } = await query("select reason from sign_in_failures where kind = 'password' and contact = 'gone@example.com'");
  assert.deepEqual(rows.map((r) => r.reason), ['suspended'], 'the reason is kept for the owner, never told to the caller');
});

// ---------------------------------------------------------------------------
// L2: forgot
// ---------------------------------------------------------------------------

test('forgot always answers 200, and mails only a real account', async () => {
  const linksBefore = (await query('select count(*)::int n from sign_in_links')).rows[0].n;
  const log = captureLog();
  let unknown;
  try {
    unknown = await post('/api/auth/forgot', { email: 'stranger@example.com' });
    await new Promise((r) => setTimeout(r, 200));
  } finally { log.restore(); }
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, { ok: true });
  assert.equal((await query('select count(*)::int n from sign_in_links')).rows[0].n, linksBefore, 'an unknown address gets nothing');
  assert.ok(!log.lines.some((l) => l.includes('/in/')), 'and no link is logged for it');

  const blank = await post('/api/auth/forgot', {});
  assert.deepEqual([blank.status, blank.body], [200, { ok: true }]);
});

test('forgot makes a thirty-minute reset link, logs it with no sender, and a second cancels the first', async () => {
  const acct = await makeAccount({ email: 'reset@example.com', name: 'Rae Set', password: 'old password 123' });
  const live = () => query(
    `select id, purpose, requested_by, delivery, used_at, expires_at > now() as live,
            extract(epoch from (expires_at - created_at)) as ttl
       from sign_in_links where account_id = $1 order by created_at`,
    [acct.id],
  );

  const log = captureLog();
  try {
    const first = await post('/api/auth/forgot', { email: 'Reset@Example.com' });
    assert.deepEqual([first.status, first.body], [200, { ok: true }]);
    await eventually(async () => (await live()).rows[0]?.delivery);
    const second = await post('/api/auth/forgot', { email: 'reset@example.com' });
    assert.equal(second.status, 200);
    await eventually(async () => (await live()).rows[1]?.delivery);
  } finally { log.restore(); }

  const { rows } = await live();
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.purpose, 'reset');
    assert.equal(r.requested_by, 'self');
    assert.equal(r.delivery, 'no_sender', 'no sender in the test — recorded, not pretended');
    assert.equal(r.used_at, null);
  }
  // The live one runs for thirty minutes; the cancelled one was cut short to now.
  assert.ok(Math.abs(Number(rows[1].ttl) - 1800) < 5, `thirty minutes, saw ${rows[1].ttl}s`);
  assert.equal(rows[0].live, false, 'the older unused reset link is cancelled');
  assert.equal(rows[1].live, true, 'the newest one works');

  // The owner can pass the link on: it is in the log, naming the account.
  const lines = log.lines.filter((l) => l.includes(acct.id));
  assert.equal(lines.length, 2);
  const [oldToken, newToken] = lines.map(tokenIn);
  assert.ok(oldToken && newToken);
  assert.equal((await get(`/api/auth/link/${oldToken}`)).status, 404, 'the cancelled link opens nothing');
  const shown = await get(`/api/auth/link/${newToken}`);
  assert.equal(shown.status, 200);
  assert.deepEqual({ ...shown.body, expiresAt: typeof shown.body.expiresAt }, { mode: 'reset', email: 'reset@example.com', firstName: 'Rae', expiresAt: 'string' });
});

test('a suspended account is sent nothing, and the answer is the same', async () => {
  const acct = await makeAccount({ email: 'suspreset@example.com', status: 'suspended' });
  const r = await post('/api/auth/forgot', { email: 'suspreset@example.com' });
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal((await query('select count(*)::int n from sign_in_links where account_id = $1', [acct.id])).rows[0].n, 0);
});

test('the reset email says what the handoff says', () => {
  const { subject, text, html } = mail.resetPasswordEmail({ url: 'https://epic.day/in/abc' });
  assert.equal(subject, 'Reset your Epic password');
  assert.match(text, /Tap below to choose a new password\. The link works once, for 30 minutes\./);
  assert.match(text, /Didn't ask for this\? Ignore it and your password stays the same\./);
  assert.match(html, /Set a new password/);
  assert.match(html, /https:\/\/epic\.day\/in\/abc/);
});

// ---------------------------------------------------------------------------
// L4: look at a link, then set credentials with it
// ---------------------------------------------------------------------------

test('L4 is told what a link is for, without spending it', async () => {
  const acct = await makeAccount({ email: 'jo@epic.day', name: 'Jo Bennett', staff: true, status: 'invited' });
  const { token: invite } = await accounts.createSignInLink(acct.id, { requestedBy: 'owner', purpose: 'invite' });
  const { token: magic } = await accounts.createSignInLink(acct.id, { requestedBy: 'self', ttlHours: 0.25 });

  const shown = await get(`/api/auth/link/${invite}`);
  assert.equal(shown.status, 200);
  assert.equal(shown.body.mode, 'invite');
  assert.equal(shown.body.email, 'jo@epic.day');
  assert.equal(shown.body.firstName, 'Jo');
  assert.ok(new Date(shown.body.expiresAt) > new Date(Date.now() + 6 * 86400000), 'a seven-day invite');
  // Looking twice is fine: it was not spent.
  assert.equal((await get(`/api/auth/link/${invite}`)).status, 200);

  // A magic link is not an L4 link, and nonsense is nothing.
  assert.deepEqual(await get(`/api/auth/link/${magic}`), { status: 404, body: { error: 'link_spent' } });
  assert.equal((await get('/api/auth/link/not-a-token')).status, 404);
});

test('too short is refused before anything is spent', async () => {
  const acct = await makeAccount({ email: 'short@example.com', status: 'invited' });
  const { token } = await accounts.createSignInLink(acct.id, { purpose: 'invite' });
  for (const password of ['', 'nine char', undefined, 12345678901]) {
    const r = await post('/api/auth/credentials', { token, password });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'too_short', message: 'Use at least 10 characters.' });
  }
  assert.ok(await accounts.inspectSignInLink(token), 'the link still works after a short password');
  const ok = await post('/api/auth/credentials', { token, password: 'ten chars!' });
  assert.equal(ok.status, 201, 'exactly ten characters is enough');
});

test('an invite sets the password, activates the account, and signs them in', async () => {
  const acct = await makeAccount({ email: 'newstaff@epic.day', name: 'New Staff', staff: true, status: 'invited' });
  const { token } = await accounts.createSignInLink(acct.id, { requestedBy: 'owner', purpose: 'invite' });

  const r = await post('/api/auth/credentials', { token, password: 'my first password', label: 'laptop' });
  assert.equal(r.status, 201);
  assert.equal(r.body.account.id, acct.id);
  assert.ok(r.body.access.doors.includes('admin'));
  assert.ok(!JSON.stringify(r.body).includes('password'), 'nothing about the password comes back');

  const { rows: [a] } = await query('select status, activated_at, sign_in_count, password_set_at, password_hash from accounts where id = $1', [acct.id]);
  assert.equal(a.status, 'active');
  assert.ok(a.activated_at && a.password_set_at);
  assert.equal(a.sign_in_count, 1);
  assert.ok(a.password_hash && !a.password_hash.includes('my first password'), 'a hash, never the password');
  const sess = await query('select kind, auth_method from api_sessions where account_id = $1', [acct.id]);
  assert.deepEqual(sess.rows, [{ kind: 'device', auth_method: 'password' }]);

  // Once.
  const again = await post('/api/auth/credentials', { token, password: 'another password' });
  assert.equal(again.status, 401);
  assert.equal(again.body.error, 'link_spent');
  // And the password now logs in.
  assert.equal((await post('/api/auth/login', { email: 'newstaff@epic.day', password: 'my first password' })).status, 201);
});

test('a reset changes the password and signs every other device out', async () => {
  const acct = await makeAccount({ email: 'compromised@example.com', password: 'the old password' });
  const { token: otherA } = await openSession('phone', acct.id, 'device', 'link');
  const { token: otherB } = await openSession('tablet', acct.id, 'device', 'password');
  // Somebody else's session is not theirs to sign out.
  const bystander = await makeAccount({ email: 'bystander@example.com' });
  const { token: theirs } = await openSession('theirs', bystander.id, 'device', 'link');

  const { token } = await accounts.createSignInLink(acct.id, { requestedBy: 'self', ttlHours: 0.5, purpose: 'reset' });
  const r = await post('/api/auth/credentials', { token, password: 'the new password' });
  assert.equal(r.status, 201);

  const live = async (t) => (await fetch(`${base}/api/session`, { headers: { authorization: `Bearer ${t}` } }).then((x) => x.json())).signedIn;
  assert.equal(await live(otherA), false, 'the old phone session is revoked');
  assert.equal(await live(otherB), false, 'the old tablet session is revoked');
  assert.equal(await live(r.body.token), true, 'the new session is live');
  assert.equal(await live(theirs), true, 'another account is untouched');

  assert.equal((await post('/api/auth/login', { email: 'compromised@example.com', password: 'the old password' })).status, 401);
  assert.equal((await post('/api/auth/login', { email: 'compromised@example.com', password: 'the new password' })).status, 201);
});

test('a link is spent only at its own door: magic links, invites, resets and Google codes never cross', async () => {
  const acct = await makeAccount({ email: 'doors@example.com', status: 'invited' });
  const { token: invite } = await accounts.createSignInLink(acct.id, { purpose: 'invite' });
  const { token: reset } = await accounts.createSignInLink(acct.id, { requestedBy: 'self', ttlHours: 0.5, purpose: 'reset' });
  const { token: magic } = await accounts.createSignInLink(acct.id, { requestedBy: 'self', ttlHours: 0.25 });
  const { token: google } = await accounts.createSignInLink(acct.id, { requestedBy: 'google', ttlHours: 0.1 });

  // The magic-link door refuses an invite and a reset — over HTTP and in the repository.
  for (const t of [invite, reset]) {
    const r = await post('/api/session/link', { token: t });
    assert.equal(r.status, 401);
    assert.equal(await accounts.consumeSignInLink(t), null);
    assert.equal(await accounts.consumeSignInLink(t, { requestedBy: 'google' }), null, 'nor as a Google code');
  }
  // The credentials door refuses a magic link and a Google code.
  for (const t of [magic, google]) {
    const r = await post('/api/auth/credentials', { token: t, password: 'a perfectly good password' });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'link_spent');
  }
  // None of those refusals spent anything: each still redeems at its own door.
  assert.ok(await accounts.consumeSignInLink(magic), 'the magic link still works');
  assert.ok(await accounts.consumeSignInLink(google, { requestedBy: 'google' }), 'the Google code still works');
  assert.equal((await accounts.consumeSignInLink(invite, { purpose: 'credentials' }))?.purpose, 'invite');
  assert.equal((await accounts.consumeSignInLink(reset, { purpose: 'credentials' }))?.purpose, 'reset');
  const { rows } = await query("select count(*)::int n from api_sessions where account_id = $1", [acct.id]);
  assert.equal(rows[0].n, 0, 'no session was opened by any crossing attempt');
});

test('a new invite cancels the older unused invite, but not a reset; a suspended account is refused', async () => {
  const acct = await makeAccount({ email: 'kinds@example.com', password: 'whatever password' });
  const { token: reset } = await accounts.createSignInLink(acct.id, { requestedBy: 'self', ttlHours: 0.5, purpose: 'reset' });
  const { token: inviteOld } = await accounts.createSignInLink(acct.id, { purpose: 'invite' });
  const { token: inviteNew } = await accounts.createSignInLink(acct.id, { purpose: 'invite' });
  assert.equal(await accounts.inspectSignInLink(inviteOld), null, 'the older invite is cancelled');
  assert.ok(await accounts.inspectSignInLink(inviteNew));
  assert.ok(await accounts.inspectSignInLink(reset), 'a reset is another kind, and survives');
  // Cancelled, not marked used: "used" stays true only of a link somebody opened.
  const { rows } = await query('select count(*)::int n from sign_in_links where account_id = $1 and used_at is not null', [acct.id]);
  assert.equal(rows[0].n, 0);

  await query("update accounts set status = 'suspended' where id = $1", [acct.id]);
  assert.equal((await get(`/api/auth/link/${inviteNew}`)).status, 404);
  assert.equal((await post('/api/auth/credentials', { token: inviteNew, password: 'a perfectly good password' })).status, 401);
});

test('a log-in that verified the old password before a reset never keeps its session', async () => {
  const { signIn } = await import('../src/routes/authPassword.js');
  const acct = await makeAccount({ email: 'race@epic.day', staff: true, password: 'the old password' });
  const before = await accounts.passwordFor('race@epic.day');
  // The reset lands between the check and the session: the password changes.
  await accounts.setPassword(acct.id, await passwords.hashPassword('the brand new password'));
  let status = null; let body = null;
  const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; }, cookie() { return res; }, setHeader() {}, append() {}, getHeader() {} };
  await signIn({ headers: {}, body: {}, ip: '127.0.0.1', socket: {} }, res, acct.id, { verified: before.hash, email: 'race@epic.day' });
  assert.equal(status, 401);
  assert.equal(body.error, 'wrong_credentials');
  const live = await query('select count(*)::int as n from api_sessions where account_id = $1 and revoked_at is null', [acct.id]);
  assert.equal(live.rows[0].n, 0, 'the session it opened is closed again');
});
