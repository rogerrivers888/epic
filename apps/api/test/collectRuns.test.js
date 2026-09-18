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

test('a chunk comes off the list before the calls go out, not after', async () => {
  const run = await runs.start({
    whereLabel: 'Interruptible', scope: {}, sources: ['google'], todo: { google: ['a', 'b', 'c'] },
  });
  // Taking it off afterwards meant a deploy between the calls and the write
  // left the whole chunk on `todo`, and the resumed run paid for all of it
  // again (Codex, 17 Sep 2026).
  const claimed = await runs.claim(run.id, 'google', ['a', 'b']);
  assert.deepEqual(claimed.todo.google, ['c'], 'off the list');
  assert.deepEqual(claimed.asking.google, ['a', 'b'], 'and still on the row');

  const after = await runs.done(run.id, 'google', { done: 2, spentPence: 3 });
  assert.deepEqual(after.asking.google, []);
  assert.equal(after.done.google, 2);
  assert.equal(after.spent_pence, 3);
});

test('a chunk interrupted mid-call is written off rather than asked again', async () => {
  const run = await runs.start({ whereLabel: 'Cut off', scope: {}, sources: ['google'], todo: { google: ['a', 'b', 'c'] } });
  await runs.claim(run.id, 'google', ['a', 'b']);
  // The process dies here. We cannot know whether those two were billed.

  const back = await runs.abandonInFlight(run.id);
  const inFlight = (r) => Object.values(r.asking ?? {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  assert.equal(inFlight(back), 0, 'nothing is still in flight');
  assert.deepEqual(back.todo.google, ['c'], 'the rest of the list is untouched');
  assert.equal(back.refused.length, 2);
  // The safe direction is not to pay twice: a place we did not ask about is a
  // gap somebody can see, and one we paid for twice is invisible.
  for (const r of back.refused) assert.match(r.why, /avoid paying twice/);

  // And it is safe to call when nothing was in flight.
  const again = await runs.abandonInFlight(run.id);
  assert.equal(again.refused.length, 2);
});

test('two people pressing Collect at once do not pay for the same places twice', async () => {
  // Refs of this test's own, because the runs the earlier tests left going are
  // still going — which is itself the point.
  const [p, q, r] = ['clash:one', 'clash:two', 'clash:three'];
  const run = await runs.start({
    whereLabel: 'Berkshire', scope: {}, sources: ['google'], todo: { google: [p, q, r] },
  });
  // The per-chunk claim bounds the total spend; it cannot tell the money is
  // going twice on one place (Codex, 17 Sep 2026).
  const clash = await runs.alreadyGoing([r, 'clash:nobody']);
  assert.equal(clash.length, 1);
  assert.equal(clash[0].id, run.id);
  assert.equal(clash[0].where_label, 'Berkshire');

  // A place in flight counts as somebody else's work too.
  await runs.claim(run.id, 'google', [p]);
  assert.equal((await runs.alreadyGoing([p])).length, 1, 'in flight is still taken');

  // And nothing overlapping is free to start.
  assert.equal((await runs.alreadyGoing(['clash:free'])).length, 0);

  await runs.finish(run.id);
  assert.equal((await runs.alreadyGoing([p, q, r])).length, 0, 'a finished run holds nothing');
});

test('a second collection going at the same time is not hidden', async () => {
  await query('delete from collect_runs');
  const first = await runs.start({ whereLabel: 'Kent', scope: {}, sources: ['google'], todo: { google: ['a'] } });
  const second = await runs.start({ whereLabel: 'Surrey', scope: {}, sources: ['google'], todo: { google: ['b'] } });

  // The row is the newest — a failed run has to stay on the board until
  // somebody looks — but the other one is still going and still spending, and
  // reading one row alone left it off the board entirely (Codex, 18 Sep 2026).
  const board = await runs.latest();
  assert.equal(board.id, second.id, 'the row is the newest run');
  assert.equal(board.alsoRunning, 1, 'and it says the other one is going too');

  await runs.finish(first.id);
  assert.equal((await runs.latest()).alsoRunning, 0);

  // Stranded counts the same way: untouched for ten minutes while claiming to
  // be going is somebody's job today, whichever run it is.
  const third = await runs.start({ whereLabel: 'Devon', scope: {}, sources: [], todo: { free: ['c'] } });
  await query(`update collect_runs set touched_at = now() - interval '20 minutes' where id = $1`, [second.id]);
  const now = await runs.latest();
  assert.equal(now.id, third.id);
  assert.equal(now.alsoStranded, 1, 'the one a deploy took is counted even though the row is not it');
});

test('a chunk in the air when a run falls over is abandoned in as many words', async () => {
  await query('delete from collect_runs');
  const run = await runs.start({
    whereLabel: 'Dorset', scope: {}, sources: ['google'], todo: { google: ['a', 'b', 'c'] },
  });
  // A chunk is taken off the list before the calls go out, so it sits in the
  // asking list while they are in the air.
  await runs.claim(run.id, 'google', ['a', 'b']);
  const { rows: [mid] } = await query('select asking from collect_runs where id = $1', [run.id]);
  assert.deepEqual(mid.asking.google, ['a', 'b']);

  await runs.fail(run.id, 'Google fell over');
  const { rows: [after] } = await query('select asking, refused from collect_runs where id = $1', [run.id]);

  // The overlap guard only looks at runs that are going, so a chunk left in the
  // asking list by a failure protected nothing: the next Collect started
  // straight over it, and those calls may already have been paid for (Codex,
  // 18 Sep 2026).
  assert.deepEqual(after.asking, {}, 'nothing is left claiming to be in the air');
  assert.deepEqual(after.refused.map((r) => r.ref).sort(), ['a', 'b']);
  assert.match(after.refused[0].why, /not asked again, to avoid paying twice/);
});
