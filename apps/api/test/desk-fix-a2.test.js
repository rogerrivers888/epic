import { test } from 'node:test';
import assert from 'node:assert/strict';

// The second audit's fix pass (28 Sep 2026), agent A2: Changes' search takes
// % and _ as letters, a setting's "What changed" is composed by the API and
// never taken from the client, Verification is Idle (not Running) when there
// is nothing to check and nothing has been for longer than the stall window,
// the month's spend is served for the Runs screen from the Spend tile's own
// numbers, and an empty harvest queue is not a verdict.
// A database of this file's own, built from the committed migrations.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const express = (await import('express')).default;
const settings = await import('../src/desk/settings.js');
const changes = await import('../src/desk/changes.js');
const { overview, spendThisMonth, verificationTile } = await import('../src/desk/overview.js');
const { deskRoutes } = await import('../src/routes/desk.js');
const { clearsOf, headlineOf } = await import('../src/domain/runFunnel.js');

test.after(() => pool.end());

const WHO = 'fixa2@epic';

/** The desk's routes behind a session that holds the library. */
async function server() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.access = { doors: ['admin'], capabilities: new Set(['view_library', 'manage_library']), isOwner: false, role: null };
    req.account = { email: WHO };
    next();
  });
  app.use('/desk', deskRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { url: `http://127.0.0.1:${s.address().port}/desk`, close: () => new Promise((r) => s.close(r)) };
}

test('a search for % or _ finds those letters, never every change', async () => {
  await query(`delete from bo_changes where who = $1`, [WHO]);
  await changes.logChange({ who: WHO, area: 'Mapping', what: 'Google word · fixa2 · 100% sure' });
  await changes.logChange({ who: WHO, area: 'Mapping', what: 'Google word · fixa2_under' });
  await changes.logChange({ who: WHO, area: 'Mapping', what: 'Google word · fixa2 plain' });
  const pct = await changes.changes({ who: WHO, q: '%' });
  assert.deepEqual(pct.rows.map((r) => r.what), ['Google word · fixa2 · 100% sure']);
  const under = await changes.changes({ who: WHO, q: '_' });
  assert.deepEqual(under.rows.map((r) => r.what), ['Google word · fixa2_under']);
  const slash = await changes.changes({ who: WHO, q: '\\' });
  assert.equal(slash.total, 0, 'a backslash is a letter too');
  assert.equal((await changes.changes({ who: WHO, q: 'fixa2' })).total, 3);
  await query(`delete from bo_changes where who = $1`, [WHO]);
});

test('a setting\'s "What changed" is composed by the API from the key and value', async () => {
  assert.equal(settings.sentenceFor('recheckFood', 9), 'Food and dietary facts are re-checked every 9 months');
  assert.equal(settings.sentenceFor('shareMax', 85), 'Not added if more than 85% of places already have it — it tells a family nothing · access and age facts are exempt');
  assert.equal(settings.sentenceFor('venueWins', false), 'When our sources disagree, the venue’s own website wins');
  assert.equal(settings.sentenceFor('budgetGoogle', 60), 'Setting · budgetGoogle');

  settings.forget();
  const was = await settings.setting('recheckPhysical');
  const s = await server();
  try {
    const res = await fetch(`${s.url}/settings/recheckPhysical`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: was + 1, what: 'Anything the client likes' }),
    });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.changed, true);
    const { rows: [c] } = await query('select what, who, before, after from bo_changes where id = $1', [out.change]);
    assert.equal(c.what, `Physical features are re-checked every ${was + 1} months`, 'the client\'s words are ignored');
    assert.equal(c.who, WHO);
    assert.deepEqual([c.before, c.after], [String(was), String(was + 1)]);
    // The undo path's own "Undo · …" is the server's, and still written.
    const undo = await fetch(`${s.url}/undo/${out.change}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(undo.status, 200);
    const { rows: [u] } = await query(`select what from bo_changes where subject_id = 'recheckPhysical' and who = $1 order by at desc limit 1`, [WHO]);
    assert.equal(u.what, `Undo · Physical features are re-checked every ${was + 1} months`);
  } finally {
    await s.close();
    settings.forget();
    await settings.setSetting('recheckPhysical', was, { who: WHO });
    await query(`delete from bo_changes where who = $1`, [WHO]);
  }
});

test('Verification is Running only with a check inside the stall window; an empty, quiet backlog is Idle and grey', () => {
  const now = Date.now();
  const recent = new Date(now - 20 * 60_000).toISOString();
  const old = new Date(now - 5 * 3600_000).toISOString();
  assert.deepEqual(verificationTile({ state: 'running', lastAt: recent, backlog: 0 }, now),
    { tone: 'green', title: 'Running', line: 'last checked 20 min ago' });
  // Whether the status calls it idle itself or still says running.
  for (const state of ['running', 'idle']) {
    const t = verificationTile({ state, lastAt: old, backlog: 0 }, now);
    assert.equal(t.tone, 'none', 'can\'t-speak, never green');
    assert.equal(t.title, 'Idle');
    assert.match(t.line, /^nothing to check · last checked /);
  }
  assert.equal(verificationTile({ state: 'stalled', lastAt: old, backlog: 4, hours: 5 }, now).tone, 'red');
  assert.equal(verificationTile({ state: 'never', lastAt: null, backlog: 0 }, now).title, 'Never run');
});

test('the Runs screen\'s spend is the Spend tile\'s own numbers', async () => {
  const [o, s] = await Promise.all([overview(), spendThisMonth()]);
  assert.equal(s.title, o.health.spend.title);
  assert.equal(s.tone, o.health.spend.tone);
  assert.equal(s.line, o.health.spend.line);
  assert.equal(typeof s.google.spent, 'number');
  assert.equal(typeof s.claude.budget, 'number');
  const srv = await server();
  try {
    const res = await fetch(`${srv.url}/overview/spend`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).title, s.title);
  } finally { await srv.close(); }
});

test('four empty weeks are nothing to compare: not "held level", and not good news', () => {
  const quiet = [{ raised: 0, decided: 0 }, { raised: 0, decided: 0 }, { raised: 0, decided: 0 }, { raised: 0, decided: 0 }];
  assert.equal(headlineOf(quiet), 'Nothing raised or decided in the last four weeks');
  assert.equal(clearsOf(quiet).spoke, false, 'drawn grey, never lime');
  assert.equal(headlineOf([{ raised: 0, decided: 0 }, { raised: 10, decided: 10 }]), 'The queue held level last week');
  assert.equal(clearsOf([{ raised: 10, decided: 30 }]).spoke, undefined, 'a real verdict still speaks');
});
