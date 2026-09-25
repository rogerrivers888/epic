/**
 * Every value is the shape its label is.
 *
 * Migration 132 put that rule in the database rather than in whoever happened
 * to be writing, and 135 added a row lock so a value write and a definition
 * change could not each commit against the other's "before". Migration 216
 * then added the `scale` kind by rewriting the trigger *from 132's text* — and
 * silently reverted 135's lock, because a `create or replace` of a function
 * somebody else has amended is a revert wearing the clothes of an addition
 * (Codex, 20 Sep 2026). 218 put it back.
 *
 * Migration 246 then retired the scale kind's only members — the eight graded
 * axes — without touching the trigger: deactivated, never deleted, so a row
 * that exists stays valid and nothing new can be written under it.
 *
 * So this pins both halves against the live definition, not against a
 * migration file: the shapes it enforces, and the lock it takes to enforce
 * them. The next person to extend this trigger will break one of these rather
 * than production.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
// After `testDatabase`, so the repository's own pool is the test database's.
const placeAttributes = await import('../src/repositories/placeAttributes.js');

test.after(() => pool.end());

/** A drawer to hang values on, made once. */
const aDrawer = async () => {
  await query(`insert into shelf_categories (key, label) values ('t-cat', 'Testing')
               on conflict (key) do nothing`);
  await query(`insert into shelf_subcategories (key, category_key, label) values ('t-sub', 't-cat', 'Test drawer')
               on conflict (key) do nothing`);
  return 't-sub';
};

const fails = async (sql, params, matching) => {
  await assert.rejects(() => query(sql, params), (err) => {
    assert.match(err.message, matching);
    // 22023 is "invalid parameter value" — what the trigger raises, as opposed
    // to a constraint violation or a type error, which would mean the trigger
    // never ran and something else caught it by accident.
    assert.equal(err.code, '22023');
    return true;
  });
};

test('the trigger reads the label with a lock, so a shape cannot change under a value', async () => {
  const { rows } = await query(
    "select pg_get_functiondef(oid) as src from pg_proc where proname = 'attribute_value_kind'");
  assert.equal(rows.length, 1, 'there is exactly one value-shape trigger function');
  // The whole point of 135, and the thing 216 lost. Asserted against the live
  // definition because that is the only place the truth is.
  assert.match(rows[0].src, /for share/i,
    'the definition read must take the row for share (migration 135)');
  // And it still knows about all four shapes — the fourth for the rows the
  // retired axes left behind, which stay valid rather than being deleted.
  for (const kind of ['yesno', 'range', 'oneof', 'scale']) {
    assert.match(rows[0].src, new RegExp(`'${kind}'`), `the trigger still knows ${kind}`);
  }
});

test('the eight graded axes are retired: switched off, their rows kept, nothing new written', async () => {
  const sub = await aDrawer();
  const { rows } = await query(
    "select key, active from place_attributes where kind = 'scale' order by position");
  assert.equal(rows.length, 8, 'the eight are still in the vocabulary, so what was written against them can be read');
  for (const a of rows) assert.equal(a.active, false, `${a.key} is off`);

  // The database still accepts a row of that shape — a retirement that broke a
  // place would not be a retirement — but the API refuses to write one.
  await query(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, level) values ($1, 'how-thrilling', 0)
     on conflict (subcategory_key, attribute_key) do update set level = excluded.level`, [sub]);
  await assert.rejects(
    () => placeAttributes.setDefault(sub, 'how-thrilling', { level: 2 }),
    /was one of the graded axes, which are gone/);
  await assert.rejects(
    () => placeAttributes.setValue('atlas:1', 'how-thrilling', { level: 2 }),
    /was one of the graded axes, which are gone/);
  // And a level on a live label is not a shape any more, whatever the label.
  await assert.rejects(
    () => placeAttributes.setDefault(sub, 'parking', { level: 2 }),
    /is not a graded scale. Nothing is/);
  // A row under a retired label reads as nothing said: the vocabulary does not
  // hand back a value nobody may be shown.
  const { bySubcategory } = await placeAttributes.attributes();
  assert.equal(bySubcategory.get(sub)?.get('how-thrilling'), undefined);
});

test('no new graded scale can be made, by any name', async () => {
  await assert.rejects(
    () => placeAttributes.saveAttribute({ label: 'How exciting', kind: 'scale', rangeMin: 0, rangeMax: 4 }),
    /A graded scale is not a kind of label any more/);
  const { rows } = await query("select 1 from place_attributes where key = 'how-exciting'");
  assert.equal(rows.length, 0);
});

test('a shape cannot be worn by a label that is not it, in either direction', async () => {
  const sub = await aDrawer();
  // A level on a yes/no.
  await fails(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, level) values ($1, 'parking', 2)`,
    [sub], /Parking is a yes or no/);
  // A yes on a range.
  await fails(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno) values ($1, 'suits-ages', true)`,
    [sub], /is a range/);
  // A choice off the list, on the cost band.
  await fails(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, choice) values ($1, 'cost-band', 'ruinous')`,
    [sub], /is not one of Cost band/);
});

test('a default arrives proposed, and everything written before the column existed is settled', async () => {
  const sub = await aDrawer();
  await query(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, choice) values ($1, 'cost-band', 'cheap')
     on conflict (subcategory_key, attribute_key) do update set choice = excluded.choice, settled = false`, [sub]);
  const { rows } = await query(
    'select settled from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2',
    [sub, 'cost-band']);
  // The screen draws this as an outline rather than a fill: nobody has agreed
  // to it yet.
  assert.equal(rows[0].settled, false);
});

test('dog friendly is one of our labels, because the drawing asks a place about dogs', async () => {
  const { rows } = await query("select kind from place_attributes where key = 'dog-friendly'");
  assert.equal(rows[0]?.kind, 'yesno');
  // And it cannot be raised again as a new word by the harvest.
  const { rows: alias } = await query(
    "select target_key from attribute_aliases where norm in ('dog friendly', 'dogs allowed', 'dogs welcome')");
  assert.equal(alias.length, 3);
  for (const a of alias) assert.equal(a.target_key, 'dog-friendly');
});


test('Accept succeeds on a row written before the shapes were enforced', async () => {
  const sub = await aDrawer();
  // A range under a yes/no label — the shape the table can still hold because
  // it predates migration 132's trigger. Written with the trigger off, which
  // is the only way to create one now and is exactly how the real ones got in.
  await query('alter table shelf_subcategory_attributes disable trigger shelf_subcategory_attributes_kind');
  await query(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, from_value, to_value, settled)
     values ($1, 'toilets', 0, 7, false)
     on conflict (subcategory_key, attribute_key) do update
        set from_value = 0, to_value = 7, yesno = null, settled = false`, [sub]);
  await query('alter table shelf_subcategory_attributes enable trigger shelf_subcategory_attributes_kind');

  // Before: the screen offers a proposal, because the stored value is not
  // readable as a yes or no. Accepting it used to be refused by the trigger,
  // which meant the rows that most needed fixing were the ones that could not
  // be (Codex via epic-f4, 20 Sep 2026).
  const value = await placeAttributes.acceptDefault(sub, 'toilets', { yesno: true });
  assert.deepEqual(value, { yesno: true });

  const { rows } = await query(
    'select yesno, from_value, to_value, settled from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2',
    [sub, 'toilets']);
  assert.equal(rows[0].yesno, true);
  assert.equal(rows[0].settled, true);
  // And the range it was wearing is gone, rather than sitting alongside.
  assert.equal(rows[0].from_value, null);
  assert.equal(rows[0].to_value, null);
});

test('Accept settles a good value somebody else set, and does not overwrite it', async () => {
  const sub = await aDrawer();
  await query(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, settled)
     values ($1, 'parking', false, false)
     on conflict (subcategory_key, attribute_key) do update set yesno = false, settled = false`, [sub]);

  // The screen was showing "Yes" when it was rendered; by the time Accept runs
  // somebody has set No. Accept means "the answer that is there is right".
  const value = await placeAttributes.acceptDefault(sub, 'parking', { yesno: true });
  assert.deepEqual(value, { yesno: false });
  const { rows } = await query(
    'select yesno, settled from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2',
    [sub, 'parking']);
  assert.equal(rows[0].yesno, false);
  assert.equal(rows[0].settled, true);
});
