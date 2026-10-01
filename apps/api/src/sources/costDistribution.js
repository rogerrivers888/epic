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
 * start whose confirm does not match the estimate's request count, written place
 * by place so a deploy loses nothing, and picked up at boot. Each place lands as
 * one of three facts (migration 309): a price level; Google holds it but gives no
 * price; or the id would not resolve at all — a stale id, not a coverage gap.
 */

import { query, withTransaction } from '../db.js';
import { googleSource } from './google.js';
import { runAsSpender, currentSpender } from '../context.js';
import { recordProviderCall } from '../repositories/visits.js';
import { bandIndexForLevel, scaleFor } from '../domain/costBand.js';

/** A Place Details asking for the price level bills at the Pro tier: 2.5p a call. */
const GBP_PER_CALL = 0.025;
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

/**
 * What a run of an area would cost now: the places not yet sampled by its latest
 * still-running run (so a resume prices only what is left), or all of them for a
 * fresh run. `requests` is the gate's number — `start` refuses a confirm that
 * does not match it.
 */
export async function estimate(areaSlug) {
  const slug = String(areaSlug).toLowerCase();
  const refs = await refsFor(slug);
  const run = await latestRun(slug);
  let done = new Set();
  if (run && run.state === 'running') {
    const { rows } = await query('select venue_ref from cost_dist_samples where run_id = $1', [run.id]);
    done = new Set(rows.map((r) => r.venue_ref));
  }
  const left = refs.filter((r) => !done.has(r));
  return { areaSlug: slug, total: refs.length, requests: left.length, costGbp: Number((left.length * GBP_PER_CALL).toFixed(2)), resuming: !!(run && run.state === 'running') };
}

/**
 * Start (or resume) a run. Refused unless `confirm` equals the request count the
 * estimate just reported — the gate every paid run here uses, so a run never
 * spends more than was priced and agreed. A still-running run for the area is
 * resumed rather than duplicated.
 */
export async function start({ areaSlug, confirm, householdId = null, startedBy = null, startedSessionId = null } = {}) {
  const slug = String(areaSlug || '').toLowerCase();
  if (!slug) throw bad('an area is needed');
  const session = startedSessionId ?? currentSpender().sessionId ?? null;
  // Resuming an already-running run is not a fresh spend, so it is not gated
  // again — a second Start (a double click, or after a deploy) picks the run up
  // where it is rather than erroring or duplicating.
  const existing = await latestRun(slug);
  if (existing && existing.state === 'running') {
    await query('update cost_dist_runs set touched_at = now(), started_session_id = coalesce($2, started_session_id) where id = $1', [existing.id, session]);
    return existing;
  }
  // A fresh run is gated: confirm must equal the request count the estimate reported.
  const plan = await estimate(slug);
  if (Number(confirm) !== plan.requests) {
    throw bad(`confirm the request count: ${plan.requests} place${plan.requests === 1 ? '' : 's'} left to look up`);
  }
  const { rows: [run] } = await query(
    `insert into cost_dist_runs (area_slug, household_id, started_by, started_session_id, requests)
     values ($1, $2, $3, $4, $5) returning *`,
    [slug, householdId, startedBy, session, plan.requests]);
  return run;
}

/**
 * Work a run to completion: one Place Details per place not yet sampled, each
 * spent through the run's own session so a resume is still attributed and still
 * within its grant. A place that resolves records its price level (or null, if
 * Google holds it but gives no price); one that will not resolve records
 * resolved = false. Heartbeats as it goes; stops the moment the run is no longer
 * running (somebody stopped it). Returns the finished run.
 */
export async function work(runId, { get = googleSource.get.bind(googleSource) } = {}) {
  const { rows: [run] } = await query('select * from cost_dist_runs where id = $1', [runId]);
  if (!run || run.state !== 'running') return run ?? null;
  const refs = await refsFor(run.area_slug);
  const { rows: doneRows } = await query('select venue_ref from cost_dist_samples where run_id = $1', [runId]);
  const done = new Set(doneRows.map((r) => r.venue_ref));
  const left = refs.filter((r) => !done.has(r));
  for (const ref of left) {
    // Stop at once if the run was stopped between places.
    const { rows: [now] } = await query('select state from cost_dist_runs where id = $1', [runId]);
    if (!now || now.state !== 'running') return now ? { ...run, state: now.state } : null;
    const id = ref.slice('google:'.length);
    const meter = {};
    let venue = null;
    try {
      venue = await runAsSpender({ householdId: run.household_id, sessionId: run.started_session_id },
        () => get(id, { meter }));
    } catch { venue = null; }
    if (Object.keys(meter).length) {
      await recordProviderCall(run.household_id, 'google', 'cost.distribution', meter, ref).catch(() => null);
    }
    const resolved = Boolean(venue);
    const priceLevel = resolved && venue.priceLevel != null ? Number(venue.priceLevel) : null;
    await query(
      `insert into cost_dist_samples (run_id, venue_ref, price_level, resolved)
       values ($1, $2, $3, $4) on conflict (run_id, venue_ref) do nothing`,
      [runId, ref, priceLevel, resolved]);
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
  const total = (await refsFor(slug)).length;
  if (!run) return { areaSlug: slug, run: null, total, sampled: 0 };
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
    run: { id: run.id, state: run.state, requests: run.requests, startedAt: run.started_at, finishedAt: run.finished_at },
    total,
    sampled: rows.length,
    // The four-step scale's own coverage: a place with a level fills a step.
    bands: { Free: bands.Free, [scale[1]]: bands.one, [scale[2]]: bands.two, [scale[3]]: bands.three },
    withLevel,
    // The two that look identical in the atlas and are not (owner, 1 Oct 2026).
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
