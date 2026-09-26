/**
 * A finer census of a ring's edge (sources/censusEdge.js).
 *
 * The owner, 25 Sep 2026: "re-ask only the straddling boxes at one
 * kilometre… the problem is the edge, not the ground you have already
 * censused." The two-kilometre pass that preceded this resolved almost
 * nothing because its boxes were wider than the corner test's `FINE_M` and
 * stayed across; the first test here pins the grid under that line so it
 * cannot happen again quietly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const edge = await import('../src/sources/censusEdge.js');
const { FINE_M, widthOf, PointIndex } = await import('../src/repositories/censusRing.js');
const { startRun, rollUpScope, RING_EDGE } = await import('../src/sources/censusRun.js');

test.after(() => pool.end());

test('an edge square is placed by its centre: the grid sits under the corner test’s line', () => {
  assert.ok(edge.edgeSquareWidth() <= FINE_M, `${edge.edgeSquareWidth()} m is wider than FINE_M ${FINE_M}`);
  const [one] = edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.48, maxLng: -0.58 }]);
  assert.ok(widthOf(one) <= FINE_M, 'every square it makes is under the line too');
});

test('the squares under a box cover it, once each, and a box already fine is left alone', () => {
  // An eight-by-twelve hundredths box on the 0.01 x 0.015 grid: 8 x 8 squares.
  const box = { minLat: 51.40, minLng: -0.72, maxLat: 51.48, maxLng: -0.60 };
  const squares = edge.squaresUnder([box]);
  assert.equal(squares.length, 64);
  assert.equal(new Set(squares.map((s) => s.gridKey)).size, 64, 'each once');
  for (const s of squares) {
    assert.ok(s.maxLat > box.minLat && s.minLat < box.maxLat && s.maxLng > box.minLng && s.minLng < box.maxLng, 'every square overlaps the box');
  }
  // Two boxes that overlap share their squares rather than doubling them.
  const twice = edge.squaresUnder([box, { minLat: 51.44, minLng: -0.66, maxLat: 51.52, maxLng: -0.54 }]);
  assert.ok(twice.length < 128 && twice.length > 64, `${twice.length} squares for two overlapping boxes`);
  // A box no wider than FINE_M needs nothing.
  assert.deepEqual(edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.405, maxLng: -0.695 }]), []);
});

test('a square reports to the district its centre is nearest, and to nobody where nothing is near', () => {
  const index = new PointIndex([
    { code: 'sector:ZT1 1', outcode: 'ZT1', lat: 51.405, lng: -0.695 },
    { code: 'sector:ZT2 1', outcode: 'ZT2', lat: 51.475, lng: -0.605 },
  ]);
  const squares = edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.48, maxLng: -0.60 }]);
  const tagged = edge.tagSquares(squares, index);
  // Squares sit on grid lines, not on the box's corners: find the square that
  // holds each corner point.
  const holding = (lat, lng) => tagged.find((s) => s.minLat <= lat && lat < s.maxLat && s.minLng <= lng && lng < s.maxLng);
  const sw = holding(51.401, -0.699);
  const ne = holding(51.479, -0.601);
  assert.ok(sw && ne, 'both corners are under a square');
  assert.deepEqual(sw.outcodes, ['ZT1']);
  assert.deepEqual(ne.outcodes, ['ZT2']);
  assert.deepEqual(edge.tagSquares(squares, new PointIndex([]))[0].outcodes, [], 'nothing near: reports to nobody, still asked');
  // A square on the line between two districts carries both.
  const line = new PointIndex([
    { code: 'sector:ZT1 1', outcode: 'ZT1', lat: 51.405, lng: -0.6999 },
    { code: 'sector:ZT2 1', outcode: 'ZT2', lat: 51.405, lng: -0.6851 },
  ]);
  const [straddling] = edge.tagSquares(edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.42, maxLng: -0.67 }]), line)
    .filter((s) => s.minLat <= 51.405 && 51.405 < s.maxLat && s.minLng <= -0.6925 && -0.6925 < s.maxLng);
  assert.deepEqual(straddling.outcodes, ['ZT1', 'ZT2'], 'both sides of the line, not the one under the centre');
});

test('a square takes every district with a placing point inside it, not only the ones its probes hit', async () => {
  const squares = edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.42, maxLng: -0.67 }]);
  const target = squares.find((s) => s.minLat <= 51.405 && 51.405 < s.maxLat && s.minLng <= -0.6925 && -0.6925 < s.maxLng);
  await query(`delete from geo_cells where code in ('sector:ZT7 1', 'sector:ZT6 1')`);
  // Two sectors inside the one square, off-centre and off-corner.
  await query(
    `insert into geo_cells (code, scheme, label, country_code, outcode, lat, lng, source) values
       ('sector:ZT7 1', 'sector', 'ZT7 1', 'GB', 'ZT7', $1, $2, 'test'),
       ('sector:ZT6 1', 'sector', 'ZT6 1', 'GB', 'ZT6', $3, $4, 'test')`,
    [target.minLat + (target.maxLat - target.minLat) * 0.3, target.minLng + (target.maxLng - target.minLng) * 0.7,
      target.minLat + (target.maxLat - target.minLat) * 0.7, target.minLng + (target.maxLng - target.minLng) * 0.3]);
  try {
    const inside = await edge.districtsInside([target]);
    assert.deepEqual([...(inside.get(target.gridKey) ?? [])].sort(), ['ZT6', 'ZT7']);
  } finally {
    await query(`delete from geo_cells where code in ('sector:ZT7 1', 'sector:ZT6 1')`);
  }
});

test('an edge run asks every planned square again, however fresh the tile', async () => {
  const [sq] = edge.tagSquares(
    edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.42, maxLng: -0.67 }]),
    new PointIndex([{ code: 'sector:ZT1 1', outcode: 'ZT1', lat: 51.41, lng: -0.685 }]),
  ).map((s) => ({ ...s, gridKey: `test/edge/fresh/${s.gridKey}` }));
  await query(`delete from census_run_tiles where grid_key like 'test/edge/fresh/%'`);
  await query(`delete from census_tiles where grid_key like 'test/edge/fresh/%'`);
  // Censused a minute ago and done: an area run would walk past it.
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, done_subcategories)
     values ($1, $2, $3, $4, $5, array['ZT1'], 'done', now() - interval '1 minute', array['golf'])`,
    [sq.gridKey, sq.minLat, sq.minLng, sq.maxLat, sq.maxLng]);
  const plan = { ring: { cell: 'sector:ZT1 1', label: 'ZT1 1', mode: 'driving', minutes: 30 }, outcodes: ['ZT1'], squares: [sq] };
  const quote = await edge.quoteEdge(plan);
  const run = await edge.startEdgeRun({ plan, maxRequests: quote.requests, label: 'test edge fresh', ratePerSec: 1 });
  try {
    const { rows: [tile] } = await query(`select state, done_subcategories from census_tiles where grid_key = $1`, [sq.gridKey]);
    assert.equal(tile.state, 'todo', 'work again, fresh or not');
    assert.deepEqual(tile.done_subcategories, [], 'and every drawer is asked again');
  } finally {
    await query(`update census_runs set state = 'stopped', finished_at = now() where id = $1`, [run.id]);
    await query(`delete from census_run_tiles where grid_key like 'test/edge/fresh/%'`);
    await query(`delete from census_tiles where grid_key like 'test/edge/fresh/%'`);
    await query(`delete from census_runs where id = $1`, [run.id]);
  }
});

test('a square that is already a tile keeps every district it carried', async () => {
  const [sq] = edge.tagSquares(
    edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.42, maxLng: -0.67 }]),
    new PointIndex([{ code: 'sector:ZT1 1', outcode: 'ZT1', lat: 51.41, lng: -0.685 }]),
  ).map((s) => ({ ...s, gridKey: `test/edge/merge/${s.gridKey}` }));
  await query(`delete from census_run_tiles where grid_key like 'test/edge/merge/%'`);
  await query(`delete from census_tiles where grid_key like 'test/edge/merge/%'`);
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state)
     values ($1, $2, $3, $4, $5, array['ZT9', 'ZT8'], 'done')`, [sq.gridKey, sq.minLat, sq.minLng, sq.maxLat, sq.maxLng]);
  try {
    const [merged] = await edge.mergeExistingCoverage([sq]);
    assert.deepEqual(merged.outcodes, ['ZT1', 'ZT8', 'ZT9'], 'the tile\u2019s districts and this ring\u2019s, together');
  } finally {
    await query(`delete from census_tiles where grid_key like 'test/edge/merge/%'`);
  }
});

test('a run given its squares claims exactly those tiles, and says it is a ring-edge run', async () => {
  const squares = edge.tagSquares(
    edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.42, maxLng: -0.67 }]),
    new PointIndex([{ code: 'sector:ZT1 1', outcode: 'ZT1', lat: 51.41, lng: -0.685 }]),
  );
  // Test keys, so the census fixtures' cleaner recognises them as ours.
  const mine = squares.map((s) => ({ ...s, gridKey: `test/edge/${s.gridKey}` }));
  await query(`delete from census_run_tiles where grid_key like 'test/edge/%'`);
  await query(`delete from census_tiles where grid_key like 'test/edge/%'`);
  await query(`delete from census_runs where label like 'test edge%'`);
  const run = await startRun({
    label: 'test edge run', outcodes: ['ZT1'], tiles: mine, maxRequests: 100, ratePerSec: 0,
    startedBy: `${RING_EDGE}sector:ZT1 1|driving|30`,
  });
  try {
    const { rows } = await query(`select grid_key, outcodes from census_tiles where run_id = $1 order by grid_key`, [run.id]);
    assert.equal(rows.length, mine.length, 'the run’s tiles are the squares it was given, no more');
    assert.deepEqual(rows.map((r) => r.grid_key).sort(), mine.map((s) => s.gridKey).sort());
    assert.deepEqual(rows[0].outcodes, ['ZT1'], 'and each carries its district for the roll-up');
    assert.equal(run.tiles_total, mine.length);
    assert.deepEqual(rollUpScope(run), { skip: true, outcodes: null, runId: null }, 'a ring-edge run rolls up no district: its slivers must never become a district\u2019s count');
    assert.deepEqual(rollUpScope({ id: run.id, started_by: 'a person', areas: ['ZT1'] }), { skip: false, outcodes: null, runId: run.id }, 'an area run rolls up its own tiles');
  } finally {
    await query(`update census_runs set state = 'stopped', finished_at = now() where id = $1`, [run.id]);
    await query(`delete from census_run_tiles where grid_key like 'test/edge/%'`);
    await query(`delete from census_tiles where grid_key like 'test/edge/%'`);
    await query(`delete from census_runs where id = $1`, [run.id]);
  }
});

test('a ring-edge run is refused without the request count its quote reported, and with any other number', async () => {
  const plan = { ring: { cell: 'sector:ZT1 1', mode: 'driving', minutes: 30 }, outcodes: ['ZT1'], squares: [{ gridKey: 'x', minLat: 0, minLng: 0, maxLat: 0.01, maxLng: 0.015, outcodes: ['ZT1'] }] };
  const quote = await edge.quoteEdge(plan);
  await assert.rejects(() => edge.startEdgeRun({ plan }), /request count its quote reported/);
  // A number, but not the quote's: refused, and the refusal names the quote.
  await assert.rejects(() => edge.startEdgeRun({ plan, maxRequests: quote.requests + 1 }), (err) => {
    assert.match(err.message, /quote reported/);
    assert.equal(err.quoted, quote.requests, 'the refusal carries the number that would be accepted');
    return true;
  });
  await assert.rejects(() => edge.startEdgeRun({ plan: { ...plan, squares: [] }, maxRequests: quote.requests }), /nothing across/);
});

test('a run confirmed with its quote stops at the quote’s ceiling, not at the estimate', async () => {
  const squares = edge.tagSquares(
    // Wider than the fine line, so it is a box the edge would re-ask.
    edge.squaresUnder([{ minLat: 51.40, minLng: -0.70, maxLat: 51.42, maxLng: -0.67 }]),
    new PointIndex([{ code: 'sector:ZT1 1', outcode: 'ZT1', lat: 51.41, lng: -0.685 }]),
  ).map((s) => ({ ...s, gridKey: `test/edge/${s.gridKey}` }));
  const plan = { ring: { cell: 'sector:ZT1 1', label: 'ZT1 1', mode: 'driving', minutes: 30 }, outcodes: ['ZT1'], squares };
  const quote = await edge.quoteEdge(plan);
  assert.ok(quote.ceiling >= quote.requests * 2, 'the ceiling leaves room for splitting the estimate did not see');
  await query(`delete from census_run_tiles where grid_key like 'test/edge/%'`);
  await query(`delete from census_tiles where grid_key like 'test/edge/%'`);
  const run = await edge.startEdgeRun({ plan, maxRequests: quote.requests, label: 'test edge confirmed', ratePerSec: 1 });
  try {
    assert.equal(run.max_requests, quote.ceiling, 'held to the ceiling');
    assert.ok(String(run.started_by).startsWith(RING_EDGE));
    assert.equal(run.tiles_total, squares.length);
  } finally {
    await query(`update census_runs set state = 'stopped', finished_at = now() where id = $1`, [run.id]);
    await query(`delete from census_run_tiles where grid_key like 'test/edge/%'`);
    await query(`delete from census_tiles where grid_key like 'test/edge/%'`);
    await query(`delete from census_runs where id = $1`, [run.id]);
  }
});

test('a quote is nought squares and nought requests when nothing is across, and counts the plan’s questions otherwise', async () => {
  const none = await edge.quoteEdge({ squares: [] });
  assert.equal(none.squares, 0);
  assert.equal(none.requests, 0);
  assert.equal(none.costGbp, 0);
  const one = await edge.quoteEdge({ squares: [{ gridKey: 'q', minLat: 51.40, minLng: -0.70, maxLat: 51.41, maxLng: -0.685 }] });
  assert.equal(one.squares, 1);
  assert.ok(one.requests >= one.questions && one.questions > 0, 'at least every question once');
  assert.equal(one.costGbp, 0, 'IDs Only: free');
});
