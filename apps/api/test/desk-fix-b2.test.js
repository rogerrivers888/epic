import { test } from 'node:test';
import assert from 'node:assert/strict';

// The second audit's fixes (28 Sep 2026), Categories and Facts: an undone
// correction takes its accuracy row with it, a source that checked nothing
// says so, an idle machine is not "Running", an unset default speaks only
// from its evidence, the prototype's words for a single default, and Copy
// facts offers only what a copy would add.
// A database of this file's own, built from the committed migrations.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const settings = await import('../src/desk/settings.js');
const categories = await import('../src/desk/categories.js');
const facts = await import('../src/desk/facts.js');
const verification = await import('../src/desk/verification.js');

test.after(() => pool.end());

const WHO = 'fixb2@epic';

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('fb2', 'Fix B2', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('fb2', 'fb2-pools', 'Pools', 1), ('fb2', 'fb2-lidos', 'Lidos', 2), ('fb2', 'fb2-spas', 'Spas', 3)
               on conflict (key) do update set active = true`);
  await query(`insert into place_attributes (key, label, kind, active, standard) values
               ('fb2-wave', 'Wave machine', 'yesno', true, false), ('fb2-sauna', 'Sauna', 'yesno', true, false)
               on conflict (key) do update set active = true, standard = false`);
  await query(`insert into place_attributes (key, label, kind, active, standard) values
               ('parking', 'Parking', 'yesno', true, true), ('toilets', 'Toilets', 'yesno', true, true), ('indoor', 'Indoors', 'yesno', true, true)
               on conflict (key) do update set active = true, standard = true`);
  for (const k of ['fb2-wave', 'fb2-sauna', 'parking', 'toilets', 'indoor']) {
    for (const t of ['subcategory_facts', 'place_fact_answers', 'place_fact_evidence', 'place_attribute_values', 'fact_corrections', 'fact_unknowns']) {
      await query(`delete from ${t} where attribute_key = $1`, [k]);
    }
  }
  await query(`delete from shelf_subcategory_attributes where subcategory_key like 'fb2-%'`);
  await query(`delete from bo_changes where who = $1`, [WHO]);
  for (const [ref, sub] of [['fb2:1', 'fb2-pools'], ['fb2:2', 'fb2-pools'], ['fb2:3', 'fb2-lidos']]) {
    await query(`insert into place_index (venue_ref, subcategory, country_code) values ($1, $2, 'GB')
                 on conflict (venue_ref) do update set subcategory = $2, not_in_epic_at = null`, [ref, sub]);
    await query(`insert into place_records (venue_ref, name) values ($1, $2) on conflict (venue_ref) do update set name = $2`, [ref, `Place ${ref.slice(4)}`]);
  }
  // Pools look for both; Lidos already look for the wave machine; Spas for nothing.
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, verified_places, first_seen, active_since) values
               ('fb2-pools', 'fb2-wave', 'active', 2, now(), now()), ('fb2-pools', 'fb2-sauna', 'active', 2, now(), now()),
               ('fb2-lidos', 'fb2-wave', 'gathering', 0, now(), null)`);
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values
               ('fb2:1', 'fb2-wave', 'yes', true, 'osm'), ('fb2:2', 'fb2-wave', 'yes', true, 'osm'),
               ('fb2:1', 'fb2-sauna', 'yes', true, 'site'), ('fb2:2', 'fb2-sauna', 'yes', true, 'site'),
               ('fb2:1', 'toilets', 'yes', true, 'osm'), ('fb2:2', 'toilets', 'no', false, 'osm'),
               ('fb2:1', 'indoor', 'yes', true, 'osm'), ('fb2:2', 'indoor', 'yes', true, 'site')`);
  settings.forget();
}

test('undoing a correction deletes the accuracy row it wrote', async () => {
  await seed();
  const change = await facts.correct({ ref: 'fb2:1', fact: 'fb2-wave', option: 'no', who: WHO });
  const { rows: before } = await query(`select id from fact_corrections where venue_ref = 'fb2:1' and attribute_key = 'fb2-wave'`);
  assert.equal(before.length, 1);
  const { rows: [row] } = await query('select * from bo_changes where id = $1', [change.id]);
  assert.equal(row.undo.correctionId, before[0].id, 'the undo carries the row it wrote');
  await facts.undoCorrection({ change: row, who: WHO });
  const { rows: after } = await query(`select id from fact_corrections where venue_ref = 'fb2:1' and attribute_key = 'fb2-wave'`);
  assert.equal(after.length, 0);
});

test('a change logged before the id was kept still takes its own row, and only its own', async () => {
  await seed();
  const first = await facts.correct({ ref: 'fb2:2', fact: 'fb2-wave', option: 'no', who: WHO });
  const second = await facts.correct({ ref: 'fb2:2', fact: 'fb2-wave', option: 'yes', who: WHO });
  const { rows: [row] } = await query('select * from bo_changes where id = $1', [second.id]);
  delete row.undo.correctionId;
  await facts.undoCorrection({ change: row, who: WHO });
  const { rows } = await query(`select answer from fact_corrections where venue_ref = 'fb2:2' and attribute_key = 'fb2-wave'`);
  assert.deepEqual(rows.map((r) => r.answer), ['no'], 'the first correction stands');
  assert.ok(first.id);
});

test('a source Failing for checking nothing while others did says that, not "nothing can fail"', async () => {
  await seed();
  await query(`delete from place_fact_evidence`);
  await query(`insert into place_fact_evidence (venue_ref, attribute_key, source, says) values ('fb2:1', 'fb2-wave', 'osm', 'yes')`);
  const cfg = (await settings.settings()).values;
  const rows = await verification.sources(cfg);
  const wiki = rows.find((r) => r.source === 'wikipedia');
  assert.equal(wiki.status, 'Failing');
  assert.equal(wiki.failingWhy, 'Checked nothing this week while others did');
  const osm = rows.find((r) => r.source === 'osm');
  assert.equal(osm.status, 'Healthy');
  assert.match(osm.failingWhy, /nothing fetched/);
});

test('an empty backlog with no check for longer than the stall window is idle, not running', async () => {
  await query('delete from fact_suggestions');
  await query('delete from fact_checks');
  await query(`insert into fact_checks (venue_ref, feature, outcome, at) values ('fb2:1', 'Wave machine', 'verified', now() - interval '5 hours')`);
  assert.equal((await verification.status()).state, 'idle');
  await query(`insert into fact_suggestions (venue_ref, feature, first_seen) values ('fb2:1', 'Sauna', now() - interval '6 hours')`);
  assert.equal((await verification.status()).state, 'stalled');
  await query('delete from fact_suggestions');
  await query(`insert into fact_checks (venue_ref, feature, outcome) values ('fb2:2', 'Wave machine', 'verified')`);
  assert.equal((await verification.status()).state, 'running');
});

test('an unset default speaks from its evidence: none, mixed, or of one mind', async () => {
  await seed();
  const page = await categories.subcategoryPage('fb2-pools');
  const basis = (k) => page.defaults.find((d) => d.fact === k).basis;
  assert.equal(basis('parking'), 'No confirmed places yet');
  assert.equal(basis('toilets'), 'The places disagree, so each answers for itself');
  assert.equal(basis('indoor'), '2 confirmed places say Yes · not proposed yet');
});

test('a single default, a one-tick bulk Set and an accept are logged in the prototype\'s words', async () => {
  await seed();
  const one = await categories.setDefaults({ subs: ['fb2-pools'], fact: 'parking', option: 'yes', who: WHO });
  let { rows: [row] } = await query('select * from bo_changes where id = $1', [one.changes[0].id]);
  assert.equal(row.what, 'Default · Parking · Pools');

  const bulk = await categories.setDefaults({ subs: ['fb2-lidos'], fact: 'parking', option: 'no', who: WHO, bulk: true });
  ({ rows: [row] } = await query('select * from bo_changes where id = $1', [bulk.changes[0].id]));
  assert.equal(row.what, 'Default set · Parking on 1 subcategory · Lidos');
  assert.match(row.why, /^Applies to \d+ places without their own answer · \d+ keep their own$/);
  await categories.undoDefault({ change: row, who: WHO });
  const { rows: gone } = await query(`select 1 from shelf_subcategory_attributes where subcategory_key = 'fb2-lidos' and attribute_key = 'parking'`);
  assert.equal(gone.length, 0, 'one Undo puts the one-tick Set back');

  await query(`insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, origin, settled) values ('fb2-spas', 'toilets', true, 'machine', false)`);
  const acc = await categories.acceptDefault({ sub: 'fb2-spas', fact: 'toilets', who: WHO });
  ({ rows: [row] } = await query('select * from bo_changes where id = $1', [acc.id]));
  assert.equal(row.what, 'Default accepted · Toilets · Spas');
  assert.equal(row.before, 'Proposed');
  assert.equal(row.after, 'Yes');
});

test('Copy facts lists only subcategories with something new to copy', async () => {
  await seed();
  const lidos = await categories.subcategoryPage('fb2-lidos');
  assert.deepEqual(lidos.copyFrom.map((o) => [o.key, o.n]), [['fb2-pools', 1]], 'the wave machine is already here; the sauna is new');
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, verified_places, first_seen) values ('fb2-lidos', 'fb2-sauna', 'ignored', 0, now())`);
  const again = await categories.subcategoryPage('fb2-lidos');
  assert.deepEqual(again.copyFrom.filter((o) => o.key.startsWith('fb2-')), [], 'a removed fact is not copied back, so Pools has nothing new');
  const spas = await categories.subcategoryPage('fb2-spas');
  assert.deepEqual(spas.copyFrom.filter((o) => o.key.startsWith('fb2-')).map((o) => [o.key, o.n]), [['fb2-pools', 2]]);
});
