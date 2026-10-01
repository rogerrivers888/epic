/**
 * Log in with Google (routes/authGoogle.js; migration 311).
 *
 * The real OIDC handshake with Google cannot run in a unit test, so what is
 * pinned here is everything after it — the two decisions a Google sign-in turns
 * on, which are also the two ways it can quietly go wrong:
 *
 *  - **Who it matches.** `google_sub` first, then a *verified* email equal to an
 *    existing account; the `sub` is written on that first email match; an account
 *    is never created. Get this wrong and a stranger signs in as somebody, or a
 *    real person is turned away.
 *  - **Who it lets in.** Staff only until launch: a session opens only for an
 *    account that opens the admin door. A customer and an unknown address are
 *    both refused as 'no-account' upstream, so neither can be told from the other.
 *
 * Then the handoff: the one-time code the callback mints is swapped for a session
 * exactly once, and the sign-in is written down as `method = 'google'`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase, aHousehold } from './helpers/db.js';

// These tests present several bad codes on purpose; the sign-in guard must not
// lock this file's own process out part-way (signInGuard.js reads this once,
// at the dynamic import below).
process.env.EPIC_SIGNIN_MAX_FAILURES = '100';

const { query, pool } = await testDatabase();

const accounts = await import('../src/repositories/accounts.js');
const rolesRepo = await import('../src/repositories/roles.js');
const authGoogle = await import('../src/routes/authGoogle.js');
const { resolveGoogleAccount } = authGoogle;

const supportRoleId = (await rolesRepo.roleByKey('support')).id; // doors include 'admin' (034)
const { household } = await aHousehold(query);

/**
 * Make an account; staff carry a role that opens the admin door, customers do
 * not. Every account is attached to a household here — a staff account carries
 * none in production (310), but that is not what these tests turn on, and giving
 * one keeps the fixtures independent of whether 310 is in the base.
 */
async function makeAccount({ email, staff = false, sub = null }) {
  const { rows } = await query(
    `insert into accounts (household_id, email, name, role_id, status, google_sub)
     values ($1, $2, $3, $4, 'active', $5) returning id, email, role, role_id, google_sub`,
    [household.id, email, email.split('@')[0], staff ? supportRoleId : null, sub],
  );
  return rows[0];
}

test.after(() => pool.end());

// ---------------------------------------------------------------------------
// matching and the staff gate
// ---------------------------------------------------------------------------

test('a verified email matching a staff account signs in, and the sub is remembered', async () => {
  const staff = await makeAccount({ email: 'jo@epic.day', staff: true });

  const first = await resolveGoogleAccount({ sub: 'google-jo', email: 'jo@epic.day', emailVerified: true });
  assert.equal(first.ok, true);
  assert.equal(first.account.id, staff.id);

  // The sub was written on that first email match.
  const stored = await accounts.accountByGoogleSub('google-jo');
  assert.ok(stored && stored.id === staff.id, 'google_sub should now be stored on the account');

  // From then on it matches by sub, even with no email.
  const again = await resolveGoogleAccount({ sub: 'google-jo', email: null, emailVerified: false });
  assert.equal(again.ok, true);
  assert.equal(again.account.id, staff.id);
});

test('the email match is case-insensitive and only ever to one account', async () => {
  const staff = await makeAccount({ email: 'case@epic.day', staff: true });
  const r = await resolveGoogleAccount({ sub: 'google-case', email: 'CASE@Epic.Day', emailVerified: true });
  assert.equal(r.ok, true);
  assert.equal(r.account.id, staff.id);
});

test('a customer is refused — not-staff, never a session', async () => {
  await makeAccount({ email: 'family@example.com', staff: false });
  const r = await resolveGoogleAccount({ sub: 'google-fam', email: 'family@example.com', emailVerified: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-staff');
});

test('an unknown address is refused, and nothing is created', async () => {
  const before = (await query('select count(*)::int n from accounts')).rows[0].n;
  const r = await resolveGoogleAccount({ sub: 'google-x', email: 'nobody@example.com', emailVerified: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-account');
  const after = (await query('select count(*)::int n from accounts')).rows[0].n;
  assert.equal(after, before, 'resolving must never create an account');
});

test('an unverified email never matches, even for a real staff address', async () => {
  await makeAccount({ email: 'unverified@epic.day', staff: true });
  const r = await resolveGoogleAccount({ sub: 'google-unv', email: 'unverified@epic.day', emailVerified: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-account');
});

test('a different Google subject on a bound account is refused, never a takeover', async () => {
  const staff = await makeAccount({ email: 'linked@epic.day', staff: true, sub: 'first-sub' });
  // A token with the same email but a different sub — a reassigned Workspace
  // address — must not sign into the account the first identity already holds.
  const r = await resolveGoogleAccount({ sub: 'second-sub', email: 'linked@epic.day', emailVerified: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-account');
  // The binding is untouched: the second identity is never stored.
  const stillFirst = await accounts.accountByGoogleSub('first-sub');
  assert.ok(stillFirst && stillFirst.id === staff.id);
  assert.equal(await accounts.accountByGoogleSub('second-sub'), null);
  // And the identity it is bound to still signs in.
  const ok = await resolveGoogleAccount({ sub: 'first-sub', email: 'linked@epic.day', emailVerified: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.account.id, staff.id);
});

test('no sub is no account', async () => {
  const r = await resolveGoogleAccount({ sub: null, email: 'jo@epic.day', emailVerified: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-account');
});

// ---------------------------------------------------------------------------
// the handoff: a one-time code becomes a session, written as 'google'
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api', authGoogle.default);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

// A browser user-agent, so a sign-in on the account is classed a device session
// (sessionKindFor), the way a real exchange from the web app is.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': BROWSER_UA }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('the exchange trades a one-time code for a session, once, and records method google', async () => {
  const staff = await makeAccount({ email: 'handoff@epic.day', staff: true });
  const { token: code } = await accounts.createSignInLink(staff.id, { requestedBy: 'google', ttlHours: 1 });

  const ok = await post('/api/auth/google/exchange', { code, label: 'a test device' });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.token, 'a session token comes back');
  assert.equal(ok.body.account.email, 'handoff@epic.day');
  // The answer carries the doors, exactly as the magic-link door answers them,
  // so a Google sign-in lands fully formed — and a support role is not the owner.
  assert.equal(ok.body.isOwner, false);
  assert.ok(ok.body.access && ok.body.access.doors.includes('admin'), 'a staff session opens the admin door');

  const signIns = await query('select method from account_sign_ins where account_id = $1', [staff.id]);
  assert.equal(signIns.rows.length, 1);
  assert.equal(signIns.rows[0].method, 'google');

  // A real browser sign-in is a device session (so paidGate does not deny it and
  // it is not in the agent-session controls), and it records that it signed in
  // with Google (auth_method, migration 313) so the privileged-action gate treats
  // it as the personal sign-in it is.
  const sess = await query('select kind, auth_method from api_sessions where account_id = $1 order by created_at desc limit 1', [staff.id]);
  assert.equal(sess.rows[0].kind, 'device');
  assert.equal(sess.rows[0].auth_method, 'google');

  // The code is single-use.
  const again = await post('/api/auth/google/exchange', { code });
  assert.equal(again.status, 401);
  assert.equal(again.body.error, 'code_spent');
});

test('the exchange refuses an empty or unknown code, and writes the failure down', async () => {
  assert.equal((await post('/api/auth/google/exchange', { code: '' })).status, 401);
  assert.equal((await post('/api/auth/google/exchange', { code: 'not-a-real-code' })).status, 401);
  // Every miss is written down as a google failure (316), so a run of bad codes
  // trips the same lockout and owner alert as a run of bad links.
  const { rows } = await query("select count(*)::int as n from sign_in_failures where kind = 'google'");
  assert.ok(rows[0].n >= 2, `expected google failures recorded, saw ${rows[0].n}`);
});

test('the exchange refuses an ordinary magic link, and does not spend it', async () => {
  const staff = await makeAccount({ email: 'ordinary@epic.day', staff: true });
  const { token: link } = await accounts.createSignInLink(staff.id, { requestedBy: 'owner' });
  // A week-long owner/self link is not a Google handoff: the Google door turns
  // it away rather than recording it as a Google sign-in.
  assert.equal((await post('/api/auth/google/exchange', { code: link })).status, 401);
  // And the failed attempt did not consume it — it still redeems at its own door.
  const spent = await accounts.consumeSignInLink(link);
  assert.ok(spent && spent.account_id === staff.id, 'the ordinary link is untouched and still usable');
});

test('the return path after sign-in is only ever an in-app path', () => {
  const { safeNext } = authGoogle;
  assert.equal(safeNext('/admin'), '/admin');
  assert.equal(safeNext('/trips/abc?x=1'), '/trips/abc?x=1');
  // Protocol-relative, backslash and browser-normalised escapes all leave the origin.
  // Nor back into a sign-in door, nor carrying a credential (login CSRF).
  for (const bad of ['/login?code=x', '/%6cogin?code=x', '/login', '/in/tok', '/admin?signin=abc', '/x?code=1', '/foo/../login', '/foo/%2e%2e/login', '/./login', '/%E0%A4%A', '/login#done', '/admin#x']) {
    assert.equal(safeNext(bad), null, `${bad} must be refused`);
  }
  for (const bad of ['//evil.example', '/\\evil.example', '/\n/evil.example', '/\t/evil.example', ' /admin', 'https://evil.example', '/', '', null]) {
    assert.equal(safeNext(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
});

test('a start on another hostname for the API is moved to the configured one first', () => {
  const { canonicalStart } = authGoogle;
  const before = process.env.EPIC_API_BASE_URL;
  process.env.EPIC_API_BASE_URL = 'https://api.epic.day';
  try {
    const at = (host, url, fwd) => canonicalStart({ headers: { host, ...(fwd ? { 'x-forwarded-host': fwd } : {}) }, originalUrl: url });
    assert.equal(at('api-production-20beb.up.railway.app', '/api/auth/google?next=%2Fadmin'), 'https://api.epic.day/api/auth/google?next=%2Fadmin');
    assert.equal(at('api.epic.day', '/api/auth/google'), null);
    assert.equal(at('API.EPIC.DAY', '/api/auth/google'), null);
    assert.equal(at('internal:8080', '/api/auth/google', 'api.epic.day'), null);
  } finally {
    if (before === undefined) delete process.env.EPIC_API_BASE_URL; else process.env.EPIC_API_BASE_URL = before;
  }
});
