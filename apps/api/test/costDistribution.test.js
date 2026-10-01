/**
 * The cost-band distribution runner (sources/costDistribution.js; owner, 1 Oct
 * 2026). Enumerates an area's google: places, looks each up once, and tallies the
 * four-step scale's coverage — telling apart Google-holds-it-but-no-price from
 * an id that will not resolve (a stale id). The Place Details call is injected,
 * so the runner is exercised without spending.
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

test('estimate prices one Place Details per unsampled place; start gates on the count', async (t) => {
  await seed(); t.after(() => query(`delete from place_areas where area_slug = $1`, [AREA]));
  const est = await dist.estimate(AREA);
  assert.equal(est.requests, 5);
  assert.equal(est.costGbp, 0.13, '5 × 2.5p, to the penny');
  // The gate: confirm must equal the request count.
  await assert.rejects(() => dist.start({ areaSlug: AREA, confirm: 4, startedBy: 'test' }), /confirm the request count/);
  const run = await dist.start({ areaSlug: AREA, confirm: 5, startedBy: 'test', startedSessionId: null });
  assert.ok(run.id);
  assert.equal(run.requests, 5);
  // A second start while one runs resumes rather than duplicates.
  const again = await dist.start({ areaSlug: AREA, confirm: 0, startedBy: 'test' });
  assert.equal(again.id, run.id, 'resumed, not a second run');
});

test('work records a sample per place, and status splits no-price from unresolved', async (t) => {
  await seed(); t.after(() => query(`delete from place_areas where area_slug = $1`, [AREA]));
  const run = await dist.start({ areaSlug: AREA, confirm: 5, startedBy: 'test' });
  // Injected Place Details: a price, Free, the top (capped), a resolve with no
  // price, and an id that will not resolve at all.
  const answers = {
    A: { priceLevel: 2 }, B: { priceLevel: 0 }, C: { priceLevel: 4 }, D: { priceLevel: null }, E: '__throw__',
  };
  const get = async (id) => { if (answers[id] === '__throw__') throw new Error('not resolved'); return answers[id]; };
  const finished = await dist.work(run.id, { get });
  assert.equal(finished.state, 'done');

  const st = await dist.status(AREA);
  assert.equal(st.sampled, 5);
  assert.equal(st.withLevel, 3, 'A, B and C carry a level');
  assert.deepEqual(st.bands, { Free: 1, '£': 0, '££': 1, '£££': 1 }, 'B Free, A ££, C £££ (level 4 caps)');
  assert.equal(st.noPriceLevel, 1, 'D: Google holds it but gives no price');
  assert.equal(st.unresolved, 1, 'E: a stale id Place Details would not resolve');
  assert.equal(st.run.state, 'done');
});

test('work resumes where it left off — a sample already written is not asked again', async (t) => {
  await seed(); t.after(() => query(`delete from place_areas where area_slug = $1`, [AREA]));
  const run = await dist.start({ areaSlug: AREA, confirm: 5, startedBy: 'test' });
  // Pretend three were already done before a deploy.
  for (const ref of ['google:A', 'google:B', 'google:C']) {
    await query(`insert into cost_dist_samples (run_id, venue_ref, price_level, resolved) values ($1, $2, 1, true)`, [run.id, ref]);
  }
  const asked = [];
  const get = async (id) => { asked.push(id); return { priceLevel: 2 }; };
  await dist.work(run.id, { get });
  assert.deepEqual(asked.sort(), ['D', 'E'], 'only the two unsampled places are looked up');
});
