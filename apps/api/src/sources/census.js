/**
 * The census: knowing what exists, free and for good.
 *
 * The second of the data policy's five sentences (19 Sep 2026), and the one the
 * other four stand on. Ranking from what we own is only possible once we own a
 * complete list of what there is; buying only for what is shown is only
 * possible once something other than Google decides what to show.
 *
 * **Google cannot count.** Every query returns its top twenty and pages to a
 * hard stop at sixty. Ask "restaurants in Bristol" and you are told about sixty
 * restaurants, not how many there are — and there is no parameter, anywhere, to
 * ask the second question. So a count is *built*:
 *
 *   1. One query per Google place type inside each Epic subcategory, fenced to
 *      a box. `pub` and `bar` and `gastropub` are three questions, not one.
 *   2. A slice that comes back with sixty was cut off. It is marked saturated
 *      and split — into four tiles — and each tile is asked the same question.
 *   3. Recurse until every slice answers under the ceiling. The union of the
 *      ids is the census.
 *
 * All of it on the Essentials mask — an id, a point, a type — which is free.
 * The whole design exists because that tier is free: it is what lets us ask
 * Google forty times about one outcode without it costing anything, and it is
 * why `sources/google.js` now meters the tier separately (a flat meter priced
 * every one of those slices at the Enterprise rate).
 *
 * **What is written down is identifiers and our own derivations.** The place
 * id, the point, Google's type words, which slice found it and at what rank.
 * Never a name, an opinion, an opening time or a photograph. That is what makes
 * the census permanent where a search result is not.
 */

import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { googleSource } from './google.js';
import * as index from '../repositories/placeIndex.js';
import * as providerCalls from '../repositories/providerCalls.js';

/**
 * How far a saturated slice is allowed to be split.
 *
 * Four tiles a level, so depth 3 is sixty-four tiles of the original box. An
 * outcode cut sixty-four ways is a few hundred metres a side; if Google still
 * says sixty in that, the honest answer is that the box is a city centre and
 * the count is a floor, which is what `saturated` on the row is for. Going
 * deeper trades real requests for a number nobody will act on.
 */
const MAX_DEPTH = 3;
/** A census is good for 30 days; the policy's own figure. */
export const CENSUS_FRESH_DAYS = 30;
/**
 * A ceiling on one run, whatever the plan says.
 *
 * Essentials requests are free inside Google's allowance and priced at nought
 * here, which is exactly the condition under which a runaway goes unnoticed:
 * nothing in the ledger would complain, and the first sign would be the console
 * showing the allowance gone. Forty-six subcategories over two hundred and
 * fifty types, each able to split into sixty-four tiles, is an upper bound in
 * the tens of thousands — so the run stops at a number a person chose, records
 * that it stopped, and is resumed rather than silently half-done.
 *
 * The owner is setting a daily cap in the Cloud Console as the outer guard
 * (19 Sep 2026). This is the inner one: a console cap protects the account, and
 * this protects the run from having to rely on it.
 */
export const MAX_REQUESTS_PER_RUN = Number(process.env.EPIC_CENSUS_MAX_REQUESTS || 2000);

/**
 * The slice plan: which Google types stand for which Epic subcategory.
 *
 * Read from `shelf_rules`, not from a table of its own, because the mapping
 * already exists there — 250 `labels` rules carrying `google:<type>` against a
 * subcategory, taught in the back office. A census that kept its own copy would
 * be a second taxonomy to maintain and would drift from the one the app files
 * places under, which is the exact thing the labels work was done to stop.
 *
 * That also delivers the policy's "a taxonomy change re-maps for free": teach a
 * type onto a different drawer and the next census slices for it there, with no
 * migration and no new questions asked of Google.
 */
export async function slicePlan({ subcategories = null } = {}) {
  const { rows } = await query(
    `select s.category_key                as category,
            r.subcategory                 as subcategory,
            array_agg(distinct substring(l from 8)) as types
       from shelf_rules r
       join shelf_subcategories s on s.key = r.subcategory
       cross join lateral unnest(r.labels) as l
      where r.scope = 'labels'
        and r.subcategory is not null
        and s.active
        and l like 'google:%'
        ${subcategories?.length ? 'and r.subcategory = any($1)' : ''}
      group by 1, 2
      order by 1, 2`,
    subcategories?.length ? [subcategories] : [],
  );
  return rows.map((r) => ({ ...r, types: r.types.filter(Boolean) }));
}

/** The four tiles a saturated box splits into. */
function quarters(box) {
  const midLat = (box.minLat + box.maxLat) / 2;
  const midLng = (box.minLng + box.maxLng) / 2;
  return [
    { minLat: box.minLat, minLng: box.minLng, maxLat: midLat, maxLng: midLng },
    { minLat: box.minLat, minLng: midLng, maxLat: midLat, maxLng: box.maxLng },
    { minLat: midLat, minLng: box.minLng, maxLat: box.maxLat, maxLng: midLng },
    { minLat: midLat, minLng: midLng, maxLat: box.maxLat, maxLng: box.maxLng },
  ];
}

const boxLabel = (box) => [box.minLat, box.minLng, box.maxLat, box.maxLng].map((n) => Number(n).toFixed(4)).join(',');

/**
 * One type, one box, splitting itself until nothing is cut off.
 *
 * Returns every id found anywhere under it. The rows written to
 * `census_slices` are the working: a saturated parent keeps its row *beside*
 * its four children, because "we asked and the answer was cut off" is the first
 * thing to look at when a count reads wrong, and a tree that quietly replaced
 * the parent with its tiles would hide it.
 */
async function sliceDown({ box, type, category, subcategory, areaSlug, outcode, householdId, runId, depth = 0, parentId = null, found, meter, stats }) {
  if (stats.requests >= stats.maxRequests) { stats.stopped = true; return; }
  const before = meter['google'] ?? 0;
  const res = await googleSource.censusSlice({ box, includedType: type, meter });
  // Count what was *attempted*, not what succeeded. `call` bumps the meter
  // before it fetches, so a timeout or a 429 is still a request Google saw —
  // and counting only the successes meant a run of failures never reached the
  // ceiling and never wrote a ledger row, while the outbound calls kept going
  // (Codex, 19 Sep 2026). The meter is the honest count.
  const attempted = Math.max((meter['google'] ?? 0) - before, res.requests);
  stats.requests += attempted;

  let fresh = 0;
  for (const p of res.places) {
    const ref = `google:${p.id}`;
    if (!found.has(ref)) fresh += 1;
    // Later slices do not overwrite the first one to find a place: the narrowest
    // question that returned it is the most informative thing about it, and the
    // first slice is always at least as narrow as any that follows it.
    if (!found.has(ref)) {
      // An id, and which question found it. No point and no type: the census is
      // IDs Only, and both of those are Pro fields that bill (owner, 19 Sep
      // 2026). They arrive with the first display search that returns the place.
      found.set(ref, {
        ref, category, subcategory, foundBy: type, rank: p.rank, slice: boxLabel(box),
      });
    }
  }

  const saturated = res.saturated && depth < MAX_DEPTH;
  const { rows: [row] } = await query(
    `insert into census_slices
       (area_slug, outcode, min_lat, min_lng, max_lat, max_lng, category, subcategory,
        google_type, query, returned, new_ids, saturated, parent_id, depth, requests, problem, run_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     returning id`,
    [areaSlug, outcode, box.minLat, box.minLng, box.maxLat, box.maxLng, category, subcategory,
      type, type, res.places.length, fresh, res.saturated, parentId, depth, attempted, res.problem, runId],
  );
  stats.slices += 1;
  if (res.problem) stats.problems.push(`${subcategory}/${type}: ${res.problem}`);
  if (res.saturated && depth >= MAX_DEPTH) stats.saturated += 1;

  if (!saturated) return;
  for (const q of quarters(box)) {
    await sliceDown({
      box: q, type, category, subcategory, areaSlug, outcode, householdId, runId,
      depth: depth + 1, parentId: row.id, found, meter, stats,
    });
  }
}

/**
 * Census one box.
 *
 * `box` is corners, never a postcode: the policy keys everything on a place id
 * and a point, because a thirty-minute ring is not a postcode and never was.
 * `areaSlug` and `outcode` are labels for the board to group by, not the key.
 *
 * Nothing about this is a search a household made, so no rented content is
 * fetched, held or shown. It is the one Google call Epic makes that produces
 * something it may keep for ever.
 */
export async function censusArea({ areaSlug = null, outcode = null, box, subcategories = null, householdId = null, onProgress = null, maxRequests = MAX_REQUESTS_PER_RUN } = {}) {
  if (!box || box.minLat == null) throw Object.assign(new Error('a census needs a box'), { status: 400 });
  const plan = await slicePlan({ subcategories });
  if (!plan.length) return { noted: 0, requests: 0, slices: 0, plan: 0, problems: ['no Google types are taught onto any active subcategory'] };

  const runId = randomUUID();
  const found = new Map();
  const meter = {};
  const stats = { requests: 0, slices: 0, saturated: 0, problems: [], maxRequests, stopped: false };
  // Only the subcategories carried all the way through. A run that stopped at
  // its ceiling used to roll the *whole plan* up anyway, which wrote nought
  // against every subcategory it never reached and stamped the area fresh — so
  // `censusIsFresh` then held a half-done census off for thirty days and the
  // board showed empty drawers as fact (Codex, 19 Sep 2026).
  const done = [];

  for (const { category, subcategory, types } of plan) {
    for (const type of types) {
      await sliceDown({ box, type, category, subcategory, areaSlug, outcode, householdId, runId, found, meter, stats });
      if (stats.stopped) break;
    }
    if (stats.stopped) { stats.problems.push(`stopped at the ${maxRequests}-request ceiling; ${plan.length - done.length} subcategories were not reached`); break; }
    done.push({ category, subcategory });
    onProgress?.({ subcategory, found: found.size, requests: stats.requests });
  }

  // One ledger row for the whole census, metered at the tier it actually used.
  // Priced at nought by `domain/providerPrices.js` — which is the point, and is
  // the thing the first run is asked to demonstrate from the ledger rather than
  // from a promise.
  if (stats.requests) {
    await providerCalls.record(householdId, 'google', 'census.slice', JSON.stringify(meter)).catch(() => null);
  }

  const places = [...found.values()];
  // In chunks, because a census of a city centre is tens of thousands of places
  // and one statement carries several bind parameters each: past about nine
  // thousand places the write blows Postgres's 65,535-parameter protocol limit
  // and the whole persistence step aborts — losing a census that cost real
  // money to take (Codex, 19 Sep 2026).
  for (const batch of chunks(places, WRITE_BATCH)) {
    // `sources` is a list of source *names*; the identifier travels as
    // `sourceId` for the source the caller is writing as. Handing it objects
    // stringified each one to "[object Object]" and dropped the Google id, so
    // the census wrote no Google coverage at all (Codex, 19 Sep 2026).
    // No `lat`/`lng`: the census does not know them and must not pretend to.
    // `noteMany` coalesces, so a null cannot erase a point something else knew.
    await index.noteMany(
      batch.map((p) => ({ ref: p.ref, sourceId: p.ref.slice('google:'.length), sources: ['google'] })),
      { source: 'google', countryCode: 'GB' },
    );
    await writeCensusFacts(batch);
  }
  await rollUp({ areaSlug, runId, done, found: places });

  return { noted: places.length, ...stats, runId, plan: plan.length, completed: done.length };
}

/**
 * How many places go into one write.
 *
 * Seven bind parameters each here and five in `noteMany`, against Postgres's
 * limit of 65,535 for one statement. Two thousand leaves room in both and is
 * still one round trip per two thousand places rather than per place.
 */
const WRITE_BATCH = 2000;

const chunks = (rows, n) => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, i * n + n));

/**
 * What the census learned, onto the index.
 *
 * Separate from `noteMany` because that is the general "we saw this place"
 * path shared with every other source, and these columns are the census's own.
 * Written in one statement rather than a row at a time: a census of a city
 * centre is thousands of places and a round trip each would take longer than
 * the Google calls did.
 */
async function writeCensusFacts(places) {
  const values = places.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4}::int,$${i * 6 + 5},$${i * 6 + 6})`).join(',');
  const params = places.flatMap((p) => [p.ref, p.category, p.foundBy, p.rank, p.slice, p.subcategory]);
  await query(
    `update place_index i
        set censused_at = now(),
            found_by     = v.found_by,
            found_rank   = v.found_rank,
            slice        = v.slice,
            -- The census is allowed to file a place it found under the drawer
            -- whose question found it, but never to overwrite a filing somebody
            -- made by hand: a rule taught in the back office outranks a guess
            -- made from the query that happened to surface it.
            category     = coalesce(i.category, v.category),
            subcategory  = coalesce(i.subcategory, v.subcategory),
            derived_by   = coalesce(i.derived_by, 'census')
       from (values ${values}) as v(ref, category, found_by, found_rank, slice, subcategory)
      where i.venue_ref = v.ref`,
    params,
  );
}

/**
 * The area board's numbers, written down so the board can draw without calling
 * anybody.
 *
 * The policy is explicit that the board "cannot trigger a paid call" and shows
 * "the same numbers on every visit until the census re-runs". A board that
 * recomputed from a provider on each view would be neither.
 *
 * `osm_count`, `fhrs_count` and `residual` are left alone here: they are the
 * free cross-checks and are filled by their own passes, which run on their own
 * clocks. A null is honest — it says nobody has checked — and is not the same
 * as a nought.
 */
async function rollUp({ areaSlug, runId, done, found }) {
  if (!areaSlug) return;
  for (const { category, subcategory } of done) {
    const mine = found.filter((p) => p.subcategory === subcategory);
    // This run's saturation, not every run's. Slices are append-only, so
    // counting them all meant a later clean census could never clear an earlier
    // one and two runs over the same ground made the number climb by itself
    // (Codex, 19 Sep 2026).
    const { rows: [sat] } = await query(
      `select count(*)::int n from census_slices
        where run_id = $1 and subcategory = $2 and saturated and depth >= $3`,
      [runId, subcategory, MAX_DEPTH],
    );
    // Scored places *here*, not everywhere. The unscoped count wrote the same
    // national figure into every area's board the moment a second area existed
    // (Codex, 19 Sep 2026); the places this run found are the honest scope.
    const refs = mine.map((p) => p.ref);
    const { rows: [scored] } = refs.length
      ? await query(`select count(*)::int n from epic_scores where venue_ref = any($1)`, [refs])
      : { rows: [{ n: 0 }] };
    await query(
      `insert into area_counts (area_slug, category, subcategory, census_count, scored_count, saturated, censused_at, run_id, complete)
       values ($1,$2,$3,$4,$5,$6, now(), $7, true)
       on conflict (area_slug, category, subcategory) do update
          set census_count = excluded.census_count,
              scored_count = excluded.scored_count,
              saturated    = excluded.saturated,
              censused_at  = excluded.censused_at,
              run_id       = excluded.run_id,
              complete     = true`,
      [areaSlug, category, subcategory, mine.length, scored.n, sat.n, runId],
    );
  }
}

/** Has this area been censused recently enough to leave alone? */
export async function censusIsFresh(areaSlug, { days = CENSUS_FRESH_DAYS } = {}) {
  if (!areaSlug) return false;
  const { rows: [row] } = await query(
    `select max(censused_at) at from area_counts where area_slug = $1`, [areaSlug],
  );
  return Boolean(row?.at) && Date.now() - new Date(row.at).getTime() < days * 86_400_000;
}

/**
 * What a display search teaches the index, which the census could not.
 *
 * The census is IDs Only, so it knows a place exists and which question found
 * it, and nothing about where it is. A point and Google's type words are Pro
 * fields — dearer than the census may be — and they arrive on the first display
 * search that returns the place, a call being made anyway for somebody who is
 * actually looking at it (owner, 19 Sep 2026).
 *
 * This is a thin wrapper over `placeIndex.noteMany`, and deliberately so. The
 * first cut of it was a direct `update place_index`, which went round the two
 * things that writer does and nothing else does: it dates the position and
 * names whose it is, and it clears `placed_at` when a place learns where it is
 * so the hourly settler gives it a cell and a ring. A census row is exactly a
 * row with no position, so going round that meant a place could be surfaced,
 * gain a coordinate, and never once appear in a reachability ring (Codex,
 * 19 Sep 2026). The display routes already call `noteSeen`, which goes through
 * the same writer — so in practice this is for callers that hold venues and no
 * route.
 */
export async function noteFromDisplay(venues, { source = 'google' } = {}) {
  const rows = (venues ?? [])
    .map((v) => ({
      ref: v.venueRef ?? (v.sourcePlaceId ? `${v.source ?? source}:${v.sourcePlaceId}` : null),
      lat: v.lat,
      lng: v.lng,
      types: [...new Set([v.primaryType, ...(v.labels ?? []).map((l) => String(l).replace(/^google:/, ''))].filter(Boolean))],
    }))
    .filter((r) => r.ref && r.lat != null && r.lng != null);
  if (!rows.length) return { noted: 0 };
  let noted = 0;
  for (const batch of chunks(rows, WRITE_BATCH)) {
    await index.noteMany(batch, { source });
    noted += batch.length;
  }
  return { noted };
}

/**
 * Coordinates past the thirty days Google's terms allow.
 *
 * Nulled rather than deleted: the place stays in the index — the id is ours
 * indefinitely — and simply stops saying where it is until the next display
 * search returns it. A place nobody has looked at in a month is a place we have
 * no business holding a point for.
 */
/**
 * Whose coordinates never expire.
 *
 * The open map is ODbL, the atlas harvest and our own research are ours. Every
 * other prefix is somebody else's and gets the clock — named this way round on
 * purpose: a new provider added tomorrow is rented by default, where a list of
 * *what expires* would have silently granted it permanent retention until
 * somebody remembered to add it. Tripadvisor was exactly that case (Codex,
 * 19 Sep 2026).
 */
const OURS_TO_KEEP = ['osm', 'atlas', 'own'];

export async function expireRentedCoordinates({ days = 30 } = {}) {
  const { rows } = await query(
    `update place_index
        set lat = null, lng = null, cell = null, coords_at = null, coords_from = null,
            -- Back into the settler's hands. Without this the row keeps a
            -- placed_at that refers to a position it no longer has, and if the
            -- place is surfaced again the ring is worked out from nothing.
            placed_at = null
      where coords_from is not null
        and coords_from <> all ($2::text[])
        and coords_at < now() - ($1 || ' days')::interval
      returning venue_ref`,
    [String(days), OURS_TO_KEEP],
  );
  if (!rows.length) return { expired: 0, cells: 0 };
  // The same point, copied. `repositories/reach.js` stamps a place into
  // `place_cells` with its own lat and lng, so clearing the index alone left
  // the rented coordinate sitting in the other table for ever — and left the
  // place looking stamped, so nothing ever asked for it again (Codex, 19 Sep
  // 2026). Both copies go, or neither has expired.
  let cells = 0;
  for (const batch of chunks(rows.map((r) => r.venue_ref), WRITE_BATCH)) {
    const { rowCount } = await query('delete from place_cells where venue_ref = any($1)', [batch]);
    cells += rowCount;
  }
  return { expired: rows.length, cells };
}
