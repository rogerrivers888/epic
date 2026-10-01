/**
 * The password door locks itself (routes/authPassword.js, signInGuard.js).
 *
 * Its own file because the guard reads its threshold once, at import: here it is
 * three, so the fourth try against one address is refused before the password is
 * even looked at — the right password included — while authPassword.test.js runs
 * with the threshold out of reach.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

process.env.EPIC_SIGNIN_MAX_FAILURES = '3';

const { query, pool } = await testDatabase();
const accounts = await import('../src/repositories/accounts.js');
const passwords = await import('../src/passwords.js');
const { signInGuardConfig } = await import('../src/signInGuard.js');
const authPassword = (await import('../src/routes/authPassword.js')).default;

const app = express();
// As server.js has it, so req.ip is the address the (test) proxy appended.
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', authPassword);
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { server.close(); await pool.end(); });

let caller = 0;
const login = async (body) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/120.0', 'x-forwarded-for': `192.0.2.${++caller}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('a run of wrong passwords locks the door, even to the right one', async () => {
  assert.equal(signInGuardConfig().max, 3);
  const acct = await accounts.createAccount({ email: 'locked@example.com', name: 'Locked' });
  await accounts.setPassword(acct.id, await passwords.hashPassword('the right password'));

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await login({ email: 'locked@example.com', password: `wrong ${i} password` })).status, 401);
  }
  const locked = await login({ email: 'locked@example.com', password: 'the right password' });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, 'locked_out');
  const { rows } = await query("select count(*)::int n from api_sessions where account_id = $1", [acct.id]);
  assert.equal(rows[0].n, 0, 'no session while locked out');
});
