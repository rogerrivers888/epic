/**
 * The cost-band distribution runner (sources/costDistribution.js; owner, 1 Oct
 * 2026). Enumerates an area's google: places, looks each up once for its price
 * level alone, and tallies the four-step scale's coverage as an aggregate
 * histogram — telling apart Google-holds-it-but-no-price from an id that will not
 * resolve (a stale id). No per-place price is stored (the policy forbids it): the
 * sample table is a pure claim ledger and the counts live on the run. The Place
 * Details call is injected, so the runner is exercised without spending.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
test.after(() => pool.end());

const dist = await import('../src/sources/costDistribution.js');

const AREA = 'zzdist';
async function seed() {
  await query(`delete from cost_dist_runs where area_slug = $1`, [AREA]);
  await query(`delete from place_areas where area_slug = $1`, [AREA]);
  const refs = ['google:A', 'google:B', 'google:C', 'google:D', 'google:E', 'osm:way/1'];
  for (const r of refs) {
    await query(`insert into place_index (venue_ref) values ($1) on conflict (venue_ref) do nothing`, [r]);
    await query(`insert into place_areas (venue_ref, area_slug) values ($1, $2) on conflict do nothing`, [r, AREA]);
  }
}

test('refsFor returns only the area\'s google: places', async (t) => {
  await seed(); t.after(() => query(`delete from place_areas where area_slug = $1`, [AREA]));
  const refs = await dist.refsFor(AREA);
  assert.deepEqual(refs, ['google:A', 'google:B', 'google:C', 'google:D', 'google:E'], 'the osm: ref is excluded — a Place Details id cannot resolve it');
});

test('estimate prices one Place Details per unclaimed place; start gates on the count', async (t) => {
  await seed(); t.after(() => query(`delete from place_areas where area_slug = $1`, [AREA]));
  const est = await dist.estimate(AREA);
  assert.equal(est.requests, 5);
  assert.equal(est.costGbp, 0.10, '5 Place Details at $0.025, in GBP, to the penny');
  // The gate: confirm must equal the request count.
  await assert.rejects(() => dist.start({ areaSlug: AREA, confirm: 4, startedBy: 'test' }), /confirm the request count/);
  const { run, created } = await dist.start({ areaSlug: AREA, confirm: 5, startedBy: 'test', startedSessionId: null });
  assert.ok(run.id);
  assert.equal(created, true, 'a fresh run is created');
  assert.equal(run.requests, 5);
  assert.deepEqual(run.refs, ['google:A', 'google:B', 'google:C', 'google:D', 'google:E'], 'the place set is frozen onto the run');
  // A second start while one runs resumes rather than duplicates, and does not create.
  const again = await dist.start({ areaSlug: AREA, confirm: 0, startedBy: 'test' });
  assert.equal(again.run.id, run.id, 'resumed, not a second run');
  assert.equal(again.created, false, 'the loser does not create — it resumes the winner');
  assert.equal(again.reclaim, false, 'a run just created is being worked, not reclaimable');
});

test('work records one band per place, and status splits no-price from unresolved', async (t) => {
  await seed(); t.after(() => query(`delete from place_areas where area_slug = $1`, [AREA]));
  const { run } = await dist.start({ areaSlug: AREA, confirm: 5, startedBy: 'test' });
  // Injected Place Details: a price, Free, the top (capped), a resolve with no
  // price, and an id that will not resolve at all.
  const answers = {
    A: { priceLevel: 2 }, B: { priceLevel: 0 }, C: { priceLevel: 4 }, D: { priceLevel: null }, E: '__notfound__',
  };
  const get = async (id) => {
    // A definite not-found (404) is a stale id; the worker counts it unresolved.
    if (answers[id] === '__notfound__') throw new Error('Google Places 404: NOT_FOUND');
    return answers[id];
  };
  const finished = await dist.work(run.id, { get });
  assert.equal(finished.state, 'done');

  const st = await dist.status(AREA);
  assert.equal(st.sampled, 5);
  assert.equal(st.withLevel, 3, 'A, B and C carry a level');
  assert.deepEqual(st.bands, { Free: 1, '£': 0, '££': 1, '£££': 1 }, 'B Free, A ££, C £££ (level 4 caps)');
  assert.equal(st.noPriceLevel, 1, 'D: Google holds it but gives no price');
  assert.equal(st.unresolved, 1, 'E: a stale id Place Details would not resolve');
  assert.equal(st.run.state, 'done');

  // The policy: no per-place price is stored — the ledger holds ids only.
  const { rows } = await query('select * from cost_dist_samples where run_id = $1', [run.id]);
  assert.equal(rows.length, 5, 'one claim row per place looked up');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['at', 'run_id', 'venue_ref'], 'the ledger carries no price');
});

test('a transient failure pauses the run resumably, and never records a false stale id', async (t) => {
  await seed(); t.after(() => query(`delete from place_areas where area_slug = $1`, [AREA]));
  const { run } = await dist.start({ areaSlug: AREA, confirm: 5, startedBy: 'test' });
  // A rate limit on the second place: not a not-found, so the id is not stale.
  let hits = 0;
  const get = async (id) => {
    if (id === 'B') { hits += 1; if (hits === 1) throw new Error('Google Places 429: RESOURCE_EXHAUSTED'); }
    return { priceLevel: 1 };
  };
  const paused = await dist.work(run.id, { get });
  assert.equal(paused.state, 'running', 'a 429 pauses the run — kept running so it is reclaimed, not abandoned');
  assert.match(paused.problem, /google:B/, 'the pause names where it halted');
  let st = await dist.status(AREA);
  assert.equal(st.sampled, 1, 'only google:A was counted; B was not recorded as unresolved');
  assert.equal(st.unresolved, 0, 'a transient failure is not a stale id');
  // B's claim was released, so a resume retries it rather than skipping it.
  const { rows: bClaim } = await query('select 1 from cost_dist_samples where run_id = $1 and venue_ref = $2', [run.id, 'google:B']);
  assert.equal(bClaim.length, 0, 'the paused place\'s claim is released for the retry');

  // A paused run is reclaimable, and resume() finishes it from where it left off.
  const again = await dist.start({ areaSlug: AREA, confirm: 0, startedBy: 'test' });
  assert.equal(again.reclaim, true, 'a paused run reports itself reclaimable');
  const finished = await dist.work(run.id, { get });
  assert.equal(finished.state, 'done', 'the retry succeeds and the run completes');
  st = await dist.status(AREA);
  assert.equal(st.sampled, 5, 'all five counted after the resume');
});

test('work resumes where it left off — a place already claimed is not asked again', async (t) => {
  await seed(); t.after(() => query(`delete from place_areas where area_slug = $1`, [AREA]));
  const { run } = await dist.start({ areaSlug: AREA, confirm: 5, startedBy: 'test' });
  // Pretend three were already claimed (looked up) before a deploy.
  for (const ref of ['google:A', 'google:B', 'google:C']) {
    await query(`insert into cost_dist_samples (run_id, venue_ref) values ($1, $2)`, [run.id, ref]);
  }
  const asked = [];
  const get = async (id) => { asked.push(id); return { priceLevel: 2 }; };
  await dist.work(run.id, { get });
  assert.deepEqual(asked.sort(), ['D', 'E'], 'only the two unclaimed places are looked up');
});
