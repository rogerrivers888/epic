import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mapping on the rebuilt desk (back-office handover, 28 Sep 2026): a fact a
// word carries is part of every decision's before and after, so a picker's
// fact tick is a Repointed decision undone like any other; the Decided view
// lists live decisions only and says which can be undone; a narrowing says
// what it keeps and what leaves.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const mapping = await import('../src/desk/mapping.js');

test.after(() => pool.end());

const WHO = 'test@epic';

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1), ('culture', 'Culture', 2)
               on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('fun', 'dm-water', 'Water parks', 1), ('culture', 'dm-landmarks', 'Landmarks', 2)
               on conflict (key) do update set active = true`);
  await query(`insert into place_attributes (key, label, kind, position, active) values ('dm-slides', 'Has slides', 'yesno', 300, true)
               on conflict (key) do update set active = true, kind = 'yesno'`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values
               ('google', 'dm_water_park', 'water park', 'dm-water', true),
               ('google', 'dm_church', 'church', 'dm-landmarks', true)
               on conflict (namespace, key) do update set points_at = excluded.points_at, decision = null, active = true`);
  await query(`delete from word_targets where word like 'dm_%'`);
  await query(`delete from taxonomy_label_carries where key like 'dm_%'`);
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary) values ('google', 'dm_water_park', 'dm-water', true), ('google', 'dm_church', 'dm-landmarks', true)`);
}

test('a fact ticked in the picker is a Repointed decision, and its undo takes the fact off again', async () => {
  await seed();
  const out = await mapping.setFact({ word: 'dm_water_park', fact: 'dm-slides', on: true, why: 'Added Has slides', who: WHO });
  assert.equal(out.decision.kind, 'Repointed');
  assert.ok(out.change?.id, 'the change id is what the toast undoes');
  let { rows } = await query(`select 1 from taxonomy_label_carries where key = 'dm_water_park' and attribute_key = 'dm-slides'`);
  assert.equal(rows.length, 1);
  const { rows: [t] } = await query(`select subcategory_key from word_targets where word = 'dm_water_park' and is_primary`);
  assert.equal(t.subcategory_key, 'dm-water', 'the subcategories are left as they were');
  const { rows: [ch] } = await query('select after from bo_changes where id = $1', [out.change.id]);
  assert.match(ch.after, /fact: Has slides/);
  await mapping.undo({ id: out.decision.id, who: WHO });
  ({ rows } = await query(`select 1 from taxonomy_label_carries where key = 'dm_water_park' and attribute_key = 'dm-slides'`));
  assert.equal(rows.length, 0);
  await assert.rejects(mapping.setFact({ word: 'dm_water_park', fact: 'no-such-fact', who: WHO }), /not one of our facts/);
});

test('repointing keeps the facts a word carries, and excluding then undoing puts them back', async () => {
  await seed();
  await mapping.setFact({ word: 'dm_church', fact: 'dm-slides', on: true, who: WHO });
  await mapping.setTargets({ word: 'dm_church', subs: ['dm-landmarks', 'dm-water'], who: WHO });
  let { rows } = await query(`select 1 from taxonomy_label_carries where key = 'dm_church'`);
  assert.equal(rows.length, 1, 'a picker edit to subcategories leaves facts alone');
  const ex = await mapping.exclude({ word: 'dm_church', who: WHO });
  await mapping.undo({ id: ex.decision.id, who: WHO });
  ({ rows } = await query(`select 1 from taxonomy_label_carries where key = 'dm_church'`));
  assert.equal(rows.length, 1);
});

test('Decided lists live decisions only, newest first, and marks which one can be undone', async () => {
  await seed();
  const a = await mapping.setTargets({ word: 'dm_water_park', subs: ['dm-landmarks'], why: 'first', who: WHO });
  const b = await mapping.setTargets({ word: 'dm_water_park', subs: ['dm-water'], why: 'second', who: WHO });
  let out = await mapping.decisions({});
  const mine = out.rows.filter((r) => r.word === 'dm_water_park');
  assert.equal(mine[0].id, b.decision.id);
  assert.equal(mine[0].latest, true);
  assert.equal(mine.find((r) => r.id === a.decision.id).latest, false, 'an older decision cannot be undone while a newer stands');
  assert.ok(Number.isInteger(out.total));
  await mapping.undo({ id: b.decision.id, who: WHO });
  out = await mapping.decisions({ kind: 'Repointed' });
  assert.ok(!out.rows.some((r) => r.id === b.decision.id), 'an undone decision leaves Decided');
  assert.equal(out.rows.find((r) => r.id === a.decision.id).latest, true);
  assert.ok(out.rows.every((r) => r.kind === 'Repointed'));
});

test('Keep on a proposal reads "Kept — proposal declined"', async () => {
  await seed();
  await query(`delete from word_proposals where word = 'dm_church'`);
  const { rows: [p] } = await query(
    `insert into word_proposals (word, grp, action, change_to) values ('dm_church', 'not_places', 'exclude', '{"text":"Exclude"}'::jsonb) returning id`);
  const out = await mapping.decideProposal({ id: p.id, action: 'keep', who: WHO });
  assert.equal(out.decision.why, 'Kept — proposal declined');
  await mapping.undo({ id: out.decision.id, who: WHO });
  const { rows: [again] } = await query('select state from word_proposals where id = $1', [p.id]);
  assert.equal(again.state, 'open', 'undo reopens the proposal');
  await query(`delete from word_proposals where word = 'dm_church'`);
});

test('a narrowing counts what it keeps and what would leave Epic', async () => {
  await seed();
  await query(`insert into place_index (venue_ref, subcategory) values ('dm:1', 'dm-landmarks'), ('dm:2', 'dm-landmarks'), ('dm:3', 'dm-landmarks')
               on conflict (venue_ref) do update set subcategory = excluded.subcategory, not_in_epic_at = null`);
  await query(`delete from place_index_labels where venue_ref like 'dm:%'`);
  await query(`insert into place_index_labels (venue_ref, label) values ('dm:1', 'google:dm_church'), ('dm:2', 'google:dm_church'), ('dm:3', 'google:dm_church'), ('dm:3', 'google:dm_water_park')`);
  await query(`insert into place_records (venue_ref, wikidata_id) values ('dm:1', 'Q1') on conflict (venue_ref) do update set wikidata_id = 'Q1'`);
  const n = await mapping.narrowCounts('dm_church', 'encyclopedia_or_listing');
  assert.deepEqual(n, { kept: 1, leave: 1 }, 'dm:3 is carried by another word, so it does not leave');
  assert.equal(await mapping.narrowCounts('dm_church', 'nonsense'), null);
});
