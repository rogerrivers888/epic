// The walking and cycling matrices, routed with OSRM (sources/osrmMatrix.js).
//
// The two properties worth holding: a routed time is written exactly where the
// estimator's would be, differing only in `method = 'osrm'`; and a cell OSRM
// cannot reach is dropped, never written as zero — the can't-speak rule, which
// is what lets a regional extract build only the cells it covers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { osrmTable, buildOsrmMode } = await import('../src/sources/osrmMatrix.js');

test.after(() => pool.end());

// A small cluster of invented cells (ZZ, so they never collide with the ONS
// sectors the test database is seeded with), close enough that the straight-line
// bound keeps them all as candidates of each other.
const CELLS = [
  { code: 'sector:ZZ1 1', lat: 51.400, lng: -0.600 },
  { code: 'sector:ZZ1 2', lat: 51.410, lng: -0.600 },
  { code: 'sector:ZZ1 3', lat: 51.420, lng: -0.600 },
  { code: 'sector:ZZ1 4', lat: 51.430, lng: -0.600 },
];
const seed = async () => {
  for (const c of CELLS) {
    await query(
      `insert into geo_cells (code, scheme, label, outcode, lat, lng, source)
       values ($1, 'sector', $4, 'ZZ1', $2, $3, 'test')
       on conflict (code) do update set lat = excluded.lat, lng = excluded.lng`,
      [c.code, c.lat, c.lng, c.code.slice('sector:'.length)]);
  }
};
const clean = async () => {
  await query(`delete from reach where from_cell like 'sector:ZZ%' or to_cell like 'sector:ZZ%'`);
  await query(`delete from cell_builds where from_cell like 'sector:ZZ%'`);
  await query(`delete from ring_counts where cell like 'sector:ZZ%'`);
  await query(`delete from ring_rankings where cell like 'sector:ZZ%'`);
  await query(`delete from geo_cells where code like 'sector:ZZ%'`);
  await query(`delete from reach_runs where scheme = 'test-osrm'`);
};

test('osrmTable maps one origin against many, and carries nulls as null', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      // sources=0, destinations=1;2 → a 1×2 matrix, one entry per destination
      json: async () => ({
        code: 'Ok',
        durations: [[600, null]],          // 10 min, then unroutable
        distances: [[1234.5, null]],
      }),
    };
  };
  const table = osrmTable('http://osrm:5000/', { fetchImpl, profile: 'foot' });
  const out = await table(CELLS[0], [CELLS[1], CELLS[2]]);
  assert.equal(out.length, 2);
  assert.equal(out[0].seconds, 600);
  assert.equal(out[0].metres, 1234.5);
  assert.equal(out[1].seconds, null);     // null stays null, never 0
  assert.equal(out[1].metres, null);
  // sources pinned to the origin, destinations are the rest
  assert.match(calls[0], /sources=0&destinations=1;2/);
  assert.match(calls[0], /\/table\/v1\/foot\//);
});

test('osrmTable throws on a body that is not Ok — a router that cannot speak', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ code: 'NoSegment' }) });
  const table = osrmTable('http://osrm:5000', { fetchImpl });
  await assert.rejects(() => table(CELLS[0], [CELLS[1]]), /osrm NoSegment/);
});

test('osrmTable throws on a short duration row — Ok but incomplete is not an answer', async () => {
  // code Ok, but one duration for two destinations: a malformed answer, not a
  // cell that happens to be unroutable.
  const fetchImpl = async () => ({ ok: true, json: async () => ({ code: 'Ok', durations: [[600]], distances: [[900]] }) });
  const table = osrmTable('http://osrm:5000', { fetchImpl });
  await assert.rejects(() => table(CELLS[0], [CELLS[1], CELLS[2]]), /1 of 2 destinations/);
});

test('buildOsrmMode writes routed rows as osrm, with the self-pair, the drop and the horizon', async () => {
  await clean();
  await seed();
  // A fake router: ZZ1 2 is 10 min, ZZ1 3 is unroutable (null), ZZ1 4 is over
  // the horizon. Distances are handed back so km comes from the route.
  const table = async (origin, dests) => dests.map((d) => {
    if (d.code === 'sector:ZZ1 2') return { to: d, seconds: 600, metres: 900 };
    if (d.code === 'sector:ZZ1 3') return { to: d, seconds: null, metres: null };
    if (d.code === 'sector:ZZ1 4') return { to: d, seconds: 9000, metres: 30000 }; // 150 min
    return { to: d, seconds: 1200, metres: 1800 };
  });
  const res = await buildOsrmMode({ mode: 'walking', cells: CELLS, table, horizon: 130, scheme: 'test-osrm', resume: false });
  assert.equal(res.mode, 'walking');
  assert.equal(res.built, CELLS.length);

  const { rows } = await query(
    `select from_cell, to_cell, minutes, km, method from reach
      where from_cell = 'sector:ZZ1 1' and mode = 'walking' order by minutes`);
  const by = Object.fromEntries(rows.map((r) => [r.to_cell, r]));
  // self-pair at zero, always
  assert.equal(by['sector:ZZ1 1'].minutes, 0);
  // the 10-minute neighbour, routed, km from the route (900 m → 0.9)
  assert.equal(by['sector:ZZ1 2'].minutes, 10);
  assert.equal(Number(by['sector:ZZ1 2'].km), 0.9);
  // every written row says osrm
  assert.ok(rows.every((r) => r.method === 'osrm'));
  // the unroutable cell is absent, not a zero
  assert.equal(by['sector:ZZ1 3'], undefined);
  // the over-horizon cell (150 > 130) is absent
  assert.equal(by['sector:ZZ1 4'], undefined);

  const { rows: [mark] } = await query(
    `select cap_minutes, method from cell_builds where from_cell = 'sector:ZZ1 1' and mode = 'walking'`);
  assert.equal(mark.cap_minutes, 130);
  assert.equal(mark.method, 'osrm');

  const { rows: [run] } = await query(
    `select state, method, mode from reach_runs where scheme = 'test-osrm' order by started_at desc limit 1`);
  assert.equal(run.state, 'done');
  assert.equal(run.method, 'osrm');
  assert.equal(run.mode, 'walking');
  await clean();
});

test('buildOsrmMode resumes — an origin already built to the horizon is skipped', async () => {
  await clean();
  await seed();
  const table = async (origin, dests) => dests.map((d) => ({ to: d, seconds: 600, metres: 900 }));
  await buildOsrmMode({ mode: 'cycling', cells: CELLS, table, horizon: 130, scheme: 'test-osrm', resume: false });
  // a second pass with resume on should skip every already-built origin
  const res = await buildOsrmMode({ mode: 'cycling', cells: CELLS, table, horizon: 130, scheme: 'test-osrm', resume: true });
  assert.equal(res.skipped, CELLS.length);
  assert.equal(res.built, 0);
  await clean();
});

test('buildOsrmMode drops the stale ring for a rebuilt origin, and only its own mode', async () => {
  await clean();
  await seed();
  // A walking ring and a driving ring already counted for this origin.
  for (const mode of ['walking', 'driving']) {
    await query(
      `insert into ring_counts (cell, mode, minutes, category, places) values ('sector:ZZ1 1', $1, 30, 'fun', 5)`, [mode]);
    await query(
      `insert into ring_rankings (cell, mode, minutes, category, venue_ref, rank, epic_score) values ('sector:ZZ1 1', $1, 30, 'fun', 'ref:x', 1, 50)`, [mode]);
  }
  const table = async (origin, dests) => dests.map((d) => ({ to: d, seconds: 600, metres: 900 }));
  await buildOsrmMode({ mode: 'walking', cells: CELLS, table, horizon: 130, scheme: 'test-osrm', resume: false });
  // the walking ring, counted from the reach we just replaced, is gone
  const walk = await query(`select 1 from ring_counts where cell='sector:ZZ1 1' and mode='walking'`);
  assert.equal(walk.rows.length, 0);
  // the driving ring, untouched by a walking build, stays
  const drive = await query(`select 1 from ring_counts where cell='sector:ZZ1 1' and mode='driving'`);
  assert.equal(drive.rows.length, 1);
  const walkRank = await query(`select 1 from ring_rankings where cell='sector:ZZ1 1' and mode='walking'`);
  assert.equal(walkRank.rows.length, 0);
  await clean();
});

test('buildOsrmMode refuses driving and transit — those are not OSRM here', async () => {
  const table = async () => [];
  await assert.rejects(() => buildOsrmMode({ mode: 'driving', cells: CELLS, table }), /walking or cycling/);
  await assert.rejects(() => buildOsrmMode({ mode: 'transit', cells: CELLS, table }), /walking or cycling/);
});

test('resume with `since` skips only origins built at or after it — never an older build\'s', async () => {
  await clean();
  await seed();
  const table = async (origin, dests) => dests.map((d) => ({ to: d, seconds: 600, metres: 900 }));
  await buildOsrmMode({ mode: 'walking', cells: CELLS, table, horizon: 130, scheme: 'test-osrm', resume: false });
  const later = new Date(Date.now() + 60_000).toISOString();
  // A rebuild that began after those markers: none of them is its own, nothing skipped.
  const fresh = await buildOsrmMode({ mode: 'walking', cells: CELLS, table, horizon: 130, scheme: 'test-osrm', resume: true, since: later });
  assert.equal(fresh.skipped, 0);
  assert.equal(fresh.built, CELLS.length);
  // A retry of a build that began before them: all its own, all skipped.
  const earlier = new Date(Date.now() - 3600_000).toISOString();
  const retry = await buildOsrmMode({ mode: 'walking', cells: CELLS, table, horizon: 130, scheme: 'test-osrm', resume: true, since: earlier });
  assert.equal(retry.skipped, CELLS.length);
  await clean();
});
