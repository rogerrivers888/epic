/**
 * Privileged actions need the owner personally signed in (G11, 1 Oct 2026).
 *
 * "Lift the hold, paid grants, bulk production changes, anything that spends
 * money or overrides a safeguard must require my own signed-in account
 * (roger@epic.day via the e-mail link). Not available to passcode sessions.
 * Agent sessions: read, test, propose — no spending, no lifting holds, no paid
 * grants, no bulk production changes." These pin the access layer that enforces
 * it: how a session signed in (auth_method) and what kind it is decide
 * `elevated`, and `requireOwnerSignedIn` lets only an elevated session through.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { pool } = await testDatabase();
const { accessFor, requireOwnerSignedIn, VIEW_CAPABILITIES, CAPABILITIES } = await import('../src/access.js');
test.after(() => pool.end());

const owner = { id: 'a1', email: 'roger@epic.day', name: 'Roger', role: 'owner' };

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const run = async (req) => {
  let passed = false;
  const r = res();
  await requireOwnerSignedIn('lift the hold')(req, r, () => { passed = true; });
  return { passed, r };
};

test('an agent session reads and proposes, and can change nothing', async () => {
  const a = await accessFor({ account: owner, session: { kind: 'agent', auth_method: 'passcode' } });
  assert.equal(a.isOwner, false, 'the session is an agent, whatever the account');
  assert.equal(a.elevated, false);
  // Every read it keeps; no manage capability at all.
  for (const c of CAPABILITIES) {
    assert.equal(a.capabilities.has(c.key), !c.manages, c.key);
  }
  assert.ok(a.capabilities.size === VIEW_CAPABILITIES.length);
  assert.deepEqual([...a.capabilities].filter((k) => k.startsWith('manage_')), []);
});

test('the shared passcode is the owner for ordinary work but never elevated', async () => {
  const claimed = await accessFor({ account: owner, session: { kind: 'device', auth_method: 'passcode' } });
  assert.equal(claimed.isOwner, true, 'ordinary manage still works on the passcode');
  assert.equal(claimed.elevated, false, 'but privileged actions do not');
  // And the passcode with no claimed account, same answer.
  const bare = await accessFor({ account: null, session: { kind: 'device', auth_method: 'passcode' } });
  assert.equal(bare.isOwner, true);
  assert.equal(bare.elevated, false);
});

test('the owner signed in by e-mail link, on a device, is elevated', async () => {
  const a = await accessFor({ account: owner, session: { kind: 'device', auth_method: 'link' } });
  assert.equal(a.isOwner, true);
  assert.equal(a.elevated, true);
});

test('the owner signed in with a password, on a device, is elevated', async () => {
  // A password is something only that person knows — the same standing as a link
  // to their own inbox (routes/authPassword.js).
  const a = await accessFor({ account: owner, session: { kind: 'device', auth_method: 'password' } });
  assert.equal(a.isOwner, true);
  assert.equal(a.elevated, true);
  const automated = await accessFor({ account: owner, session: { kind: 'agent', auth_method: 'password' } });
  assert.equal(automated.elevated, false, 'an automated session is still never elevated');
});

test('a personal method on an automated session is still not elevated', async () => {
  // Belt and braces: an agent that somehow carried a link method is still an agent.
  const a = await accessFor({ account: owner, session: { kind: 'agent', auth_method: 'link' } });
  assert.equal(a.elevated, false);
});

test('a member is neither owner nor elevated', async () => {
  const a = await accessFor({ account: { id: 'm1', email: 'gina@test', role: null }, session: { kind: 'device', auth_method: 'link' } });
  assert.equal(a.isOwner, false);
  assert.equal(a.elevated, false);
});

test('requireOwnerSignedIn lets an elevated session through and refuses the rest', async () => {
  const elevated = await run({ access: await accessFor({ account: owner, session: { kind: 'device', auth_method: 'link' } }) });
  assert.equal(elevated.passed, true);

  for (const session of [
    { kind: 'device', auth_method: 'passcode' },
    { kind: 'agent', auth_method: 'passcode' },
    { kind: 'agent', auth_method: 'link' },
  ]) {
    const out = await run({ access: await accessFor({ account: owner, session }) });
    assert.equal(out.passed, false, JSON.stringify(session));
    assert.equal(out.r.code, 403);
    assert.equal(out.r.body.error, 'needs_personal_sign_in');
    assert.match(out.r.body.message, /Google, your password or an e-mail link/);
  }

  // No access resolved at all (a request that never reached requireSession).
  const none = await run({});
  assert.equal(none.passed, false);
  assert.equal(none.r.code, 403);
});

test('an agent sign-in on a member account is still only a member, never the back office', async () => {
  // Codex, 1 Oct 2026: the agent branch must downgrade the account, not replace
  // it — a household member on an automated user agent must not read the estate.
  const member = { id: 'm2', email: 'sam@test', role: null };
  const a = await accessFor({ account: member, session: { kind: 'agent', auth_method: 'passcode' } });
  assert.deepEqual(a.doors, ['client'], 'the client door only — no admin');
  assert.equal(a.capabilities.size, 0, 'a member holds no reads to keep');
  assert.equal(a.isOwner, false);
  assert.equal(a.elevated, false);
});

test('an agent is restricted only on the shared passcode — a personal sign-in from an automated client is not caged', async () => {
  // Codex, 1 Oct 2026: a coding agent holds the passcode; a human (even via
  // okhttp or curl) signs in by link and keeps their hands.
  const passcodeAgent = await accessFor({ account: owner, session: { kind: 'agent', auth_method: 'passcode' } });
  assert.deepEqual([...passcodeAgent.capabilities].filter((k) => k.startsWith('manage_')), [], 'passcode agent: reads only');

  const linkFromAutomated = await accessFor({ account: owner, session: { kind: 'agent', auth_method: 'link' } });
  assert.ok([...linkFromAutomated.capabilities].some((k) => k.startsWith('manage_')), 'a personal link keeps manage, even from an automated client');
  assert.equal(linkFromAutomated.elevated, false, 'but an automated session is still never elevated');
});

test('a group invite or code sign-in never elevates — only the e-mail magic link does', async () => {
  // Codex, 1 Oct 2026: a participant six-digit code recorded as 'link' would
  // have cleared the owner gate without the magic link.
  for (const auth_method of ['invite', 'passcode', 'code', 'service']) {
    const a = await accessFor({ account: owner, session: { kind: 'device', auth_method } });
    assert.equal(a.elevated, false, auth_method);
  }
  assert.equal((await accessFor({ account: owner, session: { kind: 'device', auth_method: 'link' } })).elevated, true);
});
