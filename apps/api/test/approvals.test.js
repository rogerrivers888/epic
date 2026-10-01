/**
 * The Approvals queue (G11, 1 Oct 2026): an agent files a privileged request,
 * the owner approves it while signed in, and that one call then goes through
 * once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const approvals = await import('../src/repositories/approvals.js');
const { requireOwnerSignedIn, accessFor } = await import('../src/access.js');

let AGENT = null;
test.before(async () => {
  ({ rows: [{ id: AGENT }] } = await query(
    `insert into api_sessions (token_hash, label, kind, auth_method, expires_at)
     values ('test:appr-agent', 'epic-xx', 'agent', 'passcode', now() + interval '1 day')
     on conflict (token_hash) do update set kind = 'agent' returning id`));
});
test.after(async () => { await query(`delete from approvals where session_id = $1`, [AGENT]); await pool.end(); });

const REQ = 'POST /api/admin/place-index/owned-points/purge';

test('an approved request is consumed exactly once', async () => {
  const filed = await approvals.fileApproval({ sessionId: AGENT, label: 'epic-xx', request: REQ, description: 'Purge 12 stale owned points', numbers: { places: 12 } });
  assert.equal(filed.state, 'pending');

  // Pending cannot be consumed.
  assert.equal(await approvals.consumeApproval(AGENT, REQ), false);

  const decided = await approvals.decideApproval(filed.id, { state: 'approved', by: 'roger@epic.day' });
  assert.equal(decided.state, 'approved');
  assert.equal(decided.decided_by, 'roger@epic.day');

  // Approved: consumed once, then never again.
  assert.equal(await approvals.consumeApproval(AGENT, REQ), true);
  assert.equal(await approvals.consumeApproval(AGENT, REQ), false, 'once only');

  // A different call is not unlocked by it.
  await approvals.decideApproval((await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'again' })).id, { state: 'approved', by: 'me' });
  assert.equal(await approvals.consumeApproval(AGENT, 'POST /api/admin/place-index/refresh'), false);
});

test('a decided request cannot be decided again', async () => {
  const filed = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'x' });
  assert.ok(await approvals.decideApproval(filed.id, { state: 'declined', by: 'me' }));
  assert.equal(await approvals.decideApproval(filed.id, { state: 'approved', by: 'me' }), null, 'already decided');
});

test('requireOwnerSignedIn lets a non-elevated session through on an approved matching request', async () => {
  await query(`delete from approvals where session_id = $1`, [AGENT]);
  const filed = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'purge' });
  await approvals.decideApproval(filed.id, { state: 'approved', by: 'me' });

  const access = await accessFor({ account: { role: 'owner' }, session: { id: AGENT, kind: 'agent', auth_method: 'passcode' } });
  const req = { session: { id: AGENT }, method: 'POST', originalUrl: '/api/admin/place-index/owned-points/purge?x=1', access };
  let passed = false; const res = { status: () => ({ json: () => {} }) };
  await requireOwnerSignedIn('purge owned points')(req, res, () => { passed = true; });
  assert.equal(passed, true, 'the approved request let it through');

  // And not a second time (the approval is spent).
  let passed2 = false; let code = null;
  const res2 = { status: (c) => { code = c; return { json: () => {} }; } };
  await requireOwnerSignedIn('purge owned points')(req, res2, () => { passed2 = true; });
  assert.equal(passed2, false);
  assert.equal(code, 403);
});
