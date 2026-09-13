/**
 * The sweep's lock on an area (migration 093).
 *
 * `markSweeping` used to be a one-way door: it set state='sweeping' and only a
 * sweep that reached its end ever cleared it. A sweep that threw — a source
 * erroring, a deploy landing mid-run — left its area locked, and neither the
 * loop nor the owner could sweep that code again. BS48 went that way during
 * the Bristol sweep on 13 September 2026 and could not be retried at all.
 *
 * What has to hold: one sweep at a time; an abandoned lock is taken back, by
 * the scheduler as well as by name; a sweep that overran cannot clear the lock
 * of whoever replaced it; and a failed sweep does not pass itself off as a
 * completed one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query } = await testDatabase();
const scout = await import('../src/repositories/scout.js');

const CODE = 'ZZ9';

async function anArea({ due = true } = {}) {
  await query('delete from scout_areas where code = $1', [CODE]);
  await query(
    `insert into scout_areas (code, label, lat, lng, radius_km, keep, state, next_sweep_at)
     values ($1, 'Nowhere', 51.5, -0.1, 2.5, 25, 'pending', $2)`,
    [CODE, due ? new Date(Date.now() - 60_000) : null],
  );
}
const rowOf = async () => (await query('select * from scout_areas where code = $1', [CODE])).rows[0];
const ageLock = (minutes) => query(
  `update scout_areas set sweeping_since = clock_timestamp() - ($2 || ' minutes')::interval where code = $1`,
  [CODE, String(minutes)],
);
const isDue = async () => (await scout.dueAreas(50)).some((a) => a.code === CODE);

test('one sweep at a time: the second caller is turned away', async () => {
  await anArea();
  const lease = await scout.markSweeping(CODE);
  assert.ok(lease, 'the first caller gets a lease');
  assert.equal(await scout.markSweeping(CODE), null, 'a running sweep must not be joined');
  const row = await rowOf();
  assert.equal(row.state, 'sweeping');
  assert.ok(row.sweeping_since, 'the lock records when it was taken');
});

test('a lock nobody released is taken back, so the area is never lost', async () => {
  await anArea();
  assert.ok(await scout.markSweeping(CODE));
  // The sweep died here: no finishSweep, no release.
  await ageLock(scout.SWEEP_LOCK_MINUTES + 1);
  assert.ok(await scout.markSweeping(CODE), 'an abandoned lock must be takeable');
});

test('a lock that is merely old-ish is still somebody else’s', async () => {
  await anArea();
  await scout.markSweeping(CODE);
  await ageLock(scout.SWEEP_LOCK_MINUTES - 1);
  assert.equal(await scout.markSweeping(CODE), null);
});

test('the scheduler offers an abandoned area, and passes over a live one', async () => {
  await anArea();
  await scout.markSweeping(CODE);
  assert.equal(await isDue(), false, 'a sweep in flight is not handed out again');
  await ageLock(scout.SWEEP_LOCK_MINUTES + 1);
  assert.equal(await isDue(), true, 'the loop must be able to rescue it on its own');
});

test('a sweep that overran cannot finish over the one that replaced it', async () => {
  await anArea();
  const stale = await scout.markSweeping(CODE);
  await ageLock(scout.SWEEP_LOCK_MINUTES + 1);
  const fresh = await scout.markSweeping(CODE);
  assert.ok(fresh);

  assert.equal(
    await scout.finishSweep(CODE, { state: 'done', kept: 99, seen: 99, nextSweepAt: new Date(), lease: stale }),
    false,
    'the old worker must not write',
  );
  let row = await rowOf();
  assert.equal(row.state, 'sweeping', 'the replacement still holds it');
  assert.equal(row.kept, 0);

  assert.equal(
    await scout.finishSweep(CODE, { state: 'done', kept: 7, seen: 9, nextSweepAt: new Date(), lease: fresh }),
    true,
  );
  row = await rowOf();
  assert.equal(row.kept, 7);
  assert.equal(row.sweeping_since, null);
});

test('a failed sweep gives the area back without claiming to have swept it', async () => {
  await anArea();
  const first = await scout.markSweeping(CODE);
  await scout.finishSweep(CODE, { state: 'done', why: null, seen: 40, chains: 3, kept: 25, nextSweepAt: new Date(), lease: first });
  const after = await rowOf();

  const lease = await scout.markSweeping(CODE);
  assert.equal(await scout.releaseSweep(CODE, { why: 'the sweep stopped: boom', nextSweepAt: new Date(), lease }), true);

  const row = await rowOf();
  assert.equal(row.state, 'failed');
  assert.match(row.why, /boom/);
  assert.equal(row.sweeping_since, null, 'the area is free for the next attempt');
  // What the last good sweep found is left exactly as it was.
  assert.equal(row.kept, 25);
  assert.equal(row.seen, 40);
  assert.equal(row.chains, 3);
  assert.equal(row.sweeps, after.sweeps, 'a sweep that failed is not a sweep');
  assert.deepEqual(row.swept_at, after.swept_at);

  assert.ok(await scout.markSweeping(CODE), 'and it can be swept again at once');
  await query('delete from scout_areas where code = $1', [CODE]);
});

test('a superseded sweep writes no places at all, not even half of them', async () => {
  await anArea();
  const place = (ref, name) => ({ venueRef: ref, name, epicScore: 5, ownedScore: 4, crowdBand: 'top', countBand: 'many', from: ['osm'] });

  // The sweep that holds the area writes its selection.
  const mine = await scout.markSweeping(CODE);
  const first = await scout.commitSweep(CODE, {
    lease: mine, places: [place('osm:1', 'The Good One'), place('osm:2', 'The Other')],
    state: 'done', seen: 9, chains: 1, nextSweepAt: new Date(),
  });
  assert.ok(first);
  assert.equal((await query('select count(*) from scout_places where area_code = $1', [CODE])).rows[0].count, '2');

  // One that overran, was taken over, and only now got to its write phase.
  const stale = await scout.markSweeping(CODE);
  await ageLock(scout.SWEEP_LOCK_MINUTES + 1);
  const replacement = await scout.markSweeping(CODE);
  assert.ok(replacement && replacement !== stale);

  assert.equal(
    await scout.commitSweep(CODE, { lease: stale, places: [place('osm:9', 'Gone Stale')], state: 'done', nextSweepAt: new Date() }),
    null,
    'a lost lease commits nothing',
  );
  const { rows } = await query('select venue_ref from scout_places where area_code = $1 order by venue_ref', [CODE]);
  assert.deepEqual(rows.map((r) => r.venue_ref), ['osm:1', 'osm:2'], 'the newer sweep’s places are untouched and nothing was pruned');

  await query('delete from scout_places where area_code = $1', [CODE]);
  await query('delete from scout_areas where code = $1', [CODE]);
});

test('a place the sweep never handed over is found again, not left for six months', async () => {
  await anArea();
  const lease = await scout.markSweeping(CODE);
  await scout.commitSweep(CODE, {
    lease,
    places: [
      { venueRef: 'osm:handed', name: 'Handed Over', epicScore: 5, ownedScore: 4, from: ['osm'] },
      { venueRef: 'osm:missed', name: 'Never Handed Over', epicScore: 6, ownedScore: 5, from: ['osm'] },
    ],
    state: 'done', seen: 2, chains: 0, nextSweepAt: new Date(Date.now() + 180 * 86_400_000),
  });
  // The process stopped here, having only got as far as the first place.
  await query(
    `insert into place_records (venue_ref) values ('osm:handed') on conflict do nothing`,
  );

  const waiting = await scout.withoutRecord(50);
  const refs = waiting.map((w) => w.ref);
  assert.ok(refs.includes('osm:missed'), 'the one that never got a record must be on the list');
  assert.ok(!refs.includes('osm:handed'), 'the one that did must not be');
  // And it carries what the researcher needs to ask about it.
  assert.equal(waiting.find((w) => w.ref === 'osm:missed').name, 'Never Handed Over');

  await query("delete from place_records where venue_ref in ('osm:handed','osm:missed')");
  await query('delete from scout_places where area_code = $1', [CODE]);
  await query('delete from scout_areas where code = $1', [CODE]);
});
