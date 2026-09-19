/**
 * What the census costs, and whether it can count at all.
 *
 * Two claims underpin the data policy (19 Sep 2026). One of them turned out to
 * be false, which is why both are held here rather than believed:
 *
 *   · **The price.** The policy is costed on the census being free. It is not:
 *     Essentials is *ids only*, and `places.location` and `places.types` — the
 *     two things a census exists to record — are Pro fields (Codex, 19 Sep
 *     2026). These tests pin each tier to its own price so the census cannot
 *     drift back into the free column without somebody saying so out loud.
 *   · **The count.** Google returns its top twenty and stops at sixty, so a
 *     slice that comes back full has been cut off and must be split. A census
 *     that took sixty for an answer would report sixty restaurants in Bristol.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { googleSource, skuFor } from '../src/sources/google.js';
import { costOf } from '../src/domain/providerPrices.js';
import { censusArea, slicePlan, noteFromDisplay, expireRentedCoordinates } from '../src/sources/census.js';
import { query, pool } from '../src/db.js';

test.after(() => pool.end());

// ---------------------------------------------------------------------------
// free
// ---------------------------------------------------------------------------

test('a point and a type are things Google charges to tell you', () => {
  // The finding that cost the policy its central claim (Codex, 19 Sep 2026).
  // Essentials is *ids only*; `places.location` and `places.types` are Pro. The
  // first draft of `skuFor` put them in the free tier, which would have recorded
  // every census slice at nought while Google billed for it — the exact failure
  // the tier split was written to prevent, inverted. Asserted here so nobody
  // can quietly move the census back into the free tier without saying so.
  assert.equal(skuFor('places.id,nextPageToken', '/places:searchText'), 'google-essentials');
  assert.equal(skuFor('places.id,places.location', '/places:searchText'), 'google-pro');
  assert.equal(skuFor('places.id,places.types', '/places:searchText'), 'google-pro');
  assert.equal(skuFor('places.id,places.location,places.types,nextPageToken', '/places:searchText'), 'google-pro');
  // An opinion is dearer than a description, and a details call is its own SKU.
  assert.equal(skuFor('places.id,places.rating', '/places:searchText'), 'google-search');
  assert.equal(skuFor('id,displayName,reviews', '/places/ChIJabc'), 'google-details');
  // No mask at all is somebody forgetting, not somebody asking for nothing.
  assert.equal(skuFor('', '/places:searchText'), 'google-search');
});

test('each tier is priced as itself', () => {
  assert.equal(costOf({ google: 1, 'google-essentials': 1 }), 0, 'ids only really are free');
  assert.equal(costOf({ google: 1, 'google-pro': 1 }), 0.032, 'and the census is not');
  assert.equal(costOf({ google: 40, 'google-pro': 40 }), 1.28);
  assert.equal(costOf({ google: 1, 'google-search': 1 }), 0.04);
  assert.equal(costOf({ google: 1, 'google-details': 1 }), 0.025);
});

test('a request metered at a tier is not also billed the flat rate', () => {
  // Both keys are bumped on purpose: `google` so the free-allowance lines keep
  // counting requests, the tier so the money is right. Adding them up would
  // bill the same request twice — and would price the census at the Enterprise
  // rate anyway, which is the fault the split exists to fix.
  assert.equal(costOf({ google: 1, 'google-search': 1 }), 0.04, 'not 0.072');
  assert.equal(costOf({ google: 1, 'google-pro': 1 }), 0.032, 'not 0.064');
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
// What IDs Only actually returns: an id and where it came in the answer.
const place = (n) => ({ id: `ChIJcensus_test_${n}`, rank: 1 });

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

test('a run that stopped early leaves the area stale rather than claiming it is done', async () => {
  // The worst outcome available: a run cut short used to roll the whole plan up
  // anyway, writing nought against every subcategory it never reached and
  // stamping the area fresh — so the next thirty days of boards showed empty
  // drawers as fact and no census would run to correct them (Codex, 19 Sep 2026).
  const plan = await slicePlan();
  if (plan.length < 2) return;

  const impl = async () => ({ places: [place('stale')], requests: 1, saturated: true, problem: null });
  const out = await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-stale', outcode: 'ZZ96', box: BOX, maxRequests: 3,
  }));
  assert.ok(out.stopped);
  assert.ok(out.completed < out.plan, 'it did not get through the plan');

  const { rows } = await query(
    `select count(*)::int n from area_counts where area_slug = 'census-test-stale'`);
  assert.equal(rows[0].n, out.completed,
    'only the subcategories that finished are written down; the rest keep no row at all');

  await query(`delete from census_slices where area_slug = 'census-test-stale'`);
  await query(`delete from area_counts where area_slug = 'census-test-stale'`);
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

// ---------------------------------------------------------------------------
// where things are, which the census is not allowed to buy
// ---------------------------------------------------------------------------

test('the census locates nothing, and the first display search locates it', async () => {
  const plan = await slicePlan();
  if (!plan.length) return;

  const impl = async () => ({ places: [{ id: 'ChIJcensus_locate', rank: 1 }], requests: 1, saturated: false, problem: null });
  await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-loc', outcode: 'ZZ95', box: BOX, subcategories: [plan[0].subcategory],
  }));

  const ref = 'google:ChIJcensus_locate';
  const after = async () => (await query(
    `select lat, lng, google_types, coords_at, coords_from, found_by, found_rank, censused_at
       from place_index where venue_ref = $1`, [ref])).rows[0];

  let row = await after();
  assert.ok(row, 'the census wrote the place down');
  assert.equal(row.lat, null, 'and did not buy a point for it');
  assert.equal(row.google_types, null, 'nor Googles words for what it is');
  assert.ok(row.found_by, 'but it does know which question found it');
  assert.ok(row.censused_at);

  // The display search is the call that locates it — one being made anyway,
  // for a place somebody is actually looking at.
  await noteFromDisplay([{ venueRef: ref, lat: 51.41, lng: -0.66, primaryType: 'restaurant', labels: ['google:restaurant', 'google:bar'] }]);
  row = await after();
  assert.equal(Number(row.lat), 51.41);
  assert.deepEqual(row.google_types.sort(), ['bar', 'restaurant']);
  assert.equal(row.coords_from, 'google', 'and dates it, because a rented point expires');
  assert.ok(row.coords_at);

  // Thirty days later it is gone, and the place stays: the id is ours, the
  // point never was.
  await query(`update place_index set coords_at = now() - interval '31 days' where venue_ref = $1`, [ref]);
  await expireRentedCoordinates();
  row = await after();
  assert.equal(row.lat, null, 'the point expired');
  assert.ok(row.censused_at, 'the place did not');

  await query(`delete from place_index where venue_ref = $1`, [ref]);
  await query(`delete from census_slices where area_slug = 'census-test-loc'`);
  await query(`delete from area_counts where area_slug = 'census-test-loc'`);
});

test("OpenStreetMap's own coordinates are ours to keep, so they never expire", async () => {
  const ref = 'osm:node/999000111';
  await query(`insert into place_index (venue_ref) values ($1) on conflict do nothing`, [ref]);
  await noteFromDisplay([{ venueRef: ref, lat: 51.4, lng: -0.6 }], { source: 'osm' });
  await query(`update place_index set coords_at = now() - interval '400 days' where venue_ref = $1`, [ref]);
  await expireRentedCoordinates();
  const { rows: [row] } = await query(`select lat, coords_from from place_index where venue_ref = $1`, [ref]);
  assert.equal(row.coords_from, 'osm');
  assert.ok(row.lat != null, 'ODbL lets us keep it, so the expiry sweep leaves it alone');
  await query(`delete from place_index where venue_ref = $1`, [ref]);
});
