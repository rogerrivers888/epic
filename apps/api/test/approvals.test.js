/**
 * Approve-and-run (G11, 1 Oct 2026): an agent files a request with a fixed
 * payload; the owner approves it signed in; the server runs exactly that call
 * and keeps the result; a failed run is re-approvable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const approvals = await import('../src/repositories/approvals.js');
const adminRoutes = (await import('../src/routes/admin.js')).default;
const { runApprovedCall } = await import('../src/routes/admin.js');

let AGENT = null;
test.before(async () => {
  ({ rows: [{ id: AGENT }] } = await query(
    `insert into api_sessions (token_hash, label, kind, auth_method, expires_at)
     values ('test:appr-run', 'epic-xx', 'agent', 'passcode', now() + interval '1 day')
     on conflict (token_hash) do update set kind = 'agent' returning id`));
});
test.after(async () => { await query(`delete from approvals where session_id = $1`, [AGENT]); await pool.end(); });

const REQ = 'POST /api/admin/place-index/owned-points/purge';

test('only a replayable back-office write, never an approvals call, can be filed', () => {
  assert.ok(approvals.parseApprovalRequest(REQ));
  assert.equal(approvals.parseApprovalRequest('GET /api/admin/foo'), null, 'reads are not filed');
  assert.equal(approvals.parseApprovalRequest('POST /api/trips/x'), null, 'not a back-office path');
  assert.equal(approvals.parseApprovalRequest('POST /api/admin/approvals/1/decide'), null, 'no approving an approval');
  assert.equal(approvals.parseApprovalRequest('POST /api/admin/Approvals/1/decide'), null, 'nor any case of it');
  assert.ok(approvals.parseApprovalRequest('DELETE /api/accounts/5'), 'an accounts path is allowed');
  assert.equal(approvals.parseApprovalRequest('POST /api/admin/../api/trips/x'), null, 'no path traversal');
  assert.equal(approvals.parseApprovalRequest('POST /api/admin/x/../../trips'), null, 'no dot segments');
});

test('a filed request keeps its fixed payload and shows as open', async () => {
  const filed = await approvals.fileApproval({ sessionId: AGENT, label: 'epic-xx', request: REQ, description: 'Purge 12 stale owned points', numbers: { places: 12 }, payload: { ref: 'all', dry: false } });
  assert.equal(filed.state, 'pending');
  assert.deepEqual(filed.payload, { ref: 'all', dry: false });
  assert.ok((await approvals.listApprovals({ state: 'open' })).some((a) => a.id === filed.id));
});

test('approving runs the recorded call; a failure is re-approvable, a success is done', async () => {
  const filed = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'purge', numbers: { places: 3 }, payload: { ref: 'all' } });

  // The server's dispatch is replaced so no socket is needed; it records what it was asked.
  let seen = null;
  const okDispatch = async (call) => { seen = call; return { ok: true, status: 200, body: { done: 3 } }; };
  const r1 = await runApprovedCall(filed, { headers: { authorization: 'Bearer owner-token' } }, okDispatch);
  assert.deepEqual(seen, { method: 'POST', path: '/api/admin/place-index/owned-points/purge', body: { ref: 'all' }, token: 'owner-token' }, 'exactly the recorded call, with the owner token');
  assert.equal(r1.ok, true);

  // A failing call leaves it failed and re-approvable.
  const filed2 = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'purge', payload: {} });
  const claimed = await approvals.startRun(filed2.id, { by: 'roger@epic.day' });
  assert.equal(claimed.state, 'running');
  const bad = await runApprovedCall(claimed, { headers: { authorization: 'Bearer t' } }, async () => ({ ok: false, status: 409, body: { message: 'nothing to purge' } }));
  const failedRow = await approvals.finishRun(claimed.id, { state: 'failed', result: bad });
  assert.equal(failedRow.state, 'failed');
  assert.match(failedRow.result.message, /nothing to purge/);
  // Re-approvable: startRun claims it again.
  const again = await approvals.startRun(filed2.id, { by: 'roger@epic.day' });
  assert.equal(again.state, 'running', 'a failed run can be approved again');
  await approvals.finishRun(filed2.id, { state: 'done', result: { ok: true, status: 200, message: 'Done.' } });
  const done = (await query('select state from approvals where id = $1', [filed2.id])).rows[0];
  assert.equal(done.state, 'done');
});

test('a lost connection is unknown, not a re-approvable failure', async () => {
  const filed = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'purge', payload: {} });
  const claimed = await approvals.startRun(filed.id, { by: 'me' });
  const thrown = await runApprovedCall(claimed, { headers: { authorization: 'Bearer t' } }, async () => { throw new Error('socket hang up'); });
  assert.equal(thrown.indeterminate, true);
  await approvals.finishRun(claimed.id, { state: 'unknown', result: thrown });
  const row = (await query('select state from approvals where id = $1', [filed.id])).rows[0];
  assert.equal(row.state, 'unknown');
  // Not re-approvable: startRun (open states only) cannot claim it.
  assert.equal(await approvals.startRun(filed.id, { by: 'me' }), null, 'an unknown-outcome run is not re-approvable');
});

test('a 5xx is indeterminate, a 4xx is a re-approvable failure, and a stale run is reconciled', async () => {
  const filed = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'x', payload: {} });
  const claimed = await approvals.startRun(filed.id, { by: 'me' });
  const five = await runApprovedCall(claimed, { headers: { authorization: 'Bearer t' } }, async () => ({ ok: false, status: 500, body: { message: 'boom' } }));
  assert.equal(five.indeterminate, true, '5xx may have partly run');
  const four = await runApprovedCall(claimed, { headers: { authorization: 'Bearer t' } }, async () => ({ ok: false, status: 409, body: { message: 'no' } }));
  assert.equal(four.indeterminate, false, '4xx was rejected before acting');

  // A stale running row becomes unknown.
  await approvals.finishRun(filed.id, { state: 'done', result: null }); // clear running
  const f2 = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'y', payload: {} });
  await approvals.startRun(f2.id, { by: 'me' });
  await query(`update approvals set decided_at = now() - interval '20 minutes' where id = $1`, [f2.id]);
  const n = await approvals.reconcileStaleRuns({ olderThanMinutes: 10 });
  assert.ok(n >= 1);
  assert.equal((await query('select state from approvals where id = $1', [f2.id])).rows[0].state, 'unknown');
});

test('the review list includes unknown runs, which the owner can close but not re-run', async () => {
  const filed = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'z', payload: {} });
  await approvals.startRun(filed.id, { by: 'me' });
  await approvals.finishRun(filed.id, { state: 'unknown', result: { ok: false, status: 0, message: 'lost' } });
  assert.ok((await approvals.listApprovals({ state: 'review' })).some((a) => a.id === filed.id), 'unknown shows for review');
  assert.equal(await approvals.startRun(filed.id, { by: 'me' }), null, 'cannot be re-run');
  const closed = await approvals.declineApproval(filed.id, { by: 'roger@epic.day' });
  assert.ok(closed, 'can be closed after checking');
  assert.equal(closed.state, 'declined');
});

test('runApprovedCall refuses a bad recorded request or a missing token', async () => {
  const noToken = await runApprovedCall({ request: REQ, payload: {} }, { headers: {} }, async () => ({ ok: true, status: 200 }));
  assert.equal(noToken.ok, false);
  assert.equal(noToken.status, 401);
  const badReq = await runApprovedCall({ request: 'GET /api/admin/x', payload: {} }, { headers: { authorization: 'Bearer t' } }, async () => ({ ok: true, status: 200 }));
  assert.equal(badReq.ok, false);
});

test('the decide route runs an approved request end to end', async () => {
  const filed = await approvals.fileApproval({ sessionId: AGENT, request: REQ, description: 'purge', numbers: { places: 1 }, payload: { ref: 'x' } });
  const prev = runApprovedCall.dispatch;
  runApprovedCall.dispatch = async () => ({ ok: true, status: 200, body: { done: 1 } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.access = { doors: ['admin'], capabilities: new Set(['view_activity']), isOwner: true, role: null, elevated: true };
    req.account = { id: null, email: 'roger@epic.day' };
    req.session = { id: null };
    req.headers.authorization = 'Bearer owner';
    next();
  });
  app.use('/admin', adminRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/admin/approvals/${filed.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approved' }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.ok, true);
    assert.equal(body.approval.state, 'done');
    // Audited: approved then ran, with the owner's name.
    const { rows } = await query(`select action, actor_label from admin_audit where subject_id = $1 order by at`, [filed.id]);
    assert.ok(rows.some((a) => a.action === 'approval.approved'));
    assert.ok(rows.some((a) => a.action === 'approval.ran' && a.actor_label === 'roger@epic.day'));
  } finally { runApprovedCall.dispatch = prev; await new Promise((d) => s.close(d)); }
});
