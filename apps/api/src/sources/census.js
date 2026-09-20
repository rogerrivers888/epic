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
import { NOT_ASKABLE } from './googleTypes.js';
import { wordQuestionsFor, WORD_QUESTION_SUBCATEGORIES } from './censusQuestions.js';
import * as index from '../repositories/placeIndex.js';
import * as providerCalls from '../repositories/providerCalls.js';

/**
 * How far a saturated slice may be split.
 *
 * **Adaptive: keep splitting until a slice comes back under the ceiling**
 * (owner, 20 Sep 2026). Three levels was enough for Surrey and not for
 * Southwark — SE1 left **73 slices still cut off after two splits and 30 at the
 * limit**, so its restaurant count was a floor and the board had no way of
 * saying so. Six levels is 4,096 tiles of the original box, which for a
 * 2.5 km outcode is about forty metres a side: past that the tile is smaller
 * than the error in a pin and splitting further tells you nothing.
 *
 * The ceiling is not the guard. `MAX_REQUESTS_PER_RUN` is — a depth limit
 * bounds one branch, and what actually needs bounding is the run.
 */
const MAX_DEPTH = Number(process.env.EPIC_CENSUS_MAX_DEPTH || 6);
/**
 * The ceiling, for anything that reports on a run.
 *
 * Exported because a reporting script that keeps its own copy will keep the
 * old one: the first SE1 report was written against a limit of three and went
 * on calling saturation at depth three "at the limit" after the limit became
 * six, which reads as forty-one truncated drawers where the true figure is
 * nought (20 Sep 2026).
 */
export const CENSUS_MAX_DEPTH = MAX_DEPTH;
/** A census is good for 30 days; the policy's own figure. */
export const CENSUS_FRESH_DAYS = 30;
/**
 * A ceiling on one run, whatever the plan says.
 *
 * **This is the real guard, not the depth limit** (owner, 20 Sep 2026). Now
 * that a saturated slice keeps splitting until it answers, one dense
 * subcategory in one city could in principle ask four thousand questions on its
 * own. A depth limit bounds a branch; only a request ceiling bounds the run.
 *
 * Essentials requests are free and priced at nought here, which is exactly the
 * condition under which a runaway goes unnoticed: nothing in the ledger would
 * complain, and the first sign would be the console's daily cap. So the run
 * stops at a number a person chose, records that it stopped, and is resumed
 * rather than silently half-done. Twenty thousand against a whole
 * thirty-nine-outcode ring's 11,287, and a 75,000-a-day cap above it.
 */
export const MAX_REQUESTS_PER_RUN = Number(process.env.EPIC_CENSUS_MAX_REQUESTS || 20_000);

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
  // A type that cannot be asked for is dropped here rather than failing a slice
  // later. Deleting the rules was not enough on its own: the boot pass that
  // registers every type the code reads taught one of them straight back
  // (Codex, 20 Sep 2026), so the census refuses to ask regardless of what is
  // taught.
  //
  // A question is a type and, where Google has no word for the drawer, the
  // words that narrow it (`censusQuestions.js`). A plain type question carries
  // no words: the slice sends the type's own words as the text query, which is
  // what it has always done.
  const byKey = new Map(rows
    .map((r) => ({
      category: r.category,
      subcategory: r.subcategory,
      questions: r.types.filter((t) => t && !NOT_ASKABLE.has(t)).map((type) => ({ type, words: null })),
    }))
    .map((r) => [r.subcategory, r]));

  // The five Google has no word for. Merged in here rather than taught as
  // rules, because teaching the broad type onto the drawer would file every
  // gym and five-a-side pitch there for ever — see `censusQuestions.js`.
  const wanted = subcategories?.length ? new Set(subcategories) : null;
  const missing = WORD_QUESTION_SUBCATEGORIES.filter((key) => (!wanted || wanted.has(key)) && !byKey.has(key));
  if (missing.length) {
    const { rows: subs } = await query(
      'select key, category_key from shelf_subcategories where key = any($1) and active', [missing]);
    for (const s of subs) byKey.set(s.key, { category: s.category_key, subcategory: s.key, questions: [] });
  }
  for (const [key, row] of byKey) {
    for (const q of wordQuestionsFor(key)) {
      if (NOT_ASKABLE.has(q.type)) continue;
      row.questions.push({ type: q.type, words: q.words });
    }
  }

  return [...byKey.values()]
    .filter((r) => r.questions.length)
    .sort((a, b) => a.category.localeCompare(b.category) || a.subcategory.localeCompare(b.subcategory));
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
async function sliceDown({ box, type, words = null, category, subcategory, areaSlug, outcode, householdId, runId, depth = 0, parentId = null, found, surfaced, meter, stats, pace = null }) {
  if (stats.requests >= stats.maxRequests) { stats.stopped = true; return; }
  // A long run is paced rather than budgeted: Essentials is free and the only
  // thing that can go wrong is asking Google faster than the project's quota
  // allows. Waiting here rather than between tiles keeps the rate honest
  // inside a tile that splits forty times (brief, §4).
  if (pace) await pace();
  const before = meter['google'] ?? 0;
  // `words` only where Google has no word for the drawer. The type still goes
  // as `includedType`, so what comes back is fenced by Google's own answer and
  // not only by a string match (`censusQuestions.js`).
  const res = await googleSource.censusSlice({ box, includedType: type, query: words ?? undefined, meter });
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
    // Every question that surfaced it, not only the first.
    //
    // A golf course in a wood is both, and filing it under whichever question
    // ran first made `sport/golf` read nought in Ascot while Google had just
    // returned two courses (owner, 19 Sep 2026). `found` still keeps the one
    // filing — a place lives on one shelf — and this keeps the count.
    const key = `${ref}|${subcategory}|${areaSlug ?? ''}`;
    if (!surfaced.has(key)) {
      surfaced.set(key, { ref, category, subcategory, foundBy: type, rank: p.rank, areaSlug });
    }
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
      type, words ?? type, res.places.length, fresh, res.saturated, parentId, depth, attempted, res.problem, runId],
  );
  stats.slices += 1;
  if (res.problem) {
    stats.problems.push(`${subcategory}/${words ? `${type} “${words}”` : type}: ${res.problem}`);
    // A refusal is not a slice that found nothing; it is the whole run being
    // told to stop. The first ring census walked into the console's daily
    // Text Search cap after two outcodes and then fired **9,321 more doomed
    // requests** — every remaining slice of every remaining outcode — because
    // nothing read the answer. Worse, each of those outcodes then rolled up as
    // a completed census of nought places (19 Sep 2026).
    if (/\b429\b|RESOURCE_EXHAUSTED|Quota exceeded|rate limit/i.test(res.problem)) {
      stats.refused = res.problem.slice(0, 200);
      stats.stopped = true;
    }
  } else {
    // At least one slice of this subcategory was actually answered. Without
    // this a subcategory whose every slice was refused looked exactly like one
    // Google answered with nothing.
    stats.answered.add(subcategory);
  }
  if (res.saturated && depth >= MAX_DEPTH) stats.saturated += 1;

  if (!saturated) return;
  for (const q of quarters(box)) {
    await sliceDown({
      box: q, type, words, category, subcategory, areaSlug, outcode, householdId, runId,
      depth: depth + 1, parentId: row.id, found, surfaced, meter, stats, pace,
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
export async function censusArea({
  areaSlug = null, outcode = null, box, subcategories = null, householdId = null,
  onProgress = null, maxRequests = MAX_REQUESTS_PER_RUN,
  // Called before every request. A tile census hands in a rate limiter here.
  pace = null,
  // Whether to write this area's board counts. A tile is not an area anybody
  // browses — its counts are rolled up to the outcodes it covers afterwards
  // (`rollUpOutcodes`), and writing tile keys into `area_counts` would put
  // rows on the board for places nobody can navigate to.
  rollUpCounts = true,
} = {}) {
  if (!box || box.minLat == null) throw Object.assign(new Error('a census needs a box'), { status: 400 });
  const plan = await slicePlan({ subcategories });
  if (!plan.length) return { noted: 0, requests: 0, slices: 0, plan: 0, problems: ['no Google types are taught onto any active subcategory'] };

  const runId = randomUUID();
  const found = new Map();
  // One entry per place *per subcategory that found it*. `found` is one entry
  // per place: the two answer different questions and the board shows both.
  const surfaced = new Map();
  const meter = {};
  const stats = { requests: 0, slices: 0, saturated: 0, problems: [], maxRequests, stopped: false, refused: null, answered: new Set() };
  // Only the subcategories carried all the way through. A run that stopped at
  // its ceiling used to roll the *whole plan* up anyway, which wrote nought
  // against every subcategory it never reached and stamped the area fresh — so
  // `censusIsFresh` then held a half-done census off for thirty days and the
  // board showed empty drawers as fact (Codex, 19 Sep 2026).
  const done = [];

  for (const { category, subcategory, questions } of plan) {
    for (const { type, words } of questions) {
      await sliceDown({ box, type, words, category, subcategory, areaSlug, outcode, householdId, runId, found, surfaced, meter, stats, pace });
      if (stats.stopped || stats.refused) break;
    }
    if (stats.refused) { stats.problems.push(`the provider refused: ${stats.refused}`); break; }
    if (stats.stopped) { stats.problems.push(`stopped at the ${maxRequests}-request ceiling; ${plan.length - done.length} subcategories were not reached`); break; }
    // Only a subcategory something actually answered for. A drawer whose every
    // slice was refused is not a drawer with nothing in it, and rolling it up
    // as nought overwrote a good census of SL5 with forty-six zeroes.
    if (!stats.answered.has(subcategory)) continue;
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
  for (const batch of chunks([...surfaced.values()], WRITE_BATCH)) {
    await writeSurfacings(batch, runId);
  }
  if (rollUpCounts) await rollUp({ areaSlug, runId, done, found: places, surfaced: [...surfaced.values()] });

  return {
    noted: places.length, surfacings: surfaced.size, ...stats,
    // A Set does not survive JSON, and the count is what a caller wants anyway.
    answered: stats.answered.size,
    runId, plan: plan.length, completed: done.length,
    // *Which* drawers finished, not only how many. A tile census checkpoints on
    // this: a tile interrupted half way through resumes at the next drawer
    // rather than paying again for the ones already answered (brief, §4).
    done: done.map((d) => d.subcategory),
    // The whole plan, so a caller can tell "this drawer was never reached" from
    // "this drawer was asked and there was nothing there".
    planned: plan.map((p) => p.subcategory),
  };
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
 * Every question that surfaced a place, so a count can be honest.
 *
 * Written after the index, because the foreign key points at it. `last_seen`
 * moves on a re-census and `first_seen` does not: a subcategory that stopped
 * finding a place keeps its row, which is how "this used to be here" stays
 * legible rather than silently vanishing.
 */
async function writeSurfacings(rows, runId) {
  const values = rows.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5}::int,$${i * 6 + 6}, now(), now(), $${rows.length * 6 + 1})`).join(',');
  const params = rows.flatMap((r) => [r.ref, r.category, r.subcategory, r.foundBy, r.rank, r.areaSlug ?? null]);
  params.push(runId);
  await query(
    `insert into place_subcategories (venue_ref, category, subcategory, found_by, found_rank, area_slug, first_seen, last_seen, run_id)
     values ${values}
     on conflict (venue_ref, subcategory, coalesce(area_slug, '')) do update
        -- The category too. A taxonomy change can move a subcategory to another
        -- shelf, and leaving the old parent here made the (category,
        -- subcategory) index answer with stale membership for ever — which
        -- contradicts the one thing the plan being read from shelf_rules is
        -- meant to buy, that a re-map costs nothing (Codex, 19 Sep 2026).
        set category = excluded.category,
            found_by = excluded.found_by, found_rank = excluded.found_rank, last_seen = now(),
            -- The run that last found it, so a count and the explanation beside
            -- it come from the same census (Codex, 20 Sep 2026).
            run_id = excluded.run_id`,
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
async function rollUp({ areaSlug, runId, done, found, surfaced }) {
  if (!areaSlug) return;
  for (const { category, subcategory } of done) {
    // Filed here — one per place, the shelving answer.
    const mine = found.filter((p) => p.subcategory === subcategory);
    // Found by this question — the answer to "how many are there". The gap
    // between the two is the overlap with other drawers, and the owner asked
    // to see both where they differ (19 Sep 2026).
    const surfacedHere = surfaced.filter((p) => p.subcategory === subcategory);
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
    // Scored is counted over everything this question found, not only what it
    // was filed under: a golf course scored as a wood is still scored.
    const refs = [...new Set(surfacedHere.map((p) => p.ref))];
    const { rows: [scored] } = refs.length
      ? await query(`select count(*)::int n from epic_scores where venue_ref = any($1)`, [refs])
      : { rows: [{ n: 0 }] };
    await query(
      `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count, saturated, censused_at, run_id, complete)
       values ($1,$2,$3,$4,$5,$6,$7, now(), $8, true)
       on conflict (area_slug, category, subcategory) do update
          set census_count   = excluded.census_count,
              surfaced_count = excluded.surfaced_count,
              scored_count   = excluded.scored_count,
              saturated      = excluded.saturated,
              censused_at    = excluded.censused_at,
              run_id         = excluded.run_id,
              complete       = true`,
      [areaSlug, category, subcategory, mine.length, surfacedHere.length, scored.n, sat.n, runId],
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
export const OURS_TO_KEEP = ['osm', 'atlas', 'own'];

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
  // Written down as it happens, because it cannot be recovered afterwards: an
  // expired row looks exactly like a census row that never had a point
  // (migration 205). A count and a date, never the refs — keeping those would
  // be keeping a Google-derived collection past its thirty days by another
  // name.
  await query('insert into coordinate_expiries (expired, cells) values ($1, $2)', [rows.length, cells])
    .catch(() => null);
  return { expired: rows.length, cells };
}

/**
 * Rebuild an area's board counts from what is already stored.
 *
 * The census writes two things: the places, into `place_index` and
 * `place_subcategories`, and the roll-up, into `area_counts`. The first is the
 * record and the second is derived from it — so when a run zeroed SL5's
 * forty-six drawers by rolling up a census in which every slice had been
 * refused, nothing was actually lost. The places were still there; only the
 * summary was wrong.
 *
 * This puts the summary back from the record, which is the right direction of
 * travel and costs nothing. It is also what makes the zeroing survivable at
 * all: a derived table that cannot be rebuilt is not derived, it is the record.
 */
export async function rebuildCounts(areaSlug) {
  const { rows } = await query(
    `select ps.category, ps.subcategory,
            count(*)::int                                            as surfaced,
            count(*) filter (where i.subcategory = ps.subcategory)::int as filed,
            count(e.venue_ref)::int                                  as scored
       from place_subcategories ps
       join place_index i on i.venue_ref = ps.venue_ref
       left join epic_scores e on e.venue_ref = ps.venue_ref
      where ps.area_slug = $1
      group by 1, 2`,
    [areaSlug],
  );
  let written = 0;
  for (const r of rows) {
    const { rows: [sat] } = await query(
      `select count(*)::int n from census_slices
        where area_slug = $1 and subcategory = $2 and saturated and depth >= $3
          and run_id = (select run_id from census_slices
                         where area_slug = $1 and subcategory = $2 and problem is null
                         order by ran_at desc limit 1)`,
      [areaSlug, r.subcategory, MAX_DEPTH],
    );
    await query(
      `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count, saturated, censused_at, complete)
       values ($1,$2,$3,$4,$5,$6,$7,
               (select max(ran_at) from census_slices where area_slug = $1 and subcategory = $3 and problem is null),
               true)
       on conflict (area_slug, category, subcategory) do update
          set census_count = excluded.census_count, surfaced_count = excluded.surfaced_count,
              scored_count = excluded.scored_count, saturated = excluded.saturated,
              censused_at = excluded.censused_at, complete = true`,
      [areaSlug, r.category, r.subcategory, r.filed, r.surfaced, r.scored, sat.n],
    );
    written += 1;
  }
  // A drawer with no surfacings at all keeps no row: the board draws the plan,
  // and a row of noughts asserts an answer nobody got.
  await query(
    `delete from area_counts a
      where a.area_slug = $1
        and not exists (select 1 from place_subcategories ps
                         where ps.area_slug = a.area_slug and ps.subcategory = a.subcategory)`,
    [areaSlug],
  );
  return { written };
}
