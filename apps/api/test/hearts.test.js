/**
 * A heart belongs to a person, and unhearting has to find that person.
 *
 * Hearting a row is the highest-signal tap in the product and attribution is
 * the whole of its value: the row rises for whoever said yes. So a heart
 * deleted from the wrong person is not a cosmetic fault — the real heart
 * survives, the row keeps rising for somebody who never chose it, and the
 * screen reports success. The user is told the opposite of what happened and
 * the training signal is quietly wrong (owner, 21 Sep 2026).
 *
 * Two faults produced that, and both are pinned here:
 *
 *   · the row carried the owner's *name* and not their id, so a screen with two
 *     members of the same name could aim the delete at either of them;
 *   · `heartsFor` was a Map keyed on `row_key`, so where two people in one
 *     household hearted the same row it kept whichever came back last and the
 *     other was invisible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { testDatabase, aHousehold } from './helpers/db.js';

const { query, pool } = await testDatabase();
const browseRows = await import('../src/repositories/browseRows.js');

test.after(() => pool.end());

/** A household with three members, and one row they can all heart. */
async function aHouseholdOfThree(rowKey) {
  const { household } = await aHousehold(query);
  const names = ['Sarah', 'Tom', 'Sarah'];
  const members = [];
  for (const name of names) {
    const { rows: [m] } = await query(
      'insert into members (household_id, name, is_minor) values ($1, $2, false) returning *',
      [household.id, name]);
    members.push(m);
  }
  await query(
    `insert into browse_rows (key, grouping, title, predicate, position, active, seeded)
     values ($1, 'Test', 'A row to heart', '{"all":[]}'::jsonb, 1, true, false)
     on conflict (key) do nothing`, [rowKey]);
  return { household, members };
}

test('unhearting as somebody who is not the first member takes the right heart', async () => {
  const key = `heart-second-${Math.random().toString(36).slice(2, 8)}`;
  const { household, members } = await aHouseholdOfThree(key);
  const [first, second] = members;

  // The second member hearts it. Nobody else has.
  await browseRows.heart(key, { householdId: household.id, memberId: second.id, on: true });

  const before = await browseRows.heartsFor(household.id);
  assert.equal(before.get(key).length, 1);
  assert.equal(before.get(key)[0].member_id, second.id);

  // Unhearting aimed at the first member — which is what the screen did — must
  // not report success while the real heart survives. Aimed at the owner, it
  // must actually remove it.
  await browseRows.heart(key, { householdId: household.id, memberId: first.id, on: false });
  const stillThere = await browseRows.heartsFor(household.id);
  assert.equal(stillThere.get(key)?.length, 1,
    'deleting the first member’s heart removed somebody else’s');

  await browseRows.heart(key, { householdId: household.id, memberId: second.id, on: false });
  const gone = await browseRows.heartsFor(household.id);
  assert.equal(gone.get(key), undefined);
});

test('two people hearting one row are both kept', async () => {
  // Keyed on `row_key` alone, the second overwrote the first and the screen
  // named one person where two had said yes.
  const key = `heart-both-${Math.random().toString(36).slice(2, 8)}`;
  const { household, members } = await aHouseholdOfThree(key);
  const [first, second] = members;

  await browseRows.heart(key, { householdId: household.id, memberId: first.id, on: true });
  await browseRows.heart(key, { householdId: household.id, memberId: second.id, on: true });

  const hearts = (await browseRows.heartsFor(household.id)).get(key);
  assert.equal(hearts.length, 2);
  assert.deepEqual(new Set(hearts.map((h) => h.member_id)), new Set([first.id, second.id]));
});

test('one person unhearting leaves the other person’s heart alone', async () => {
  const key = `heart-one-of-two-${Math.random().toString(36).slice(2, 8)}`;
  const { household, members } = await aHouseholdOfThree(key);
  const [first, second] = members;

  await browseRows.heart(key, { householdId: household.id, memberId: first.id, on: true });
  await browseRows.heart(key, { householdId: household.id, memberId: second.id, on: true });
  await browseRows.heart(key, { householdId: household.id, memberId: first.id, on: false });

  const left = (await browseRows.heartsFor(household.id)).get(key);
  assert.equal(left.length, 1);
  assert.equal(left[0].member_id, second.id,
    'unhearting one person took the other person’s heart');
});

test('two members of one household may share a name, which is why the id is what travels', async () => {
  // Sarah and Sarah. A screen matching the owner on `heartedBy` would have had
  // to pick one of them, and would have been right half the time.
  const key = `heart-samename-${Math.random().toString(36).slice(2, 8)}`;
  const { household, members } = await aHouseholdOfThree(key);
  const sarahs = members.filter((m) => m.name === 'Sarah');
  assert.equal(sarahs.length, 2);

  await browseRows.heart(key, { householdId: household.id, memberId: sarahs[1].id, on: true });
  const hearts = (await browseRows.heartsFor(household.id)).get(key);
  assert.equal(hearts[0].member_id, sarahs[1].id);
  assert.notEqual(hearts[0].member_id, sarahs[0].id);
});

test('hearts come back oldest first, so who hearted it has a stable answer', async () => {
  const key = `heart-order-${Math.random().toString(36).slice(2, 8)}`;
  const { household, members } = await aHouseholdOfThree(key);
  const [first, second] = members;

  await browseRows.heart(key, { householdId: household.id, memberId: first.id, on: true });
  // A second apart, so the ordering is by time rather than by whatever the
  // planner happened to return.
  await query('update browse_row_hearts set hearted_at = now() - interval \'1 hour\' where member_id = $1',
    [second.id]);
  await browseRows.heart(key, { householdId: household.id, memberId: second.id, on: true });
  await query('update browse_row_hearts set hearted_at = now() - interval \'1 hour\' where member_id = $1',
    [second.id]);

  const hearts = (await browseRows.heartsFor(household.id)).get(key);
  assert.equal(hearts[0].member_id, second.id, 'the older heart is not first');
});

test('a heart cannot be set without saying whose it is', async () => {
  // Hearting with nobody chosen is a question to ask, not a tap to drop.
  const key = `heart-nobody-${Math.random().toString(36).slice(2, 8)}`;
  const { household } = await aHouseholdOfThree(key);
  await assert.rejects(
    () => browseRows.heart(key, { householdId: household.id, memberId: null, on: true }),
    /whose heart/i);
});

// --- a run's middle, written while it runs ---------------------------------

const sets = await import('../src/repositories/questionSets.js');

test('a run in flight records its middle, and a finished one is left alone', async () => {
  // Without this the live panel is seven noughts until the run ends, which is
  // the moment it stops mattering. And a late note must never reopen a run
  // that has already reported: `finishRun` is the last word.
  const { rows: [run] } = await query(
    `insert into vocabulary_runs (kind, subcategories, params) values ('free', '{}', '{}'::jsonb) returning *`);

  await sets.noteRun(run.id, { funnel: { read: 40, raw: 90 }, places: 40, candidates: 7 });
  const { rows: [mid] } = await query('select * from vocabulary_runs where id = $1', [run.id]);
  assert.equal(mid.funnel.read, 40);
  assert.equal(mid.places, 40);

  await sets.finishRun(run.id, { places: 100, candidates: 12, funnel: { read: 100, raw: 260 } });
  await sets.noteRun(run.id, { funnel: { read: 1 }, places: 1, candidates: 1 });

  const { rows: [after] } = await query('select * from vocabulary_runs where id = $1', [run.id]);
  assert.equal(after.places, 100, 'a note after the run finished overwrote its report');
  assert.equal(after.funnel.read, 100);
});
