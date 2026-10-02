/**
 * An agent session may sign only itself out, never the owner everywhere (G11,
 * 1 Oct 2026). Since the owner account is claimed, a passcode agent carries the
 * owner's account_id, so `?all=1` must not revoke his personal sessions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { openSession } = await import('../src/auth.js');
const sessionRoutes = (await import('../src/routes/session.js')).default;
const { findLiveSession } = await import('../src/repositories/sessions.js');

const app = express();
app.use(express.json());
app.use('/api', sessionRoutes);
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { server.close(); await pool.end(); });

test('an agent signing out everywhere signs out only itself', async () => {
  const { rows: [hh] } = await query(`insert into households (name) values ('Owner hh') returning id`);
  const { rows: [owner] } = await query(
    `insert into accounts (household_id, email, role, status) values ($1, 'owner@test', 'owner', 'active') returning id`, [hh.id]);
  // The owner's own device (personal link sign-in) and an agent on the same account.
  const device = await openSession('Computer · Chrome', owner.id, 'device', 'link');
  const agent = await openSession('epic-xx', owner.id, 'agent', 'passcode');

  const res = await fetch(`${base}/api/session?all=1`, { method: 'DELETE', headers: { authorization: `Bearer ${agent.token}` } });
  assert.equal(res.status, 204);

  // The agent is gone; the owner's own device is untouched.
  assert.equal(await findLiveSession(agent.token), null, 'the agent signed itself out');
  assert.ok(await findLiveSession(device.token), 'the owner stays signed in on his device');

  await query('delete from api_sessions where account_id = $1', [owner.id]);
  await query('delete from accounts where id = $1', [owner.id]);
  await query('delete from households where id = $1', [hh.id]);
});
