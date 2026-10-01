/**
 * The sign-in door's guard (signInGuard.js), tested where it is load-bearing:
 * the launch gate leaves this door open, so the lockout is what stops it being a
 * guessing ground. Pinned here: a handful of failures from one IP locks it out,
 * an account is locked across IPs by a bad link, and a bystander IP is never
 * swept up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { pool, query } = await testDatabase();
const { signInLockedOut, noteSignInFailure, signInGuardConfig } = await import('../src/signInGuard.js');
const { createAccount, createSignInLink, linkContactFor } = await import('../src/repositories/accounts.js');
const { sweepOldFailures, recordFailure } = await import('../src/repositories/signInFailures.js');

test.after(() => pool.end());

const reqFrom = (ip) => ({ headers: { 'x-forwarded-for': ip }, ip, socket: {} });

test('a handful of failures from one IP locks it out; another IP is untouched', async () => {
  const { max } = signInGuardConfig();
  const attacker = reqFrom('203.0.113.9');
  const bystander = reqFrom('198.51.100.4');
  assert.equal(await signInLockedOut(attacker), false, 'not locked at the start');
  let n = 0;
  for (let i = 0; i < max; i += 1) n = await noteSignInFailure(attacker, { kind: 'passcode', reason: 'wrong_passcode' });
  assert.equal(n, max, 'each failure is counted');
  assert.equal(await signInLockedOut(attacker), true, `locked after ${max} failures`);
  assert.equal(await signInLockedOut(bystander), false, 'a different IP is not swept up');
});

test('the failure ledger is swept: old rows go, recent ones stay', async () => {
  await query("insert into sign_in_failures (ip, kind, reason, at) values ('9.9.9.9', 'passcode', 'old-row', now() - interval '40 days')");
  await recordFailure({ ip: '9.9.9.8', kind: 'passcode', reason: 'recent-row' });
  await sweepOldFailures(30);
  const { rows } = await query("select reason from sign_in_failures where reason in ('old-row', 'recent-row')");
  const reasons = rows.map((r) => r.reason);
  assert.ok(!reasons.includes('old-row'), 'a 40-day-old failure is swept');
  assert.ok(reasons.includes('recent-row'), 'a recent failure is kept');
});

test('the sign-in route can derive the account behind a magic link, so the account lockout is real', async () => {
  // Codex, 1 Oct 2026: the account-wide lockout is only real if the route can
  // turn a link token into the account it was for. It can, even once the link is
  // spent or expired — and a blind guess resolves to nobody (IP lockout covers that).
  const account = await createAccount({ email: 'linktest@example.com', name: 'Link Test', householdName: 'Link Test household' });
  const { token } = await createSignInLink(account.id);
  assert.equal(await linkContactFor(token), 'linktest@example.com', 'the token resolves to its account');
  assert.equal(await linkContactFor('a-token-that-was-never-a-link'), null, 'a guess resolves to nobody');
});

test('the lockout is held for the full window even after the failures age out of the count', async () => {
  const req = reqFrom('203.0.113.200');
  const { max } = signInGuardConfig();
  for (let i = 0; i < max; i += 1) await noteSignInFailure(req, { kind: 'passcode', reason: 'wrong_passcode' });
  assert.equal(await signInLockedOut(req), true, 'locked once the threshold is crossed');
  // The burst leaves the counting window (or is swept) — the lockout must still hold.
  await query("delete from sign_in_failures where ip = '203.0.113.200'");
  assert.equal(await signInLockedOut(req), true, 'still locked — held for the window, not only while the rows are in range');
});

test('a bad magic link locks the account out across IPs, not just the IP it came from', async () => {
  const { max } = signInGuardConfig();
  const from = reqFrom('203.0.113.50');
  const victim = 'mallory@example.com';
  for (let i = 0; i < max; i += 1) await noteSignInFailure(from, { kind: 'link', contact: victim, reason: 'link_spent' });
  const freshIp = reqFrom('203.0.113.77');
  assert.equal(await signInLockedOut(freshIp, victim), true, 'the account is locked whatever IP names it');
  assert.equal(await signInLockedOut(freshIp), false, 'but the fresh IP on its own is clean');
});
