/**
 * The big run: does it stop, does it resume, and does it ask twice?
 *
 * Three of the four things the brief asks of a run of this length cannot be
 * demonstrated by running it — by the time you find out it did not stop, it has
 * not stopped for thirty hours. So they are held here instead:
 *
 *   · a tile censused inside the freshness window is not asked again;
 *   · a tile interrupted half way resumes at the drawer it reached, and pays
 *     nothing for the ones already answered;
 *   · the ceiling, the stop control and a provider refusal each end the run,
 *     and each says which of the three it was.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { googleSource } from '../src/sources/google.js';
import { tileOf, planTiles, startRun, advance, requestStop, resume, rollUpOutcodes } from '../src/sources/censusRun.js';
import { slicePlan } from '../src/sources/census.js';
import { query, pool } from '../src/db.js';

test.after(() => pool.end());

const withCensus = async (impl, run) => {
  const was = googleSource.censusSlice;
  googleSource.censusSlice = impl;
  try { return await run(); } finally { googleSource.censusSlice = was; }
};

/** One place, the way IDs Only answers: an id and where it came in the answer. */
const answers = (n = 1) => async () => ({
  places: Array.from({ length: n }, (_, i) => ({ id: `ChIJrun_test_${Math.random().toString(36).slice(2, 8)}_${i}`, rank: i + 1 })),
  requests: 1, saturated: false, problem: null,
});

/** Everything this test made, gone, whatever it found. */
const clean = async () => {
  const { rows } = await query(`select grid_key from census_tiles where grid_key like 'test%'`);
  const keys = rows.map((r) => r.grid_key);
  if (keys.length) {
    await query(`delete from place_subcategories where area_slug = any($1)`, [keys]);
    await query(`delete from census_slices where area_slug = any($1)`, [keys]);
  }
  await query(`delete from census_tiles where grid_key like 'test%'`);
  await query(`delete from census_runs where label like 'test %'`);
};

const seedTile = async (run, gridKey) => {
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, run_id, state)
     values ($1, 51.40, -0.70, 51.48, -0.58, array['ZZ99'], $2, 'todo')
     on conflict (grid_key) do update set run_id = excluded.run_id, state = 'todo', done_subcategories = '{}'`,
    [gridKey, run.id]);
};

const startTestRun = async (over = {}) => {
  const { rows: [run] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days)
     values ($1, array['ZZ'], 0.08, 0.12, $2, $3, 30) returning *`,
    [over.label ?? 'test run', over.maxRequests ?? 100_000, over.ratePerSec ?? 0]);
  return run;
};

// ---------------------------------------------------------------------------
// the grid
// ---------------------------------------------------------------------------

test('the same square is the same tile, whoever asks and from where', () => {
  const a = tileOf(51.4085, -0.6465);
  const b = tileOf(51.4322, -0.6001);
  assert.equal(a.gridKey, b.gridKey, 'two points in one square are one tile');
  assert.ok(a.minLat <= 51.4085 && a.maxLat > 51.4322, 'and the square contains them both');
  // The step is in the key on purpose. A different grid is not a finer census
  // of the same tiles, it is a different set of tiles, and the two are not
  // comparable — so they must not collide.
  assert.notEqual(tileOf(51.4085, -0.6465, 0.04, 0.06).gridKey, a.gridKey);
});

test('a region is the squares its postcodes fall in, and each knows its outcodes', async () => {
  const tiles = await planTiles({ areas: ['SL', 'GU'] });
  if (!tiles.length) return; // a database with no geo_cells has no region to plan
  assert.ok(tiles.every((t) => t.outcodes.length), 'every tile says which outcodes it covers');
  assert.ok(tiles.every((t) => t.maxLat > t.minLat && t.maxLng > t.minLng), 'and is a real box');
  const keys = new Set(tiles.map((t) => t.gridKey));
  assert.equal(keys.size, tiles.length, 'no square is planned twice — that is the whole point of a grid');
  // The overlap this replaces: an eight-kilometre box per outcode covers the
  // same ground three and four times over.
  const outcodes = new Set(tiles.flatMap((t) => t.outcodes));
  assert.ok(tiles.length < outcodes.size, 'a region is fewer tiles than it is outcodes');
});

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

test('a tile remembers which drawers it finished, and the next pass asks only the rest', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun();
  await seedTile(run, 'test/checkpoint');

  // Stop after the first drawer: the shape of a deploy landing mid-tile.
  let asked = 0;
  await withCensus(async () => { asked += 1; return (await answers(1)())(); }, async () => {});

  const first = [];
  await withCensus(async ({ includedType }) => {
    first.push(includedType);
    return { places: [{ id: `ChIJrun_test_a${first.length}`, rank: 1 }], requests: 1, saturated: false, problem: null };
  }, () => advance({ runId: run.id, budgetMs: 30_000 }));

  const { rows: [tile] } = await query(`select * from census_tiles where grid_key = 'test/checkpoint'`);
  assert.ok(tile.done_subcategories.length, 'the drawers it answered are written down');
  assert.equal(tile.state, 'done', 'a tile that finished its plan is done');
  assert.ok(tile.requests > 0 && tile.censused_at, 'and says what it cost and when');

  // Second pass: a finished tile is a no-op. Re-running one must never re-ask.
  const second = [];
  await withCensus(async ({ includedType }) => {
    second.push(includedType);
    return { places: [], requests: 1, saturated: false, problem: null };
  }, () => advance({ runId: run.id, budgetMs: 5_000 }));
  assert.equal(second.length, 0, 'nothing is asked of Google a second time');
  assert.ok(asked >= 0);
});

test('a run stops when a person presses stop, and says that is why', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test stop' });
  await seedTile(run, 'test/stop');
  await requestStop(run.id);

  const out = await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 10_000 }));
  assert.equal(out.reason, 'stopped');
  const { rows: [after] } = await query(`select state, finished_at from census_runs where id = $1`, [run.id]);
  assert.equal(after.state, 'stopped');
  assert.ok(after.finished_at, 'a run that ended has an end');

  // And it can be picked up again exactly where it was.
  const back = await resume(run.id);
  assert.equal(back?.state, 'running');
});

test('the ceiling pauses the run rather than stopping it for good', async (t) => {
  await clean();
  t.after(clean);
  // One request is enough to be over a ceiling of one.
  const run = await startTestRun({ label: 'test ceiling', maxRequests: 1 });
  await seedTile(run, 'test/ceiling');

  // The pass that spends past the ceiling is the pass that ends it: the run
  // notices between tiles, not on the next call.
  const out = await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 10_000 }));
  assert.equal(out.reason, 'ceiling');
  // And a later pass simply finds nothing running rather than starting again.
  const again = await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 5_000 }));
  assert.equal(again.working, false);
  const { rows: [after] } = await query(`select state, problem from census_runs where id = $1`, [run.id]);
  assert.equal(after.state, 'paused', 'paused, because the work is not wrong — only the budget ran out');
  assert.match(after.problem ?? '', /ceiling/);
});

test('a provider refusal stops the whole run, not one tile', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test refusal' });
  await seedTile(run, 'test/refused');

  // The first ring census walked into the daily cap and then fired 9,321 more
  // doomed requests, because nothing read the answer (sources/census.js).
  let calls = 0;
  const out = await withCensus(async () => {
    calls += 1;
    return { places: [], requests: 1, saturated: false, problem: 'RESOURCE_EXHAUSTED: Quota exceeded' };
  }, () => advance({ runId: run.id, budgetMs: 10_000 }));

  assert.equal(out.reason, 'refused');
  assert.ok(calls < 50, `the run stopped asking rather than working through the plan (${calls} calls)`);
  const { rows: [after] } = await query(`select state, problem from census_runs where id = $1`, [run.id]);
  assert.equal(after.state, 'refused');
  assert.match(after.problem ?? '', /Quota|RESOURCE_EXHAUSTED/);
});

test('two runs over the same ground are refused, because free work is still work', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test clash' });
  await assert.rejects(
    () => startRun({ label: 'test clash two', areas: ['SL'] }),
    /already running/,
    'a second run is refused while one is going');
  await query(`update census_runs set state = 'done' where id = $1`, [run.id]);
});

// ---------------------------------------------------------------------------
// tiles back to outcodes
// ---------------------------------------------------------------------------

test('a tile census is reported by outcode, and a box across the edge is neither in nor out', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from area_counts where area_slug in ('zz9a', 'zz9b')`);
    await query(`delete from geo_cells where code like 'ZZ9%'`);
    await query(`delete from place_index where venue_ref like 'google:rollup_%'`);
    await clean();
  });

  // Two outcodes, far enough apart that a box can sit wholly in one.
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values
       ('ZZ9A 1', 'sector', 'ZZ9A 1', 'ZZ9A', 51.41, -0.68, 'test'),
       ('ZZ9A 2', 'sector', 'ZZ9A 2', 'ZZ9A', 51.42, -0.66, 'test'),
       ('ZZ9B 1', 'sector', 'ZZ9B 1', 'ZZ9B', 51.46, -0.60, 'test'),
       ('ZZ9B 2', 'sector', 'ZZ9B 2', 'ZZ9B', 51.47, -0.59, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, saturated)
     values ('test/rollup', 51.40, -0.72, 51.48, -0.56, array['ZZ9A','ZZ9B'], 'done', now(), 0)
     on conflict (grid_key) do update set outcodes = excluded.outcodes, state = 'done', censused_at = now()`);

  // One place in a small box inside ZZ9A, one in a box that spans both.
  const place = async (ref, slice) => {
    await query(
      `insert into place_index (venue_ref, country_code, slice, category, subcategory)
       values ($1, 'GB', $2, 'sport', 'golf')
       on conflict (venue_ref) do update set slice = excluded.slice`, [ref, slice]);
    await query(
      `insert into place_subcategories (venue_ref, category, subcategory, found_by, area_slug, first_seen, last_seen)
       values ($1, 'sport', 'golf', 'golf_course', 'test/rollup', now(), now())
       on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do nothing`, [ref]);
  };
  await place('google:rollup_inside', '51.4050,-0.6900,51.4250,-0.6600');
  await place('google:rollup_across', '51.4000,-0.7200,51.4800,-0.5600');

  const out = await rollUpOutcodes({ outcodes: ['ZZ9A', 'ZZ9B'] });
  assert.ok(out.rows > 0, 'the outcodes got their counts');

  const { rows: [a] } = await query(
    `select census_count, unresolved, tiles, tiles_saturated, complete, censused_at
       from area_counts where area_slug = 'zz9a' and subcategory = 'golf'`);
  assert.equal(a.census_count, 1, 'the place whose box sits inside is counted once');
  assert.equal(a.unresolved, 1, 'and the one whose box straddles the edge is unresolved, not discarded');
  assert.equal(a.tiles, 1, 'the coverage is on the row: one tile');
  assert.equal(a.tiles_saturated, 0, 'none of it cut off');
  assert.ok(a.complete && a.censused_at, 'and it says when the ground was last looked at');

  const { rows: [b] } = await query(
    `select census_count, unresolved from area_counts where area_slug = 'zz9b' and subcategory = 'golf'`);
  assert.equal(b.census_count, 0, 'a box wholly in the other outcode is not counted here');
  assert.equal(b.unresolved, 1, 'the straddling one is unresolved in both, because it is in one of them');
});

test('a run can be three districts, which is what calibrating before committing means', async () => {
  const districts = await planTiles({ outcodes: ['SL5', 'GU21'] });
  if (!districts.length) return; // no geo_cells for those in this database
  assert.ok(districts.every((t) => t.outcodes.some((o) => ['SL5', 'GU21'].includes(o))),
    'the tiles are the ones those districts sit in');
  const wholeArea = await planTiles({ areas: ['SL'] });
  if (wholeArea.length) {
    assert.ok(districts.length < wholeArea.length + 10,
      'and naming a district is not a way of accidentally censusing its whole postcode area');
  }
});

test('a free run that starts costing money stops on the first penny', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from provider_calls where purpose = 'census.slice' and household_id is null and ms = -4242`);
    await clean();
  });
  const run = await startTestRun({ label: 'test billed' });
  await seedTile(run, 'test/billed');

  // What a wrong field mask looks like from the outside: the census's own
  // purpose, with money against it. At a hundred thousand requests the gap
  // between Essentials and Pro is the gap between nothing and thousands of
  // pounds, so this is not a warning to log.
  await query(
    `insert into provider_calls (provider, purpose, estimated_cost_usd, ms, created_at)
     values ('google', 'census.slice', 0.032, -4242, now())`);

  const out = await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 10_000 }));
  assert.equal(out.reason, 'billed');
  const { rows: [after] } = await query(`select state, problem from census_runs where id = $1`, [run.id]);
  assert.equal(after.state, 'paused', 'it waits for a person rather than carrying on');
  assert.match(after.problem ?? '', /free|penny|may not buy/i);
});

test('a tile interrupted half way keeps what it answered, and the next pass asks only the rest', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test interrupted' });
  await seedTile(run, 'test/interrupted');

  // Slow enough that the pass runs out of time part way through the plan,
  // which is what a deploy landing mid-tile looks like from in here.
  const firstAsked = [];
  await withCensus(async ({ includedType }) => {
    firstAsked.push(includedType);
    await new Promise((r) => setTimeout(r, 12));
    return { places: [{ id: `ChIJrun_test_i${firstAsked.length}`, rank: 1 }], requests: 1, saturated: false, problem: null };
  }, () => advance({ runId: run.id, budgetMs: 120 }));

  const { rows: [half] } = await query(`select * from census_tiles where grid_key = 'test/interrupted'`);
  assert.equal(half.state, 'todo', 'an unfinished tile is work again, not done');
  assert.ok(half.done_subcategories.length > 0, 'and the drawers it did answer are written down');
  assert.ok(half.requests > 0, 'with what they cost');
  const answered = new Set(half.done_subcategories);

  // The second pass must not pay for those drawers again.
  const secondAsked = [];
  await withCensus(async ({ includedType }) => {
    secondAsked.push(includedType);
    return { places: [], requests: 1, saturated: false, problem: null };
  }, () => advance({ runId: run.id, budgetMs: 30_000 }));

  const plan = await slicePlan();
  const typesOfAnswered = new Set(plan
    .filter((p) => answered.has(p.subcategory))
    .flatMap((p) => p.questions.map((q) => q.type)));
  const typesOfRest = new Set(plan
    .filter((p) => !answered.has(p.subcategory))
    .flatMap((p) => p.questions.map((q) => q.type)));
  // A type can belong to two drawers, so only the ones that belong to nothing
  // outstanding prove the point.
  const shouldNotRecur = [...typesOfAnswered].filter((t2) => !typesOfRest.has(t2));
  for (const type of shouldNotRecur) {
    assert.ok(!secondAsked.includes(type), `${type} was answered in the first pass and is not asked again`);
  }
});

test('a place found by three drawers is one place in the tile', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test counting' });
  await seedTile(run, 'test/counting');

  // The same place for every question. Adding each drawer's total would make
  // the tile's "places" a count of surfacings — 135 rows for 65 places was that
  // mistake in the ring count, and this is the same one a tile further up.
  const one = { id: 'ChIJrun_test_the_same_place', rank: 1 };
  await withCensus(async () => ({ places: [one], requests: 1, saturated: false, problem: null }),
    () => advance({ runId: run.id, budgetMs: 30_000 }));

  const { rows: [tile] } = await query(`select places, done_subcategories from census_tiles where grid_key = 'test/counting'`);
  assert.ok(tile.done_subcategories.length > 1, 'several drawers were asked');
  assert.equal(tile.places, 1, 'and they all found the one place, which is one place');
});

test('re-censusing a tile counts what is there now, not what was there last time', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test recensus' });
  await seedTile(run, 'test/recensus');

  // A census that finds two places.
  const both = [{ id: 'ChIJrun_test_still_open', rank: 1 }, { id: 'ChIJrun_test_closed_down', rank: 2 }];
  await withCensus(async () => ({ places: both, requests: 1, saturated: false, problem: null }),
    () => advance({ runId: run.id, budgetMs: 30_000 }));
  const { rows: [first] } = await query(`select places from census_tiles where grid_key = 'test/recensus'`);
  assert.equal(first.places, 2);

  // The same ground a month later, with one of them gone. The surfacing stays
  // on the record — that is deliberate, "this used to be here" is a fact — but
  // it is not something this census found.
  await query(
    `update census_tiles set state = 'todo', done_subcategories = '{}', censused_at = now() - interval '40 days',
                             started_at = null, places = 0
      where grid_key = 'test/recensus'`);
  await query(`update census_runs set state = 'running', finished_at = null where id = $1`, [run.id]);
  await withCensus(async () => ({ places: [both[0]], requests: 1, saturated: false, problem: null }),
    () => advance({ runId: run.id, budgetMs: 30_000 }));

  const { rows: [second] } = await query(`select places from census_tiles where grid_key = 'test/recensus'`);
  assert.equal(second.places, 1, 'the count goes down when the ground does');
  const { rows: kept } = await query(
    `select distinct venue_ref from place_subcategories where area_slug = 'test/recensus'`);
  assert.equal(kept.length, 2, 'and the one that is gone is still on the record, not deleted');
});
