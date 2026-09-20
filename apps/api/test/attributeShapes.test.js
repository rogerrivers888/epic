/**
 * Every value is the shape its label is — including the fourth shape.
 *
 * Migration 132 put that rule in the database rather than in whoever happened
 * to be writing, and 135 added a row lock so a value write and a definition
 * change could not each commit against the other's "before". Migration 216 then
 * added the `scale` kind by rewriting the trigger *from 132's text* — and
 * silently reverted 135's lock, because a `create or replace` of a function
 * somebody else has amended is a revert wearing the clothes of an addition
 * (Codex, 20 Sep 2026). 218 put it back.
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
  // And it still knows about all four shapes, so nobody can restore the lock
  // by putting 135's body back and losing the scale.
  for (const kind of ['yesno', 'range', 'oneof', 'scale']) {
    assert.match(rows[0].src, new RegExp(`'${kind}'`), `the trigger still knows ${kind}`);
  }
});

test('the eight are a scale, nought to four, and the ends are the database’s to keep', async () => {
  const sub = await aDrawer();
  const { rows } = await query(
    "select key, range_min, range_max from place_attributes where kind = 'scale' order by position");
  assert.equal(rows.length, 8, 'there are eight of them');
  for (const a of rows) {
    assert.equal(a.range_min, 0);
    assert.equal(a.range_max, 4);
  }

  // Nought is a value, and the one most likely to be dropped by a falsy check.
  await query(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, level) values ($1, 'how-thrilling', 0)
     on conflict (subcategory_key, attribute_key) do update set level = excluded.level`, [sub]);
  const { rows: zero } = await query(
    'select level from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2',
    [sub, 'how-thrilling']);
  assert.equal(zero[0].level, 0);

  await fails(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, level) values ($1, 'how-smart', 5)`,
    [sub], /runs up to 4/);
  await fails(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, level) values ($1, 'how-smart', -1)`,
    [sub], /runs from 0 upwards/);
  await fails(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno) values ($1, 'how-smart', true)`,
    [sub], /is a scale/);
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
});

test('a default arrives proposed, and everything written before the column existed is settled', async () => {
  const sub = await aDrawer();
  await query(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, level) values ($1, 'how-new', 2)
     on conflict (subcategory_key, attribute_key) do update set level = excluded.level, settled = false`, [sub]);
  const { rows } = await query(
    'select settled from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2',
    [sub, 'how-new']);
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
