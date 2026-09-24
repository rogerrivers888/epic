/**
 * A ring's counts and order, as owned rows (migration 245).
 *
 * The owner, 20 Sep 2026: "Store the counts and the ranking — place IDs by Epic
 * score, per category per band — as owned data, refreshed on the 30-day census
 * cycle. The count on Inspire should be read from that table, instantly, every
 * time, never computed while the household waits."
 *
 * Committed with the migration it needs, as the working agreement requires: an
 * uncommitted migration is invisible to every other session's test database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const tables = await import('../src/repositories/ringTables.js');

test.after(() => pool.end());

const CELL = 'sector:ZT1 1';
const REFS = ['google:RT-TOP', 'google:RT-MID', 'google:RT-UNSCORED', 'google:RT-SPORT'];

const seed = async ({ censused = true } = {}) => {
  await query('delete from ring_counts where cell = $1', [CELL]);
  await query('delete from ring_rankings where cell = $1', [CELL]);
  await query('delete from place_subcategories where venue_ref = any($1)', [REFS]);
  await query('delete from place_index where venue_ref = any($1)', [REFS]);
  await query('delete from place_records where venue_ref = any($1)', [REFS]);
  await query(`delete from area_counts where area_slug = 'zt1'`);
  await query('delete from geo_cells where code = $1', [CELL]);
  await query(
    `insert into geo_cells (code, scheme, label, country_code, outcode, lat, lng, source)
     values ($1, 'sector', 'ZT1 1', 'GB', 'ZT1', 51.700, -0.900, 'test')`, [CELL]);
  // Four places in one small box inside the sector: three Fun, one Sport.
  await query(
    `insert into place_index (venue_ref, category, subcategory, lat, lng, slice, country_code) values
       ('google:RT-TOP','fun','theme-parks', null, null, '51.6990,-0.9020,51.7010,-0.8980', 'GB'),
       ('google:RT-MID','fun','zoos-wildlife', null, null, '51.6990,-0.9020,51.7010,-0.8980', 'GB'),
       ('google:RT-UNSCORED','fun','days-out', null, null, '51.6990,-0.9020,51.7010,-0.8980', 'GB'),
       ('google:RT-SPORT','sport','swimming', null, null, '51.6990,-0.9020,51.7010,-0.8980', 'GB')`);
  await query(
    `insert into place_subcategories (venue_ref, category, subcategory, area_slug, found_by, found_rank) values
       ('google:RT-TOP','fun','theme-parks','zt1','amusement_park',1),
       ('google:RT-TOP','fun','days-out','zt1','tourist_attraction',3),
       ('google:RT-MID','fun','zoos-wildlife','zt1','zoo',1),
       ('google:RT-UNSCORED','fun','days-out','zt1','tourist_attraction',9),
       ('google:RT-SPORT','sport','swimming','zt1','swimming_pool',1)`);
  // Two scored, one not: the order is by score and an unscored place has no rank.
  await query(
    `insert into place_records (venue_ref, name, epic_score, scored_at, updated_at) values
       ('google:RT-TOP', 'Top', 7.5, now(), now()),
       ('google:RT-MID', 'Mid', 4.2, now(), now())
     on conflict (venue_ref) do update set epic_score = excluded.epic_score, scored_at = excluded.scored_at`);
  if (censused) {
    await query(
      `insert into area_counts (area_slug, category, subcategory, census_count, censused_at)
       values ('zt1', 'fun', 'theme-parks', 3, now())`);
  }
};

test('a refreshed ring writes its counts, distinct per category', async () => {
  await seed();
  const out = await tables.refreshRing({ cell: CELL, mode: 'drive', minutes: 30 });
  assert.ok(out, 'the ring resolved from its own cell');
  const fun = out.counts.find((c) => c.category === 'fun');
  // RT-TOP is filed under two of Fun's drawers and is one place.
  assert.equal(fun.places, 3);
  assert.equal(out.counts.find((c) => c.category === 'sport').places, 1);
  assert.equal(fun.floor, false, 'every district censused and nothing across the edge');
});

test('the counts are a read, and read back what was written', async () => {
  await seed();
  await tables.refreshRing({ cell: CELL, mode: 'drive', minutes: 30 });
  const got = await tables.countsFor({ cell: CELL, mode: 'drive', minutes: 30 });
  assert.equal(got.fun.places, 3);
  assert.equal(got.sport.places, 1);
  assert.ok(got.fun.computedAt, 'and says when');
  // A ring nobody has counted answers nothing, and the caller refreshes behind
  // the screen — never in front of it.
  assert.equal(await tables.countsFor({ cell: 'sector:NOWHERE 0', mode: 'drive', minutes: 30 }), null);
});

test('a counted ring with nothing in it is a counted ring, not an unlooked-at one', async () => {
  await seed();
  await query('delete from place_subcategories where venue_ref = any($1)', [REFS]);
  const out = await tables.refreshRing({ cell: CELL, mode: 'drive', minutes: 30 });
  // The census looked for Fun in this district and found none: nought is the
  // answer, written down as such.
  assert.equal(out.counts.find((c) => c.category === 'fun')?.places, 0);
  const got = await tables.countsFor({ cell: CELL, mode: 'drive', minutes: 30 });
  assert.ok(got, 'counted, so not null');
  assert.equal(got.fun.places, 0);
  assert.ok(!('' in got), 'the marker row never reaches a reader');
  // And the cycle can find it: a counted-empty ring older than the window is due.
  await query(`update ring_counts set computed_at = now() - interval '40 days' where cell = $1`, [CELL]);
  const done = await tables.refreshDue({ olderThanDays: 30 });
  assert.ok(done.some((d) => d.cell === CELL), 'an empty ring still ages');
});

test('a finished census counts again every ring computed before it started', async () => {
  await seed();
  await tables.refreshRing({ cell: CELL, mode: 'drive', minutes: 30 });
  const { rows: [{ at }] } = await query('select max(computed_at) as at from ring_counts where cell = $1', [CELL]);
  const earlier = new Date(new Date(at).getTime() - 1000);
  assert.ok(!(await tables.refreshDue({ before: earlier })).some((d) => d.cell === CELL), 'counted after the run began: left alone');
  const later = new Date(new Date(at).getTime() + 1000);
  assert.ok((await tables.refreshDue({ before: later })).some((d) => d.cell === CELL), 'counted before the run began: counted again');
});

test('the order is by our score, and an unscored place has no rank', async () => {
  await seed();
  await tables.refreshRing({ cell: CELL, mode: 'drive', minutes: 30 });
  const order = await tables.rankingFor({ cell: CELL, mode: 'drive', minutes: 30, category: 'fun' });
  assert.deepEqual(order.map((r) => r.venueRef), ['google:RT-TOP', 'google:RT-MID']);
  assert.deepEqual(order.map((r) => r.rank), [1, 2]);
  assert.equal(order[0].epicScore, 7.5);
});

test('a district the census never looked at makes the count a floor', async () => {
  await seed({ censused: false });
  const out = await tables.refreshRing({ cell: CELL, mode: 'drive', minutes: 30 });
  assert.equal(out.counts.find((c) => c.category === 'fun').floor, true);
  assert.deepEqual(out.notCensusedOutcodes, ['ZT1'], 'and names it, so a census can be asked for');
});

test('the 30-day cycle counts a stale ring again and leaves a fresh one alone', async () => {
  await seed();
  await tables.refreshRing({ cell: CELL, mode: 'drive', minutes: 30 });
  await query(`update ring_counts set computed_at = now() - interval '40 days' where cell = $1`, [CELL]);
  const done = await tables.refreshDue({ olderThanDays: 30 });
  assert.ok(done.some((d) => d.cell === CELL), 'forty days old is due');
  const again = await tables.refreshDue({ olderThanDays: 30 });
  assert.ok(!again.some((d) => d.cell === CELL), 'and having just been counted, it is not');
});
