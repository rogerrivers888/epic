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
