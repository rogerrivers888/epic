import { test } from 'node:test';
import assert from 'node:assert/strict';

// Collections reach families (owner, 28 Sep 2026: "carry on with the
// collections for the family thing"). The household's own endpoint and the
// desk's "See as a household" read one path (desk/collections.js `judge`):
// audience from the rule, thinness within the household's own reach, hearts
// first with unhearted ones kept in view, hearts fading, the first heart
// asking whose list it is, never an empty hearted row, the legacy predicate
// run exactly where there is no rule, and nothing of another household's in
// the answer.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const express = (await import('express')).default;
const collections = await import('../src/desk/collections.js');
const { collectionRoutes } = await import('../src/routes/collections.js');
const { runAsAccount } = await import('../src/context.js');

test.after(() => pool.end());

const REFS = ['cfh:1', 'cfh:2', 'cfh:3', 'cfh:4', 'cfh:5', 'cfh:6'];

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values ('fun', 'cfh-pools', 'Pools', 1)
               on conflict (key) do update set active = true, label = 'Pools'`);
  for (const [i, ref] of REFS.entries()) {
    await query(`insert into place_index (venue_ref, subcategory) values ($1, 'cfh-pools')
                 on conflict (venue_ref) do update set subcategory = 'cfh-pools', not_in_epic_at = null`, [ref]);
    // cfh:6 has no name we hold: it can be counted, never shown.
    if (ref !== 'cfh:6') {
      await query(`insert into place_records (venue_ref, name) values ($1, $2) on conflict (venue_ref) do update set name = excluded.name`, [ref, `Pool ${i + 1}`]);
    } else {
      await query('delete from place_records where venue_ref = $1', [ref]);
    }
  }
  // Every age, so an age condition is decided by the household, not the place.
  for (const ref of REFS) {
    await query(`insert into place_attribute_values (venue_ref, attribute_key, from_value, to_value, set_by) values ($1, 'suits-ages', 0, 99, 'a person')
                 on conflict (venue_ref, attribute_key) do update set from_value = 0, to_value = 99, set_by = 'a person'`, [ref]);
  }
  await query(`delete from browse_rows where key like 'cfh-%'`);
  collections.forget();
}

const rule = (extra = {}) => JSON.stringify({ subs: [{ id: 'cfh-pools', not: false }], ...extra });

async function row(key, { position = 0, extra = {}, predicate = null, active = true } = {}) {
  await query(`insert into browse_rows (key, grouping, title, copy, predicate, rule, position, active, seeded)
               values ($1, 'custom', $2, $3, $4::jsonb, $5::jsonb, $6, $7, false)`,
  [key, `T ${key}`, `Copy ${key}`, predicate ? JSON.stringify(predicate) : '{}', predicate ? null : rule(extra), position, active]);
}

async function household({ kids = [9] } = {}) {
  const { rows: [h] } = await query(`insert into households (name) values ('CFH house') returning id`);
  const { rows: [sarah] } = await query(`insert into members (household_id, name, birth_year) values ($1, 'Sarah', 1985) returning id`, [h.id]);
  const children = [];
  for (const age of kids) {
    const { rows: [c] } = await query(`insert into members (household_id, name, birth_year, is_minor) values ($1, $2, $3, true) returning id`,
      [h.id, `Kid${age}`, new Date().getFullYear() - age]);
    children.push(c);
  }
  return { h, sarah, children };
}

/** A reach that speaks exactly, holding the given places. */
const reachOf = (refs, over = {}) => async () => ({
  label: 'Test home', minutes: 30, refs: new Set(refs), speaks: true, atLeast: false,
  uncovered: [], unresolved: 0, unplaceable: 0, ...over,
});

const mine = (rows) => rows.filter((r) => r.key.startsWith('cfh-')).map((r) => r.key);

async function cleanup(h) {
  await query(`delete from browse_rows where key like 'cfh-%'`);
  if (h) await query('delete from households where id = $1', [h.id]);
}

test('who sees a collection follows from its rule: ages to households with someone that age, 16 and over to an adult', async () => {
  await seed();
  await row('cfh-all', { position: -30 });
  await row('cfh-tots', { position: -29, extra: { ages: [0, 3] } });
  await row('cfh-older', { position: -28, extra: { ages: [8, 12] } });
  await row('cfh-grown', { position: -27, extra: { ages: [16, 99] } });
  const { h } = await household({ kids: [9] });
  collections.forget();
  const out = await collections.familyCollections({ householdId: h.id, reachFor: reachOf(REFS) });
  assert.deepEqual(mine(out.list), ['cfh-all', 'cfh-older', 'cfh-grown'], 'no toddler here, a nine-year-old and an adult');
  await cleanup(h);
});

test('a collection thin within the household’s reach is not shown; a hearted one waits in the list and never shows an empty shelf', async () => {
  await seed();
  await row('cfh-thin', { position: -30 });
  await row('cfh-thinheart', { position: -29 });
  const { h, sarah } = await household();
  await query(`insert into browse_row_hearts (row_key, household_id, member_id) values ('cfh-thinheart', $1, $2)`, [h.id, sarah.id]);
  collections.forget();
  // Two places near: under the minimum of four.
  const thin = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(['cfh:1', 'cfh:2']) });
  assert.deepEqual(mine(thin.list), ['cfh-thinheart']);
  const waiting = thin.list.find((r) => r.key === 'cfh-thinheart');
  assert.equal(waiting.waiting, true);
  assert.deepEqual(waiting.shelf, [], 'a waiting row carries no shelf');
  assert.deepEqual(mine(thin.inspire), [], 'and Inspire leaves it out');
  // The same two places where the count is only a floor: not judged thin.
  const floor = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(['cfh:1', 'cfh:2'], { speaks: false, atLeast: true }) });
  assert.deepEqual(mine(floor.list), ['cfh-thin', 'cfh-thinheart']);
  assert.equal(floor.list.find((r) => r.key === 'cfh-thinheart').waiting, false);
  // Enough near: every place with a name on the shelf, the nameless one left off.
  const near = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(REFS) });
  const full = near.list.find((r) => r.key === 'cfh-thinheart');
  assert.equal(full.waiting, false);
  assert.equal(full.places, 6);
  assert.deepEqual(full.shelf.map((p) => p.name).sort(), ['Pool 1', 'Pool 2', 'Pool 3', 'Pool 4', 'Pool 5']);
  assert.equal(full.shelf[0].kind, 'Pools');
  await cleanup(h);
});

test('never an empty hearted row: enough places near but none we can name waits', async () => {
  await seed();
  await row('cfh-nameless', { position: -30 });
  const { h, sarah } = await household();
  await query(`insert into browse_row_hearts (row_key, household_id, member_id) values ('cfh-nameless', $1, $2)`, [h.id, sarah.id]);
  // The reach holds only cfh:6, which has no name we hold, and its count is
  // a floor (so never judged thin): something is near, nothing can be shown.
  collections.forget();
  const out = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(['cfh:6'], { speaks: false, atLeast: true }) });
  const r = out.list.find((x) => x.key === 'cfh-nameless');
  assert.equal(r.waiting, true);
  assert.deepEqual(r.shelf, []);
  await cleanup(h);
});

test('hearted rows rise, one unhearted row after the second and three more after them', async () => {
  await seed();
  for (let i = 0; i < 8; i++) await row(`cfh-r${i}`, { position: -40 + i });
  const { h, sarah } = await household();
  for (const k of ['cfh-r5', 'cfh-r6', 'cfh-r7']) {
    await query(`insert into browse_row_hearts (row_key, household_id, member_id) values ($1, $2, $3)`, [k, h.id, sarah.id]);
  }
  collections.forget();
  const out = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(REFS) });
  assert.deepEqual(mine(out.inspire), ['cfh-r5', 'cfh-r6', 'cfh-r0', 'cfh-r7', 'cfh-r1', 'cfh-r2', 'cfh-r3']);
  assert.deepEqual(mine(out.list), ['cfh-r0', 'cfh-r1', 'cfh-r2', 'cfh-r3', 'cfh-r4', 'cfh-r5', 'cfh-r6', 'cfh-r7'], 'the list is library order');
  // One heart: it leads, then three unhearted.
  await query(`delete from browse_row_hearts where household_id = $1 and row_key <> 'cfh-r5'`, [h.id]);
  const one = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(REFS) });
  assert.deepEqual(mine(one.inspire), ['cfh-r5', 'cfh-r0', 'cfh-r1', 'cfh-r2']);
  await cleanup(h);
});

test('a heart older than the fade no longer lifts its row', async () => {
  await seed();
  await row('cfh-old', { position: -30 });
  const { h, sarah } = await household();
  await query(`insert into browse_row_hearts (row_key, household_id, member_id, hearted_at) values ('cfh-old', $1, $2, now() - interval '${collections.FADE_DAYS + 5} days')`, [h.id, sarah.id]);
  collections.forget();
  const out = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(REFS) });
  assert.equal(out.list.find((r) => r.key === 'cfh-old').hearted, false);
  await cleanup(h);
});

test('the first heart asks whose list it is; after that the hearts are the viewer’s own, and the personal row takes an adult’s name', async () => {
  await seed();
  await row('cfh-a', { position: -30 });
  const { h, sarah, children: [kid] } = await household();
  // The personalised row, pointed at the test places for this file's database.
  await query(`update browse_rows set rule = $1::jsonb, active = true where key = 'dayyourself'`, [rule()]);
  collections.forget();
  await assert.rejects(collections.heartCollection({ householdId: h.id, key: 'cfh-a', on: true }), (e) => e.code === 'whose_list' && e.status === 409);
  const before = await collections.familyCollections({ householdId: h.id, reachFor: reachOf(REFS) });
  assert.equal(before.ask, true);
  assert.equal(before.whose, null);
  assert.equal(before.list.find((r) => r.key === 'dayyourself')?.title, 'A day to yourself', 'nobody chosen: the plain title');
  assert.deepEqual(before.members.map((m) => [m.name, m.age]), [['Sarah', null], ['Kid9', 9]], 'a child’s age beside their name, an adult’s not');
  await collections.heartCollection({ householdId: h.id, key: 'cfh-a', on: true, memberId: kid.id });
  const asKid = await collections.familyCollections({ householdId: h.id, viewer: kid.id, reachFor: reachOf(REFS) });
  assert.equal(asKid.ask, false);
  assert.equal(asKid.list.find((r) => r.key === 'cfh-a').hearted, true);
  assert.equal(asKid.list.some((r) => r.key === 'dayyourself'), false, 'a child never sees the personal row');
  const asSarah = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(REFS) });
  assert.equal(asSarah.list.find((r) => r.key === 'cfh-a').hearted, false, 'Sarah’s list holds Sarah’s hearts');
  assert.equal(asSarah.list.find((r) => r.key === 'dayyourself')?.title, 'A day to yourself, Sarah');
  // A member of another household is nobody here.
  const other = await household();
  await assert.rejects(collections.heartCollection({ householdId: h.id, key: 'cfh-a', on: true, memberId: other.sarah.id }), (e) => e.status === 400);
  await collections.heartCollection({ householdId: h.id, key: 'cfh-a', on: false, memberId: kid.id });
  assert.equal((await query('select count(*)::int n from browse_row_hearts where household_id = $1', [h.id])).rows[0].n, 0);
  await query(`update browse_rows set rule = null where key = 'dayyourself'`);
  await cleanup(other.h);
  await cleanup(h);
});

test('a row with no rule runs its legacy predicate exactly, and a switched-off row is never shown', async () => {
  await seed();
  await row('cfh-legacy', { position: -30, predicate: { all: [{ subcategory: ['cfh-pools'] }] } });
  await row('cfh-retired', { position: -29, predicate: { all: [{ attribute: 'how-thrilling', atLeast: 3 }] }, active: false });
  const { h } = await household();
  collections.forget();
  const out = await collections.familyCollections({ householdId: h.id, reachFor: reachOf(REFS) });
  assert.deepEqual(mine(out.list), ['cfh-legacy']);
  await assert.rejects(collections.heartCollection({ householdId: h.id, key: 'cfh-retired', on: true }), (e) => e.status === 404);
  await cleanup(h);
});

test('the desk’s See as a household sends what the family’s endpoint sends, from the same reading', async () => {
  await seed();
  for (let i = 0; i < 5; i++) await row(`cfh-d${i}`, { position: -40 + i });
  const { h, sarah } = await household();
  collections.forget();
  const hearts = [{ key: 'cfh-d3', member: sarah.id, days: 2 }, { key: 'cfh-d4', member: sarah.id, days: 1 }];
  const desk = await collections.asHousehold({ householdId: h.id, seenAs: sarah.id, hearts, reachFor: reachOf(REFS) });
  await query(`insert into browse_row_hearts (row_key, household_id, member_id) values ('cfh-d3', $1, $2), ('cfh-d4', $1, $2)`, [h.id, sarah.id]);
  const family = await collections.familyCollections({ householdId: h.id, viewer: sarah.id, reachFor: reachOf(REFS) });
  assert.deepEqual(desk.inspire, family.inspire);
  assert.deepEqual(desk.list, family.list);
  assert.deepEqual(mine(desk.inspire).slice(0, 3), ['cfh-d3', 'cfh-d4', 'cfh-d0']);
  // The preview's hearts were never written.
  await query('delete from browse_row_hearts where household_id = $1', [h.id]);
  const again = await collections.asHousehold({ householdId: h.id, seenAs: sarah.id, hearts, reachFor: reachOf(REFS) });
  assert.equal((await query('select count(*)::int n from browse_row_hearts where household_id = $1', [h.id])).rows[0].n, 0);
  assert.deepEqual(again.inspire, desk.inspire);
  await cleanup(h);
});

/** The household's routes behind a signed-in account. */
async function server(account) {
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => runAsAccount(account, next));
  app.use('/api/collections', collectionRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { url: `http://127.0.0.1:${s.address().port}/api/collections`, close: () => new Promise((r) => s.close(r)) };
}

test('the endpoint: no home is said rather than drawn, the first heart is a 409 with who can answer, and no household id leaves', async () => {
  await seed();
  await row('cfh-e', { position: -30 });
  const { h, sarah } = await household();
  const other = await household();
  const srv = await server({ id: null, household_id: h.id, member_id: null, status: 'active' });
  try {
    const got = await (await fetch(srv.url)).json();
    assert.equal(got.reach, null, 'no home: nothing can be judged near');
    assert.deepEqual(got.inspire, []);
    assert.equal(got.ask, true);
    const text = JSON.stringify(got);
    assert.ok(!text.includes(h.id), 'the household’s own id is not sent');
    assert.ok(!text.includes(other.h.id) && !text.includes(other.sarah.id), 'nothing of another household');
    const ask = await fetch(`${srv.url}/cfh-e/heart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) });
    assert.equal(ask.status, 409);
    const body = await ask.json();
    assert.equal(body.error, 'whose_list');
    assert.deepEqual(body.members.map((m) => m.name), ['Sarah', 'Kid9']);
    const ok = await fetch(`${srv.url}/cfh-e/heart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true, member: sarah.id }) });
    assert.deepEqual(await ok.json(), { key: 'cfh-e', hearted: true });
    const seen = await (await fetch(`${srv.url}?as=${other.sarah.id}`)).json();
    assert.equal(seen.whose, null, 'a device naming somebody from elsewhere is nobody here');
    const bad = await fetch(`${srv.url}/cfh-e/heart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true, member: other.sarah.id }) });
    assert.equal(bad.status, 400);
  } finally { await srv.close(); }
  // An account that is somebody's own hearts as them and is never asked.
  const own = await server({ id: null, household_id: h.id, member_id: sarah.id, status: 'active' });
  try {
    const got = await (await fetch(own.url)).json();
    assert.equal(got.ask, false);
    assert.equal(got.whose.name, 'Sarah');
    assert.equal(got.whoseFixed, true);
    const refused = await fetch(`${own.url}/cfh-e/heart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true, member: other.sarah.id }) });
    assert.equal(refused.status, 400, 'never as somebody else');
  } finally { await own.close(); }
  await cleanup(other.h);
  await cleanup(h);
});
