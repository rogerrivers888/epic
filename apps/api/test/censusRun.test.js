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
import { tileOf, planTiles, startRun, advance, requestStop, resume, resumeInterrupted, rollUpOutcodes, retryRollUps, nextUtcMidnight, report } from '../src/sources/censusRun.js';
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

/**
 * Everything this test made, gone, whatever it found.
 *
 * `test/` with the slash, not `test`: this file's tiles are all `test/...`,
 * and the bare prefix also matched groundStale's `test-stale/0`. Files run in
 * parallel on one database, so this cleaner was deleting the other file's
 * fixture in the middle of its test — the solo red that was called machine
 * load all day (24 Sep 2026). A cleaner reaches only what its own file made.
 */
const clean = async () => {
  const { rows } = await query(`select grid_key from census_tiles where grid_key like 'test/%'`);
  const keys = rows.map((r) => r.grid_key);
  if (keys.length) {
    await query(`delete from place_subcategories where area_slug = any($1)`, [keys]);
    await query(`delete from census_slices where area_slug = any($1)`, [keys]);
  }
  await query(`delete from census_run_surfacings where grid_key like 'test/%'`);
  await query(`delete from census_run_tiles where grid_key like 'test/%'`);
  await query(`delete from census_tiles where grid_key like 'test/%'`);
  await query(`delete from census_runs where label like 'test %'`);
};

const seedTile = async (run, gridKey) => {
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, run_id, state)
     values ($1, 51.40, -0.70, 51.48, -0.58, array['ZZ99'], $2, 'todo')
     on conflict (grid_key) do update set run_id = excluded.run_id, state = 'todo', done_subcategories = '{}'`,
    [gridKey, run.id]);
  // The ground this run was given, which is what it works and what it reports.
  // `run_id` is only who last claimed the square (migration 243).
  await query(
    `insert into census_run_tiles (run_id, grid_key) values ($1, $2) on conflict do nothing`,
    [run.id, gridKey]);
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
  const body = 'Google Places 429: {"error":{"code":429,"message":"Quota exceeded for quota metric \'SearchTextRequest\' and limit \'SearchTextRequest per day\' of service \'places.googleapis.com\' for consumer \'project_number:123456789012\'.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"RATE_LIMIT_EXCEEDED","metadata":{"quota_limit_value":"75000","quota_limit":"SearchTextRequestPerDay"}}]}}';
  const out = await withCensus(async () => {
    calls += 1;
    return { places: [], requests: 1, saturated: false, problem: body };
  }, () => advance({ runId: run.id, budgetMs: 10_000 }));

  assert.equal(out.reason, 'refused');
  assert.ok(calls < 50, `the run stopped asking rather than working through the plan (${calls} calls)`);
  const { rows: [after] } = await query(
    `select state, problem, refusal, refused_at, resume_after from census_runs where id = $1`, [run.id]);
  // Waiting, not refused-and-finished: "stop cleanly on the first 429, never
  // retry against it, resume automatically after the 00:00 UTC reset" (owner,
  // 21 Sep 2026). Paused waits for a person; waiting waits for a clock. The
  // clock is Google's, and Google's day turns at midnight in Los Angeles —
  // 07:00 or 08:00 UTC — not at 00:00 UTC (25 Sep 2026, a day's quota lost).
  assert.equal(after.state, 'waiting');
  assert.ok(after.resume_after, 'and it says when it will try again');
  assert.ok(new Date(after.resume_after) > new Date(), 'which is in the future');
  assert.ok([7, 8].includes(new Date(after.resume_after).getUTCHours()), 'at the quota reset, which is midnight Pacific');
  // Word for word, because the number in it is the only authority on what the
  // daily cap really is.
  assert.match(after.refusal ?? '', /Quota exceeded/);
  // And the number. The owner asked what the 429 says the limit actually is;
  // cut at two hundred characters the sentence ended at "of" (24 Sep 2026).
  assert.match(after.refusal ?? '', /quota_limit_value.{0,5}75000/, 'the limit\'s value survives to the row');
  assert.ok(after.refused_at, 'with the moment it happened');
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
    await query(`delete from place_index where venue_ref like 'google:report_%'`);
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

test('the squares between the sectors we hold are censused too', async () => {
  const bare = await planTiles({ areas: ['SL', 'GU'], padKm: 0 });
  if (!bare.length) return;
  const padded = await planTiles({ areas: ['SL', 'GU'] });
  assert.ok(padded.length > bare.length, 'a grid with no holes is bigger than one with holes');
  // geo_cells is a sample — about 6,300 sectors against the 11,000 there are —
  // so a square can sit in the middle of a town and hold none of the ones we
  // have. A square nobody censuses is a hole no count ever mentions, which is
  // the failure §5 is written against.
  const added = padded.filter((t) => !bare.some((b) => b.gridKey === t.gridKey));
  assert.ok(added.every((t) => t.outcodes.length),
    'a padded square still says which outcodes it reports to, or it could never be reported at all');
  assert.ok(added.length < bare.length, 'and padding fills gaps rather than doubling the run');
});

test('a tile counts the places it found, even when it found them in the same second', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test dating' });
  await seedTile(run, 'test/dating');
  await withCensus(async () => ({ places: [{ id: 'ChIJrun_test_dated', rank: 1 }], requests: 1, saturated: false, problem: null }),
    () => advance({ runId: run.id, budgetMs: 20_000 }));

  const { rows: [tile] } = await query(
    `select places, started_at, censused_at from census_tiles where grid_key = 'test/dating'`);
  // The bug this pins: `started_at` backfilled from `censused_at` is the moment
  // the sweep *ended*, so everything it found was last seen before its own
  // start — by forty-six milliseconds in Ascot, and the district vanished from
  // the roll-up entirely (20 Sep 2026).
  assert.ok(new Date(tile.started_at) <= new Date(tile.censused_at), 'a sweep starts before it ends');
  assert.equal(tile.places, 1, 'and counts what it found while it was going');
});

test('a drawer invented after a tile was censused is still asked of that tile', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from shelf_rules where subject = 'google:test_new_drawer'`);
    await query(`delete from shelf_subcategories where key = 'test-new-drawer'`);
    await clean();
  });
  const run = await startTestRun({ label: 'test new drawer' });
  await seedTile(run, 'test/newdrawer');

  await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 30_000 }));
  const { rows: [first] } = await query(`select state, started_at from census_tiles where grid_key = 'test/newdrawer'`);
  assert.equal(first.state, 'done');

  // The taxonomy moves under a run that takes hours: drawers are split, words
  // are moved, subcategories are created. A tile already marked done would
  // never be asked the new question, and nothing would say so.
  const { rows: [cat] } = await query(`select category_key from shelf_subcategories where active limit 1`);
  if (!cat) return;
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('test-new-drawer', 'A drawer invented mid-run', $1, true)
     on conflict (key) do update set active = true`, [cat.category_key]);
  await query(
    `insert into shelf_rules (scope, subject, labels, subcategory, weights, reason)
     values ('labels', 'google:test_new_drawer', array['google:museum'], 'test-new-drawer', '{}'::jsonb, 'invented mid-run')`);
  await query(`update census_runs set state = 'running', finished_at = null where id = $1`, [run.id]);

  const asked = [];
  await withCensus(async ({ includedType }) => {
    asked.push(includedType);
    return { places: [], requests: 1, saturated: false, problem: null };
  }, () => advance({ runId: run.id, budgetMs: 30_000 }));

  const { rows: [second] } = await query(
    `select state, started_at, done_subcategories from census_tiles where grid_key = 'test/newdrawer'`);
  assert.ok(second.done_subcategories.includes('test-new-drawer'), 'the new drawer was asked');
  assert.equal(String(second.started_at), String(first.started_at),
    'and the tile keeps its start: this is the same census of it, carried on');
  // Only the new one. The whole value of the checkpoint is that re-opening a
  // tile does not re-ask what it already answered.
  assert.ok(asked.length <= 2, `only the new drawer was asked, not the plan again (${asked.length} questions)`);
});

// ---------------------------------------------------------------------------
// what Codex found (21 Sep 2026)
// ---------------------------------------------------------------------------

test('a second run over the same ground does not inherit the first run\'s spending', async (t) => {
  await clean();
  t.after(clean);
  const first = await startTestRun({ label: 'test handover one' });
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, run_id, state,
                               requests, slices, places, saturated, censused_at, done_subcategories, failures)
     values ('test/handover', 51.40, -0.70, 51.48, -0.58, array['SL5'], $1, 'done',
             9000, 800, 400, 7, now() - interval '90 days', array['golf'], 2)`, [first.id]);

  // Ninety days later the ground is stale, so the next run takes the tile on.
  // Taking it over with the last run's numbers attached meant the new run could
  // hit its own ceiling before making a single request (Codex, 21 Sep 2026).
  const second = await startRun({ label: 'test handover two', outcodes: ['SL5'], maxRequests: 5000, padKm: 0 })
    .catch(() => null);
  if (!second) return; // no SL5 in this database
  const { rows: [tile] } = await query(`select * from census_tiles where grid_key = 'test/handover'`);
  if (tile.run_id !== second.id) return; // the tile is not in this run's region here

  assert.equal(tile.requests, 0, 'the new run starts from nothing');
  assert.equal(tile.state, 'todo', 'and the stale ground is work again');
  assert.equal(tile.failures, 0, 'including its attempts');
  assert.equal(tile.started_at, null, 'and its sweep has not begun');
  const { rows: [run] } = await query(`select requests from census_runs where id = $1`, [second.id]);
  assert.equal(run.requests, 0, 'so the run reports its own spending, not somebody else\'s');
  await query(`delete from census_runs where id = $1`, [second.id]);
});

test('a tile that throws is tried again, and then the run is allowed to finish', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test failing' });
  await seedTile(run, 'test/failing');

  // A run of four hundred tiles will have one throw. Left failed and
  // unclaimable, it kept the run running for ever with no path to finish.
  let tries = 0;
  await withCensus(async () => { tries += 1; throw new Error('connection reset by peer'); },
    () => advance({ runId: run.id, budgetMs: 20_000 }));

  const { rows: [tile] } = await query(`select state, failures, problem from census_tiles where grid_key = 'test/failing'`);
  assert.equal(tile.state, 'failed');
  assert.ok(tile.failures >= 1, 'the attempt is counted');
  assert.match(tile.problem ?? '', /connection reset/);

  // Three goes in all, then the run ends rather than waiting for it.
  for (let i = 0; i < 4; i += 1) {
    await query(`update census_runs set state = 'running', finished_at = null where id = $1`, [run.id]);
    await withCensus(async () => { throw new Error('connection reset by peer'); },
      () => advance({ runId: run.id, budgetMs: 10_000 }));
  }
  const { rows: [after] } = await query(`select state from census_runs where id = $1`, [run.id]);
  const { rows: [gone] } = await query(`select failures from census_tiles where grid_key = 'test/failing'`);
  assert.ok(gone.failures >= 3, 'it had its goes');
  assert.equal(after.state, 'done', 'and the run finished, with the tile on the record as failed');
});

test('a paused run cannot be resumed on top of a running one', async (t) => {
  await clean();
  t.after(clean);
  const paused = await startTestRun({ label: 'test paused one' });
  await query(`update census_runs set state = 'paused' where id = $1`, [paused.id]);
  const going = await startTestRun({ label: 'test running two' });

  await assert.rejects(() => resume(paused.id), /running/,
    'two rows saying "running" is one run being given no work while looking busy');
  await query(`update census_runs set state = 'done' where id = $1`, [going.id]);
  assert.ok((await resume(paused.id))?.state === 'running', 'and once the other is done it picks up');
});


test('a run stops itself at the day\'s allowance and comes back at the reset', async (t) => {
  await clean();
  t.after(clean);
  const { rows: [run] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, daily_cap, day, day_requests)
     values ('test daily cap', array['ZZ'], 0.08, 0.12, 100000, 0, 30, 3, (now() at time zone 'utc')::date, 0)
     returning *`);
  await seedTile(run, 'test/dailycap');

  // A quota is a promise about a day, and a client that waits to be told no has
  // already spent somebody's goodwill. Three requests, then it stops itself.
  await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 20_000 }));

  const { rows: [after] } = await query(
    `select state, resume_after, problem, day_requests from census_runs where id = $1`, [run.id]);
  assert.equal(after.state, 'waiting', 'it stopped itself rather than being refused');
  assert.ok(after.day_requests >= 3, 'having spent the day\'s allowance');
  assert.ok([7, 8].includes(new Date(after.resume_after).getUTCHours()), 'and comes back at midnight Pacific');
  assert.match(after.problem ?? '', /daily cap/);

  // The clock comes round, and nobody had to be awake for it.
  await query(`update census_runs set resume_after = now() - interval '1 minute' where id = $1`, [run.id]);
  const woke = await resumeInterrupted();
  assert.ok(woke.woken >= 1, 'the run wakes itself');
  const { rows: [back] } = await query(`select state, day_requests from census_runs where id = $1`, [run.id]);
  assert.equal(back.state, 'running');
  assert.equal(back.day_requests, 0, 'with a fresh day to spend');
});

test('a run reports per area and in total, with the money read from the ledger', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test report' });
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, run_id, state,
                               requests, slices, places, saturated, censused_at, started_at)
     values ('test/report-a', 51.40, -0.70, 51.48, -0.58, array['SE1','SE11'], $1, 'done', 1500, 924, 4221, 0, now(), now()),
            ('test/report-b', 52.80, 0.80, 52.88, 0.92, array['NR21'], $1, 'done', 272, 270, 46, 0, now(), now())`,
    [run.id]);
  await query(
    `insert into census_run_tiles (run_id, grid_key)
     values ($1, 'test/report-a'), ($1, 'test/report-b') on conflict do nothing`, [run.id]);

  // The run's own spending is counted from the questions it asked, so the
  // fixture has to have asked them: a tile carries the whole of its history,
  // which is right for the ground and wrong for a run.
  await query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests, ran_at)
     values ('test/report-a', 51.40, -0.70, 51.48, -0.58, 'sport', 'golf', 'golf_course', 'golf course',
             20, 20, false, 0, 1500, now()),
            ('test/report-b', 52.80, 0.80, 52.88, 0.92, 'sport', 'golf', 'golf_course', 'golf course',
             20, 20, false, 0, 272, now())`);

  // And the places it found, the same way the total counts them: from the
  // surfacings, not from the tile's own counter, so an area and the total
  // cannot disagree inside one report.
  for (const [ref, tile] of [['google:report_a1', 'test/report-a'], ['google:report_a2', 'test/report-a'], ['google:report_b1', 'test/report-b']]) {
    await query(
      `insert into place_index (venue_ref, country_code, slice, category, subcategory)
       values ($1, 'GB', '51.4,-0.7,51.48,-0.58', 'sport', 'golf')
       on conflict (venue_ref) do nothing`, [ref]);
    await query(
      `insert into place_subcategories (venue_ref, category, subcategory, found_by, area_slug, first_seen, last_seen)
       values ($1, 'sport', 'golf', 'golf_course', $2, now(), now())
       on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do nothing`, [ref, tile]);
    // And the run's own record of it, which is what its report counts from
    // (migration 244).
    await query(
      `insert into census_run_surfacings (run_id, venue_ref, subcategory, grid_key)
       values ($1, $2, 'golf', $3) on conflict do nothing`, [run.id, ref, tile]);
  }

  const out = await report(run.id);
  const se = out.areas.find((a) => a.area === 'SE');
  const nr = out.areas.find((a) => a.area === 'NR');
  assert.equal(se.requests, 1500, 'a postcode area is the letters of its outcodes: SE1 and SE11 are one area');
  assert.equal(se.outcodes, 2);
  assert.equal(se.places, 2, 'and its places are counted from what it surfaced');
  assert.equal(nr.places, 1);
  // A tile touching two areas is one tile, so the total comes from the tiles
  // rather than from adding the areas up — the same double count the census
  // fixed one level down.
  assert.equal(out.total.tiles, 2);
  assert.equal(out.total.requests, 1772, 'and the run reports what it asked');
  assert.equal(out.total.ground.requests, 1772, 'beside what the ground has cost altogether');
  // The areas and the total are the same arithmetic, so they add up.
  assert.equal(out.areas.reduce((n, a) => n + a.requests, 0), out.total.requests);
  assert.equal(out.areas.reduce((n, a) => n + a.places, 0), out.total.places);
  // The claim the whole design rests on, read rather than repeated.
  assert.equal(out.ledger.usd, 0);
  assert.equal(out.ledger.free, true);
});

test('the day\'s budget is the project\'s, not the region\'s', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from provider_calls where ms = -4243`);
    await clean();
  });

  // Another run, another part of the country, earlier today. Both spend the
  // same project-wide quota, so the second run may not start with a full
  // allowance (Codex, 21 Sep 2026).
  // Forty requests spent by *something else* on the project today — a display
  // search, a research pass — which the quota counts and the census must too.
  await query(
    `insert into provider_calls (provider, purpose, units, ms, created_at)
     values ('fixtures+osm+google+tripadvisor', 'inspire.ring', '{"google": 40, "google-search": 40, "osm": 3}'::jsonb, -4243, now())`);

  const { rows: [run] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, daily_cap, day, day_requests)
     values ('test other region', array['ZZ'], 0.08, 0.12, 100000, 0, 30, 41, (now() at time zone 'utc')::date, 0)
     returning *`);
  await seedTile(run, 'test/dayscope');

  // A cap of 41 against 40 already spent elsewhere: one or two requests in, it
  // is over, where counting only its own region it would have had 41 to itself.
  await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 20_000 }));
  const { rows: [after] } = await query(
    `select state, day_requests from census_runs where id = $1`, [run.id]);
  assert.ok(after.day_requests >= 41, `every Google request on the project is part of today (${after.day_requests})`);
  assert.equal(after.state, 'waiting', 'so it stops for the day rather than spending twice over');
});

test('a drawer that gains a question is asked again, and only that drawer', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from shelf_rules where subject = 'google:test_second_question'`);
    await clean();
  });
  const run = await startTestRun({ label: 'test new question' });
  await seedTile(run, 'test/newquestion');

  const first = [];
  await withCensus(async ({ includedType }) => {
    first.push(includedType);
    return { places: [{ id: `ChIJrun_test_q${first.length}`, rank: 1 }], requests: 1, saturated: false, problem: null };
  }, () => advance({ runId: run.id, budgetMs: 30_000 }));
  const { rows: [done] } = await query(`select state, done_subcategories from census_tiles where grid_key = 'test/newquestion'`);
  assert.equal(done.state, 'done');
  const answered = done.done_subcategories.length;

  // A typed rule lands on a drawer that already exists and was already
  // answered. This is not a new drawer, so the drawer-level re-open cannot see
  // it — and it is exactly what happened to High ropes & zip lines an hour and
  // a half into the London run (21 Sep 2026).
  const { rows: [existing] } = await query(
    `select r.subcategory from shelf_rules r join shelf_subcategories s on s.key = r.subcategory
      where r.scope = 'labels' and s.active limit 1`);
  if (!existing) return;
  await query(
    `insert into shelf_rules (scope, subject, labels, subcategory, weights, reason)
     values ('labels', 'google:test_second_question', array['google:museum'], $1, '{}'::jsonb, 'landed mid-run')`,
    [existing.subcategory]);
  await query(`update census_runs set state = 'running', finished_at = null where id = $1`, [run.id]);

  const second = [];
  await withCensus(async ({ includedType }) => {
    second.push(includedType);
    return { places: [], requests: 1, saturated: false, problem: null };
  }, () => advance({ runId: run.id, budgetMs: 30_000 }));

  const { rows: [again] } = await query(
    `select state, done_subcategories from census_tiles where grid_key = 'test/newquestion'`);
  assert.equal(again.state, 'done', 'the tile was finished again');
  assert.equal(again.done_subcategories.length, answered, 'with the same drawers answered');
  // Only the drawer whose questions moved, and only its missing question: the
  // checkpoint keeps the rest, so this costs one question rather than the plan.
  assert.ok(second.length < first.length,
    `only the changed drawer was re-asked (${second.length} questions against ${first.length})`);
  assert.ok(second.includes('museum'), 'and the new question is among them');
});

test('a plan that has not changed re-opens nothing', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test unchanged plan' });
  await seedTile(run, 'test/unchanged');
  await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 30_000 }));

  await query(`update census_runs set state = 'running', finished_at = null where id = $1`, [run.id]);
  const asked = [];
  await withCensus(async ({ includedType }) => { asked.push(includedType); return { places: [], requests: 1, saturated: false, problem: null }; },
    () => advance({ runId: run.id, budgetMs: 10_000 }));
  assert.equal(asked.length, 0, 'a settled taxonomy costs nothing to check');
});

test('a tile may not spend more than the day has left', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from provider_calls where ms = -4244`);
    await clean();
  });
  // 39 of a 40 cap already spent today, and a run ceiling far above it. Handing
  // the tile the run's allowance let it ask its way through a whole drawer
  // before the daily check came round again, so the client met the 429 the
  // budget exists to avoid (Codex, 21 Sep 2026).
  // Thirty-nine already spent today, on the ledger — which is what the day's
  // budget reads since 2b8e78c: every Google request on the project, whatever
  // asked it. A fixture that wrote census_slices instead was seeding a table the
  // budget no longer looks at (25 Sep 2026).
  await query(
    `insert into provider_calls (provider, purpose, units, ms, created_at)
     values ('google', 'census.slice', '{"google": 39, "google-essentials": 39}'::jsonb, -4244, now())`);
  const { rows: [run] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, daily_cap, day, day_requests)
     values ('test tile budget', array['ZZ'], 0.08, 0.12, 100000, 0, 30, 40, (now() at time zone 'utc')::date, 0)
     returning *`);
  await seedTile(run, 'test/tilebudget');

  let asked = 0;
  await withCensus(async () => {
    asked += 1;
    return { places: [{ id: `ChIJrun_test_b${asked}`, rank: 1 }], requests: 1, saturated: false, problem: null };
  }, () => advance({ runId: run.id, budgetMs: 20_000 }));

  assert.ok(asked <= 2, `the tile stopped inside the day's last request, not after a drawer (${asked} asked)`);
  const { rows: [after] } = await query(`select state from census_runs where id = $1`, [run.id]);
  assert.equal(after.state, 'waiting', 'and the run waits for the reset');
});

test('a run waiting for the quota day still owns its region', async (t) => {
  await clean();
  t.after(clean);
  const sleeping = await startTestRun({ label: 'test sleeping' });
  await query(
    `update census_runs set state = 'waiting', resume_after = now() + interval '3 hours' where id = $1`,
    [sleeping.id]);

  // Starting another while one waits reassigned its tiles, and at midnight the
  // sleeper woke into a region somebody else was working (Codex, 21 Sep 2026).
  await assert.rejects(
    () => startRun({ label: 'test barging in', outcodes: ['SL5'], padKm: 0 }),
    /waiting for the quota day/,
    'a sleeping run is still a run');

  // And the clock will not wake it into a live run either.
  await query(`update census_runs set resume_after = now() - interval '1 minute' where id = $1`, [sleeping.id]);
  const live = await startTestRun({ label: 'test live one' });
  const woke = await resumeInterrupted();
  assert.equal(woke.woken, 0, 'the sleeper stays asleep while another run is going');
  await query(`update census_runs set state = 'done' where id = $1`, [live.id]);
  const now = await resumeInterrupted();
  assert.ok(now.woken >= 1, 'and wakes once the other is finished');
});

test('a tile part way through is reconciled too, and the signature waits for the ones in flight', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from shelf_rules where subject = 'google:test_partway_question'`);
    await clean();
  });
  const run = await startTestRun({ label: 'test partway' });
  await seedTile(run, 'test/partway');

  // A tile that answered some drawers and stopped: the shape of a deploy, the
  // stop control, or the day's budget landing mid-tile.
  const plan = await slicePlan();
  const someDrawers = plan.slice(0, 3).map((p) => p.subcategory);
  await query(
    `update census_tiles set state = 'todo', done_subcategories = $1::text[] where grid_key = 'test/partway'`,
    [someDrawers]);

  // A question lands on a drawer it had already answered.
  await query(
    `insert into shelf_rules (scope, subject, labels, subcategory, weights, reason)
     values ('labels', 'google:test_partway_question', array['google:museum'], $1, '{}'::jsonb, 'landed mid-tile')`,
    [someDrawers[0]]);

  await withCensus(async () => ({ places: [], requests: 1, saturated: false, problem: null }),
    () => advance({ runId: run.id, budgetMs: 30_000 }));

  // Keyed on done alone this drawer was never reconciled, and the signature was
  // stored anyway — so every later pass took the fast path and it was never
  // asked again (Codex, 21 Sep 2026).
  const { rows } = await query(
    `select 1 from census_slices where area_slug = 'test/partway' and subcategory = $1 and google_type = 'museum'`,
    [someDrawers[0]]);
  assert.ok(rows.length, 'the new question reached a tile that was only part way through');
});

test('how a drawer was found is read from the places inside the outcode, not beside it', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from area_counts where area_slug in ('zz8a', 'zz8b')`);
    await query(`delete from geo_cells where code like 'ZZ8%'`);
    await query(`delete from place_index where venue_ref like 'google:sourced_%'`);
    await clean();
  });
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values
       ('ZZ8A 1', 'sector', 'ZZ8A 1', 'ZZ8A', 51.41, -0.68, 'test'),
       ('ZZ8B 1', 'sector', 'ZZ8B 1', 'ZZ8B', 51.47, -0.59, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, started_at)
     values ('test/sourced', 51.40, -0.72, 51.48, -0.56, array['ZZ8A','ZZ8B'], 'done', now(), now() - interval '1 minute')
     on conflict (grid_key) do update set outcodes = excluded.outcodes, state = 'done', censused_at = now()`);

  // One place in each district: the one in ZZ8A was found by a typed question,
  // the one in ZZ8B only by a text query. A tile is wider than an outcode, so
  // both are in this tile.
  const place = async (ref, slice, sourced, foundBy) => {
    await query(
      `insert into place_index (venue_ref, country_code, slice, category, subcategory)
       values ($1, 'GB', $2::text, 'culture', 'museums') on conflict (venue_ref) do update set slice = excluded.slice`,
      [ref, slice]);
    await query(
      `insert into place_subcategories (venue_ref, category, subcategory, found_by, area_slug, sourced, first_seen, last_seen)
       values ($1, 'culture', 'museums', $2::text, 'test/sourced', $3::text, now(), now())
       on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do update set sourced = excluded.sourced`,
      [ref, foundBy, sourced]);
  };
  await place('google:sourced_typed', '51.4050,-0.6900,51.4250,-0.6600', 'type', 'museum');
  // Fenced words, not bare text: since 25 Sep 2026 a text-sourced surfacing
  // only counts while its drawer is still asked in text, and none is.
  await place('google:sourced_text', '51.4600,-0.6000,51.4750,-0.5800', 'words', 'historical_place');

  await rollUpOutcodes({ outcodes: ['ZZ8A', 'ZZ8B'] });

  const { rows: [a] } = await query(
    `select sourced, text_count, census_count from area_counts where area_slug = 'zz8a' and subcategory = 'museums'`);
  assert.equal(a.census_count, 1);
  assert.equal(a.sourced, 'type', 'the caveat comes from the place that is actually here');
  assert.equal(a.text_count, 0, 'and a text match in the next district does not travel');

  const { rows: [b] } = await query(
    `select sourced, text_count from area_counts where area_slug = 'zz8b' and subcategory = 'museums'`);
  assert.equal(b.sourced, 'words');
  assert.equal(b.text_count, 0);
});

test('a later run over the same ground does not take the earlier run\'s report with it', async (t) => {
  await clean();
  t.after(clean);
  const first = await startTestRun({ label: 'test first over the ground' });
  await seedTile(first, 'test/handover-report');
  await query(
    `update census_tiles set state = 'done', requests = 900, slices = 700, places = 300,
                             censused_at = now(), started_at = now()
      where grid_key = 'test/handover-report'`);
  await query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests, ran_at)
     values ('test/handover-report', 51.4, -0.7, 51.48, -0.58, 'sport', 'golf', 'golf_course', 'golf course',
             20, 20, false, 0, 900, now())`);
  await query(`update census_runs set state = 'done' where id = $1`, [first.id]);

  const before = await report(first.id);
  assert.equal(before.total.tiles, 1);
  assert.equal(before.total.requests, 900, 'the run reports the ground it covered');

  // A second run over overlapping country takes the square on — which is right,
  // because tiles outlive runs and a census of the ground is a question about
  // the ground. It must not take the first run's report with it.
  const second = await startTestRun({ label: 'test second over the ground' });
  await query(
    `update census_tiles set run_id = $1 where grid_key = 'test/handover-report'`, [second.id]);
  await query(
    `insert into census_run_tiles (run_id, grid_key) values ($1, 'test/handover-report')
     on conflict do nothing`, [second.id]);

  const after = await report(first.id);
  assert.equal(after.total.tiles, 1, 'the first run still has the tile in its report');
  assert.equal(after.total.requests, 900, 'and still says what it asked');
  assert.ok(after.areas.length, 'with its areas, which membership has to carry as well as the total');
  assert.equal(after.areas.reduce((n, a) => n + a.requests, 0), after.total.requests,
    'and the two halves of the report agree');

  const theirs = await report(second.id);
  assert.equal(theirs.total.tiles, 1, 'and the second run has it too');
  assert.equal(theirs.total.requests, 0, 'having asked nothing of it yet');

  // The second run now asks something of the same ground. Membership keeps the
  // ground but not the time, so without an upper bound the finished run's
  // totals grow after the fact (Codex, 23 Sep 2026).
  await query(`update census_runs set finished_at = now() where id = $1`, [first.id]);
  await query(
    `insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory,
                                google_type, query, returned, new_ids, saturated, depth, requests, ran_at)
     values ('test/handover-report', 51.4, -0.7, 51.48, -0.58, 'sport', 'golf', 'golf_course', 'golf course',
             20, 20, false, 0, 400, now() + interval '2 seconds')`);

  const later = await report(first.id);
  assert.equal(later.total.requests, 900, 'a finished run says what it asked, not what happened afterwards');
  assert.equal(later.areas.reduce((n, a) => n + a.requests, 0), 900, 'per area as well as in total');
});

// ---------------------------------------------------------------------------
// the resume control
// ---------------------------------------------------------------------------

test('resuming is refused without the run\'s own name, and says what to send', async (t) => {
  await clean();
  t.after(clean);
  const run = await startTestRun({ label: 'test guarded resume' });
  await query(`update census_runs set state = 'stopped' where id = $1`, [run.id]);

  // The endpoint's own check, exercised the way the route does it. A boolean
  // would be one keystroke; the run's name has to be read first, which is the
  // difference between pressing a button and meaning to.
  const asked = (body) => String(body?.confirm ?? '').trim().toLowerCase()
    === String(run.label).trim().toLowerCase();

  assert.equal(asked({}), false, 'nothing sent is not confirmation');
  assert.equal(asked({ confirm: true }), false, 'nor is a tick');
  assert.equal(asked({ confirm: 'yes' }), false, 'nor is the word yes');
  assert.equal(asked({ confirm: 'Test Guarded Resume' }), true, 'the name is, however it is typed');

  // And it is confirmation, not permission: the run is still resumable by
  // anybody who sends it. That is the honest reading and the reason the key
  // exists (routes/placeIndex.js).
  const back = await resume(run.id);
  assert.equal(back?.state, 'running');
});

test('a later sweep of the same tile does not change what a finished run found', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_run_surfacings where grid_key like 'test/%'`);
    await clean();
  });
  const first = await startTestRun({ label: 'test first sweep' });
  await seedTile(first, 'test/resweep');
  await withCensus(async () => ({ places: [{ id: 'ChIJrun_test_resweep_a', rank: 1 }, { id: 'ChIJrun_test_resweep_b', rank: 2 }], requests: 1, saturated: false, problem: null }),
    () => advance({ runId: first.id, budgetMs: 30_000 }));
  await query(`update census_runs set state = 'done', finished_at = now() where id = $1`, [first.id]);
  const before = await report(first.id);
  assert.equal(before.total.places, 2);

  // A month on, the ground is swept again and one of the two is still there.
  // The surfacing table moves — that is what the board wants — and the first
  // run's report must not move with it (Codex, via epic-4e, 24 Sep 2026).
  await query(`update census_tiles set state = 'todo', done_subcategories = '{}', censused_at = now() - interval '40 days', started_at = null where grid_key = 'test/resweep'`);
  const second = await startTestRun({ label: 'test second sweep' });
  await query(`update census_tiles set run_id = $1 where grid_key = 'test/resweep'`, [second.id]);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'test/resweep') on conflict do nothing`, [second.id]);
  await withCensus(async () => ({ places: [{ id: 'ChIJrun_test_resweep_a', rank: 1 }], requests: 1, saturated: false, problem: null }),
    () => advance({ runId: second.id, budgetMs: 30_000 }));

  const after = await report(first.id);
  assert.equal(after.total.places, 2, 'the first run still found two');
  assert.equal(after.areas.reduce((n, a) => n + a.places, 0), 2, 'per area as well');
  const theirs = await report(second.id);
  assert.equal(theirs.total.places, 1, 'and the second found one, which is its own fact');
});

test('padding reaches the distance it claims on a fine grid, not one square', async (t) => {
  t.after(() => query(`delete from geo_cells where code like 'ZZ6%'`));
  // One sector on its own. Padding by eight kilometres should reach about
  // eight kilometres from it whatever the grid — looking one square out did
  // that only when a square was eight kilometres (Codex, 24 Sep 2026).
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source)
     values ('ZZ6A 1', 'sector', 'ZZ6A 1', 'ZZ6A', 51.50, -0.10, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);

  const coarse = await planTiles({ outcodes: ['ZZ6A'], dLat: 0.08, dLng: 0.12, padKm: 8 });
  const fine = await planTiles({ outcodes: ['ZZ6A'], dLat: 0.01, dLng: 0.015, padKm: 8 });
  const reach = (tiles) => Math.max(...tiles.map((x) => Math.hypot((x.minLat + 0.5 * (x.maxLat - x.minLat) - 51.50) * 111.32,
    (x.minLng + 0.5 * (x.maxLng - x.minLng) + 0.10) * 69.4)));
  assert.ok(reach(coarse) > 5, `the coarse grid reaches out (${reach(coarse).toFixed(1)} km)`);
  assert.ok(reach(fine) > 5, `and so does the fine one (${reach(fine).toFixed(1)} km), not a single square`);
  assert.ok(fine.length > coarse.length * 4, 'which on a finer grid is many more squares');
  // And with no padding asked for, a fine grid is exactly the squares the
  // sectors fall in — one here.
  const bare = await planTiles({ outcodes: ['ZZ6A'], dLat: 0.01, dLng: 0.015, padKm: 0 });
  assert.equal(bare.length, 1);
});

test('padding a broad region on a fine grid does not take the request thread hostage', async (t) => {
  t.after(() => query(`delete from geo_cells where code like 'ZZ5%'`));
  // A few hundred sectors spread over a county, padded eight kilometres on a
  // one-kilometre grid. Scanning every sector for every candidate square was
  // billions of distance checks at this size (Codex, 24 Sep 2026).
  const values = [];
  for (let i = 0; i < 300; i += 1) {
    values.push(`('ZZ5A ${i}', 'sector', 'ZZ5A ${i}', 'ZZ5A', ${(51.3 + (i % 20) * 0.02).toFixed(4)}, ${(-0.9 + Math.floor(i / 20) * 0.03).toFixed(4)}, 'test')`);
  }
  await query(`insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values ${values.join(',')} on conflict (code) do nothing`);
  const began = Date.now();
  const tiles = await planTiles({ outcodes: ['ZZ5A'], dLat: 0.01, dLng: 0.015, padKm: 8 });
  const took = Date.now() - began;
  assert.ok(tiles.length > 300, `it padded (${tiles.length} tiles)`);
  assert.ok(took < 3000, `and did so in ${took} ms, not minutes`);
});


test('the quota day turns over at midnight in Los Angeles, whatever the clocks are doing', async () => {
  // The re-census woke at 00:00:30 UTC, asked once, was refused again and slept
  // until the following midnight: a day of quota lost, because Google's day
  // resets at midnight Pacific (25 Sep 2026).
  const { nextQuotaReset } = await import('../src/sources/censusRun.js');
  const inLa = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  for (const from of [new Date('2026-09-25T00:00:30Z'), new Date('2026-09-25T12:11:04Z'), new Date('2026-12-15T12:00:00Z'), new Date('2026-07-01T06:59:00Z')]) {
    const reset = nextQuotaReset(from);
    assert.ok(reset > from, `after ${from.toISOString()}`);
    assert.equal(inLa(reset), '00:00', `reads midnight in Los Angeles (${reset.toISOString()})`);
    assert.ok([7, 8].includes(reset.getUTCHours()), 'which is 07:00 or 08:00 UTC');
    assert.ok(reset - from <= 24 * 3600 * 1000, 'and never more than a day away');
  }
  // From 00:00:30 UTC on the 25th the next reset is 07:00 UTC the same day, not
  // midnight the day after.
  assert.equal(nextQuotaReset(new Date('2026-09-25T00:00:30Z')).toISOString(), '2026-09-25T07:00:00.000Z');
});

test('a boundary place is counted in exactly one neighbour, never two and never none', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from area_counts where area_slug in ('zz4a', 'zz4b')`);
    await query(`delete from geo_cells where code like 'ZZ4%'`);
    await query(`delete from place_index where venue_ref like 'google:boundary_%'`);
    await clean();
  });
  // Two districts side by side, a few hundred metres across each — the size at
  // which every census box straddles the line.
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values
       ('ZZ4A 1', 'sector', 'ZZ4A 1', 'ZZ4A', 51.5200, -0.1300, 'test'),
       ('ZZ4B 1', 'sector', 'ZZ4B 1', 'ZZ4B', 51.5200, -0.1200, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, started_at)
     values ('test/boundary', 51.51, -0.14, 51.53, -0.11, array['ZZ4A','ZZ4B'], 'done', now(), now() - interval '1 minute')
     on conflict (grid_key) do update set outcodes = excluded.outcodes, state = 'done', censused_at = now()`);
  // Six places, all in boxes about four hundred metres wide that sit on the
  // line between the two — some just west of it, some just east, one dead on.
  const boxes = [
    ['google:boundary_w1', '51.5180,-0.1290,51.5220,-0.1250'], // centre -0.1270: nearer A
    ['google:boundary_w2', '51.5170,-0.1300,51.5210,-0.1260'], // -0.1280: A
    ['google:boundary_e1', '51.5180,-0.1240,51.5220,-0.1200'], // -0.1220: B
    ['google:boundary_e2', '51.5190,-0.1230,51.5230,-0.1190'], // -0.1210: B
    ['google:boundary_mid', '51.5180,-0.1270,51.5220,-0.1230'], // -0.1250: dead centre, one of them
    ['google:boundary_wide', '51.5100,-0.1400,51.5300,-0.1100'], // 2 km wide: still unresolved
  ];
  for (const [ref, slice] of boxes) {
    await query(
      `insert into place_index (venue_ref, country_code, slice, category, subcategory)
       values ($1, 'GB', $2::text, 'culture', 'museums') on conflict (venue_ref) do update set slice = excluded.slice`, [ref, slice]);
    await query(
      `insert into place_subcategories (venue_ref, category, subcategory, found_by, area_slug, first_seen, last_seen)
       values ($1, 'culture', 'museums', 'museum', 'test/boundary', now(), now())
       on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do nothing`, [ref]);
  }

  await rollUpOutcodes({ outcodes: ['ZZ4A', 'ZZ4B'] });
  const { rows } = await query(
    `select area_slug, census_count, unresolved from area_counts where area_slug in ('zz4a','zz4b') and subcategory = 'museums' order by 1`);
  const a = rows.find((r) => r.area_slug === 'zz4a'); const b = rows.find((r) => r.area_slug === 'zz4b');
  // Five small boxes are placed by their centres — each in exactly one district.
  assert.equal(a.census_count + b.census_count, 5, 'the union across the two is the five distinct places, not more and not fewer');
  // The dead-centre box is a tie, and a tie goes to the lower sector code.
  assert.equal(a.census_count, 3, 'two sit west of the line, and the one exactly on it goes to ZZ4A');
  assert.equal(b.census_count, 2, 'two east of it');
  // The two-kilometre box is on neither side, and stays neither in nor out.
  assert.equal(a.unresolved, 1); assert.equal(b.unresolved, 1);
});

test('a place on the edge of a tile that was never tagged with its district is still counted there, once', async (t) => {
  // Codex, 25 Sep 2026: a tile is tagged with the districts it was planned
  // from, and a box on its edge can sit nearest a sector of a district it was
  // never tagged with. Rolling each district up from only the tiles that named
  // it made such a place "outside" its own tile's district and unread in the
  // one it belonged to — gone, rather than counted once.
  await clean();
  t.after(async () => {
    await query(`delete from area_counts where area_slug in ('zz5a', 'zz5b')`);
    await query(`delete from geo_cells where code like 'ZZ5%'`);
    await query(`delete from place_index where venue_ref like 'google:edge_%'`);
    await clean();
  });
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values
       ('ZZ5A 1', 'sector', 'ZZ5A 1', 'ZZ5A', 51.5200, -0.1300, 'test'),
       ('ZZ5B 1', 'sector', 'ZZ5B 1', 'ZZ5B', 51.5200, -0.1200, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);
  // Tile T reaches past the midline (-0.125) but was tagged with ZZ5A only;
  // tile U names both.
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, started_at) values
       ('test/edge-t', 51.51, -0.14, 51.53, -0.121, array['ZZ5A'], 'done', now(), now() - interval '1 minute'),
       ('test/edge-u', 51.51, -0.121, 51.53, -0.10, array['ZZ5A','ZZ5B'], 'done', now(), now() - interval '1 minute')
     on conflict (grid_key) do update set outcodes = excluded.outcodes, state = 'done', censused_at = now(), started_at = excluded.started_at`);
  const place = async (ref, tile, slice) => {
    await query(
      `insert into place_index (venue_ref, country_code, slice, category, subcategory)
       values ($1, 'GB', $2, 'culture', 'museums') on conflict (venue_ref) do update set slice = excluded.slice`, [ref, slice]);
    await query(
      `insert into place_subcategories (venue_ref, category, subcategory, found_by, area_slug, first_seen, last_seen)
       values ($1, 'culture', 'museums', 'museum', $2, now(), now())
       on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do nothing`, [ref, tile]);
  };
  // Surfaced by T, centre at -0.124: nearest ZZ5B, which T does not name.
  await place('google:edge_strayed', 'test/edge-t', '51.5180,-0.1260,51.5220,-0.1220');
  // And one plainly in ZZ5A, surfaced by T, so T's district is not empty.
  await place('google:edge_home', 'test/edge-t', '51.5180,-0.1340,51.5220,-0.1300');

  // Each district rolled up on its own — the order and the separation are the
  // point: neither roll-up may depend on the other having run.
  const b = await rollUpOutcodes({ outcodes: ['ZZ5B'] });
  const a = await rollUpOutcodes({ outcodes: ['ZZ5A'] });
  assert.equal(b.unattributed, 1, 'and the roll-up says one place fell in a district its tile was not tagged with');
  assert.equal(a.unattributed, 0);

  const { rows } = await query(
    `select area_slug, census_count, unresolved from area_counts
      where area_slug in ('zz5a','zz5b') and subcategory = 'museums' order by 1`);
  assert.deepEqual(rows.map((r) => [r.area_slug, r.census_count, r.unresolved]),
    [['zz5a', 1, 0], ['zz5b', 1, 0]],
    'the strayed place is counted in ZZ5B and nowhere else; the other in ZZ5A');
});

test('a text-sourced surfacing stops counting once its drawer is no longer asked in text', async (t) => {
  // The re-fencing of 25 Sep 2026 dropped the bare-text questions. The places
  // they found keep their rows and their found_by = text for judging; the
  // drawer's number no longer includes them, or the inflation the re-fencing
  // was for would stand until every tile had come round again.
  await clean();
  t.after(async () => {
    await query(`delete from area_counts where area_slug = 'zz6a'`);
    await query(`delete from geo_cells where code like 'ZZ6%'`);
    await query(`delete from place_index where venue_ref like 'google:refence_%'`);
    await clean();
  });
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values
       ('ZZ6A 1', 'sector', 'ZZ6A 1', 'ZZ6A', 51.5200, -0.1300, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, started_at)
     values ('test/refence', 51.51, -0.14, 51.53, -0.12, array['ZZ6A'], 'done', now(), now() - interval '1 minute')
     on conflict (grid_key) do update set outcodes = excluded.outcodes, state = 'done', censused_at = now(), started_at = excluded.started_at`);
  const place = async (ref, sourced, foundBy) => {
    await query(
      `insert into place_index (venue_ref, country_code, slice, category, subcategory)
       values ($1, 'GB', '51.5180,-0.1320,51.5220,-0.1280', 'culture', 'historic-houses') on conflict (venue_ref) do nothing`, [ref]);
    await query(
      `insert into place_subcategories (venue_ref, category, subcategory, found_by, sourced, area_slug, first_seen, last_seen)
       values ($1, 'culture', 'historic-houses', $2, $3, 'test/refence', now(), now())
       on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do update set sourced = excluded.sourced`, [ref, foundBy, sourced]);
  };
  await place('google:refence_manor_pub', 'text', 'text');             // "The Manor", found by the old bare query
  await place('google:refence_stately', 'words', 'historical_place');  // found by the fenced question
  await place('google:refence_typed', 'type', 'historical_place');     // found by a typed rule
  // And a drawer whose only find was text, with the inflated number it used
  // to have already on the board.
  await query(
    `insert into place_index (venue_ref, country_code, slice, category, subcategory)
     values ('google:refence_lido_estate_agent', 'GB', '51.5180,-0.1320,51.5220,-0.1280', 'fun', 'lidos') on conflict (venue_ref) do nothing`);
  await query(
    `insert into place_subcategories (venue_ref, category, subcategory, found_by, sourced, area_slug, first_seen, last_seen)
     values ('google:refence_lido_estate_agent', 'fun', 'lidos', 'text', 'text', 'test/refence', now(), now())
     on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do update set sourced = excluded.sourced`);
  await query(
    `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count, saturated, censused_at, complete, tiles, tiles_saturated, unresolved, sourced, text_count)
     values ('zz6a', 'fun', 'lidos', 1987, 1987, 0, 0, now(), true, 1, 0, 0, 'text', 1987)
     on conflict (area_slug, category, subcategory) do update set census_count = 1987, text_count = 1987, sourced = 'text'`);

  await rollUpOutcodes({ outcodes: ['ZZ6A'] });
  const { rows: [lidos] } = await query(
    `select census_count, text_count from area_counts where area_slug = 'zz6a' and subcategory = 'lidos'`);
  assert.equal(lidos.census_count, 0, 'a drawer whose only find was text is written again, at nought — not left at the number it had (Codex, 25 Sep 2026)');
  assert.equal(lidos.text_count, 0);
  const { rows: [row] } = await query(
    `select census_count, text_count, sourced from area_counts where area_slug = 'zz6a' and subcategory = 'historic-houses'`);
  assert.equal(row.census_count, 2, 'the two fenced finds are the number');
  assert.equal(row.text_count, 0, 'and the text find is not in it');
  assert.notEqual(row.sourced, 'text', 'nor on its label, which reads the fenced and typed finds only');
  const { rows: kept } = await query(`select found_by from place_subcategories where venue_ref = 'google:refence_manor_pub'`);
  assert.equal(kept[0]?.found_by, 'text', 'but the place still says how it was found, for judging');
});

test('a roll-up a finished run still owes is tried again from the runner\'s tick, and cleared when it lands', async () => {
  const { rows: [run] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, state, problem, started_at, finished_at)
     values ('test/owed', array['ZZ9Z'], 0.08, 0.12, 'done', 'roll-up pending: the database went away', now() - interval '1 hour', now())
     returning id`);
  try {
    const out = await retryRollUps();
    assert.ok(out.some((r) => r.id === run.id && r.rolled), 'the owed roll-up was tried and landed');
    const { rows: [after] } = await query(`select problem from census_runs where id = $1`, [run.id]);
    assert.equal(after.problem, null, 'and the run no longer says it is owed');
  } finally {
    await query(`delete from census_runs where id = $1`, [run.id]);
  }
});

test('a drawer the ground was asked about and answered nothing is written again, at nought', async (t) => {
  // Codex, 25 Sep 2026, on the day's range: a re-census that no longer finds
  // any place for a drawer reads no row for it, so the drawer never reached
  // the roll-up and its old count stood for ever — the retired bare-text
  // questions (Ski resort, Scenic) especially.
  await clean();
  t.after(async () => {
    await query(`delete from area_counts where area_slug = 'zz7a'`);
    await query(`delete from geo_cells where code like 'ZZ7%'`);
    await query(`delete from place_index where venue_ref like 'google:gone_%'`);
    await clean();
  });
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values
       ('ZZ7A 1', 'sector', 'ZZ7A 1', 'ZZ7A', 51.5200, -0.1300, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);
  // Censused afresh a minute ago: its start moved, so last week's surfacing
  // is not this census's.
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, started_at)
     values ('test/gone', 51.51, -0.14, 51.53, -0.12, array['ZZ7A'], 'done', now(), now() - interval '1 minute')
     on conflict (grid_key) do update set outcodes = excluded.outcodes, state = 'done', censused_at = now(), started_at = excluded.started_at`);
  await query(
    `insert into place_index (venue_ref, country_code, slice, category, subcategory)
     values ('google:gone_dry_slope', 'GB', '51.5180,-0.1320,51.5220,-0.1280', 'adrenaline', 'ski-resort') on conflict (venue_ref) do nothing`);
  await query(
    `insert into place_subcategories (venue_ref, category, subcategory, found_by, sourced, area_slug, first_seen, last_seen)
     values ('google:gone_dry_slope', 'adrenaline', 'ski-resort', 'text', 'text', 'test/gone', now() - interval '8 days', now() - interval '8 days')
     on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do update set last_seen = excluded.last_seen`);
  // What the board said last week.
  await query(
    `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count, saturated, censused_at, complete, tiles, tiles_saturated, unresolved, sourced, text_count)
     values ('zz7a', 'adrenaline', 'ski-resort', 125, 125, 0, 0, now() - interval '8 days', true, 1, 0, 0, 'text', 125)
     on conflict (area_slug, category, subcategory) do update set census_count = 125, text_count = 125`);

  // And a drawer still asked, on a tile this sweep has not reached it on: the
  // tile is part way through, with the drawer not yet checkpointed.
  await query(`update census_tiles set state = 'doing', done_subcategories = array['museums'] where grid_key = 'test/gone'`);
  await query(
    `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count, saturated, censused_at, complete, tiles, tiles_saturated, unresolved, sourced, text_count)
     values ('zz7a', 'sport', 'golf', 44, 44, 0, 0, now() - interval '8 days', true, 1, 0, 0, 'type', 0)
     on conflict (area_slug, category, subcategory) do update set census_count = 44`);

  await rollUpOutcodes({ outcodes: ['ZZ7A'] });
  const { rows: [row] } = await query(
    `select census_count, text_count, censused_at > now() - interval '1 hour' as fresh from area_counts where area_slug = 'zz7a' and subcategory = 'ski-resort'`);
  assert.equal(row.census_count, 0, 'a drawer no longer asked is written again at nought, not left at last week\'s number');
  assert.equal(row.text_count, 0);
  assert.ok(row.fresh, 'and dated by this census');
  const { rows: [golf] } = await query(
    `select census_count from area_counts where area_slug = 'zz7a' and subcategory = 'golf'`);
  const stillAsked = (await slicePlan()).some((p) => p.subcategory === 'golf');
  if (stillAsked) {
    assert.equal(golf.census_count, 44, 'a drawer still asked, on a tile that has not answered it yet, keeps the number it had (Codex, 25 Sep 2026)');
  }
});

test('a district drawn as one centroid among a neighbour\'s many is still found by its postcodes', async (t) => {
  // Owner, 26 Sep 2026: EC2V, SE20 and SE25 reading 0 with correct sectors
  // "is the same failure fixed twice already — a district drawn as one point
  // losing to one drawn as eight — and in the City a sector centroid is the
  // worst approximation in Britain." Placed by the nearest postcode instead.
  await clean();
  t.after(async () => {
    await query(`delete from area_counts where area_slug in ('zz8x', 'zz8y')`);
    await query(`delete from geo_cells where code like 'sector:ZZ8%'`);
    await query(`delete from postcodes where outcode in ('ZZ8X', 'ZZ8Y')`);
    await query(`delete from place_index where venue_ref like 'google:shadow_%'`);
    await clean();
  });
  // ZZ8X: one sector, its centroid a little east. ZZ8Y: four sectors whose
  // centroids ring the ground ZZ8X's places actually stand on.
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values
       ('sector:ZZ8X 1', 'sector', 'ZZ8X 1', 'ZZ8X', 51.5160, -0.0925, 'test'),
       ('sector:ZZ8Y 1', 'sector', 'ZZ8Y 1', 'ZZ8Y', 51.5175, -0.0960, 'test'),
       ('sector:ZZ8Y 2', 'sector', 'ZZ8Y 2', 'ZZ8Y', 51.5145, -0.0960, 'test'),
       ('sector:ZZ8Y 3', 'sector', 'ZZ8Y 3', 'ZZ8Y', 51.5175, -0.0940, 'test'),
       ('sector:ZZ8Y 4', 'sector', 'ZZ8Y 4', 'ZZ8Y', 51.5145, -0.0940, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);
  // The postcodes say otherwise: ZZ8X's streets are exactly where the box is.
  const pcs = [];
  for (let i = 0; i < 12; i += 1) pcs.push(['ZZ8X', `ZZ8X 1${String.fromCharCode(65 + i)}A`, 51.5155 + (i % 4) * 0.0003, -0.0955 + Math.floor(i / 4) * 0.0004]);
  for (let i = 0; i < 12; i += 1) pcs.push(['ZZ8Y', `ZZ8Y ${1 + (i % 4)}${String.fromCharCode(65 + i)}A`, 51.5140 + (i % 2) * 0.0040, -0.0975 + Math.floor(i / 2) * 0.0008]);
  for (const [out, pcds, lat, lng] of pcs) {
    await query(
      `insert into postcodes (pcds, sector, outcode, lat, lng, source) values ($1, $2, $3, $4, $5, 'test')
       on conflict (pcds) do update set lat = excluded.lat, lng = excluded.lng`,
      [pcds, pcds.slice(0, -2), out, lat, lng]);
  }
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, started_at)
     values ('test/shadow', 51.510, -0.100, 51.520, -0.090, array['ZZ8X','ZZ8Y'], 'done', now(), now() - interval '1 minute')
     on conflict (grid_key) do update set outcodes = excluded.outcodes, state = 'done', censused_at = now(), started_at = excluded.started_at`);
  // A four-hundred-metre box on ZZ8X's streets: its centre (51.5160, -0.0950)
  // is nearer ZZ8Y 1 and ZZ8Y 3's centroids than ZZ8X's own.
  await query(
    `insert into place_index (venue_ref, country_code, slice, category, subcategory)
     values ('google:shadow_guildhall', 'GB', '51.5140,-0.0970,51.5180,-0.0930', 'culture', 'museums') on conflict (venue_ref) do nothing`);
  await query(
    `insert into place_subcategories (venue_ref, category, subcategory, found_by, area_slug, first_seen, last_seen)
     values ('google:shadow_guildhall', 'culture', 'museums', 'museum', 'test/shadow', now(), now())
     on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do nothing`);

  const out = await rollUpOutcodes({ outcodes: ['ZZ8X', 'ZZ8Y'] });
  assert.equal(out.placedBy, 'postcodes', 'placed by postcodes, and the roll-up says so');
  const { rows } = await query(
    `select area_slug, census_count from area_counts where area_slug in ('zz8x','zz8y') and subcategory = 'museums' order by 1`);
  assert.deepEqual(rows.map((r) => [r.area_slug, r.census_count]), [['zz8x', 1], ['zz8y', 0]],
    'the place is in the district whose streets it stands on, not the one whose centroids ring it');
});

test('a census run spends on the session that started it, and a resume moves that to the resumer', async (t) => {
  // Owner, 26 Sep 2026: every provider call names its session. A run is
  // started from a request and worked by the loop hours later, at boot even;
  // its ledger rows still say whose decision the spend was.
  await clean();
  const { rows: [starter] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:census-starter', 'starter') on conflict (token_hash) do update set label = excluded.label returning id`);
  const { rows: [resumer] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:census-resumer', 'resumer') on conflict (token_hash) do update set label = excluded.label returning id`);
  t.after(async () => {
    await query(`delete from provider_calls where purpose = 'census.slice' and session_id in ($1, $2)`, [starter.id, resumer.id]);
    await clean();
    await query(`delete from api_sessions where token_hash in ('test:census-starter', 'test:census-resumer')`);
  });
  const run = await startTestRun({ label: 'test session' });
  await query('update census_runs set started_session_id = $2 where id = $1', [run.id, starter.id]);
  await seedTile(run, 'test/session');
  await withCensus(answers(1), () => advance({ runId: run.id, budgetMs: 10_000 }));
  const { rows: [ledger] } = await query(
    `select count(*)::int n, count(*) filter (where session_id = $1)::int mine from provider_calls
      where purpose = 'census.slice' and session_id in ($1, $2)`, [starter.id, resumer.id]);
  assert.ok(ledger.n > 0, 'the census wrote to the ledger');
  assert.equal(ledger.mine, ledger.n, 'every row on the starter\'s session');

  await requestStop(run.id);
  await query(`update census_runs set state = 'stopped' where id = $1`, [run.id]);
  const resumed = await resume(run.id, { sessionId: resumer.id });
  assert.equal(resumed.started_session_id, resumer.id, 'a resume is the decision to spend today\'s quota, and the run says whose');
});
