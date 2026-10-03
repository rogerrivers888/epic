/**
 * Automations as records (K16; design handover §6; Roger's conditions, 3 Oct
 * 2026): seeded switched on in migration 374 so nothing that runs today stops,
 * the child-safety and lapsed-checks pauses always on with no switch, the
 * Payments chat's automations "Run by Payments", and suspensions locked until
 * Host Terms.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const automations = await import('../src/repositories/automations.js');
const routes = await import('../src/routes/automations.js');
const { runAsAccount } = await import('../src/context.js');

test.after(async () => { await pool?.end?.(); });

const STAFF = { doors: ['admin'], capabilities: new Set(['view_audit', 'manage_settings']), isOwner: false, role: null, elevated: false };
const OWNER = { ...STAFF, isOwner: true, elevated: true };

async function server(access) {
  const { household, member } = await aHousehold(query);
  const { rows: [account] } = await query("insert into accounts (household_id, member_id, email, role, status, name) values ($1,$2,$3,'customer','active','Roger') returning *", [household.id, member.id, `o-${crypto.randomUUID().slice(0, 8)}@example.com`]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.access = access; runAsAccount(account, next); });
  app.use('/api/admin/automations', routes.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const out = (r) => (r.headers.get('content-type')?.includes('json') ? r.json() : r.text()).then((body) => ({ status: r.status, body }));
  return { close: () => new Promise((r) => s.close(r)), get: (p) => fetch(base + p).then(out), send: (m, p, b) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then(out) };
}

const row = async (key) => (await query('select * from automations where key = $1', [key])).rows[0];

test('migration 374 seeds the design’s 22 automations, exactly as the code lists them', async () => {
  const { rows } = await query('select * from automations');
  const seeded = new Map(rows.map((r) => [r.key, r]));
  assert.equal(automations.AUTOMATION_SEEDS.length, 22);
  for (const a of automations.AUTOMATION_SEEDS) {
    const r = seeded.get(a.key);
    assert.ok(r, `${a.key} is seeded`);
    assert.equal(r.area, a.area, a.key);
    assert.equal(r.name, a.name, a.key);
    assert.equal(r.is_on, a.isOn, a.key);
    assert.equal(r.locked, a.locked, a.key);
    assert.equal(r.lock_kind, a.lockKind, a.key);
    assert.deepEqual(r.template_keys, a.templateKeys, a.key);
    assert.deepEqual(r.rules, a.rules, a.key);
    assert.deepEqual(r.step_locks, a.stepLocks, a.key);
    assert.equal(r.no_template, a.noTemplate, a.key);
  }
});

test('every automation is seeded on, except the suspension that waits for Host Terms', async () => {
  const { rows } = await query('select key, is_on, lock_kind from automations');
  const off = rows.filter((r) => !r.is_on).map((r) => r.key);
  assert.deepEqual(off, ['rating_suspension']);
  assert.equal((await row('rating_suspension')).lock_kind, 'owner');
  // The suspended step of Strikes is locked while the rest of Strikes runs.
  assert.deepEqual((await row('strikes')).step_locks, { suspended: 'Waits for Host Terms' });
  assert.equal(await automations.stepAllowed('strikes', 'warning'), true);
  assert.equal(await automations.stepAllowed('strikes', 'suspended'), false);
});

test('each of today’s automatic actions still fires after the migration', async () => {
  // What the code does today, by automation: none of it may read as off.
  const today = ['reminder_24h', 'morning_after', 'waitlist_offer', 'events_go_live', 'decides_by', 'refunds_within_policy', 'release_card_holds', 'pay_hosts', 'complaint_hold', 'chargebacks', 'fix_stripe_differences', 'child_safety_pause', 'checks_lapse_pause', 'hide_contact_details', 'tell_me_when'];
  for (const key of today) assert.equal(await automations.isOn(key), true, `${key} is on`);
  // And a record nobody has written yet reads as on, never as a quiet off.
  assert.equal(await automations.isOn('not_a_record_yet'), true);
});

test('the child-safety pause and the lapsed-checks pause cannot be turned off — by the API, by the owner, or in the database', async () => {
  for (const key of ['child_safety_pause', 'checks_lapse_pause']) {
    await assert.rejects(automations.changeAutomation(key, { on: false }, { who: 'Roger' }), { code: 'always_on' });
    await assert.rejects(automations.changeAutomation(key, { locked: false }, { who: 'Roger' }), { code: 'always_on' });
    await assert.rejects(query('update automations set is_on = false where key = $1', [key]), /always on/);
    await assert.rejects(query('update automations set locked = false, lock_kind = null where key = $1', [key]), /always on|automations_/);
    await assert.rejects(query('delete from automations where key = $1', [key]), /cannot be removed/);
    const r = await row(key);
    assert.equal(r.is_on, true);
    assert.equal(r.lock_kind, 'always_on');
  }
  const srv = await server(OWNER);
  try {
    const r = await srv.send('PATCH', '/api/admin/automations/checks_lapse_pause', { on: false });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'always_on');
  } finally { await srv.close(); }
});

test('the two pauses are never gated on a switch in the code', () => {
  const src = path.resolve(import.meta.dirname, '../src');
  const files = fs.readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    assert.doesNotMatch(text, /isOn\(\s*['"](child_safety_pause|checks_lapse_pause)['"]/, `${f} must not ask whether a pause is on`);
  }
});

test('a Payments-run automation says so and has no switch here', async () => {
  const list = await automations.listAutomations();
  const pay = list.filter((a) => a.lockKind === 'payments').map((a) => a.key).sort();
  assert.deepEqual(pay, ['chargebacks', 'complaint_hold', 'decides_by', 'failed_membership_payments', 'fix_stripe_differences', 'pay_hosts', 'refunds_within_policy', 'release_card_holds']);
  for (const a of list.filter((x) => x.lockKind === 'payments')) {
    assert.equal(a.status, 'Run by Payments');
    assert.equal(a.switchable, false);
    assert.equal(a.on, true);
  }
  await assert.rejects(automations.changeAutomation('pay_hosts', { on: false }, { who: 'Roger' }), { code: 'run_by_payments' });
  assert.equal(list.find((a) => a.key === 'child_safety_pause').status, 'Always on');
  assert.equal(list.find((a) => a.key === 'rating_suspension').status, 'Waits for Host Terms');
  // The design's order: Safety first, Demand last.
  assert.equal(list[0].key, 'hide_contact_details');
  assert.equal(list.at(-1).key, 'tell_me_when');
});

test('a locked suspension cannot be switched on until the owner unlocks it, and the Strikes step the same', async () => {
  await assert.rejects(automations.changeAutomation('rating_suspension', { on: true }, { who: 'Roger' }), { code: 'locked' });
  try {
    await automations.changeAutomation('rating_suspension', { locked: false }, { who: 'Roger' });
    const on = await automations.changeAutomation('rating_suspension', { on: true }, { who: 'Roger' });
    assert.equal(on.on, true);
    await automations.changeAutomation('strikes', { steps: { suspended: false } }, { who: 'Roger' });
    assert.equal(await automations.stepAllowed('strikes', 'suspended'), true);
    await assert.rejects(automations.changeAutomation('strikes', { steps: { pardoned: false } }, { who: 'Roger' }), { code: 'no_lock' });
  } finally {
    // Put the locks back: suspensions stay off until Roger switches on Host Terms.
    await automations.changeAutomation('rating_suspension', { locked: true }, { who: 'Roger' });
    await automations.changeAutomation('strikes', { steps: { suspended: true } }, { who: 'Roger' });
  }
  const r = await row('rating_suspension');
  assert.equal(r.is_on, false);
  assert.equal(r.locked, true);
  assert.equal(await automations.stepAllowed('strikes', 'suspended'), false);
  const { rows: logged } = await query("select what from bo_changes where area = 'Automations' and subject_id in ('rating_suspension', 'strikes') order by at");
  assert.ok(logged.some((l) => /Unlocked “Rating suspension”/.test(l.what)));
  assert.ok(logged.some((l) => /Locked “Rating suspension”, and switched it off/.test(l.what)));
  assert.ok(logged.some((l) => /steps of “Strikes”/.test(l.what)));
});

test('an automation with no template cannot be switched on, unless it sends nothing by design', async () => {
  await query(`insert into automations (key, area, name, trigger, is_on) values ('test_silent', 'hosting', 'A test with nothing to say', 'event.live', false) on conflict (key) do update set is_on = false, template_keys = '{}', no_template = null`);
  await assert.rejects(automations.changeAutomation('test_silent', { on: true }, { who: 'Roger' }), { code: 'no_template' });
  await query(`update automations set no_template = 'Nothing sent (deliberate)' where key = 'test_silent'`);
  assert.equal((await automations.changeAutomation('test_silent', { on: true }, { who: 'Roger' })).on, true);
  await query(`delete from automations where key = 'test_silent'`);
});

test('rule values are checked against their kind, and a change is in Changes', async () => {
  await assert.rejects(automations.changeAutomation('rating_warning', { rules: { below: 'low' } }, { who: 'Roger' }), { code: 'bad_rules' });
  await assert.rejects(automations.changeAutomation('rating_warning', { rules: { colour: 3 } }, { who: 'Roger' }), { code: 'bad_rules' });
  const a = await automations.changeAutomation('rating_warning', { rules: { below: 3.9 } }, { who: 'Roger' });
  assert.equal(a.rules.below, 3.9);
  await automations.changeAutomation('rating_warning', { rules: { below: 3.8 } }, { who: 'Roger' });
});

test('only the owner signed in personally changes an automation; staff read the list', async () => {
  const staff = await server(STAFF);
  const owner = await server(OWNER);
  try {
    const list = await staff.get('/api/admin/automations');
    assert.equal(list.status, 200);
    assert.equal(list.body.automations.length, 22);
    assert.deepEqual(list.body.areas, ['safety', 'hosting', 'money', 'members', 'demand']);
    const refused = await staff.send('PATCH', '/api/admin/automations/rating_warning', { rules: { below: 3.7 } });
    assert.equal(refused.status, 403);
    const ok = await owner.send('PATCH', '/api/admin/automations/rating_warning', { rules: { below: 3.7 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.automation.rules.below, 3.7);
    await owner.send('PATCH', '/api/admin/automations/rating_warning', { rules: { below: 3.8 } });
  } finally { await staff.close(); await owner.close(); }
});

test('the log: a run is written, counted, listed, and undone only where undoing is allowed', async () => {
  await assert.rejects(automations.logRun({ automation: 'nobody', rule: 'x', did: 'y' }), { code: 'unknown_automation' });
  const run = await automations.logRun({ automation: 'child_safety_pause', subjectKind: 'host', subjectId: crypto.randomUUID(), rule: 'A report named a child', did: 'Paused 2 events with children' });
  const list = await automations.listRuns({ automation: 'child_safety_pause' });
  assert.ok(list.runs.some((r) => r.id === run.id && r.undoable === false));
  const a = await automations.getAutomation('child_safety_pause');
  assert.ok(a.runs.last7 >= 1 && a.runs.last30 >= a.runs.last7);
  await assert.rejects(automations.undoRun(run.id, { by: crypto.randomUUID() }), { code: 'no_undo' });
  const capped = await automations.listRuns({ limit: 1 });
  assert.equal(capped.limit, 1);
  assert.equal(typeof capped.capped, 'boolean');
});

test('undoing a lapsed-checks pause before the hold exists says so in words, not a database error (Codex, 3 Oct 2026)', async () => {
  const { rows: [has] } = await query(`select 1 as yes from information_schema.columns where table_name = 'host_offers' and column_name = 'held_from'`);
  const run = await automations.logRun({ automation: 'checks_lapse_pause', subjectKind: 'host', subjectId: crypto.randomUUID(), rule: 'Insurance ended', did: 'Paused 1 drop-off event', undo: { events: [{ id: crypto.randomUUID() }] } });
  await assert.rejects(automations.undoRun(run.id, { by: crypto.randomUUID() }), { code: 'nothing_to_undo' });
  assert.ok(has === undefined || has.yes === 1);
});
