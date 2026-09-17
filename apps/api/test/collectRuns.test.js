/**
 * A collection run has to survive the process that started it.
 *
 * Collect answers the request at once and then works through a list of places.
 * That used to happen in a detached promise, so a deploy in the middle lost the
 * rest of the list without anybody being told — and because nothing recorded
 * that a run had been going, the Runs board could not say so either (Codex,
 * 17 Sep 2026). What is held here is that the list lives in the row: a place
 * leaves it once it has been asked, so resuming never pays twice.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const runs = await import('../src/repositories/collectRuns.js');

test.after(() => pool.end());

test('what is left is on the row, so nothing is asked twice', async () => {
  const run = await runs.start({
    whereLabel: 'Berkshire', scope: { kind: 'area', slug: 'berkshire' }, sources: ['own', 'google'],
    todo: { free: ['a', 'b', 'c'], google: ['a', 'b'], tripadvisor: [] },
  });
  assert.equal(run.state, 'running');

  const after = await runs.advance(run.id, 'google', ['a'], { done: 1, spentPence: 1 });
  assert.deepEqual(after.todo.google, ['b'], 'the one that was asked came off the list');
  assert.deepEqual(after.todo.free, ['a', 'b', 'c'], 'and only that list changed');
  assert.equal(after.done.google, 1);
  assert.equal(after.spent_pence, 1);

  // A run that stops here loses nothing: `b` is still on the row to be asked.
  const again = await runs.advance(run.id, 'google', ['b'], { done: 0, refused: [{ ref: 'b', why: 'no match' }] });
  assert.deepEqual(again.todo.google, []);
  assert.equal(again.refused.length, 1);
});

test('a run untouched for ten minutes is stranded, and a slow one is not', async () => {
  const slow = await runs.start({ whereLabel: 'Slow', scope: {}, sources: [], todo: { free: ['x'] } });
  assert.equal((await runs.stranded()).find((r) => r.id === slow.id), undefined,
    'a run being worked on right now is not stranded');

  await query(`update collect_runs set touched_at = now() - interval '20 minutes' where id = $1`, [slow.id]);
  assert.ok((await runs.stranded()).some((r) => r.id === slow.id), 'a deploy took it, and the board says so');

  await runs.finish(slow.id);
  assert.equal((await runs.stranded()).find((r) => r.id === slow.id), undefined,
    'a finished run is never picked up again');
});

test('the board reads the last run, and counts what is left', async () => {
  const run = await runs.start({
    whereLabel: 'Windsor', scope: {}, sources: ['google'], todo: { free: [], google: ['a', 'b', 'c'] },
  });
  await runs.advance(run.id, 'google', ['a'], { done: 1, spentPence: 2 });
  const latest = await runs.latest();
  assert.equal(latest.id, run.id);
  assert.equal(latest.asked, 1);
  assert.equal(latest.left, 2);
  assert.equal(latest.spentPence, 2);
  assert.equal(latest.state, 'running');

  await runs.fail(run.id, 'Google fell over');
  assert.equal((await runs.latest()).state, 'failed');
  // A failed run is not silently retried: the board asks somebody to look.
  assert.equal(await runs.finish(run.id), null);
});

test('two instances cannot both pick up the same interrupted run', async () => {
  const run = await runs.start({ whereLabel: 'Contested', scope: {}, sources: ['google'], todo: { google: ['a', 'b'] } });
  await query(`update collect_runs set touched_at = now() - interval '20 minutes' where id = $1`, [run.id]);

  // Both instances read it before, and both started a worker — each about to
  // make the same paid calls (Codex, 17 Sep 2026). The claim and the selection
  // are one statement now.
  const [first, second] = await Promise.all([runs.claimStranded(), runs.claimStranded()]);
  const got = [...first, ...second].filter((r) => r.id === run.id);
  assert.equal(got.length, 1, 'exactly one of them gets it');

  // And it is not offered again until it goes quiet once more.
  assert.equal((await runs.claimStranded()).find((r) => r.id === run.id), undefined);
});
