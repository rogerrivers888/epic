/**
 * The census has to be free, and it has to be able to count.
 *
 * Two claims underpin the whole data policy (19 Sep 2026) and neither is
 * obviously true, so both are held here rather than believed:
 *
 *   · **Free.** A census slice asks for an id, a point and a type — Google's
 *     Essentials tier. The meter was a flat `google` priced at the Enterprise
 *     rate whatever the mask, so a census of one outcode would have reported
 *     about £1.30 and the policy's "expect nought" would have been unanswerable.
 *   · **Counts.** Google returns its top twenty and stops at sixty, so a slice
 *     that comes back full has been cut off and must be split. A census that
 *     took sixty for an answer would report sixty restaurants in Bristol.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { googleSource, skuFor } from '../src/sources/google.js';
import { costOf } from '../src/domain/providerPrices.js';
import { censusArea, slicePlan } from '../src/sources/census.js';
import { query, pool } from '../src/db.js';

test.after(() => pool.end());

// ---------------------------------------------------------------------------
// free
// ---------------------------------------------------------------------------

test('the tier is read off the mask, because the mask is what Google prices', () => {
  assert.equal(skuFor('places.id,places.location,places.types', '/places:searchText'), 'google-essentials');
  assert.equal(skuFor('id,location,types', '/places/ChIJabc'), 'google-essentials');
  // A name is not free. This is the line that decides whether the census stays
  // inside the tier it is costed on, so it is asserted rather than assumed.
  assert.equal(skuFor('places.id,places.displayName', '/places:searchText'), 'google-search');
  assert.equal(skuFor('places.id,places.rating', '/places:searchText'), 'google-search');
  assert.equal(skuFor('id,displayName,reviews', '/places/ChIJabc'), 'google-details');
  // No mask at all is somebody forgetting, not somebody asking for nothing.
  assert.equal(skuFor('', '/places:searchText'), 'google-search');
});

test('a census slice costs nothing, and a display search still costs what it did', () => {
  assert.equal(costOf({ google: 1, 'google-essentials': 1 }), 0, 'the census is free or the policy is not affordable');
  assert.equal(costOf({ google: 40, 'google-essentials': 40 }), 0);
  assert.equal(costOf({ google: 1, 'google-search': 1 }), 0.04);
  assert.equal(costOf({ google: 1, 'google-details': 1 }), 0.025);
});

test('a request metered at a tier is not also billed the flat rate', () => {
  // Both keys are bumped on purpose: `google` so the free-allowance lines keep
  // counting requests, the tier so the money is right. Adding them up would
  // bill the same request twice — and would price the census at the Enterprise
  // rate anyway, which is the fault the split exists to fix.
  assert.equal(costOf({ google: 1, 'google-search': 1 }), 0.04, 'not 0.072');
  // A hand-built meter that says only `google` is still charged: a call that
  // does not say what it bought is assumed to have bought the dear thing.
  assert.equal(costOf({ google: 1 }), 0.032);
});

// ---------------------------------------------------------------------------
// counts
// ---------------------------------------------------------------------------

/** Stand in for Google, and record exactly what it was asked. */
const withCensus = async (impl, run) => {
  const was = googleSource.censusSlice;
  googleSource.censusSlice = impl;
  try { return await run(); } finally { googleSource.censusSlice = was; }
};

const BOX = { minLat: 51.38, minLng: -0.70, maxLat: 51.44, maxLng: -0.62 };
const place = (n) => ({ id: `ChIJcensus_test_${n}`, lat: 51.41, lng: -0.66, types: ['restaurant'] });

test('a slice cut off at sixty is split, and the parent keeps its row beside its children', async () => {
  const plan = await slicePlan();
  if (!plan.length) return; // a database with no taught Google types has nothing to slice

  const asked = [];
  // Saturated once at the top, satisfied in every tile: the shape that proves
  // the split happened rather than the ceiling being taken for an answer.
  const impl = async ({ box }) => {
    asked.push(box);
    const top = box.maxLat - box.minLat > (BOX.maxLat - BOX.minLat) / 2 + 1e-9;
    return top
      ? { places: Array.from({ length: 60 }, (_, i) => place(i)), requests: 3, saturated: true, problem: null }
      : { places: [place(`tile${asked.length}`)], requests: 1, saturated: false, problem: null };
  };

  const one = plan[0].subcategory;
  const out = await withCensus(impl, () => censusArea({
    areaSlug: 'census-test', outcode: 'ZZ99', box: BOX, subcategories: [one],
  }));

  assert.ok(asked.length > 1, 'a saturated slice is asked again in pieces');
  assert.equal(asked.filter((b) => b.maxLat - b.minLat < (BOX.maxLat - BOX.minLat) / 2 + 1e-9).length % 4, 0,
    'a box is split into four tiles, never three or five');

  const { rows } = await query(
    `select depth, saturated, parent_id from census_slices where area_slug = 'census-test' order by depth`);
  assert.ok(rows.some((r) => r.depth === 0 && r.saturated), 'the cut-off parent is still on the record');
  assert.ok(rows.some((r) => r.depth === 1 && r.parent_id), 'and its tiles point back at it');
  assert.ok(out.noted > 0, 'the union of the ids is the census');

  await query(`delete from census_slices where area_slug = 'census-test'`);
  await query(`delete from area_counts where area_slug = 'census-test'`);
});

test('a run stops at its own ceiling rather than trusting the console to stop it', async () => {
  const plan = await slicePlan();
  if (!plan.length) return;

  let calls = 0;
  const impl = async () => {
    calls += 1;
    // Always saturated: without a ceiling this recurses to the depth limit for
    // every type of every subcategory, which is the runaway the cap is for.
    return { places: [place(calls)], requests: 1, saturated: true, problem: null };
  };

  const out = await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-cap', outcode: 'ZZ98', box: BOX, maxRequests: 5,
  }));

  assert.ok(out.requests <= 5 + 4, 'the run stops within a tile of its ceiling');
  assert.ok(out.stopped, 'and says that it stopped');
  assert.match(out.problems.join(' '), /ceiling/, 'a run cut short says so rather than reading as complete');

  await query(`delete from census_slices where area_slug = 'census-test-cap'`);
  await query(`delete from area_counts where area_slug = 'census-test-cap'`);
});

test('a slice that failed is not a slice that was empty', async () => {
  const plan = await slicePlan();
  if (!plan.length) return;

  const impl = async () => ({ places: [], requests: 1, saturated: false, problem: 'Google Places 429: RESOURCE_EXHAUSTED' });
  const one = plan[0].subcategory;
  const out = await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-fail', outcode: 'ZZ97', box: BOX, subcategories: [one],
  }));

  assert.equal(out.noted, 0);
  assert.ok(out.problems.length, 'an area under-counted because Google refused must never read as an area with nothing in it');
  const { rows } = await query(`select problem from census_slices where area_slug = 'census-test-fail' limit 1`);
  assert.ok(rows[0]?.problem, 'and the reason survives onto the row');

  await query(`delete from census_slices where area_slug = 'census-test-fail'`);
  await query(`delete from area_counts where area_slug = 'census-test-fail'`);
});
