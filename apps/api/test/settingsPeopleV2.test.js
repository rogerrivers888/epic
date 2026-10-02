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
const voiceRoutes = (await import('../src/routes/voice.js')).default;
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
  app.use('/api/voice', voiceRoutes);
  app.use('/api', devices);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0, '127.0.0.1');
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

test('the cap holds at the repository, under the household lock, so every door and a racing pair share it', async () => {
  const { household: h } = await aHousehold(query);
  for (let i = 0; i < 4; i += 1) await addMember(h.id, `P${i}`); // 5 in total with Roger
  // Two adds at once with one place left: the row lock serialises them, so
  // exactly one fits — never both (Codex, 1 Oct 2026).
  const results = await Promise.allSettled([
    households.insertMember(h.id, { name: 'Sixth', isMinor: false }),
    households.insertMember(h.id, { name: 'AlsoSixth', isMinor: false }),
  ]);
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1, 'exactly one of two racing adds fits the last place');
  assert.equal(lost[0].reason.code, 'plan_cap');
  assert.equal(lost[0].reason.status, 403);
  const { rows } = await query('select count(*)::int n from members where household_id = $1', [h.id]);
  assert.equal(rows[0].n, 6, 'never a seventh');
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
    { kind: 'allergy', value: 'shellfish' },  // → crustaceans AND molluscs, as migration 352 expands it
    { kind: 'allergy', value: 'latex' },      // → the private note (not a UK-14 word)
    { kind: 'allergy', value: 'nickel' },     // → the SAME note, beside latex — never over it
    { kind: 'favourite', value: 'ramen' },    // → a like
  ], { members: [member], everyone: [member], households, householdId: h.id });
  const row = (await query('select diet, halal, allergen_note from members where id = $1', [member.id])).rows[0];
  assert.equal(row.diet, 'vegetarian');
  assert.equal(row.halal, true);
  assert.equal(row.allergen_note, 'latex, nickel', 'two unknown allergies in one apply both survive');
  const allergens = (await query(`select value from member_constraints where member_id = $1 and kind='allergen' order by value`, [member.id])).rows.map((r) => r.value);
  assert.deepEqual(allergens, ['crustaceans', 'gluten', 'milk', 'molluscs'], 'gluten-free/dairy-free become filtering allergens; spoken shellfish names both crustaceans and molluscs');
  const dislikes = (await query(`select value from member_constraints where member_id = $1 and kind='dislike' order by value`, [member.id])).rows.map((r) => r.value);
  assert.deepEqual(dislikes, ['alcohol', 'pork'], 'no-pork/no-alcohol become dislikes');
  const noDiet = (await query(`select count(*)::int n from member_constraints where member_id = $1 and kind='diet'`, [member.id])).rows[0].n;
  assert.equal(noDiet, 0, 'diet never goes back into member_constraints');
});

test('a legacy single travel mode fills an empty multi-select, and never overwrites a set one', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    await srv.send('PATCH', '/api/household', { travelMode: 'walking' });
    let hh = (await srv.get('/api/household')).body.household;
    assert.deepEqual(hh.travelModes, ['walking'], 'set-up sending only travelMode still fills the new column');
    await srv.send('PATCH', '/api/household', { travelModes: ['car', 'train'] });
    await srv.send('PATCH', '/api/household', { travelMode: 'cycling' });
    hh = (await srv.get('/api/household')).body.household;
    assert.deepEqual(hh.travelModes, ['car', 'train'], 'a chosen multi-select is never overwritten by the legacy word');
  } finally { await srv.close(); }
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

test('"Sign out all other devices" signs out devices, never the agent and service sessions the list hid', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const acct = await createAccountOnHousehold(h.id, { memberId: roger.id, name: 'Roger', role: 'customer', plan: 'household', email: 'roger2@example.com' });
  const { rows: seeded } = await query(
    `insert into api_sessions (token_hash, label, account_id, kind) values
       ('so-d1','Kitchen iPad',$1,'device'),('so-d2','This phone',$1,'device'),('so-a1','f4-scroll',$1,'agent'),('so-s1','service',$1,'service')
     returning id, label`,
    [acct.id],
  );
  const mine = seeded.find((s) => s.label === 'This phone');
  const srv = await server(asMember(h, roger.id), { id: mine.id, account_id: acct.id });
  try {
    assert.equal((await srv.send('DELETE', '/api/sessions')).status, 204);
    const { rows } = await query(
      `select label from api_sessions where account_id = $1 and revoked_at is null order by label`,
      [acct.id],
    );
    assert.deepEqual(rows.map((r) => r.label), ['This phone', 'f4-scroll', 'service'],
      'the other device goes; this phone, the agent and the service session stay');
  } finally { await srv.close(); }
});

test('the shared passcode can sign its other devices out too — its own, never an account\'s', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const other = await aHousehold(query);
  const acct = await createAccountOnHousehold(other.household.id, { memberId: other.member.id, name: 'Else', role: 'customer', plan: 'household', email: 'else@example.com' });
  const { rows: seeded } = await query(
    `insert into api_sessions (token_hash, label, account_id, kind) values
       ('pc-d1','Hall tablet',null,'device'),('pc-d2','This phone',null,'device'),('pc-a1','agent',null,'agent'),('pc-x1','Else phone',$1,'device')
     returning id, label`,
    [acct.id],
  );
  const mine = seeded.find((s) => s.label === 'This phone');
  const srv = await server(owner(h, roger.id), { id: mine.id, account_id: null });
  try {
    assert.equal((await srv.send('DELETE', '/api/sessions')).status, 204, 'the passcode is not refused its own button');
    const { rows } = await query(
      `select label from api_sessions where token_hash like 'pc-%' and revoked_at is null order by label`,
    );
    assert.deepEqual(rows.map((r) => r.label), ['Else phone', 'This phone', 'agent'],
      "the other passcode device goes; this phone, the agent, and an account's device stay");
  } finally { await srv.close(); }
});

test('a signed-in teenager is still managed by the adults — the joined lock is for adults only', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  // A real 15-year-old: is_minor is FALSE (it means under-13), and the guard
  // must find the child from the birthday, not the flag (Codex, 1 Oct 2026).
  const yr = new Date().getFullYear() - 15;
  const teen = await addMember(h.id, 'Tess', { minor: false, birthDate: `${yr}-03-01` });
  const acct = await createAccountOnHousehold(h.id, { memberId: teen.id, name: 'Tess', role: 'customer', plan: 'household', email: 'tess@example.com' });
  await query('update accounts set activated_at = now() where id = $1', [acct.id]);
  const asOwner = await server(owner(h, roger.id));
  try {
    assert.equal((await asOwner.send('PATCH', `/api/household/members/${teen.id}`, { diet: 'vegetarian' })).status, 200,
      'an adult edits a 15-year-old with an account of their own');
  } finally { await asOwner.close(); }
});

// "Yes, remember" (D1) writes what a trip request taught us — and diet is a
// member column now, so the remembered word must land where the profile reads
// it, through the same mapping the apply path uses (Codex, 1 Oct 2026).
const { normaliseTripFacts } = await import('../src/domain/voiceFacts.js');

test('Remember writes a spoken diet to the person, never to a retired constraint row', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const facts = normaliseTripFacts({ food: { diets: ['vegan', 'gluten free'] } });
  const { rows: [intake] } = await query(
    'insert into voice_intakes (household_id, facts) values ($1, $2) returning id',
    [h.id, JSON.stringify(facts)]);
  const srv = await server(owner(h, roger.id));
  try {
    const res = await srv.send('POST', `/api/voice/intake/${intake.id}/remember`);
    assert.equal(res.status, 200);
    const got = (await srv.get('/api/household')).body.members.find((m) => m.id === roger.id);
    assert.equal(got.diet, 'vegan', 'the main diet lands on the member column');
    const { rows } = await query('select kind, value from member_constraints where member_id = $1', [roger.id]);
    assert.deepEqual(rows.map((r) => `${r.kind}:${r.value}`).sort(), ['allergen:gluten'],
      'gluten-free spills to the Gluten allergen; no diet row is ever written');
  } finally { await srv.close(); }
});

// The household's day window is whole hours (smallint); a trip's is SQL times.
const { hourToTime } = await import('../src/domain/time.js');
const trips = await import('../src/repositories/trips.js');

test("the household's whole-hour day window lands on a planned stay as a real time", async () => {
  assert.equal(hourToTime(7), '07:00');
  assert.equal(hourToTime(18), '18:00');
  const { household: h } = await aHousehold(query);
  const stay = await trips.insertPlannedStay(h.id, {
    title: 'Lyme · test', notes: null, placeLabel: 'Lyme Regis', startDate: '2026-10-10', endDate: '2026-10-12',
    baseLabel: 'Lyme (centre)', baseLat: 50.72, baseLng: -2.93, hasCar: true,
    dayStart: hourToTime(h.day_start), dayEnd: hourToTime(h.day_end),
    travelMode: 'driving', intensity: 'balanced', timezone: 'Europe/London',
  });
  assert.equal(stay.day_start, '10:00:00', "the migration's default start, as a time");
  assert.equal(stay.day_end, '18:00:00');
});

// The allergen filter is a safety rule: after the UK-14 migration, members and
// venue data may speak different dialects, and the exclusion must still hold.
const { applyConstraints } = await import('../src/domain/ranking.js');

test('the allergen filter speaks one dialect: gluten excludes wheat, crustaceans excludes shellfish', () => {
  const attendees = [{ id: 'm1', name: 'Maya', allergens: ['gluten', 'crustaceans'], diets: [], dislikes: [], likes: [], access: [] }];
  const venues = [
    { id: 'v1', name: 'Old Wheat House', allergens: ['wheat'] },
    { id: 'v2', name: 'Shellfish Shack', allergens: ['shellfish'] },
    { id: 'v3', name: 'Safe Soup', allergens: [] },
  ];
  const { candidates, excluded } = applyConstraints({ venues, attendees });
  assert.deepEqual(excluded.map((v) => v.id).sort(), ['v1', 'v2'], 'old-vocabulary venue data still excludes');
  assert.deepEqual(candidates.map((v) => v.id), ['v3']);
});

test('step-free excludes only on a known no; unknown never hides; a known yes ranks up', () => {
  const attendees = [{ id: 'm1', name: 'Maya', allergens: [], diets: [], dislikes: [], likes: [], access: ['step-free', 'accessible-toilet'] }];
  const venues = [
    { id: 'steps', name: 'Steps Only', allergens: [], accessibility: { stepFree: 'no' } },
    { id: 'unknown', name: 'No Facts', allergens: [] },
    { id: 'flat', name: 'Flat In', allergens: [], accessibility: { stepFree: 'yes', wheelchairToilet: 'yes' } },
  ];
  const { candidates, excluded } = applyConstraints({ venues, attendees });
  assert.deepEqual(excluded.map((v) => v.id), ['steps'], 'a KNOWN non-step-free place is hidden');
  assert.deepEqual(candidates.map((v) => v.id).sort(), ['flat', 'unknown'], 'no step-free fact never hides (can\'t-speak)');
  const flat = candidates.find((v) => v.id === 'flat');
  const unknown = candidates.find((v) => v.id === 'unknown');
  assert.ok(flat.score > unknown.score, 'known step-free + accessible toilet ranks above no-facts');
  assert.ok(flat.reasons.some((r) => r.kind === 'access'), 'and says why');
});

// Deleting a household withdraws its requests on other people's offers — a
// waitlisted one included — and frees the place for the host, as well as
// deleting its data (owner, 2 Oct 2026). The cascade does it; this pins it.
const hostingRepo = await import('../src/repositories/hosting.js');
const { standing } = await import('../src/domain/hosting.js');

test('deleting a household withdraws its requests on another host\'s offer and frees the place', async () => {
  const hostSide = await aHousehold(query);
  const host = await hostingRepo.insertHost(hostSide.household.id, { name: 'Hana', type: 'skill' });
  const offer = await hostingRepo.insertOffer(host.id, 'oneoff', { startsOn: '2099-05-01', maxCount: 2 });
  const { household: leaving, member: lee } = await aHousehold(query);
  const other = await aHousehold(query);
  await hostingRepo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: other.household.id, occurrence: '2099-05-01', party: [], heads: 2, state: 'confirmed', amountPence: 0 }, null);
  await hostingRepo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: leaving.id, occurrence: '2099-05-01', party: [], heads: 1, state: 'waitlisted', amountPence: 0 }, null);

  const srv = await server(owner(leaving, lee.id));
  try {
    const res = await srv.send('DELETE', '/api/household', { confirmName: leaving.name });
    assert.equal(res.status, 200, 'a household waiting on somebody else\'s offer is not blocked from leaving');
  } finally { await srv.close(); }

  const left = await hostingRepo.bookingsOfOffer(offer.id);
  assert.deepEqual(left.map((b) => b.household_id), [other.household.id], 'the waitlisted request is withdrawn; the other guest is untouched');
  const fresh = await hostingRepo.offerById(offer.id);
  assert.equal(standing(fresh, left, '2099-05-01').heads, 2, 'the host counts only the guest still holding a place');
  const gone = await query('select count(*)::int n from households where id = $1', [leaving.id]);
  assert.equal(gone.rows[0].n, 0, 'and the household\'s own data is gone');
});

test('Remember keeps an unmapped diet in the note, and never touches a joined adult', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const dev = await addMember(h.id, 'Dev');
  const devAcct = await createAccountOnHousehold(h.id, { memberId: dev.id, name: 'Dev', role: 'customer', plan: 'household', email: 'dev-remember@example.com' });
  await query('update accounts set activated_at = now() where id = $1', [devAcct.id]);
  const facts = normaliseTripFacts({ food: { diets: ['vegan', 'low FODMAP'] } });
  const { rows: [intake] } = await query(
    'insert into voice_intakes (household_id, facts) values ($1, $2) returning id',
    [h.id, JSON.stringify(facts)]);
  const srv = await server(owner(h, roger.id));
  try {
    assert.equal((await srv.send('POST', `/api/voice/intake/${intake.id}/remember`)).status, 200);
    const people = (await srv.get('/api/household')).body.members;
    const me = people.find((m) => m.id === roger.id);
    const them = people.find((m) => m.id === dev.id);
    assert.equal(me.diet, 'vegan');
    assert.equal(me.allergenNote, 'low FODMAP', 'a diet that maps to nothing is kept where a person can read it');
    assert.equal(them.diet, 'none', "a joined adult's diet is theirs alone — Remember does not reach it");
    assert.equal(them.allergenNote, null);
  } finally { await srv.close(); }
});

test('the voice apply path still lets an adult edit a signed-in teenager', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const yr = new Date().getFullYear() - 15;
  const teen = await addMember(h.id, 'Tess', { minor: false, birthDate: `${yr}-03-01` });
  const acct = await createAccountOnHousehold(h.id, { memberId: teen.id, name: 'Tess', role: 'customer', plan: 'household', email: 'tess-voice@example.com' });
  await query('update accounts set activated_at = now() where id = $1', [acct.id]);
  const { canEditPerson } = await import('../src/routes/household.js');
  const { loadMembers } = await import('../src/routes/household.js');
  const asLoaded = (await loadMembers(h.id)).find((m) => m.id === teen.id);
  // The voice routes pass loadMembers' camelCase people, not database rows.
  await new Promise((resolve, reject) => runAsAccount(owner(h, roger.id), () => canEditPerson(asLoaded).then((ok) => {
    try { assert.equal(ok, true, 'a 15-year-old read through loadMembers is still a child'); resolve(); } catch (e) { reject(e); }
  }, reject)));
});

test('voice apply keeps an unmapped diet in the private note, beside an unmapped allergy', async () => {
  const { household: h, member } = await aHousehold(query);
  await applyFood([
    { kind: 'diet', value: 'low FODMAP' },
    { kind: 'allergy', value: 'latex' },
  ], { members: [member], everyone: [member], households, householdId: h.id });
  const row = (await query('select allergen_note from members where id = $1', [member.id])).rows[0];
  assert.equal(row.allergen_note, 'low FODMAP, latex', 'neither is lost, and the second never overwrites the first');
});

test('a signed-in teenager edits themselves, and nobody else in the household', async () => {
  const { household: h } = await aHousehold(query);
  const yr = new Date().getFullYear();
  const teen = await addMember(h.id, 'Tess', { minor: false, birthDate: `${yr - 15}-03-01` });
  const sibling = await addMember(h.id, 'Theo', { minor: true, birthDate: `${yr - 9}-06-01` });
  const invited = await addMember(h.id, 'Gina');
  const asTeen = await server(asMember(h, teen.id));
  try {
    assert.equal((await asTeen.send('PATCH', `/api/household/members/${teen.id}`, { diet: 'vegetarian' })).status, 200, 'their own profile is theirs');
    assert.equal((await asTeen.send('PATCH', `/api/household/members/${sibling.id}`, { diet: 'vegan' })).status, 403, "a sibling's profile is the adults' to manage");
    assert.equal((await asTeen.send('POST', `/api/household/members/${sibling.id}/constraints`, { kind: 'allergen', value: 'peanuts' })).status, 403, "nor a sibling's allergens");
    assert.equal((await asTeen.send('PATCH', `/api/household/members/${invited.id}`, { diet: 'vegan' })).status, 403, 'nor an adult who has not joined yet');
  } finally { await asTeen.close(); }
});

test("a household's lead is its first account — a customer — and may remove another adult", async () => {
  const { household: h, member: lead } = await aHousehold(query);
  const gina = await addMember(h.id, 'Gina');
  // Both are ordinary customers: the estate's `owner` role is somebody else's.
  await createAccountOnHousehold(h.id, { memberId: lead.id, name: 'Lead', role: 'customer', plan: 'household', email: 'lead-first@example.com' });
  await createAccountOnHousehold(h.id, { memberId: gina.id, name: 'Gina', role: 'customer', plan: 'household', email: 'gina-second@example.com' });
  const asLead = await server(asMember(h, lead.id));
  try {
    const people = (await asLead.get('/api/household')).body.members;
    assert.equal(people.find((m) => m.id === lead.id).access.isLead, true, 'the first account on the household is its lead');
    assert.equal(people.find((m) => m.id === gina.id).access.isLead, false);
  } finally { await asLead.close(); }
  // The route reads the account itself, so the request carries the lead's own account row.
  const { rows: [leadAcct] } = await query('select * from accounts where member_id = $1', [lead.id]);
  const asLeadAccount = await server({ ...leadAcct, status: 'active' });
  try {
    assert.equal((await asLeadAccount.send('DELETE', `/api/household/members/${gina.id}`)).status, 204, 'the lead removes another adult');
  } finally { await asLeadAccount.close(); }
});

test('the invite door and the spoken household both respect a joined adult', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const dev = await addMember(h.id, 'Dev');
  const devAcct = await createAccountOnHousehold(h.id, { memberId: dev.id, name: 'Dev', role: 'customer', plan: 'household', email: 'dev-joined@example.com' });
  await query('update accounts set activated_at = now() where id = $1', [devAcct.id]);
  const srv = await server(owner(h, roger.id));
  try {
    const invite = await srv.send('POST', `/api/household/members/${dev.id}/invite`, { email: 'someone-else@example.com' });
    assert.equal(invite.status, 403, "re-inviting is no way round: their email is theirs to change");
    const { rows: [after] } = await query('select email from members where id = $1', [dev.id]);
    assert.notEqual(after.email, 'someone-else@example.com');
  } finally { await srv.close(); }
});

const { createTripFromIntent } = await import('../src/routes/plan.js');

test('"When your day runs" sets a day outing\'s start and length when nothing was said', async () => {
  const { household: h, member } = await aHousehold(query);
  await query('update households set day_start = 8, day_end = 14 where id = $1', [h.id]);
  const { rows: [household] } = await query('select * from households where id = $1', [h.id]);
  const trip = await createTripFromIntent({
    household, members: [{ ...member, isMinor: false }], intent: { date: '2099-06-01', attending: [] },
    origin: { label: 'Home', lat: 51.5, lng: -0.1 },
    destination: { label: 'Kew', lat: 51.48, lng: -0.29, countryCode: 'GB', locality: 'Kew' },
    anchorPlace: null, title: 'Kew · test',
  });
  const tripId = trip.id ?? trip.trip?.id;
  const { rows: [day] } = await query('select start_time::text, end_time::text from trip_days where trip_id = $1', [tripId]);
  assert.equal(day.start_time, '08:00:00', 'the day starts when the household says');
  assert.equal(day.end_time, '14:00:00', 'and runs as long as their window');
});

test('"Getting there" reaches the planner: the single mode it reads follows the ticked ones', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    await srv.send('PATCH', '/api/household', { travelModes: ['train', 'walking'] });
    let { rows: [row] } = await query('select travel_mode from households where id = $1', [h.id]);
    assert.equal(row.travel_mode, 'transit', 'train and walking plan as public transport');
    await srv.send('PATCH', '/api/household', { travelModes: ['walking', 'car'] });
    ({ rows: [row] } = await query('select travel_mode from households where id = $1', [h.id]));
    assert.equal(row.travel_mode, 'driving', 'with a car ticked, the car reaches furthest');
  } finally { await srv.close(); }
});

test("the shared passcode's device list is its own devices, never every customer's", async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const other = await aHousehold(query);
  const acct = await createAccountOnHousehold(other.household.id, { memberId: other.member.id, name: 'Else', role: 'customer', plan: 'household', email: 'else-list@example.com' });
  const { rows: seeded } = await query(
    `insert into api_sessions (token_hash, label, account_id, kind) values
       ('pl-d1','Hall tablet',null,'device'),('pl-x1','Somebody else''s phone',$1,'device')
     returning id, label`, [acct.id]);
  const srv = await server(owner(h, roger.id), { id: seeded[0].id, account_id: null });
  try {
    const labels = (await srv.get('/api/sessions')).body.sessions.map((s) => s.label);
    assert.ok(labels.includes('Hall tablet'), 'the passcode sees its own device');
    assert.ok(!labels.includes("Somebody else's phone"), "and never another account's");
  } finally { await srv.close(); }
});

test('"No birthday" and an erased mobile really clear, with the empty string', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const kid = await addMember(h.id, 'Kit', { minor: true, birthDate: '2016-04-01' });
  await query("update members set mobile = '+447700900123' where id = $1", [roger.id]);
  const srv = await server(owner(h, roger.id));
  try {
    assert.equal((await srv.send('PATCH', `/api/household/members/${kid.id}`, { birthDate: '' })).status, 200);
    assert.equal((await srv.send('PATCH', `/api/household/members/${roger.id}`, { mobile: '' })).status, 200);
    const { rows: [k] } = await query('select birth_date, birth_year, is_minor from members where id = $1', [kid.id]);
    assert.equal(k.birth_date, null, 'the birthday is gone');
    assert.equal(k.birth_year, null, 'and the year it implied with it');
    assert.equal(k.is_minor, true, 'a child with no birthday stays a child');
    const { rows: [r] } = await query('select mobile from members where id = $1', [roger.id]);
    assert.equal(r.mobile, null, 'the number is gone');
    // null is still "keep".
    await srv.send('PATCH', `/api/household/members/${kid.id}`, { birthDate: '2015-02-02' });
    await srv.send('PATCH', `/api/household/members/${kid.id}`, { birthDate: null, name: 'Kit' });
    const { rows: [k2] } = await query('select birth_date::text from members where id = $1', [kid.id]);
    assert.equal(k2.birth_date, '2015-02-02');
  } finally { await srv.close(); }
});

test("a day outing with no mode said travels the household's own way", async () => {
  const { household: h, member } = await aHousehold(query);
  await query("update households set travel_mode = 'cycling' where id = $1", [h.id]);
  const { rows: [household] } = await query('select * from households where id = $1', [h.id]);
  const out = await createTripFromIntent({
    household, members: [{ ...member, isMinor: false }], intent: { date: '2099-07-01', attending: [] },
    origin: { label: 'Home', lat: 51.5, lng: -0.1 },
    destination: { label: 'Kew', lat: 51.48, lng: -0.29, countryCode: 'GB', locality: 'Kew' },
    anchorPlace: null, title: 'Kew · bike',
  });
  const { rows: [t] } = await query('select travel_mode from trips where id = $1', [out.id ?? out.trip?.id]);
  assert.equal(t.travel_mode, 'cycling', 'not the old transit default');
});

test('a day outing that names its mode is created, not thrown (a stray travelMode() call on main)', async () => {
  const { household: h, member } = await aHousehold(query);
  const { rows: [household] } = await query('select * from households where id = $1', [h.id]);
  const out = await createTripFromIntent({
    household, members: [{ ...member, isMinor: false }], intent: { date: '2099-07-02', attending: [], travel_mode: 'walking' },
    origin: { label: 'Home', lat: 51.5, lng: -0.1 },
    destination: { label: 'Kew', lat: 51.48, lng: -0.29, countryCode: 'GB', locality: 'Kew' },
    anchorPlace: null, title: 'Kew · walk',
  });
  const { rows: [t] } = await query('select travel_mode from trips where id = $1', [out.id ?? out.trip?.id]);
  assert.equal(t.travel_mode, 'walking');
});

test('only the lead may delete the household', async () => {
  const { household: h, member: lead } = await aHousehold(query);
  const gina = await addMember(h.id, 'Gina');
  await createAccountOnHousehold(h.id, { memberId: lead.id, name: 'Lead', role: 'customer', plan: 'household', email: 'lead-del@example.com' });
  await createAccountOnHousehold(h.id, { memberId: gina.id, name: 'Gina', role: 'customer', plan: 'household', email: 'gina-del@example.com' });
  const { rows: [ginaAcct] } = await query('select * from accounts where member_id = $1', [gina.id]);
  const asGina = await server({ ...ginaAcct, status: 'active' });
  try {
    const res = await asGina.send('DELETE', '/api/household', { confirmName: h.name });
    assert.equal(res.status, 403, 'a non-lead adult cannot delete everybody');
    const { rows } = await query('select count(*)::int n from households where id = $1', [h.id]);
    assert.equal(rows[0].n, 1, 'and the household is still there');
  } finally { await asGina.close(); }
});

test('unticking every travel mode clears the mode the planner reads', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    await srv.send('PATCH', '/api/household', { travelModes: ['car'] });
    await srv.send('PATCH', '/api/household', { travelModes: [] });
    const { rows: [row] } = await query('select travel_mode, travel_modes from households where id = $1', [h.id]);
    assert.equal(row.travel_mode, null, 'no car left behind for the planner');
    assert.deepEqual(row.travel_modes, []);
  } finally { await srv.close(); }
});

test('a spoken household too big for the plan adds nobody, rather than half of it', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  for (let i = 0; i < 3; i += 1) await addMember(h.id, `P${i}`); // 4 with Roger, 2 places left
  const srv = await server(owner(h, roger.id));
  try {
    const res = await srv.send('POST', '/api/voice/household/who/apply', { people: [{ name: 'A', role: 'adult' }, { name: 'B', role: 'adult' }, { name: 'C', role: 'adult' }] });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'plan_cap');
    const { rows } = await query('select count(*)::int n from members where household_id = $1', [h.id]);
    assert.equal(rows[0].n, 4, 'nobody was added');
  } finally { await srv.close(); }
});

test('an allergen is stored as its own key, whatever concept rides along with it', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    const res = await srv.send('POST', `/api/household/members/${roger.id}/constraints`, { kind: 'allergen', value: 'peanuts', conceptKey: 'dish:ramen' });
    assert.ok(res.status < 300, `accepted (${res.status})`);
    const { rows } = await query(`select value, concept_key from member_constraints where member_id = $1 and kind = 'allergen'`, [roger.id]);
    assert.deepEqual(rows.map((r) => [r.value, r.concept_key]), [['peanuts', null]], 'never "ramen" as a safety filter');
  } finally { await srv.close(); }
});

test('Remember with more children than the plan has room for writes nothing at all', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  for (let i = 0; i < 4; i += 1) await addMember(h.id, `P${i}`); // 5 with Roger, 1 place left
  const facts = normaliseTripFacts({ food: { diets: ['vegan'] }, kids_ages: [{ age: 4 }, { age: 7 }] });
  const { rows: [intake] } = await query('insert into voice_intakes (household_id, facts) values ($1, $2) returning id', [h.id, JSON.stringify(facts)]);
  const srv = await server(owner(h, roger.id));
  try {
    const res = await srv.send('POST', `/api/voice/intake/${intake.id}/remember`);
    assert.equal(res.status, 403);
    const { rows: [n] } = await query('select count(*)::int n from members where household_id = $1', [h.id]);
    assert.equal(n.n, 5, 'no child was added');
    const { rows: [me] } = await query('select diet from members where id = $1', [roger.id]);
    assert.equal(me.diet, 'none', 'and the diet was not half-written before the refusal');
  } finally { await srv.close(); }
});

test('joining a group: the same new name twice is one person, and a full household adds nobody', async () => {
  const express = (await import('express')).default;
  const { randomBytes } = await import('node:crypto');
  const groupRoutes = (await import('../src/routes/groups.js')).default;
  const groupsRepo = await import('../src/repositories/groups.js');
  const { household: organiser } = await aHousehold(query);
  const trip = await trips.insertPlannedStay(organiser.id, {
    title: 'Group · test', notes: null, placeLabel: 'Bath', startDate: '2099-08-01', endDate: '2099-08-02',
    baseLabel: 'Bath', baseLat: 51.38, baseLng: -2.36, hasCar: true, dayStart: '10:00', dayEnd: '18:00',
    travelMode: 'driving', intensity: 'balanced', timezone: 'Europe/London',
  });
  const group = await groupsRepo.insertGroup(trip.id, organiser.id, {
    name: 'Bath lot', expectedCount: 6, minimumCount: null, maximumCount: null, wantedBy: null,
    inviteToken: randomBytes(12).toString('hex'), remindersOn: false, cadence: 'weekly', firstReminderOn: null,
  });
  const { household: guestHh, member: guest } = await aHousehold(query);
  for (let i = 0; i < 4; i += 1) await addMember(guestHh.id, `G${i}`); // 5 with the guest: one place left
  const acct = await createAccountOnHousehold(guestHh.id, { memberId: guest.id, name: 'Guest', role: 'customer', plan: 'household', email: 'guest-join@example.com' });
  const pToken = randomBytes(8).toString('hex');
  const p = await groupsRepo.insertParticipant(group.id, { name: 'Guest', heads: 1, token: pToken });
  await query('update group_participants set account_id = $1 where id = $2', [acct.id, p.id]);

  const app = express();
  app.use(express.json());
  app.use('/api', groupRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const url = `http://127.0.0.1:${s.address().port}/api/join/${group.invite_token}/household`;
  const send = (members) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ participantToken: pToken, members }) });
  try {
    const twice = await send([{ name: 'Nia' }, { name: 'nia ' }]);
    assert.ok(twice.status < 300, `one new person, said twice, fits the last place (${twice.status})`);
    let { rows: [n] } = await query('select count(*)::int n from members where household_id = $1', [guestHh.id]);
    assert.equal(n.n, 6);
    const over = await send([{ name: 'Ola' }]);
    assert.equal(over.status, 403, 'a full household refuses before writing');
    ({ rows: [n] } = await query('select count(*)::int n from members where household_id = $1', [guestHh.id]));
    assert.equal(n.n, 6, 'nobody added');
  } finally { await new Promise((r) => s.close(r)); }
});

test('an explicit null for close to home is "Any distance"; leaving it out keeps the setting', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    await srv.send('PATCH', '/api/household', { closeToHomeMinutes: 90 });
    await srv.send('PATCH', '/api/household', { name: h.name });
    let hh = (await srv.get('/api/household')).body.household;
    assert.equal(hh.closeToHomeMinutes, 90, 'an absent field keeps it');
    await srv.send('PATCH', '/api/household', { closeToHomeMinutes: null });
    hh = (await srv.get('/api/household')).body.household;
    assert.equal(hh.closeToHomeMinutes, null, 'null is any distance, as the API type says');
  } finally { await srv.close(); }
});

test('Solo is just you: every door refuses a second person and says to upgrade', async () => {
  const { household: h, member: me } = await aHousehold(query);
  await createAccountOnHousehold(h.id, { memberId: me.id, name: 'Sol', role: 'customer', plan: 'solo', email: 'solo-cap@example.com' });
  const { rows: [acct] } = await query('select * from accounts where member_id = $1', [me.id]);
  const srv = await server({ ...acct, status: 'active' });
  try {
    const viaSettings = await srv.send('POST', '/api/household/members', { name: 'Partner' });
    assert.equal(viaSettings.status, 403);
    assert.equal(viaSettings.body.error, 'plan_cap');
    assert.match(viaSettings.body.message, /Household plan/, 'the refusal names the upgrade');
    const hh = (await srv.get('/api/household')).body.household;
    assert.equal(hh.planCap, 1, 'the screen is told the cap the door enforces');
    const viaVoice = await srv.send('POST', '/api/voice/household/who/apply', { people: [{ name: 'Kid', role: 'child', age: 6 }] });
    assert.equal(viaVoice.status, 403, 'the spoken household is refused the same way');
    const { rows: [n] } = await query('select count(*)::int n from members where household_id = $1', [h.id]);
    assert.equal(n.n, 1, 'still just you');
  } finally { await srv.close(); }
  // The shared door carries the flag the app turns into the upgrade prompt.
  const err = households.planCapRefusal(await households.planCapFor(h.id));
  assert.deepEqual(err.details, { plan: 'solo', cap: 1, upgrade: true, householdCap: households.HOUSEHOLD_PLAN_CAP });
});

test('an outing around a fixed event stays inside the day window, never cutting the event', async () => {
  const { household: h, member } = await aHousehold(query); // the default 10:00–18:00
  const { rows: [household] } = await query('select * from households where id = $1', [h.id]);
  const mk = (anchor, title) => createTripFromIntent({
    household, members: [{ ...member, isMinor: false }], intent: { date: '2099-07-03', attending: [], anchor },
    origin: { label: 'Home', lat: 51.5, lng: -0.1 },
    destination: { label: 'Kew', lat: 51.48, lng: -0.29, countryCode: 'GB', locality: 'Kew' },
    anchorPlace: null, title,
  });
  const dayOf = async (out) => (await query('select start_time::text, end_time::text from trip_days where trip_id = $1', [out.id ?? out.trip?.id])).rows[0];
  const mid = await dayOf(await mk({ name: 'Matinee', start_time: '14:00', duration_minutes: 120 }, 'Kew · show'));
  assert.deepEqual([mid.start_time, mid.end_time], ['10:00:00', '18:00:00'], 'a 2pm show: the day is the window, not 09:12–18:48');
  const late = await dayOf(await mk({ name: 'Late show', start_time: '19:00', duration_minutes: 120 }, 'Kew · late'));
  assert.equal(late.end_time, '21:00:00', 'an event past the window keeps its own end');
});

test('two batches racing for the last places: one lands whole, the other writes nobody', async () => {
  const { household: h } = await aHousehold(query);
  for (let i = 0; i < 2; i += 1) await addMember(h.id, `P${i}`); // 3 with the first person: 3 places left
  const results = await Promise.allSettled([
    households.insertMembers(h.id, [{ name: 'A1', isMinor: false }, { name: 'A2', isMinor: false }]),
    households.insertMembers(h.id, [{ name: 'B1', isMinor: false }, { name: 'B2', isMinor: false }]),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one batch fits');
  const { rows } = await query('select name from members where household_id = $1 order by name', [h.id]);
  const names = rows.map((r) => r.name);
  assert.equal(names.length, 5, 'never a half-written batch');
  const won = names.includes('A1') ? 'A' : 'B';
  assert.ok(names.includes(`${won}2`) && !names.some((n) => n.startsWith(won === 'A' ? 'B' : 'A')), 'the winner whole, the loser not at all');
});

test('the day window takes whole hours: 7.5 is a 400, never a 500', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    const res = await srv.send('PATCH', '/api/household', { dayStart: 7.5 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_day_window');
  } finally { await srv.close(); }
});

test('forgetting is permanent: a stale save adds to the never-learn list and never takes from it', async () => {
  const { household: h, member: roger } = await aHousehold(query);
  const srv = await server(owner(h, roger.id));
  try {
    // Two tabs open on the same profile, each forgetting something different.
    await srv.send('PATCH', `/api/household/members/${roger.id}`, { neverLearn: ['italian'] });
    await srv.send('PATCH', `/api/household/members/${roger.id}`, { neverLearn: ['sushi'] });
    let got = (await srv.get('/api/household')).body.members.find((m) => m.id === roger.id);
    assert.deepEqual([...got.neverLearn].sort(), ['italian', 'sushi'], 'the second tab does not undo the first');
    await srv.send('PATCH', `/api/household/members/${roger.id}`, { neverLearn: [] });
    got = (await srv.get('/api/household')).body.members.find((m) => m.id === roger.id);
    assert.deepEqual([...got.neverLearn].sort(), ['italian', 'sushi'], 'nor does an empty list clear it');
  } finally { await srv.close(); }
});

test('leaving now with no length said still ends with the day window (at least an hour out)', async () => {
  const { household: h, member } = await aHousehold(query); // 10:00–18:00
  const { rows: [household] } = await query('select * from households where id = $1', [h.id]);
  const out = await createTripFromIntent({
    household, members: [{ ...member, isMinor: false }], intent: { attending: [] },
    origin: { label: 'Home', lat: 51.5, lng: -0.1 },
    destination: { label: 'Kew', lat: 51.48, lng: -0.29, countryCode: 'GB', locality: 'Kew' },
    anchorPlace: null, title: 'Kew · now',
  });
  const { rows: [t] } = await query('select depart_at, return_at from trips where id = $1', [out.id ?? out.trip?.id]);
  const minutes = (new Date(t.return_at) - new Date(t.depart_at)) / 60000;
  // Whatever time the suite runs: never the whole 8-hour window tacked onto
  // "now" past the window's end, and never less than an hour.
  const { wallToUtc, wallClock } = await import('../src/domain/time.js');
  const today = wallClock(new Date(), 'Europe/London').dateStr;
  const winEnd = wallToUtc(today, '18:00', 'Europe/London').getTime();
  assert.ok(minutes >= 60, `at least an hour out (${minutes} min)`);
  const winStart = wallToUtc(today, '10:00', 'Europe/London').getTime();
  assert.ok(new Date(t.depart_at).getTime() >= winStart, 'never before the window opens');
  assert.ok(new Date(t.return_at).getTime() <= Math.max(winEnd, new Date(t.depart_at).getTime() + 3600000),
    'ends by the window close, or an hour after leaving if that is later');
});

test('a founding account with no person linked is still the lead', async () => {
  const { household: h } = await aHousehold(query);
  const lead = await createAccountOnHousehold(h.id, { memberId: null, name: 'Founder', role: 'customer', plan: 'household', email: 'founder-nomember@example.com' });
  const { rows: [acct] } = await query('select * from accounts where id = $1', [lead.id]);
  const srv = await server({ ...acct, status: 'active' });
  try {
    const body = (await srv.get('/api/household')).body;
    assert.equal(body.meIsLead, true, 'Delete household and Plan and billing are theirs');
  } finally { await srv.close(); }
});

test('a definite wheelchair=no is read even beside a descriptive step-free note', () => {
  const attendees = [{ id: 'm1', name: 'Maya', allergens: [], diets: [], dislikes: [], likes: [], access: ['step-free'] }];
  const venues = [
    { id: 'stepped', name: 'Stepped', allergens: [], accessibility: { stepFree: 'two steps at the door', wheelchair: 'no' } },
    { id: 'level', name: 'Level', allergens: [], accessibility: { stepFree: 'ramp round the side', wheelchair: 'Yes' } },
    { id: 'vague', name: 'Vague', allergens: [], accessibility: { stepFree: 'ask at the door' } },
  ];
  const { candidates, excluded } = applyConstraints({ venues, attendees });
  assert.deepEqual(excluded.map((v) => v.id), ['stepped'], 'the definite no still hides it');
  assert.deepEqual(candidates.map((v) => v.id).sort(), ['level', 'vague'], 'and a note that says neither never hides');
  const level = candidates.find((v) => v.id === 'level');
  const vague = candidates.find((v) => v.id === 'vague');
  assert.ok(level.score > vague.score, 'the definite yes ranks up');
});
