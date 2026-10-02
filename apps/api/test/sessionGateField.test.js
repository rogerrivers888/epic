/**
 * GET /api/session says whether the launch gate is up (web › SiteScreen): the
 * website draws only for somebody signed in while it is, and at once when it is
 * not. Answered to anybody, signed in or not, and never cached.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

process.env.EPIC_PASSCODE = process.env.EPIC_PASSCODE || 'test-passcode-1234';
const { pool } = await testDatabase();
const { default: sessionRoutes } = await import('../src/routes/session.js');

const app = express();
app.use(express.json());
app.use('/api', sessionRoutes);
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { server.close(); await pool.end(); });

async function withGate(value, fn) {
  const before = process.env.SITE_GATE;
  if (value === null) delete process.env.SITE_GATE; else process.env.SITE_GATE = value;
  try { await fn(); } finally { if (before === undefined) delete process.env.SITE_GATE; else process.env.SITE_GATE = before; }
}

test('signed out, the session answer still says whether the gate is up', async () => {
  await withGate('on', async () => {
    const res = await fetch(`${base}/api/session`);
    const body = await res.json();
    assert.equal(body.signedIn, false);
    assert.equal(body.gate, true);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
  await withGate('off', async () => {
    assert.equal((await (await fetch(`${base}/api/session`)).json()).gate, false);
  });
  await withGate(null, async () => {
    assert.equal((await (await fetch(`${base}/api/session`)).json()).gate, true, 'unset is on, as the gate itself reads it');
  });
});
