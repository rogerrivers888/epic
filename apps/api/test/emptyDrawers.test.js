/**
 * No active drawer is silently unaskable — migrations 233 and 234.
 *
 * The census asks one Text Search per Google type inside each subcategory, so a
 * drawer with no vocabulary generates **no queries at all** and comes back
 * nought. Nought is indistinguishable from "there are none in the south of
 * England", and for a climbing wall that is plainly false.
 *
 * That makes this the one mapping mistake that cannot be corrected afterwards:
 * every place the census would have found has to be found again, at the cost of
 * the whole run. So it is pinned here rather than left to be noticed — a rule
 * deleted in the back office six months from now would otherwise put a drawer
 * back to zero with nothing to say so.
 *
 * It reads the census's own plan rather than counting rules, because the plan is
 * what actually decides what gets asked: a drawer can be askable through a
 * `labels` rule carrying a Google type, or through a word-question fencing a
 * broader type, and either is enough. Counting rules would pass drawers the
 * census cannot ask about and fail ones it can.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { slicePlan } = await import('../src/sources/census.js');

test.after(() => pool.end());

/** The five section 4 named, by the key the taxonomy holds them under. */
const THE_FIVE = ['climbing', 'paddling', 'flying', 'ropes', 'watersports'];

test('every one of the five empty drawers can be asked about', async () => {
  {
    const plan = await slicePlan({ subcategories: THE_FIVE });
    const rows = plan.plan ?? plan;
    const byKey = new Map(rows.map((r) => [r.subcategory, r]));

    for (const key of THE_FIVE) {
      const row = byKey.get(key);
      assert.ok(row, `${key} generates no census questions at all, so it will come back nought`);
      assert.ok(row.questions.length > 0, `${key} has an empty question list`);
    }
  }
});

test('High ropes & zip lines has a real type, not only words', async () => {
  {
    const rows = (await slicePlan({ subcategories: ['ropes'] }));
    const ropes = (rows.plan ?? rows)[0];
    // A word-question fences a broad type with words and can miss a place
    // whose name says nothing — a Go Ape typed `adventure_sports_center` and
    // called "Zip World" is found by the type and not by "high ropes course".
    const typed = ropes.questions.filter((q) => q.sourced === 'type');
    assert.ok(typed.length > 0, 'ropes has no typed question, only words');
    assert.ok(typed.some((q) => q.type === 'adventure_sports_center'));
  }
});

test('a word that files places is never also answered Not in Epic', async () => {
  {
    // Flying carried three `labels` rules filing places into it while the same
    // three words were answered `aside`. Both were true in the tables and they
    // cannot both be true on a screen: Mapping would have shown them excluded
    // while places went on arriving in the drawer behind them.
    const { rows } = await query(
      `select l.namespace || ':' || l.key as word, l.decision, r.subcategory
         from taxonomy_labels l
         join shelf_rules r
           on r.scope = 'labels'
          and r.subcategory is not null
          and (l.namespace || ':' || l.key) = any(r.labels)
        where l.decision = 'aside'`);
    assert.deepEqual(rows, [],
      `these words are excluded and filing at the same time: ${rows.map((r) => `${r.word} → ${r.subcategory}`).join(', ')}`);
  }
});

test('the three Google has no word for are asked in words, and say so', async () => {
  {
    const rows = await slicePlan({ subcategories: ['climbing', 'paddling', 'watersports'] });
    for (const row of (rows.plan ?? rows)) {
      // Table A holds no climbing, rowing, sailing or wakeboarding word, so
      // every question for these three narrows a broader type with words. The
      // count that comes back carries that on its own row, which is what makes
      // it auditable rather than invented.
      assert.ok(row.questions.every((q) => q.sourced !== 'type'),
        `${row.subcategory} claims a typed question, but Google has no word for it`);
      assert.ok(row.questions.every((q) => q.words),
        `${row.subcategory} has a question with no words to narrow it`);
    }
  }
});

test('a word that points at a drawer is never switched off', async () => {
  // Answering a word `aside` switches it off as well as answering it, so
  // clearing the decision alone leaves it mapped *and* inactive — and every
  // consumer that filters on `active`, the audit included, goes on skipping
  // it. The two fields have to move together, or they contradict each other
  // in a new way (Codex, 21 Sep 2026, on migration 234).
  const { rows } = await query(
    `select namespace || ':' || key as word, points_at
       from taxonomy_labels
      where points_at is not null and active = false`);
  assert.deepEqual(rows, [],
    `these words file places while switched off: ${rows.map((r) => `${r.word} → ${r.points_at}`).join(', ')}`);
});

test('every drawer the five file into exists and is active', async () => {
  // A rule pointing at a drawer that is gone, or switched off, files places
  // nowhere a household can reach — and the census would still spend requests
  // asking about it.
  const { rows } = await query(
    `select distinct r.subcategory
       from shelf_rules r
       left join shelf_subcategories s on s.key = r.subcategory
      where r.subcategory = any($1)
        and (s.key is null or not s.active)`, [THE_FIVE]);
  assert.deepEqual(rows, []);
});

test('the five are answered on a database built only from migrations', async () => {
  // The test database is exactly that case, and it is the one 234 got wrong:
  // an `update` against a vocabulary that boot has not written yet matches
  // nothing, and the deployment ends up filing places into drawers it still
  // calls undecided.
  const { rows } = await query(
    `select namespace || ':' || key as word, points_at, active
       from taxonomy_labels
      where points_at = any($1) order by 1`, [['ropes', 'flying']]);
  assert.equal(rows.length, 5, 'the five words are not all answered on a fresh database');
  assert.ok(rows.every((r) => r.active), 'a word is answered but switched off');
});
