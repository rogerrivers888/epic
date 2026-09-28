import { test } from 'node:test';
import assert from 'node:assert/strict';

// The owner's grant of paid hours to an agent session (G8), 29 Sep 2026: the
// list says whether this sign-in may grant; a device grants, an agent cannot,
// and a grant is written and read back.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();

test.after(() => pool.end());

async function serve(session) {
  const express = (await import('express')).default;
  const router = (await import('../src/routes/admin.js')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.access = { doors: ['admin'], capabilities: new Set(['manage_settings', 'view_library']), isOwner: true, role: null };
    req.session = session;
    next();
  });
  app.use('/admin', router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { url: `http://127.0.0.1:${s.address().port}/admin`, close: () => new Promise((d) => s.close(d)) };
}

test('an agent is granted three hours from a device, never from an agent, and the list says who may grant', async () => {
  const mk = async (kind) => (await query(
    `insert into api_sessions (token_hash, label, expires_at, kind) values ('test:grant:' || gen_random_uuid()::text, null, now() + interval '1 day', $1) returning id`, [kind])).rows[0].id;
  const agent = await mk('agent');
  const phone = await mk('device');

  const asAgent = await serve({ id: agent, kind: 'agent' });
  try {
    const list = await (await fetch(`${asAgent.url}/sessions/agents?all=1`)).json();
    assert.equal(list.canGrant, false);
    assert.ok(list.sessions.some((s) => s.id === agent));
    const refused = await fetch(`${asAgent.url}/sessions/${agent}/grant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hours: 3 }) });
    assert.equal(refused.status, 403);
  } finally { await asAgent.close(); }

  const asPhone = await serve({ id: phone, kind: 'device' });
  try {
    const list = await (await fetch(`${asPhone.url}/sessions/agents`)).json();
    assert.equal(list.canGrant, true);
    const ok = await fetch(`${asPhone.url}/sessions/${agent}/grant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hours: 3 }) });
    assert.equal(ok.status, 200);
    const { rows: [r] } = await query(`select extract(epoch from paid_grant_until - now())::int s from api_sessions where id = $1`, [agent]);
    assert.ok(r.s > 3 * 3600 - 60 && r.s <= 3 * 3600, `about three hours, got ${r.s}s`);
  } finally { await asPhone.close(); }
});
