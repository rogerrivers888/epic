import { test } from 'node:test';
import assert from 'node:assert/strict';

// Codex on round 3 (29 Sep 2026): a second asker's callback is kept, and a
// machine link that loses its last confirmed place is kept on record.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const own = await import('../src/sources/own.js');
const pipeline = await import('../src/desk/pipeline.js');
const settings = await import('../src/desk/settings.js');

test.after(() => pool.end());

test('two askers of one waiting job are both told when it lands, once each', () => {
  const said = [];
  const both = own.chainDone((o) => said.push(['a', o]), (o) => said.push(['b', o]));
  both(1);
  assert.deepEqual(said, [['a', 1], ['b', 1]]);
  const f = () => {};
  assert.equal(own.chainDone(f, f), f, 'the same callback is not run twice');
  assert.equal(own.chainDone(undefined, f), f);
  const throwing = own.chainDone(() => { throw new Error('x'); }, (o) => said.push(['c', o]));
  throwing(2);
  assert.deepEqual(said.at(-1), ['c', 2], 'one failing does not stop the other');
});

test('a machine link with no confirmed place left is detached and kept on record, so it is still asked', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values ('fun', 'r3c-sub', 'R3C', 1) on conflict (key) do update set active = true`);
  await query(`insert into place_attributes (key, label, kind, active, standard) values ('r3c-fact', 'Zip wire', 'yesno', true, false)
               on conflict (key) do update set active = true, standard = false`);
  await query(`delete from subcategory_facts where attribute_key = 'r3c-fact'`);
  await query(`delete from subcategory_facts_detached where attribute_key = 'r3c-fact'`);
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, verified_places) values ('r3c-sub', 'r3c-fact', 'gathering', 1)`);
  settings.forget();
  await pipeline.add();
  const { rows: live } = await query(`select 1 from subcategory_facts where attribute_key = 'r3c-fact'`);
  assert.equal(live.length, 0, 'detached');
  const { rows: [kept] } = await query(`select subcategory_key, status, why from subcategory_facts_detached where attribute_key = 'r3c-fact'`);
  assert.equal(kept.subcategory_key, 'r3c-sub');
  assert.equal(kept.status, 'gathering');
  assert.match(kept.why, /pipeline\.add/);
});
