/**
 * The sweep's lock on an area (migration 093).
 *
 * `markSweeping` used to be a one-way door: it set state='sweeping' and only a
 * sweep that reached its end ever cleared it. A sweep that threw — a source
 * erroring, a deploy landing mid-run — left its area locked, and neither the
 * loop nor the owner could sweep that code again. BS48 went that way during
 * the Bristol sweep on 13 September 2026 and could not be retried at all.
 *
 * What has to hold: one sweep at a time, an abandoned lock is taken back, and
 * finishing hands the area over cleanly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query } = await testDatabase();
const scout = await import('../src/repositories/scout.js');

const CODE = 'ZZ9';

async function anArea() {
  await query('delete from scout_areas where code = $1', [CODE]);
  await query(
    `insert into scout_areas (code, label, lat, lng, radius_km, keep, state)
     values ($1, 'Nowhere', 51.5, -0.1, 2.5, 25, 'pending')`,
    [CODE],
  );
}
const stateOf = async () => (await query('select state, sweeping_since from scout_areas where code = $1', [CODE])).rows[0];

test('one sweep at a time: the second caller is turned away', async () => {
  await anArea();
  assert.equal(await scout.markSweeping(CODE), true);
  assert.equal(await scout.markSweeping(CODE), false, 'a running sweep must not be joined');
  const row = await stateOf();
  assert.equal(row.state, 'sweeping');
  assert.ok(row.sweeping_since, 'the lock records when it was taken');
});

test('a lock nobody released is taken back, so the area is never lost', async () => {
  await anArea();
  assert.equal(await scout.markSweeping(CODE), true);
  // The sweep died here: no finishSweep, no release.
  await query(
    `update scout_areas set sweeping_since = now() - ($2 || ' minutes')::interval where code = $1`,
    [CODE, String(scout.SWEEP_LOCK_MINUTES + 1)],
  );
  assert.equal(await scout.markSweeping(CODE), true, 'an abandoned lock must be takeable');
});

test('a lock that is merely old-ish is still somebody else’s', async () => {
  await anArea();
  await scout.markSweeping(CODE);
  await query(
    `update scout_areas set sweeping_since = now() - ($2 || ' minutes')::interval where code = $1`,
    [CODE, String(scout.SWEEP_LOCK_MINUTES - 1)],
  );
  assert.equal(await scout.markSweeping(CODE), false);
});

test('finishing hands the area back, and the next sweep may take it', async () => {
  await anArea();
  await scout.markSweeping(CODE);
  await scout.finishSweep(CODE, { state: 'done', why: null, seen: 10, chains: 1, kept: 5, nextSweepAt: new Date() });
  const row = await stateOf();
  assert.equal(row.state, 'done');
  assert.equal(row.sweeping_since, null, 'the lock is let go on the way out');
  assert.equal(await scout.markSweeping(CODE), true);
  await query('delete from scout_areas where code = $1', [CODE]);
});
