/**
 * Free guest accounts (G21, owner 3 Oct 2026; migration 373).
 *
 * "Yes — ask to book and joining a waiting list create the same free account as
 * booking (bookings, messages, payments only)." Pinned here:
 *
 *  - **the plan** — `guest` is a row in `plans`, free (no price) and never a
 *    paid call (bound 0); a guest's household is never a member;
 *  - **"Use my email"** — a link for an address, the account made only when it
 *    is opened, once; an address that has an account gets that account's own
 *    link and is never duplicated or re-planned; the reply never says which;
 *  - **Continue with Google** — the guest door makes the account for a verified
 *    address, signs in any existing account, never takes over a bound one, and
 *    the plain door still makes nothing; `next` only ever an in-app guest page;
 *  - **the wall** — a guest session reaches bookings, messages, payments and its
 *    own settings, and is refused everything else with plain words;
 *  - **the spend guard** — a guest household can never cause a paid Google or
 *    Claude call, whatever its bound says.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

process.env.EPIC_SIGNIN_MAX_FAILURES = '100';

const { query, pool } = await testDatabase();

const accounts = await import('../src/repositories/accounts.js');
const { resolveGuestGoogleAccount, resolveGoogleAccount, guestNext } = await import('../src/routes/authGoogle.js');
const { default: sessionRoutes } = await import('../src/routes/session.js');
const { default: authGuestRoutes, GUEST_LINK_SENT } = await import('../src/routes/authGuest.js');
const { requireSession, openSession } = await import('../src/auth.js');
const { guestDoor, guestMayReach } = await import('../src/guestAccess.js');
const { admitPaid, householdIsGuest, UnattributedCallError } = await import('../src/sources/paidGate.js');
const { assertWithinBounds, monthlyBoundFor, claudeBoundFor } = await import('../src/claude.js');
const { runAsSpender } = await import('../src/context.js');
const { classifyHouseholds } = await import('../src/repositories/memberships.js');

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const uniq = () => Math.random().toString(36).slice(2, 8);

// The two public doors, as server.js mounts them, and behind the session door a
// stub for every path — so what is tested is the wall, not the routes behind it.
const app = express();
app.use(express.json());
app.use('/api', sessionRoutes);
app.use('/api', authGuestRoutes);
app.use(requireSession);
app.use(guestDoor);
app.use((req, res) => res.json({ reached: req.path }));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { server.close(); await pool.end(); });

const call = async (method, path, body, token = null) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'user-agent': BROWSER_UA, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const linksFor = async (email) => (await query(
  `select l.account_id, l.purpose, l.pending_email, l.used_at, l.requested_by
     from sign_in_links l left join accounts a on a.id = l.account_id
    where lower(coalesce(a.email, l.pending_email)) = lower($1) order by l.created_at`, [email])).rows;

// ---------------------------------------------------------------------------
// the plan
// ---------------------------------------------------------------------------

test('guest is a plan the database knows: free, not priced, and a bound of nought', async () => {
  const { rows: [plan] } = await query(`select key, price_pence, call_bound, active from plans where key = 'guest'`);
  assert.ok(plan, 'migration 373 adds the guest plan');
  assert.equal(plan.price_pence, null, 'not a paid plan (034: null, not 0)');
  assert.equal(plan.call_bound, 0);
  assert.equal(plan.active, true);
});

test('a link is for an account, or — only a guest link — for an address', async () => {
  await assert.rejects(
    query(`insert into sign_in_links (account_id, token_hash, purpose) values (null, 'x-${uniq()}', null)`),
    /sign_in_links_for_someone_check/,
  );
  await assert.rejects(
    query(`insert into sign_in_links (account_id, token_hash, purpose) values (null, 'x-${uniq()}', 'guest')`),
    /sign_in_links_for_someone_check/,
  );
});

// ---------------------------------------------------------------------------
// "Use my email"
// ---------------------------------------------------------------------------

test('an address with no account gets a link, and the account is made only when it is opened', async () => {
  const email = `new-${uniq()}@guest.test`;
  const r = await call('POST', '/api/auth/guest', { email, next: '/experiences/abc/book' });
  assert.equal(r.status, 200);
  assert.equal(r.body.message, GUEST_LINK_SENT);
  assert.equal(await accounts.accountByEmail(email), null, 'asking makes no account');
  const links = await linksFor(email);
  assert.equal(links.length, 1);
  assert.equal(links[0].account_id, null);
  assert.equal(links[0].purpose, 'guest');

  // Opened (minted again here, since the e-mail is not readable in a test): the account is made, once.
  const { token } = await accounts.createGuestLink({ email, name: 'Sam Guest' });
  const opened = await call('POST', '/api/session/link', { token, label: 'Computer · Chrome' });
  assert.equal(opened.status, 201);
  assert.equal(opened.body.account.plan, 'guest');
  const account = await accounts.accountByEmail(email);
  assert.equal(account.plan, 'guest');
  assert.equal(account.role, 'customer');
  assert.equal(account.status, 'active');
  assert.equal(account.monthly_call_bound, 0);
  assert.equal(account.name, 'Sam Guest');
  const { rows: [hh] } = await query('select origin from households where id = $1', [account.household_id]);
  assert.equal(hh.origin, 'guest_invite', 'a guest household is never a member or a signup');
  const { rows: [sess] } = await query('select kind, auth_method from api_sessions where account_id = $1', [account.id]);
  assert.equal(sess.kind, 'device');
  assert.equal(sess.auth_method, 'link');

  // Once only — and the older link asked for first was cancelled by the newer one.
  assert.equal((await call('POST', '/api/session/link', { token })).status, 401);
  const again = await accounts.consumeGuestLink(token);
  assert.equal(again, null);
  const { rows: [{ n }] } = await query('select count(*)::int as n from accounts where lower(email) = $1', [email]);
  assert.equal(n, 1);
});

test('an address that has an account gets its own link — never a second account, never a change of plan', async () => {
  const email = `member-${uniq()}@guest.test`;
  const existing = await accounts.createAccount({ email, name: 'Member', plan: 'friend' });
  const r = await call('POST', '/api/auth/guest', { email });
  assert.equal(r.status, 200);
  const links = await linksFor(email);
  assert.equal(links.length, 1);
  assert.equal(links[0].account_id, existing.id, 'the ordinary login link for that account');
  assert.equal(links[0].purpose, null);
  assert.equal(links[0].requested_by, 'self');
  assert.equal((await accounts.accountById(existing.id)).plan, 'friend');
});

test('a guest link opened after the address got an account signs that account in', async () => {
  const email = `race-${uniq()}@guest.test`;
  const { token } = await accounts.createGuestLink({ email });
  const meanwhile = await accounts.createAccount({ email, name: 'Made meanwhile', plan: 'trial' });
  const spent = await accounts.consumeGuestLink(token);
  assert.equal(spent.account_id, meanwhile.id);
  assert.equal(spent.created, false);
  assert.equal((await accounts.accountById(meanwhile.id)).plan, 'trial', 'plan untouched');
  const { rows: [{ n }] } = await query('select count(*)::int as n from accounts where lower(email) = $1', [email]);
  assert.equal(n, 1);
});

test('a guest link for a suspended account opens nothing, and is left unspent', async () => {
  const email = `susp-${uniq()}@guest.test`;
  const { token } = await accounts.createGuestLink({ email });
  const a = await accounts.createAccount({ email, name: 'Suspended' });
  await query(`update accounts set status = 'suspended' where id = $1`, [a.id]);
  assert.equal(await accounts.consumeGuestLink(token), null);
  const { rows: [l] } = await query('select used_at, account_id from sign_in_links where pending_email = $1', [email]);
  assert.equal(l.used_at, null);
  assert.equal(l.account_id, null);
});

test('the reply never says whether the address has an account', async () => {
  const known = `known-${uniq()}@guest.test`;
  const suspended = `gone-${uniq()}@guest.test`;
  await accounts.createAccount({ email: known, name: 'Known' });
  const s = await accounts.createAccount({ email: suspended, name: 'Gone' });
  await query(`update accounts set status = 'suspended' where id = $1`, [s.id]);
  const a = await call('POST', '/api/auth/guest', { email: known });
  const b = await call('POST', '/api/auth/guest', { email: `stranger-${uniq()}@guest.test` });
  const c = await call('POST', '/api/auth/guest', { email: suspended });
  assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
  assert.deepEqual(a.body, b.body);
  assert.deepEqual(b.body, c.body);
  assert.equal((await linksFor(suspended)).length, 0, 'a suspended account is sent nothing');
});

test('an address that is not one is refused for its shape alone', async () => {
  for (const email of ['', 'nope', 'a@b', ' @x.y']) {
    const r = await call('POST', '/api/auth/guest', { email });
    assert.equal(r.status, 400, `${JSON.stringify(email)} is not an address`);
  }
});

// ---------------------------------------------------------------------------
// Continue with Google
// ---------------------------------------------------------------------------

test('the guest door makes a free account for a verified address, once', async () => {
  const email = `g-${uniq()}@gmail.test`;
  const sub = `sub-${uniq()}`;
  const r = await resolveGuestGoogleAccount({ sub, email, emailVerified: true, name: 'Gina Guest' });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.account.plan, 'guest');
  assert.equal(r.account.google_sub, sub);
  assert.equal(r.account.name, 'Gina Guest');
  // Again: the same account, by its Google identity.
  const again = await resolveGuestGoogleAccount({ sub, email, emailVerified: true });
  assert.equal(again.account.id, r.account.id);
  assert.ok(!again.created);
});

test('the guest door makes nothing for an unverified address', async () => {
  const email = `unverified-${uniq()}@gmail.test`;
  const r = await resolveGuestGoogleAccount({ sub: `sub-${uniq()}`, email, emailVerified: false });
  assert.equal(r.ok, false);
  assert.equal(await accounts.accountByEmail(email), null);
});

test('the guest door signs an existing customer in, plan untouched — the plain door still refuses them', async () => {
  const email = `cust-${uniq()}@gmail.test`;
  const cust = await accounts.createAccount({ email, name: 'Customer', plan: 'friend' });
  await query(`update accounts set status = 'active' where id = $1`, [cust.id]);
  const sub = `sub-${uniq()}`;
  const plain = await resolveGoogleAccount({ sub: `other-${uniq()}`, email: `nobody-${uniq()}@gmail.test`, emailVerified: true });
  assert.equal(plain.ok, false, 'the plain door makes no account');
  const r = await resolveGuestGoogleAccount({ sub, email, emailVerified: true });
  assert.equal(r.ok, true);
  assert.equal(r.account.id, cust.id);
  assert.ok(!r.created);
  assert.equal((await accounts.accountById(cust.id)).plan, 'friend');
  const { rows: [{ n }] } = await query('select count(*)::int as n from accounts where lower(email) = $1', [email]);
  assert.equal(n, 1);
});

test('the guest door never takes over an account bound to another Google identity, nor a suspended one', async () => {
  const email = `bound-${uniq()}@gmail.test`;
  const a = await accounts.createAccount({ email, name: 'Bound' });
  await accounts.setGoogleSub(a.id, `first-${uniq()}`);
  assert.equal((await resolveGuestGoogleAccount({ sub: `second-${uniq()}`, email, emailVerified: true })).ok, false);

  const email2 = `susp-g-${uniq()}@gmail.test`;
  const s = await accounts.createAccount({ email: email2, name: 'Suspended' });
  await query(`update accounts set status = 'suspended' where id = $1`, [s.id]);
  assert.equal((await resolveGuestGoogleAccount({ sub: `sub-${uniq()}`, email: email2, emailVerified: true })).ok, false);
});

test('a guest is only ever sent back to a guest page', () => {
  for (const ok of ['/experiences/abc', '/experiences/abc/book?l=x&session=y', '/invited/tok', '/i/tok', '/e/abc123', '/bookings/1', '/plans?span=events', '/messages', '/en-gb/event/pottery-abc123']) {
    assert.equal(guestNext(ok), ok, ok);
  }
  for (const bad of ['/inspire', '/admin', '/login?next=/x', '//evil.test', 'https://evil.test', '/\\evil.test', '/experiences/../admin', '/plans#x', '/places', null, '']) {
    assert.equal(guestNext(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------------------
// the wall
// ---------------------------------------------------------------------------

const guestSession = async () => {
  const { account } = await accounts.createGuestSignupAccount({ email: `wall-${uniq()}@guest.test`, name: 'Wall' });
  const { token, session } = await openSession('Computer · Chrome', account.id, 'device', 'link');
  return { account, token, session };
};

test('a guest session reaches bookings, messages, payments and its own settings', async () => {
  const { token } = await guestSession();
  for (const [method, path] of [
    ['GET', '/api/booked'], ['GET', '/api/booked/b1'], ['POST', '/api/booked/b1/cancel'], ['POST', '/api/booked/b1/payment'],
    ['POST', '/api/experiences/e1/booking'], ['POST', '/api/experiences/e1/booking/quote'], ['POST', '/api/experiences/e1/waitlist'],
    ['DELETE', '/api/experiences/e1/waitlist'], ['GET', '/api/experiences/e1/mine'], ['POST', '/api/invited/t1/book'],
    ['GET', '/api/bookings'], ['GET', '/api/messages'], ['GET', '/api/chat/offer/e1'], ['POST', '/api/chat/offer/e1/topics'],
    ['GET', '/api/notifications'], ['GET', '/api/payments'], ['GET', '/api/household'], ['PATCH', '/api/household'],
    ['DELETE', '/api/household'], ['POST', '/api/household/members'], ['GET', '/api/sessions'], ['POST', '/api/activity'],
  ]) {
    const r = await call(method, path, method === 'GET' || method === 'DELETE' ? undefined : {}, token);
    assert.equal(r.status, 200, `${method} ${path} is a guest's`);
  }
});

test('a guest session is refused everything else, in plain words', async () => {
  const { token } = await guestSession();
  for (const [method, path] of [
    ['GET', '/api/inspire/near'], ['GET', '/api/places'], ['GET', '/api/discover/search'], ['POST', '/api/plan'], ['GET', '/api/trips'],
    ['POST', '/api/trips'], ['POST', '/api/voice/transcribe'], ['GET', '/api/atlas'], ['GET', '/api/menu/x'], ['GET', '/api/host/desk'],
    ['POST', '/api/host/lanes/offers'], ['GET', '/api/photos/google'], ['GET', '/api/events/near'], ['POST', '/api/household/members/m1/invite'],
    ['GET', '/api/household/spend'], ['GET', '/api/collections'], ['GET', '/api/sources'],
  ]) {
    const r = await call(method, path, method === 'GET' ? undefined : {}, token);
    assert.equal(r.status, 403, `${method} ${path} is not a guest's`);
    assert.equal(r.body.error, 'guest_account');
    assert.match(r.body.message, /bookings, messages and payments/);
  }
});

test('a member is not caught by the guest wall', async () => {
  const a = await accounts.createAccount({ email: `memberwall-${uniq()}@guest.test`, name: 'Member', plan: 'friend' });
  const { token } = await openSession('Computer · Chrome', a.id, 'device', 'link');
  const r = await call('GET', '/api/inspire/near', undefined, token);
  assert.equal(r.status, 200);
  assert.equal(guestMayReach('GET', '/api/inspire/near'), false);
});

// ---------------------------------------------------------------------------
// the spend guard
// ---------------------------------------------------------------------------

test('a guest household can never spend on Google or Claude, whatever its bound says', async () => {
  const { account, session } = await guestSession();
  assert.equal(await monthlyBoundFor(account.household_id), 0);
  assert.equal(await claudeBoundFor(account.household_id), 0);
  // Even with the bound raised by hand, the plan is refused outright.
  await query('update accounts set monthly_call_bound = 5000 where id = $1', [account.id]);
  assert.equal(await householdIsGuest(account.household_id), true);
  await runAsSpender({ householdId: account.household_id, sessionId: session.id }, async () => {
    await assert.rejects(admitPaid({ requests: 1 }), (err) => err instanceof UnattributedCallError && /guest/.test(err.message));
    await assert.rejects(assertWithinBounds({ householdId: account.household_id, sessionId: null }), (err) => err instanceof UnattributedCallError && /guest/.test(err.message));
  });
});

test('a household with no guest on it is not refused as one', async () => {
  const a = await accounts.createAccount({ email: `notguest-${uniq()}@guest.test`, name: 'Member', plan: 'friend' });
  assert.equal(await householdIsGuest(a.household_id), false);
});

test('a guest household is never counted as a member', async () => {
  const { account } = await guestSession();
  const rows = await classifyHouseholds({ householdId: account.household_id });
  assert.equal(rows.length, 0, 'guest households are not classified at all');
});
