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
 * level — so it spends the same way every paid run here does: through the session
 * that started it (a granted agent session), reserved by a gate that refuses a
 * start whose confirm does not match the estimate's request count, over a FROZEN
 * set of places so a later census cannot make it spend more than was agreed,
 * written place by place so a deploy loses nothing, and picked up at boot. Each
 * place lands as one of three facts (migration 309): a price level; Google holds
 * it but gives no price; or the id would not resolve at all — a stale id, not a
 * coverage gap. A transient failure (a 429, a timeout, the session's grant gone)
 * never counts as a stale id: it stops the run, to be resumed, so the data is
 * never poisoned.
 */

import { query } from '../db.js';
import { googleSource } from './google.js';
import { runAsSpender, currentSpender } from '../context.js';
import * as providerCalls from '../repositories/providerCalls.js';
import { bandIndexForLevel, scaleFor } from '../domain/costBand.js';
import { costOf, USD_TO_GBP } from '../domain/providerPrices.js';

/** A Place Details that reads the price level, priced as the ledger prices it. */
const callGbp = (n) => Math.round(costOf({ 'google-details': n }, 'google') * USD_TO_GBP * 100) / 100;
/** A running run whose heartbeat has been silent this long is taken over at boot. */
const STALL_MS = 5 * 60_000;

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

const sampledRefs = async (runId) => {
  const { rows } = await query('select venue_ref from cost_dist_samples where run_id = $1', [runId]);
  return new Set(rows.map((r) => r.venue_ref));
};

/**
 * What a run of an area would cost now. For a still-running run, only the places
 * of its FROZEN set not yet sampled (so a resume prices what is left, not the
 * area as it stands now); for a fresh run, every google: place the census found.
 * `requests` is the gate's number — `start` refuses a confirm that does not match.
 */
export async function estimate(areaSlug) {
  const slug = String(areaSlug).toLowerCase();
  const run = await latestRun(slug);
  if (run && run.state === 'running') {
    const done = await sampledRefs(run.id);
    const left = (run.refs ?? []).filter((r) => !done.has(r));
    return { areaSlug: slug, total: (run.refs ?? []).length, requests: left.length, costGbp: callGbp(left.length), resuming: true };
  }
  const refs = await refsFor(slug);
  return { areaSlug: slug, total: refs.length, requests: refs.length, costGbp: callGbp(refs.length), resuming: false };
}

/**
 * Start (or resume) a run. A still-running run is resumed — not gated again, since
 * resuming is not a fresh spend — and no second worker is launched for it. A fresh
 * run is refused unless `confirm` equals the request count the estimate reported,
 * and its place set is frozen onto the row. Returns `{ run, created }`: the caller
 * launches the worker only when it created the run.
 */
export async function start({ areaSlug, confirm, householdId = null, startedBy = null, startedSessionId = null } = {}) {
  const slug = String(areaSlug || '').toLowerCase();
  if (!slug) throw bad('an area is needed');
  const session = startedSessionId ?? currentSpender().sessionId ?? null;
  const existing = await latestRun(slug);
  if (existing && existing.state === 'running') {
    await query('update cost_dist_runs set touched_at = now(), started_session_id = coalesce($2, started_session_id) where id = $1', [existing.id, session]);
    return { run: existing, created: false };
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
    return { run, created: true };
  } catch (err) {
    // Lost the race to the one-running-run index: resume the winner, don't duplicate.
    if (String(err?.code) === '23505') {
      const winner = await latestRun(slug);
      if (winner && winner.state === 'running') return { run: winner, created: false };
    }
    throw err;
  }
}

/**
 * Work a run to completion over its frozen set: one Place Details per place not
 * yet sampled, each spent through the run's own session. A place that resolves
 * records its price level (or null, if Google holds it but gives no price); a
 * definite not-found (404/400) records a stale id (resolved = false). A transient
 * failure — a 429, a timeout, an unreachable provider, the grant gone — stops the
 * run with its reason rather than recording a false stale id, so a resume can
 * finish it. Returns the finished (or stopped) run.
 */
export async function work(runId, { get = googleSource.priceLevel.bind(googleSource) } = {}) {
  const { rows: [run] } = await query('select * from cost_dist_runs where id = $1', [runId]);
  if (!run || run.state !== 'running') return run ?? null;
  const done = await sampledRefs(runId);
  const left = (run.refs ?? []).filter((r) => !done.has(r));
  for (const ref of left) {
    // Stop at once if the run was stopped between places.
    const { rows: [state] } = await query('select state from cost_dist_runs where id = $1', [runId]);
    if (!state || state.state !== 'running') return state ? { ...run, state: state.state } : null;
    const id = ref.slice('google:'.length);
    const meter = {};
    let outcome;
    try {
      const v = await runAsSpender({ householdId: run.household_id, sessionId: run.started_session_id }, () => get(id, { meter }));
      outcome = v ? { resolved: true, priceLevel: v.priceLevel ?? null } : { stop: 'Google returned nothing (source off)' };
    } catch (err) {
      const status = Number((/Google Places (\d{3})/.exec(String(err?.message ?? '')) || [])[1]) || null;
      // Only a definite not-found is a stale id; everything else is transient.
      outcome = (status === 404 || status === 400) ? { resolved: false } : { stop: String(err?.message ?? err).slice(0, 200) };
    }
    // The spend lands on the ledger attributed to the run's own session, as every
    // paid background pass here does (desk/pilot.js), so a resume after a deploy
    // stays inside the grant that started it.
    if (Object.keys(meter).length) await providerCalls.record(run.household_id, 'google', 'cost.distribution', meter, run.started_session_id, ref).catch(() => null);
    if (outcome.stop) {
      await query("update cost_dist_runs set state = 'stopped', problem = $2, touched_at = now() where id = $1 and state = 'running'", [runId, `stopped at ${ref}: ${outcome.stop}`]);
      const { rows: [stopped] } = await query('select * from cost_dist_runs where id = $1', [runId]);
      return stopped;
    }
    await query(
      `insert into cost_dist_samples (run_id, venue_ref, price_level, resolved) values ($1, $2, $3, $4)
       on conflict (run_id, venue_ref) do nothing`,
      [runId, ref, outcome.resolved && outcome.priceLevel != null ? Number(outcome.priceLevel) : null, outcome.resolved]);
    await query('update cost_dist_runs set touched_at = now() where id = $1', [runId]);
  }
  await query("update cost_dist_runs set state = 'done', finished_at = now(), touched_at = now() where id = $1 and state = 'running'", [runId]);
  const { rows: [finished] } = await query('select * from cost_dist_runs where id = $1', [runId]);
  return finished;
}

/**
 * The distribution so far: how many places in each band, how many Google holds
 * with no price, and how many would not resolve — the two numbers that look
 * identical in the atlas and are not. Read of a run's own samples; costs nothing.
 */
export async function status(areaSlug) {
  const slug = String(areaSlug).toLowerCase();
  const run = await latestRun(slug);
  if (!run) return { areaSlug: slug, run: null, total: (await refsFor(slug)).length, sampled: 0 };
  const { rows } = await query('select price_level, resolved from cost_dist_samples where run_id = $1', [run.id]);
  const scale = scaleFor('GBP'); // labels only — the split is currency-agnostic
  const bands = { Free: 0, one: 0, two: 0, three: 0 };
  let noPrice = 0; let unresolved = 0;
  for (const r of rows) {
    if (!r.resolved) { unresolved += 1; continue; }
    if (r.price_level == null) { noPrice += 1; continue; }
    const i = bandIndexForLevel(r.price_level);
    if (i === 0) bands.Free += 1; else if (i === 1) bands.one += 1; else if (i === 2) bands.two += 1; else if (i === 3) bands.three += 1; else noPrice += 1;
  }
  const withLevel = bands.Free + bands.one + bands.two + bands.three;
  return {
    areaSlug: slug,
    run: { id: run.id, state: run.state, requests: run.requests, problem: run.problem, startedAt: run.started_at, finishedAt: run.finished_at },
    total: (run.refs ?? []).length,
    sampled: rows.length,
    bands: { Free: bands.Free, [scale[1]]: bands.one, [scale[2]]: bands.two, [scale[3]]: bands.three },
    withLevel,
    noPriceLevel: noPrice, // Google holds the place, gives no price — coverage thinness
    unresolved,            // Place Details would not resolve the id — a stale id we hold
  };
}

/** Resume a run left running when its process died — the boot pickup. */
export async function resume({ now = new Date() } = {}) {
  const { rows } = await query(
    "select id from cost_dist_runs where state = 'running' and touched_at < $1 order by started_at limit 1",
    [new Date(now.getTime() - STALL_MS)]);
  if (!rows.length) return null;
  return work(rows[0].id);
}

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
