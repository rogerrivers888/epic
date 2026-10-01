import { test } from 'node:test';
import assert from 'node:assert/strict';

// The owner's grant of paid hours to an agent session (G8, 29 Sep 2026),
// tightened by G11 (1 Oct 2026): granting spends money, so it needs the owner
// personally signed in — elevated — not merely a device on the shared passcode.
// The list says whether this sign-in may grant; an elevated owner grants, every
// other session is refused, and a grant is written and read back.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();

test.after(() => pool.end());

async function serve(session, { elevated = false } = {}) {
  const express = (await import('express')).default;
  const router = (await import('../src/routes/admin.js')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.access = { doors: ['admin'], capabilities: new Set(['manage_settings', 'view_library', 'view_activity']), isOwner: true, role: null, elevated };
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

test('granting needs the owner personally signed in — not an agent, not the passcode; then it is written and read back', async () => {
  const mk = async (kind) => (await query(
    `insert into api_sessions (token_hash, label, expires_at, kind) values ('test:grant:' || gen_random_uuid()::text, null, now() + interval '1 day', $1) returning id`, [kind])).rows[0].id;
  const agent = await mk('agent');
  const phone = await mk('device');

  // An agent session: the list says it may not grant, and the grant is refused.
  const asAgent = await serve({ id: agent, kind: 'agent' }, { elevated: false });
  try {
    const list = await (await fetch(`${asAgent.url}/sessions/agents?all=1`)).json();
    assert.equal(list.canGrant, false);
    assert.ok(list.sessions.some((s) => s.id === agent));
    const refused = await fetch(`${asAgent.url}/sessions/${agent}/grant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hours: 3 }) });
    assert.equal(refused.status, 403);
  } finally { await asAgent.close(); }

  // A device on the shared passcode (not elevated): also refused now (G11).
  const asPasscode = await serve({ id: phone, kind: 'device' }, { elevated: false });
  try {
    const list = await (await fetch(`${asPasscode.url}/sessions/agents`)).json();
    assert.equal(list.canGrant, false, 'the passcode manages ordinary things but cannot grant paid calls');
    const refused = await fetch(`${asPasscode.url}/sessions/${agent}/grant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hours: 3 }) });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).error, 'needs_personal_sign_in');
  } finally { await asPasscode.close(); }

  // The owner, signed in by e-mail link on a device (elevated): may grant.
  const asOwner = await serve({ id: phone, kind: 'device' }, { elevated: true });
  try {
    const list = await (await fetch(`${asOwner.url}/sessions/agents`)).json();
    assert.equal(list.canGrant, true);
    const ok = await fetch(`${asOwner.url}/sessions/${agent}/grant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hours: 3 }) });
    assert.equal(ok.status, 200);
    const { rows: [r] } = await query(`select extract(epoch from paid_grant_until - now())::int s from api_sessions where id = $1`, [agent]);
    assert.ok(r.s > 3 * 3600 - 60 && r.s <= 3 * 3600, `about three hours, got ${r.s}s`);
  } finally { await asOwner.close(); }
});
