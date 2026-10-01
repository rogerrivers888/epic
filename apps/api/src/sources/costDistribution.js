/**
 * The cost-band distribution of an area (owner, 1 Oct 2026).
 *
 * How often does Google actually hold a price level for the places the census
 * found? The drawer's four-step scale (Free · £ · ££ · £££) is worth the row it
 * occupies only if most places have a level; on the kind of place Epic exists to
 * surface — gardens, farm parks, heritage — Google's coverage is thin, and SL5 is
 * close to its worst. This measures it once, plainly, so the owner can judge the
 * scale against a real number rather than central London's 18-of-20.
 *
 * It is a paid pass — one Place Details per place, asking only for the price
 * level — so it spends the way every paid run here does: through the session that
 * started it (a granted agent session), reserved by a gate that refuses a start
 * whose confirm does not match the estimate's request count, over a FROZEN set of
 * places so a later census cannot make it spend more than was agreed, and picked
 * up at boot.
 *
 * What it keeps is the distribution, not the prices. A place's price level is
 * rented content the data policy will not let us store (google.js retention:
 * none), so it is counted in memory and only the aggregate histogram lands on the
 * run (Codex). Each place is claimed in the ledger BEFORE it is paid for, so a
 * resume never pays twice and two workers racing the same run cannot each pay for
 * one place. Each place ends as one of: a band, a place Google holds but gives no
 * price, or an id that will not resolve at all — a stale id, not a coverage gap.
 * A transient failure (a 429, a timeout, the session's grant gone) never counts
 * as a stale id: it releases that place's claim and pauses the run — kept
 * 'running' so it is reclaimed, not abandoned — so the data is never poisoned.
 */

import { query } from '../db.js';
import { googleSource } from './google.js';
import { runAsSpender, currentSpender } from '../context.js';
import * as providerCalls from '../repositories/providerCalls.js';
import { bandIndexForLevel, scaleFor } from '../domain/costBand.js';
import { costOf, USD_TO_GBP } from '../domain/providerPrices.js';

/** A Place Details that reads the price level, priced as the ledger prices it. */
const callGbp = (n) => Math.round(costOf({ 'google-details': n }, 'google') * USD_TO_GBP * 100) / 100;
/** A running run untouched this long — paused or with a dead worker — is reclaimed. */
const STALL_MS = 5 * 60_000;
/** The histogram column each outcome increments; names are fixed, never interpolated from input. */
const BAND_COLUMN = ['band0', 'band1', 'band2', 'band3'];

/** The google: refs the census found in an area — the only ones a Place Details id resolves. */
export async function refsFor(areaSlug) {
  const { rows } = await query(
    `select distinct pi.venue_ref
       from place_index pi
       join place_areas pa on pa.venue_ref = pi.venue_ref
      where pa.area_slug = $1 and pi.venue_ref like 'google:%'
      order by pi.venue_ref`, [String(areaSlug).toLowerCase()]);
  return rows.map((r) => r.venue_ref);
}

/** The latest run for an area, or null. */
export async function latestRun(areaSlug) {
  const { rows } = await query(
    `select * from cost_dist_runs where area_slug = $1 order by started_at desc limit 1`,
    [String(areaSlug).toLowerCase()]);
  return rows[0] ?? null;
}

/** The place ids this run has already claimed — looked up and counted. */
const claimedRefs = async (runId) => {
  const { rows } = await query('select venue_ref from cost_dist_samples where run_id = $1', [runId]);
  return new Set(rows.map((r) => r.venue_ref));
};

/** A running run not touched within the stall window, or paused on a problem, is reclaimable. */
const reclaimable = (run, now = Date.now()) =>
  run.state === 'running' && (run.problem != null || new Date(run.touched_at).getTime() < now - STALL_MS);

/**
 * What a run of an area would cost now. For a still-running run, only the places
 * of its FROZEN set not yet claimed (so a resume prices what is left, not the
 * area as it stands now); for a fresh run, every google: place the census found.
 * `requests` is the gate's number — `start` refuses a confirm that does not match.
 */
export async function estimate(areaSlug) {
  const slug = String(areaSlug).toLowerCase();
  const run = await latestRun(slug);
  if (run && run.state === 'running') {
    const done = await claimedRefs(run.id);
    const left = (run.refs ?? []).filter((r) => !done.has(r));
    return { areaSlug: slug, total: (run.refs ?? []).length, requests: left.length, costGbp: callGbp(left.length), resuming: true };
  }
  const refs = await refsFor(slug);
  return { areaSlug: slug, total: refs.length, requests: refs.length, costGbp: callGbp(refs.length), resuming: false };
}

/**
 * Start (or resume) a run. A still-running run is resumed, not gated again — it
 * reports `created: false`, and `reclaim: true` when its worker is gone (paused,
 * or stale) so the caller knows to launch a fresh worker for it (Codex); a run
 * being actively worked reports `reclaim: false` and no second worker is started.
 * A fresh run is refused unless `confirm` equals the request count the estimate
 * reported, and its place set is frozen onto the row.
 */
export async function start({ areaSlug, confirm, householdId = null, startedBy = null, startedSessionId = null } = {}) {
  const slug = String(areaSlug || '').toLowerCase();
  if (!slug) throw bad('an area is needed');
  const session = startedSessionId ?? currentSpender().sessionId ?? null;
  const existing = await latestRun(slug);
  if (existing && existing.state === 'running') {
    // Attribute the resumed spend to the reclaiming session (its grant is the live
    // one); do not disturb touched_at — work() claims the run when it starts.
    if (session) await query('update cost_dist_runs set started_session_id = $2 where id = $1', [existing.id, session]);
    return { run: existing, created: false, reclaim: reclaimable(existing) };
  }
  const refs = await refsFor(slug);
  if (Number(confirm) !== refs.length) {
    throw bad(`confirm the request count: ${refs.length} place${refs.length === 1 ? '' : 's'} to look up`);
  }
  try {
    const { rows: [run] } = await query(
      `insert into cost_dist_runs (area_slug, household_id, started_by, started_session_id, requests, refs)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [slug, householdId, startedBy, session, refs.length, JSON.stringify(refs)]);
    return { run, created: true, reclaim: false };
  } catch (err) {
    // Lost the race to the one-running-run index: resume the winner, don't duplicate.
    if (String(err?.code) === '23505') {
      const winner = await latestRun(slug);
      if (winner && winner.state === 'running') return { run: winner, created: false, reclaim: reclaimable(winner) };
    }
    throw err;
  }
}

/**
 * Work a run to completion over its frozen set: one Place Details per place not
 * yet claimed, each spent through the run's own session. Every place is CLAIMED
 * in the ledger before it is paid for, so a concurrent worker that loses the
 * claim skips the place rather than paying again. A place that resolves counts
 * one band (or no_price, if Google holds it but gives no price); a definite
 * not-found (404) counts one stale id. A transient failure — a 429, a timeout, an
 * unreachable provider, the grant gone, any non-404 error — releases the place's
 * claim and pauses the run (kept 'running', problem set) so a resume finishes it
 * rather than recording a false stale id. Returns the finished or paused run.
 */
export async function work(runId, { get = googleSource.priceLevel.bind(googleSource) } = {}) {
  // Claim the run: clear any prior pause and mark it worked. If it is not running
  // (already done), there is nothing to do.
  const { rowCount: claimed } = await query(
    "update cost_dist_runs set problem = null, touched_at = now() where id = $1 and state = 'running'", [runId]);
  if (!claimed) { const { rows: [r] } = await query('select * from cost_dist_runs where id = $1', [runId]); return r ?? null; }
  const { rows: [run] } = await query('select * from cost_dist_runs where id = $1', [runId]);
  const done = await claimedRefs(runId);
  const left = (run.refs ?? []).filter((r) => !done.has(r));
  for (const ref of left) {
    // Stop if the run was finished elsewhere between places.
    const { rows: [cur] } = await query('select state from cost_dist_runs where id = $1', [runId]);
    if (!cur || cur.state !== 'running') { const { rows: [r] } = await query('select * from cost_dist_runs where id = $1', [runId]); return r ?? null; }
    // Claim the place BEFORE paying: a concurrent worker that loses this insert
    // skips it rather than paying for the same place again.
    const { rowCount: mine } = await query(
      'insert into cost_dist_samples (run_id, venue_ref) values ($1, $2) on conflict do nothing', [runId, ref]);
    if (!mine) continue;
    const id = ref.slice('google:'.length);
    const meter = {};
    let outcome;
    try {
      const v = await runAsSpender({ householdId: run.household_id, sessionId: run.started_session_id }, () => get(id, { meter }));
      // A null answer is the source switched off — transient, not a stale id.
      outcome = v ? { band: columnFor(v.priceLevel) } : { pause: 'Google returned nothing (source off)' };
    } catch (err) {
      const status = Number((/Google Places (\d{3})/.exec(String(err?.message ?? '')) || [])[1]) || null;
      // Only a definite not-found is a stale id. A 400 (bad request/mask) or any
      // other error would hit every place, so it pauses rather than marking all
      // places unresolved (Codex).
      outcome = status === 404 ? { band: 'unresolved' } : { pause: String(err?.message ?? err).slice(0, 200) };
    }
    // The spend lands on the ledger attributed to the run's own session, as every
    // paid background pass here does (desk/pilot.js).
    if (Object.keys(meter).length) await providerCalls.record(run.household_id, 'google', 'cost.distribution', meter, run.started_session_id, ref).catch(() => null);
    if (outcome.pause) {
      // Release the claim so a resume retries this place, and pause the run.
      await query('delete from cost_dist_samples where run_id = $1 and venue_ref = $2', [runId, ref]);
      await query("update cost_dist_runs set problem = $2, touched_at = now() where id = $1 and state = 'running'", [runId, `paused at ${ref}: ${outcome.pause}`]);
      const { rows: [paused] } = await query('select * from cost_dist_runs where id = $1', [runId]);
      return paused;
    }
    // Count the band in memory's histogram on the run — never the price itself.
    await query(`update cost_dist_runs set ${outcome.band} = ${outcome.band} + 1, touched_at = now() where id = $1`, [runId]);
  }
  await query("update cost_dist_runs set state = 'done', finished_at = now(), touched_at = now() where id = $1 and state = 'running'", [runId]);
  const { rows: [finished] } = await query('select * from cost_dist_runs where id = $1', [runId]);
  return finished;
}

/** The histogram column a price level counts towards. */
function columnFor(priceLevel) {
  if (priceLevel == null) return 'no_price';
  const i = bandIndexForLevel(priceLevel);
  return i == null ? 'no_price' : BAND_COLUMN[i];
}

/**
 * The distribution so far: how many places in each band, how many Google holds
 * with no price, and how many would not resolve — the two numbers that look
 * identical in the atlas and are not. Read off the run's own histogram; costs
 * nothing and holds no price.
 */
export async function status(areaSlug) {
  const slug = String(areaSlug).toLowerCase();
  const run = await latestRun(slug);
  if (!run) return { areaSlug: slug, run: null, total: (await refsFor(slug)).length, sampled: 0 };
  const scale = scaleFor('GBP'); // labels only — the split is currency-agnostic
  const withLevel = run.band0 + run.band1 + run.band2 + run.band3;
  const sampled = withLevel + run.no_price + run.unresolved;
  return {
    areaSlug: slug,
    run: { id: run.id, state: run.state, requests: run.requests, problem: run.problem, startedAt: run.started_at, finishedAt: run.finished_at },
    total: (run.refs ?? []).length,
    sampled,
    bands: { Free: run.band0, [scale[1]]: run.band1, [scale[2]]: run.band2, [scale[3]]: run.band3 },
    withLevel,
    noPriceLevel: run.no_price, // Google holds the place, gives no price — coverage thinness
    unresolved: run.unresolved, // Place Details would not resolve the id — a stale id we hold
  };
}

/** Reclaim a run whose worker is gone — paused, or stalled — the boot pickup. */
export async function resume({ now = new Date() } = {}) {
  const { rows } = await query(
    `select id from cost_dist_runs
      where state = 'running' and (problem is not null or touched_at < $1)
      order by started_at limit 1`,
    [new Date(now.getTime() - STALL_MS)]);
  if (!rows.length) return null;
  return work(rows[0].id);
}

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
