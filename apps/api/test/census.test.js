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

test('a licensed point that is not Google\'s expires too', async () => {
  // Migration 184 marked every non-Google reference as OpenStreetMap's, and the
  // sweep leaves OSM alone — so a Tripadvisor coordinate would have been kept
  // for ever under a rule written to throw it away at thirty days (Codex,
  // 19 Sep 2026). Provenance is read off the reference now, and the sweep names
  // what it *keeps* rather than what it drops, so a provider added tomorrow is
  // rented by default.
  const ref = 'tripadvisor:9900112233';
  await query('insert into place_index (venue_ref) values ($1) on conflict do nothing', [ref]);
  await noteFromDisplay([{ venueRef: ref, lat: 51.4, lng: -0.6 }], { source: 'tripadvisor' });
  const { rows: [before] } = await query('select coords_from from place_index where venue_ref = $1', [ref]);
  assert.equal(before.coords_from, 'tripadvisor', 'whose point it is comes from the reference');
  await query(`update place_index set coords_at = now() - interval '31 days' where venue_ref = $1`, [ref]);
  await expireRentedCoordinates();
  const { rows: [after] } = await query('select lat, coords_from from place_index where venue_ref = $1', [ref]);
  assert.equal(after.lat, null, 'rented is rented, whoever is renting it');
  await query('delete from place_index where venue_ref = $1', [ref]);
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

test('a place found by two questions is counted under both and filed under one', async () => {
  // Golf reading nought in Ascot while Google had just returned two courses:
  // the place was filed under whichever question ran first, and the count came
  // off the filing (owner, 19 Sep 2026). A place lives on one shelf and is
  // counted under every question that found it, and the board shows both.
  const plan = await slicePlan();
  if (plan.length < 2) return;
  const [first, second] = plan;

  // The same place returned to two different subcategories.
  const impl = async () => ({ places: [{ id: 'ChIJcensus_both', rank: 1 }], requests: 1, saturated: false, problem: null });
  const out = await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-both', outcode: 'ZZ94', box: BOX,
    subcategories: [first.subcategory, second.subcategory],
  }));
  assert.equal(out.noted, 1, 'one place');
  assert.ok(out.surfacings >= 2, 'surfaced under both questions');

  const { rows: subs } = await query(
    `select subcategory from place_subcategories where venue_ref = 'google:ChIJcensus_both' order by subcategory`);
  assert.equal(subs.length, 2, 'both questions are on the record');

  const { rows: counts } = await query(
    `select subcategory, census_count, surfaced_count from area_counts
      where area_slug = 'census-test-both' order by subcategory`);
  assert.equal(counts.reduce((n, r) => n + r.census_count, 0), 1, 'filed once');
  assert.equal(counts.reduce((n, r) => n + r.surfaced_count, 0), 2, 'found twice');
  // The one the board is for: the later question no longer reads nought.
  assert.ok(counts.every((r) => r.surfaced_count === 1), 'neither question reads zero');

  await query(`delete from place_index where venue_ref = 'google:ChIJcensus_both'`);
  await query(`delete from census_slices where area_slug = 'census-test-both'`);
  await query(`delete from area_counts where area_slug = 'census-test-both'`);
});

test('a type Google does not have fails the slice rather than guessing', async () => {
  // The first fix asked the same words as a plain text query instead. That was
  // worse than the hole it filled: on IDs Only there is no `types` field to
  // check the answer against — that field is Pro and the census may not buy it
  // — so "landmark" would have counted anything merely *named* Landmark. A
  // census that invents membership is worse than one with a gap, because the
  // gap is visible and the invention is not (Codex, 19 Sep 2026).
  const { googleSource: src } = await import('../src/sources/google.js');
  let asked = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    asked += 1;
    return { ok: false, status: 400, text: async () => '{"error":{"code":400,"message":"Invalid included_type: \'landmark\'."}}' };
  };
  try {
    process.env.GOOGLE_MAPS_API_KEY ||= 'test-key';
    const out = await src.censusSlice({ box: BOX, includedType: 'landmark', meter: {} });
    assert.equal(asked, 1, 'asked once and gave up, rather than rephrasing the question');
    assert.deepEqual(out.places, [], 'and counted nothing it could not verify');
    assert.match(out.problem, /Google has no type "landmark"/);
    assert.match(out.problem, /Table A/, 'the reason says what to do about it');
  } finally { globalThis.fetch = realFetch; }
});

test('a provider refusal stops the run, and an unanswered drawer is not rolled up as empty', async () => {
  // The first ring census walked into the console's daily Text Search cap after
  // two outcodes and then fired 9,321 more doomed requests — every remaining
  // slice of every remaining outcode — because nothing read the answer. Worse,
  // each of those outcodes rolled up as a completed census of nought places,
  // which overwrote a good census of SL5 with forty-six zeroes (19 Sep 2026).
  const plan = await slicePlan();
  if (plan.length < 3) return;

  let asked = 0;
  const impl = async () => {
    asked += 1;
    return { places: [], requests: 1, saturated: false, problem: 'Google Places 429: {"error":{"code":429,"message":"Quota exceeded for quota metric \'SearchTextRequest\'"}}' };
  };
  const out = await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-429', outcode: 'ZZ93', box: BOX,
  }));

  assert.ok(asked <= 2, `stopped on the refusal rather than grinding through the plan (asked ${asked})`);
  assert.ok(out.refused, 'and says the provider refused');
  assert.match(out.problems.join(' '), /refused/);

  const { rows } = await query(
    `select count(*)::int n from area_counts where area_slug = 'census-test-429'`);
  assert.equal(rows[0].n, 0, 'nothing rolled up: a refused drawer is not an empty one');

  await query(`delete from census_slices where area_slug = 'census-test-429'`);
  await query(`delete from area_counts where area_slug = 'census-test-429'`);
});

test('a saturated slice keeps splitting until it answers, and says so when it cannot', async () => {
  // Three levels was enough for Surrey and not for Southwark: SE1 left 73
  // slices cut off after two splits and 30 at the limit, so its restaurant
  // count was a floor and the board had no way of saying so (owner, 20 Sep
  // 2026). The depth adapts now, and the request ceiling is the real guard.
  const plan = await slicePlan();
  if (!plan.length) return;

  const depths = [];
  // Saturated down to the fourth level and satisfied below it — deeper than the
  // old limit of three, so this fails outright on the previous behaviour.
  const impl = async ({ box }) => {
    const span = box.maxLat - box.minLat;
    const depth = Math.round(Math.log2((BOX.maxLat - BOX.minLat) / span));
    depths.push(depth);
    return depth < 4
      ? { places: Array.from({ length: 60 }, (_, i) => place(`d${depth}_${i}`)), requests: 3, saturated: true, problem: null }
      : { places: [place(`leaf${depths.length}`)], requests: 1, saturated: false, problem: null };
  };

  const out = await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-deep', outcode: 'ZZ92', box: BOX,
    subcategories: [plan[0].subcategory], maxRequests: 4000,
  }));

  assert.ok(Math.max(...depths) >= 4, `split past the old limit of three (got ${Math.max(...depths)})`);
  assert.equal(out.saturated, 0, 'nothing was left truncated, so no count here is a floor');

  const { rows: [counts] } = await query(
    `select coalesce(sum(saturated), 0)::int n from area_counts where area_slug = 'census-test-deep'`);
  assert.equal(counts.n, 0, 'and the board is told there is nothing cut off');

  await query(`delete from census_slices where area_slug = 'census-test-deep'`);
  await query(`delete from area_counts where area_slug = 'census-test-deep'`);
  await query(`delete from place_subcategories where area_slug = 'census-test-deep'`);
});

test('a slice still cut off at the ceiling is reported as a floor, never as a total', async () => {
  const plan = await slicePlan();
  if (!plan.length) return;
  // One branch that stays dense all the way down — a city centre, not a whole
  // city. Everything else answers at once, so the run finishes comfortably and
  // the only thing left truncated is the corner that genuinely is.
  //
  // (Saturating *everything* would hit the request ceiling instead, and a run
  // that stopped rolls nothing up at all — which is the right behaviour and the
  // wrong test.)
  const impl = async ({ box }) => {
    const chain = Math.abs(box.minLat - BOX.minLat) < 1e-9 && Math.abs(box.minLng - BOX.minLng) < 1e-9;
    return chain
      ? { places: Array.from({ length: 60 }, (_, i) => place(`f${i}`)), requests: 3, saturated: true, problem: null }
      : { places: [place(`q${box.minLat.toFixed(5)}_${box.minLng.toFixed(5)}`)], requests: 1, saturated: false, problem: null };
  };
  const out = await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-floor', outcode: 'ZZ91', box: BOX,
    subcategories: [plan[0].subcategory], maxRequests: 4000,
  }));

  assert.ok(!out.stopped, 'the run finished rather than hitting the ceiling');
  assert.ok(out.saturated > 0, 'and says a slice never came under sixty');

  const { rows: [c] } = await query(
    `select coalesce(sum(saturated), 0)::int n from area_counts where area_slug = 'census-test-floor'`);
  assert.ok(c.n > 0, 'the board carries it, which is what makes the count read as a floor rather than a total');

  await query(`delete from census_slices where area_slug = 'census-test-floor'`);
  await query(`delete from area_counts where area_slug = 'census-test-floor'`);
  await query(`delete from place_subcategories where area_slug = 'census-test-floor'`);
});

test('a type that cannot be asked for is never asked for, whatever is taught', async () => {
  // Deleting the two group-name rules was not enough: `knownLabels()` registers
  // every type the code reads, including these, and the boot pass taught
  // `place_of_worship` straight back the next morning (Codex, 20 Sep 2026). A
  // type that cannot go in `includedType` is a fact about Google rather than
  // about what anybody taught, so the census refuses to ask for it regardless.
  const { NOT_ASKABLE } = await import('../src/sources/googleTypes.js');
  assert.ok(NOT_ASKABLE.has('place_of_worship') && NOT_ASKABLE.has('landmark'));

  await query(
    `insert into shelf_rules (scope, subject, labels, subcategory, weights, reason)
     select 'labels', 'google:place_of_worship', array['google:place_of_worship'], 'churches', '{}'::jsonb, 'taught back by the boot pass'
      where exists (select 1 from shelf_subcategories where key = 'churches')
        and not exists (select 1 from shelf_rules where scope='labels' and subject='google:place_of_worship')`);

  const plan = await slicePlan({ subcategories: ['churches'] });
  const asked = plan.flatMap((p) => p.questions.map((q) => q.type));
  assert.ok(!asked.includes('place_of_worship'), 'the plan does not carry it even though a rule does');
  if (asked.length) assert.ok(asked.includes('church'), 'and the askable siblings are still there');

  await query(`delete from shelf_rules where scope='labels' and subject='google:place_of_worship' and reason='taught back by the boot pass'`);
});

// ---------------------------------------------------------------------------
// the drawers Google has no word for
// ---------------------------------------------------------------------------

test('a drawer Google has no word for is still asked about, in words fenced by a type', async () => {
  // The big census brief, §2: a subcategory with no mapped types generates no
  // queries, comes back nought, and nought is indistinguishable from "there are
  // none in the south of England". Five were in that position because Google's
  // Table A has no word for any of them.
  const { WORD_QUESTIONS } = await import('../src/sources/censusQuestions.js');
  const { GOOGLE_TYPES, NOT_ASKABLE } = await import('../src/sources/googleTypes.js');
  const askable = new Set(GOOGLE_TYPES.map((t) => t.type).filter((t) => !NOT_ASKABLE.has(t)));

  for (const [subcategory, questions] of Object.entries(WORD_QUESTIONS)) {
    for (const q of questions) {
      // The fence is the point. A bare text query on the IDs Only mask cannot
      // be checked against anything, because `places.types` is a Pro field the
      // census may not buy — so a search for "landmark" would count everything
      // *named* Landmark (Codex, 19 Sep 2026). Every word question carries a
      // real type Google will accept in `includedType`.
      assert.ok(askable.has(q.type), `${subcategory} asks for a type Google has: ${q.type}`);
      assert.ok(q.words && q.words.trim().length > 2, `${subcategory} says what it means`);
    }
  }

  const plan = await slicePlan();
  if (!plan.length) return;
  const planned = new Set(plan.map((p) => p.subcategory));
  for (const key of Object.keys(WORD_QUESTIONS)) {
    // Only where the subcategory is actually active in this database — a test
    // fixture need not carry the whole taxonomy.
    const { rows } = await query('select 1 from shelf_subcategories where key = $1 and active', [key]);
    if (rows.length) assert.ok(planned.has(key), `${key} is in the plan rather than silently unasked`);
  }
});

test('the words go to Google as the query, and the type still fences the answer', async () => {
  const plan = await slicePlan({ subcategories: ['climbing'] });
  if (!plan.length) return; // no climbing drawer in this database

  const asked = [];
  const impl = async ({ box, includedType, query: words }) => {
    asked.push({ includedType, words });
    return { places: [place(`worded${asked.length}`)], requests: 1, saturated: false, problem: null };
  };
  await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-words', outcode: 'ZZ97', box: BOX, subcategories: ['climbing'],
  }));

  assert.ok(asked.length, 'the drawer was asked about at all');
  assert.ok(asked.every((a) => a.includedType), 'every question carries a type Google can check');
  assert.ok(asked.some((a) => /climbing/.test(a.words ?? '')), 'and the words that narrow it');

  // The row says which question found it, so the audit can see that this drawer
  // is answered in words rather than by a type of its own.
  const { rows } = await query(
    `select google_type, query from census_slices where area_slug = 'census-test-words'`);
  assert.ok(rows.some((r) => r.query !== r.google_type), 'the question is on the record beside the type');

  await query(`delete from census_slices where area_slug = 'census-test-words'`);
  await query(`delete from area_counts where area_slug = 'census-test-words'`);
  await query(`delete from place_subcategories where area_slug = 'census-test-words'`);
});

// ---------------------------------------------------------------------------
// the mask, and the money it is supposed to mean
// ---------------------------------------------------------------------------

test('every request the census makes is ledgered, at the free tier, even when it is interrupted', async () => {
  // Owner, 21 Sep 2026: a test asserting the field mask and the ledgered cost.
  // Those are two claims and they are checked against each other here: the mask
  // the census actually sends, and the money the ledger records for having sent
  // it. Either one alone can be true while the pair is wrong.
  const plan = await slicePlan();
  if (!plan.length) return;

  // What the census asks for, and what that costs. `CENSUS_FIELDS` is not
  // exported on purpose, so this asserts the tier through the one function that
  // prices it — which is what Google charges on.
  assert.equal(skuFor('places.id,nextPageToken', '/places:searchText'), 'google-essentials');
  assert.equal(costOf({ google: 250, 'google-essentials': 250 }), 0, 'IDs Only is free at any volume');

  const before = (await query(
    `select coalesce(sum((units->>'google')::int), 0)::int n,
            coalesce(sum(estimated_cost_usd), 0)::float usd
       from provider_calls where purpose = 'census.slice'`)).rows[0];

  // A drawer that throws part way through. Before the meter was written down as
  // it went, everything asked before the throw was recorded in `census_slices`
  // and never reached the ledger: 48,523 asked against 47,408 ledgered on the
  // London run. It costs nothing while the mask is free, which is precisely why
  // it matters — the ledger is what would catch the mask drifting.
  // Throw part way through whatever plan this database has. A fixed number
  // assumed a plan of more than a hundred and twenty questions, and a fresh
  // database seeded with forty-three never reached it — so the drawer finished
  // cleanly and the test failed for want of a failure (24 Sep 2026).
  const questions = plan.reduce((n, p) => n + p.questions.length, 0);
  const breakAt = Math.max(2, Math.floor(questions / 2));
  let asked = 0;
  const impl = async ({ meter }) => {
    asked += 1;
    // What `call()` does to the meter for one request at the census's mask.
    meter.google = (meter.google ?? 0) + 1;
    meter['google-essentials'] = (meter['google-essentials'] ?? 0) + 1;
    if (asked > breakAt) throw new Error('connection reset by peer');
    return { places: [place(asked)], requests: 1, saturated: false, problem: null };
  };

  await assert.rejects(() => withCensus(impl, () => censusArea({
    areaSlug: 'census-test-ledger', outcode: 'ZZ96', box: BOX,
  })), /connection reset/);

  const after = (await query(
    `select coalesce(sum((units->>'google')::int), 0)::int n,
            coalesce(sum(estimated_cost_usd), 0)::float usd
       from provider_calls where purpose = 'census.slice'`)).rows[0];

  assert.equal(after.n - before.n, asked,
    `every request asked is a request ledgered (${asked} asked, ${after.n - before.n} ledgered)`);
  assert.equal(after.usd - before.usd, 0, 'and the whole of it is free, which is the claim the policy rests on');

  await query(`delete from census_slices where area_slug = 'census-test-ledger'`);
  await query(`delete from area_counts where area_slug = 'census-test-ledger'`);
  await query(`delete from place_subcategories where area_slug = 'census-test-ledger'`);
});

test('a mask that asks for more than an id is not free, and the census would know', async () => {
  // The guard the ledger exists to make possible. If somebody adds a field to
  // the census's mask, the tier changes, the ledger stops reading nought, and
  // `censusRun` stops the run on the first penny. That chain is only as good as
  // its first link, so the first link is asserted.
  assert.equal(skuFor('places.id,places.location,nextPageToken', '/places:searchText'), 'google-pro');
  assert.ok(costOf({ google: 1, 'google-pro': 1 }) > 0, 'a point costs money');
  assert.equal(skuFor('places.id,places.types,nextPageToken', '/places:searchText'), 'google-pro');
  assert.ok(costOf({ google: 1, 'google-search': 1 }) > 0, 'and so does a rating');
});

test('a ledger write that fails keeps what it could not write down', async () => {
  // Emptying the meter before the write, and swallowing the failure, threw away
  // up to a hundred requests every time the database hiccupped — which is the
  // under-reporting the flush was written to stop, by a shorter road (Codex,
  // via epic-f4, 21 Sep 2026).
  const { ledger } = await import('../src/sources/census.js');

  const meter = { google: 5, 'google-essentials': 5 };
  const written = [];
  const down = async () => { throw new Error('the database is not answering'); };
  const up = async (_h, _p, _purpose, units) => { written.push(JSON.parse(units)); };

  assert.equal(await ledger(meter, null, { force: true, record: down }), 0, 'a failed write records nothing');
  assert.deepEqual(meter, { google: 5, 'google-essentials': 5 },
    'and leaves every request it could not write down on the meter');

  // Three more asked while the database was away.
  meter.google += 3;
  meter['google-essentials'] += 3;
  assert.equal(await ledger(meter, null, { force: true, record: up }), 8, 'the next write carries the lot');
  assert.deepEqual(written, [{ google: 8, 'google-essentials': 8 }]);
  assert.deepEqual(meter, {}, 'and only then is the meter emptied');

  // Anything counted while a write is in flight survives it: the recorded
  // snapshot is subtracted, never cleared.
  const busy = { google: 2, 'google-essentials': 2 };
  const slowly = async () => { busy.google += 1; busy['google-essentials'] += 1; };
  await ledger(busy, null, { force: true, record: slowly });
  assert.deepEqual(busy, { google: 1, 'google-essentials': 1 },
    'the request that arrived mid-write is still there to be written');
});

// ---------------------------------------------------------------------------
// the box a place is known by
// ---------------------------------------------------------------------------

test('the box a place is known by is the narrowest one that returned it, not the first', async () => {
  // A saturated box is asked *before* it is split, so its first sixty places
  // were written down with the whole eight-kilometre box and then found again
  // by the quarter that actually holds them — and nothing updated them. In
  // central London that box straddles every outcode it touches, so Bloomsbury
  // rolled up as 3 places with hundreds unresolved (owner, 24 Sep 2026).
  const plan = await slicePlan();
  if (!plan.length) return;
  const one = plan[0].subcategory;
  const ref = 'google:ChIJcensus_test_narrow';
  await query(`delete from place_subcategories where venue_ref = $1`, [ref]);
  await query(`delete from place_index where venue_ref = $1`, [ref]);

  // The same place from the top box (cut off, so it splits) and from one
  // quarter. Everything else in the top box is filler to reach sixty.
  const half = (BOX.maxLat - BOX.minLat) / 2;
  const impl = async ({ box }) => {
    const top = box.maxLat - box.minLat > half + 1e-9;
    if (top) {
      return { places: [{ id: 'ChIJcensus_test_narrow', rank: 1 }, ...Array.from({ length: 59 }, (_, i) => place(`filler${i}`))], requests: 3, saturated: true, problem: null };
    }
    // Only the south-west quarter has it.
    const sw = box.minLat === BOX.minLat && box.minLng === BOX.minLng;
    return { places: sw ? [{ id: 'ChIJcensus_test_narrow', rank: 1 }] : [], requests: 1, saturated: false, problem: null };
  };
  await withCensus(impl, () => censusArea({
    areaSlug: 'census-test-narrow', outcode: 'ZZ94', box: BOX, subcategories: [one],
  }));

  const { rows: [row] } = await query('select slice from place_index where venue_ref = $1', [ref]);
  const n = row.slice.split(',').map(Number);
  assert.ok(n[2] - n[0] < half + 1e-9, `known by the quarter, not the whole box (${row.slice})`);
  assert.ok(Math.abs(n[0] - BOX.minLat) < 1e-6 && Math.abs(n[1] - BOX.minLng) < 1e-6, 'and the right quarter');

  // A later census at a coarser grid must not widen it back. Only ever narrower.
  await withCensus(async () => ({ places: [{ id: 'ChIJcensus_test_narrow', rank: 1 }], requests: 1, saturated: false, problem: null }),
    () => censusArea({ areaSlug: 'census-test-narrow-coarse', outcode: 'ZZ94', box: BOX, subcategories: [one] }));
  const { rows: [again] } = await query('select slice from place_index where venue_ref = $1', [ref]);
  assert.equal(again.slice, row.slice, 'a wider box asked later does not undo what a narrower one established');

  for (const slug of ['census-test-narrow', 'census-test-narrow-coarse']) {
    await query(`delete from census_slices where area_slug = $1`, [slug]);
    await query(`delete from area_counts where area_slug = $1`, [slug]);
    await query(`delete from place_subcategories where area_slug = $1`, [slug]);
  }
  await query(`delete from place_index where venue_ref = $1 or venue_ref like 'google:ChIJcensus_test_filler%'`, [ref]);
});

test('a drawer once asked in bare text is fenced by a type now, and nothing is asked bare', async () => {
  // Owner, 25 Sep 2026: "Historic houses at 8,159 places all from a text
  // query means most of them are estate agents, pubs called The Manor, and
  // street names — the drawer is right and the query is wrong. Map each to
  // its real Google type … then drop the bare-text query."
  const { WORD_QUESTIONS, TEXT_QUESTIONS, textStillAsked, wordQuestionsFor } = await import('../src/sources/censusQuestions.js');
  assert.deepEqual(Object.keys(TEXT_QUESTIONS), [], 'no drawer is asked in bare text any more');
  for (const key of ['historic-houses', 'ancient-sites', 'football', 'rugby-cricket', 'lidos', 'caves-falls', 'circuits', 'days-out']) {
    assert.ok(WORD_QUESTIONS[key]?.length, `${key} is asked in words fenced by a type`);
    assert.ok(WORD_QUESTIONS[key].every((q) => q.type), `${key}: every question carries its fence`);
    assert.ok(wordQuestionsFor(key).every((q) => q.sourced === 'words'), `${key}: and is labelled as fenced words, not text`);
    assert.equal(textStillAsked(key), false, `${key}: so a text-sourced surfacing is no longer its number`);
  }
  // Scenic drives is retired and Ski resort folded into Indoor snow: no
  // question at all, so both empty as their tiles come round again.
  assert.equal(wordQuestionsFor('scenic').length, 0);
  assert.equal(wordQuestionsFor('ski-resort').length, 0);
});
