/**
 * The axes are dropped (25 Sep 2026), as the database and the rows see it.
 *
 * Migration 246 in four facts: a ninth category exists; Duration and Cost
 * band exist, are asked of every place, and carry proposed defaults; the
 * eight graded axes are off and nothing new is written under them; and every
 * row whose rule named one is off, with the one rule the design brief states
 * outright rewritten. Pinned against the built database rather than the
 * migration file, because the file is what somebody edits and the database is
 * what a deploy has.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const browseRows = await import('../src/repositories/browseRows.js');

test.after(() => pool.end());

test('Educational is a ninth category, seeded and live', async () => {
  const { rows } = await query("select label, icon, active, seeded from shelf_categories where key = 'educational'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Educational');
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].seeded, true);
});

test('Duration and Cost band are labels, asked of every place, with the shapes the brief gives them', async () => {
  const { rows } = await query(
    "select key, kind, options, range_min, range_max, unit, active from place_attributes where key in ('duration', 'cost-band') order by key");
  assert.equal(rows.length, 2);
  const [cost, duration] = rows;
  assert.equal(duration.kind, 'range');
  assert.equal(duration.unit, 'minutes');
  assert.equal(cost.kind, 'oneof');
  assert.deepEqual(cost.options, ['free', 'cheap', 'moderate', 'expensive']);
  for (const a of rows) assert.equal(a.active, true);

  const { rows: asked } = await query(
    "select attribute_key from questions where scope = 'global' and attribute_key in ('duration', 'cost-band') order by 1");
  assert.deepEqual(asked.map((q) => q.attribute_key), ['cost-band', 'duration']);
});

test('the defaults arrive proposed, banded from typical minutes, and a quick stop gets none', async () => {
  const { rows } = await query(
    `select s.key, s.typical_minutes, d.from_value, d.to_value, d.settled
       from shelf_subcategories s
       left join shelf_subcategory_attributes d on d.subcategory_key = s.key and d.attribute_key = 'duration'
      where s.key in ('theme-parks', 'museums', 'parks', 'fast-food', 'zoos-wildlife')`);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  // A day out: 300 minutes is all day.
  assert.deepEqual([by['theme-parks'].from_value, by['theme-parks'].to_value], [300, 480]);
  // A couple of hours is the two-to-three band.
  assert.deepEqual([by.museums.from_value, by.museums.to_value], [120, 180]);
  // An hour and a half is roughly an hour.
  assert.deepEqual([by.parks.from_value, by.parks.to_value], [45, 90]);
  // Most of a day is half a day.
  assert.deepEqual([by['zoos-wildlife'].from_value, by['zoos-wildlife'].to_value], [180, 300]);
  // A takeaway is a twenty-minute stop, and the four bands do not describe one:
  // no default, which is a gap the sweep fills rather than a number that is wrong.
  assert.equal(by['fast-food'].from_value, null);
  // Every one written is proposed, not set: nobody has agreed to it.
  for (const r of rows) if (r.from_value != null) assert.equal(r.settled, false, `${r.key} is proposed`);

  const { rows: free } = await query(
    "select subcategory_key, choice, settled from shelf_subcategory_attributes where attribute_key = 'cost-band' order by 1");
  assert.ok(free.some((r) => r.subcategory_key === 'parks' && r.choice === 'free'));
  assert.ok(!free.some((r) => r.subcategory_key === 'theme-parks'), 'anything with a gate is left for the sweep');
  for (const r of free) assert.equal(r.settled, false);
});

test('every row whose rule named an axis is off, and Bring the grandparents has the brief’s rule', async () => {
  const { rows } = await query('select key, active, predicate from browse_rows order by position');
  const axis = /"(how-thrilling|how-much-walking|how-much-planning|how-new|how-busy-and-loud|how-much-you-learn|how-smart|how-long-a-day)"/;
  for (const r of rows) {
    if (axis.test(JSON.stringify(r.predicate))) assert.equal(r.active, false, `${r.key} names an axis and is off`);
  }
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.grandparents.active, true);
  assert.deepEqual(by.grandparents.predicate, {
    all: [
      { attribute: 'step-free', yes: true },
      { attribute: 'parking', yes: true },
      { attribute: 'toilets', yes: true },
    ],
  });
  // The phase-one rows that never needed an axis are still on.
  for (const key of ['toddler', 'little', 'older', 'teen', 'raining', 'dog', 'goingout']) {
    assert.equal(by[key].active, true, `${key} is on`);
  }
  // And the ones waiting on the Rows work are off with their rule kept, so
  // the rewrite can read what was meant.
  assert.equal(by.wearout.active, false);
  assert.equal(by.wearout.predicate.all[0].attribute, 'how-much-walking');
  // Only the live rows are what a household could be shown.
  const live = await browseRows.rows();
  assert.ok(live.every((r) => r.active));
  assert.ok(!live.some((r) => r.key === 'wearout'));
});

test('a row cannot be saved against a retired label, and the reason names it', async () => {
  const ctx = await browseRows.pool();
  const context = {
    attributes: ctx.attributes,
    subcategories: new Set(ctx.subcategories.keys()),
    categories: new Set(ctx.categories.map((c) => c.key)),
  };
  await assert.rejects(
    () => browseRows.save('wearout', { predicate: { all: [{ attribute: 'how-much-walking', atLeast: 3 }] } }, context),
    /How much walking was one of the graded axes, which are gone/);
  // The one the rewrite would write instead goes through.
  const saved = await browseRows.save('wearout', {
    predicate: { all: [{ attribute: 'duration', from: 180 }, { attribute: 'indoor', yes: false }] },
  }, context);
  assert.equal(saved.seeded, false);
  // A row still carrying an axis rule says why it is empty, by name.
  const { rows: [quiet] } = await query("select * from browse_rows where key = 'quiet'");
  assert.match(browseRows.emptyBecause(quiet, ctx), /how busy and loud, how much planning are retired/);
});
