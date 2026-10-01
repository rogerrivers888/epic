/**
 * Settings revised v2 — the server the screens depend on (owner 1 Oct 2026).
 *
 * The quiet failures this pins:
 *   · a joined adult's tastes being changed by somebody who is not them;
 *   · a seventh person slipping past the Household plan's six;
 *   · an allergen that is not one of the UK 14 pretending to filter;
 *   · "any distance" not round-tripping because coalesce can't write a null;
 *   · a test or agent session showing up in a household's Signed-in devices.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const householdRoutes = (await import('../src/routes/household.js')).default;
const { devices } = await import('../src/routes/session.js');
const { runAsAccount } = await import('../src/context.js');
const { createAccountOnHousehold } = await import('../src/repositories/accounts.js');
const households = await import('../src/repositories/households.js');
const { applyFood } = await import('../src/domain/voiceHousehold.js');

test.after(() => pool.end());

const addMember = (householdId, name, { minor = false, birthDate = null } = {}) =>
  query('insert into members (household_id, name, is_minor, birth_date) values ($1,$2,$3,$4) returning *',
    [householdId, name, minor, birthDate]).then((r) => r.rows[0]);

/** Mount the household + devices routes behind a chosen account and session. */
async function server(account, session = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; runAsAccount(account, next); });
  app.use('/api/household', householdRoutes);
  app.use('/api', devices);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  return {
    close: () => new Promise((r) => s.close(r)),
    get: (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    send: (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
  };
}

const owner = (h, memberId) => ({ id: null, household_id: h.id, member_id: memberId, role: 'owner', status: 'active' });
const asMember = (h, memberId) => ({ id: null, household_id: h.id, member_id: memberId, role: 'customer', status: 'active' });

// ---------------------------------------------------------------------------

test('a person carries one main diet, two faiths, a private allergen note, access needs and whose ratings they see', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    const patch = await srv.send('PATCH', `/api/household/members/${roger.id}`, {
      diet: 'vegetarian', halal: true, accessNeeds: ['step-free', 'lift'], allergenNote: 'latex',
      neverLearn: ['italian'], ratingsView: { mode: 'mine' },
    });
    assert.equal(patch.status, 200);
    const got = (await srv.get('/api/household')).body.members.find((m) => m.id === roger.id);
    assert.equal(got.diet, 'vegetarian');
    assert.equal(got.halal, true);
    assert.equal(got.kosher, false);
    assert.deepEqual(got.accessNeeds, ['step-free', 'lift']);
    assert.equal(got.allergenNote, 'latex');
    assert.deepEqual(got.neverLearn, ['italian']);
    assert.equal(got.ratingsView.mode, 'mine');
    // An empty string takes the private note back off.
    await srv.send('PATCH', `/api/household/members/${roger.id}`, { allergenNote: '' });
    const cleared = (await srv.get('/api/household')).body.members.find((m) => m.id === roger.id);
    assert.equal(cleared.allergenNote, null);
  } finally { await srv.close(); }
});

test('a diet off the four, and an allergen off the UK 14, are both refused', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    assert.equal((await srv.send('PATCH', `/api/household/members/${roger.id}`, { diet: 'raw-vegan' })).status, 400);
    assert.equal((await srv.send('POST', `/api/household/members/${roger.id}/constraints`, { kind: 'allergen', value: 'prawns' })).status, 400);
    assert.equal((await srv.send('POST', `/api/household/members/${roger.id}/constraints`, { kind: 'allergen', value: 'peanuts' })).status, 201);
    // Diet is no longer a constraint kind.
    assert.equal((await srv.send('POST', `/api/household/members/${roger.id}/constraints`, { kind: 'diet', value: 'vegan' })).status, 400);
  } finally { await srv.close(); }
});

test('once an adult has joined, only they may change their details and tastes — not even the owner', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const dev = await addMember(h.id, 'Dev');
  const theo = await addMember(h.id, 'Theo', { minor: true, birthDate: '2016-05-01' });
  // Dev has joined: an activated account of his own.
  const devAcct = await createAccountOnHousehold(h.id, { memberId: dev.id, name: 'Dev', role: 'customer', plan: 'household', email: 'dev@example.com' });
  await query('update accounts set activated_at = now() where id = $1', [devAcct.id]);
  // A pending (invited, not opened) adult.
  const gina = await addMember(h.id, 'Gina');
  await createAccountOnHousehold(h.id, { memberId: gina.id, name: 'Gina', role: 'customer', plan: 'household', email: 'gina@example.com' });

  const asOwner = await server(owner(h, roger.id));
  const asDev = await server(asMember(h, dev.id));
  try {
    // The owner cannot touch a joined adult's diet or tastes.
    assert.equal((await asOwner.send('PATCH', `/api/household/members/${dev.id}`, { diet: 'vegan' })).status, 403);
    assert.equal((await asOwner.send('POST', `/api/household/members/${dev.id}/constraints`, { kind: 'like', value: 'ramen' })).status, 403);
    // Dev may change his own.
    assert.equal((await asDev.send('PATCH', `/api/household/members/${dev.id}`, { diet: 'vegan' })).status, 200);
    // A child is managed by the adults.
    assert.equal((await asOwner.send('PATCH', `/api/household/members/${theo.id}`, { diet: 'pescatarian' })).status, 200);
    // A pending adult is still editable by the owner.
    assert.equal((await asOwner.send('PATCH', `/api/household/members/${gina.id}`, { diet: 'vegetarian' })).status, 200);
  } finally { await asOwner.close(); await asDev.close(); }
});

test('the Household plan covers six people, and the seventh is refused on the server', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  for (let i = 0; i < 5; i += 1) await addMember(h.id, `P${i}`); // 6 in total with Roger
  const srv = await server(owner(h, roger.id));
  try {
    const refused = await srv.send('POST', '/api/household/members', { name: 'Seventh' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'plan_cap');
  } finally { await srv.close(); }
});

test('nobody removes themselves; a non-owner removes children only; a removed joined adult is signed out', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const dev = await addMember(h.id, 'Dev');
  const theo = await addMember(h.id, 'Theo', { minor: true, birthDate: '2016-05-01' });
  const devAcct = await createAccountOnHousehold(h.id, { memberId: dev.id, name: 'Dev', role: 'customer', plan: 'household', email: 'dev2@example.com' });
  await query('update accounts set activated_at = now() where id = $1', [devAcct.id]);
  await query(`insert into api_sessions (token_hash, label, account_id, kind) values ('th-dev', 'Dev phone', $1, 'device')`, [devAcct.id]);

  const asOwner = await server(owner(h, roger.id));
  const asDev = await server(asMember(h, dev.id));
  try {
    assert.equal((await asOwner.send('DELETE', `/api/household/members/${roger.id}`)).status, 400, 'owner cannot remove self');
    assert.equal((await asDev.send('DELETE', `/api/household/members/${roger.id}`)).status, 403, 'a non-owner cannot remove an adult');
    assert.equal((await asDev.send('DELETE', `/api/household/members/${theo.id}`)).status, 204, 'a non-owner may remove a child');
    assert.equal((await asOwner.send('DELETE', `/api/household/members/${dev.id}`)).status, 204, 'the owner removes the adult');
    // The removed adult loses access at once: the session is revoked, then gone
    // with the account by cascade — either way, nothing live remains.
    const live = await query(`select count(*)::int n from api_sessions where token_hash = 'th-dev' and revoked_at is null and expires_at > now()`);
    assert.equal(live.rows[0].n, 0, 'the removed adult has no live session left');
  } finally { await asOwner.close(); await asDev.close(); }
});

test('a signed-in teenager cannot remove another child — only an adult may', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const teen = await addMember(h.id, 'Teen', { birthDate: '2010-05-01' }); // ~15
  const theo = await addMember(h.id, 'Theo', { minor: true, birthDate: '2016-05-01' });
  const teenAcct = await createAccountOnHousehold(h.id, { memberId: teen.id, name: 'Teen', role: 'customer', plan: 'household', email: 'teen@example.com' });
  await query('update accounts set activated_at = now() where id = $1', [teenAcct.id]);
  const asTeen = await server(asMember(h, teen.id));
  const asOwner = await server(owner(h, roger.id));
  try {
    assert.equal((await asTeen.send('DELETE', `/api/household/members/${theo.id}`)).status, 403, 'a 15-year-old may not remove a child');
    assert.equal((await asOwner.send('DELETE', `/api/household/members/${theo.id}`)).status, 204, 'the owner may');
  } finally { await asTeen.close(); await asOwner.close(); }
});

test('how Epic plans round-trips, "any distance" clears to null, and an impossible day is refused', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    await srv.send('PATCH', '/api/household', { closeToHomeMinutes: 90, travelModes: ['car', 'train'], dayStart: 9, dayEnd: 17 });
    let hh = (await srv.get('/api/household')).body.household;
    assert.equal(hh.closeToHomeMinutes, 90);
    assert.deepEqual(hh.travelModes, ['car', 'train']);
    assert.deepEqual([hh.dayStart, hh.dayEnd], [9, 17]);
    // "Any distance" is 0 on the wire, null in the row.
    await srv.send('PATCH', '/api/household', { closeToHomeMinutes: 0 });
    hh = (await srv.get('/api/household')).body.household;
    assert.equal(hh.closeToHomeMinutes, null);
    // A day shorter than four hours, or starting too early, is refused.
    assert.equal((await srv.send('PATCH', '/api/household', { dayStart: 10, dayEnd: 12 })).status, 400);
    assert.equal((await srv.send('PATCH', '/api/household', { dayStart: 6, dayEnd: 18 })).status, 400);
    assert.equal((await srv.send('PATCH', '/api/household', { travelModes: ['teleport'] })).status, 400);
  } finally { await srv.close(); }
});

test('voice intake writes diet to the column and maps allergens onto the UK 14', async () => {
  const { household: h, member } = await aHousehold(query);
  await applyFood([
    { kind: 'diet', value: 'vegetarian' },
    { kind: 'diet', value: 'halal' },
    { kind: 'diet', value: 'gluten-free' },   // → a Gluten allergen (filters)
    { kind: 'diet', value: 'dairy-free' },    // → a Milk allergen (filters)
    { kind: 'diet', value: 'no-pork' },       // → a pork dislike (ranks)
    { kind: 'diet', value: 'no-alcohol' },    // → an alcohol dislike (ranks)
    { kind: 'allergy', value: 'shellfish' },  // → crustaceans
    { kind: 'favourite', value: 'ramen' },    // → a like
  ], { members: [member], everyone: [member], households, householdId: h.id });
  const row = (await query('select diet, halal from members where id = $1', [member.id])).rows[0];
  assert.equal(row.diet, 'vegetarian');
  assert.equal(row.halal, true);
  const allergens = (await query(`select value from member_constraints where member_id = $1 and kind='allergen' order by value`, [member.id])).rows.map((r) => r.value);
  assert.deepEqual(allergens, ['crustaceans', 'gluten', 'milk'], 'gluten-free/dairy-free become filtering allergens; shellfish → crustaceans');
  const dislikes = (await query(`select value from member_constraints where member_id = $1 and kind='dislike' order by value`, [member.id])).rows.map((r) => r.value);
  assert.deepEqual(dislikes, ['alcohol', 'pork'], 'no-pork/no-alcohol become dislikes');
  const noDiet = (await query(`select count(*)::int n from member_constraints where member_id = $1 and kind='diet'`, [member.id])).rows[0].n;
  assert.equal(noDiet, 0, 'diet never goes back into member_constraints');
});

test('Signed-in devices shows this account real devices only — never a test or agent session', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const acct = await createAccountOnHousehold(h.id, { memberId: roger.id, name: 'Roger', role: 'owner', plan: 'household', email: 'roger@example.com' });
  await query(`insert into api_sessions (token_hash, label, account_id, kind) values ('d1','Kitchen iPad',$1,'device'),('d2','This phone',$1,'device'),('a1','f4-scroll',$1,'agent'),('s1','service',$1,'service')`, [acct.id]);
  const srv = await server(asMember(h, roger.id), { id: null, account_id: acct.id });
  try {
    const { body } = await srv.get('/api/sessions');
    const labels = body.sessions.map((s) => s.label).sort();
    assert.deepEqual(labels, ['Kitchen iPad', 'This phone'], 'only device sessions, never agent/service');
  } finally { await srv.close(); }
});
