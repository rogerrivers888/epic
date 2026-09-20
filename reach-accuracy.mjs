/**
 * How wrong is the estimate? The stored matrix against Google Routes.
 *
 * Owner, 20 Sep 2026: "Before anything else, measure the estimate's error. Take
 * a random sample of a few hundred place pairs already in the matrix, route them
 * through Google Routes, and compare the real road time against the stored
 * minutes. Report the distribution and the worst over-estimate."
 *
 * Two directions, and they are not the same risk:
 *
 *   LOSS      stored > real. The matrix says too far; the road says within. The
 *             place is never offered and the exact pass cannot go and find it.
 *             This is the one EDGE_MINUTES exists to cover, and the one the
 *             "drop but never find" rule depends on.
 *   OVER-REACH  stored < real. The matrix offers a place that is further than it
 *             said. The exact pass measures it and drops it. Costs work, not
 *             correctness — except on a screen that has no exact pass.
 *
 * Free-flow (TRAFFIC_UNAWARE) is the primary comparison, because our estimator
 * has no traffic model and a traffic-aware road time would flatter the LOSS tail
 * by inflating `real`. A subsample is then routed traffic-aware, which is what
 * the app itself buys, to say what the time of day is worth.
 *
 * Read-only against every table but provider_calls, where what the bench spent
 * is recorded like any other call.
 */
import { query, pool } from './apps/api/src/db.js';
import { estimateTravelMinutes, kmBetween } from './apps/api/src/domain/travel.js';
import { routeMatrixMinutes } from './apps/api/src/sources/routing.js';
import * as providerCalls from './apps/api/src/repositories/providerCalls.js';

const ORIGINS = Number(process.argv[2] || 50);
const TRAFFIC_N = Number(process.argv[3] || 60);
const SEED = Number(process.argv[4] || 20260920);
const BANDS = [[0, 5], [5, 15], [15, 30], [30, 45], [45, 60], [60, 95]];
const KEY = process.env.GOOGLE_MAPS_API_KEY?.trim();
if (!KEY) { console.error('No GOOGLE_MAPS_API_KEY in this environment.'); process.exit(1); }

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const sortNum = (a) => [...a].sort((x, y) => x - y);
const pct = (arr, p) => { if (!arr.length) return null; const s = sortNum(arr); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

const FIELDS = 'originIndex,destinationIndex,duration,distanceMeters,condition';
const wp = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
const mins = (d) => Math.round(Number(String(d || '0s').replace('s', '')) / 60);

let requests = 0;
let elements = 0;

/** One origin to many destinations, free of traffic. */
async function freeFlow(origin, dests) {
  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({ origins: [wp(origin)], destinations: dests.map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
    signal: AbortSignal.timeout(25_000),
  });
  requests += 1; elements += dests.length;
  if (!res.ok) throw new Error(`Routes ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = await res.json();
  const out = new Array(dests.length).fill(null);
  for (const r of rows) if (r.condition === 'ROUTE_EXISTS') out[r.destinationIndex ?? 0] = { minutes: mins(r.duration), meters: r.distanceMeters ?? null };
  return out;
}

const cells = (await query(
  `select code, label, lat, lng, points, places from geo_cells
    where scheme = 'sector' and country_code = 'GB' order by code`)).rows;
const byCode = new Map(cells.map((c) => [c.code, c]));
console.log(`cells: ${cells.length}`);

// The sample: random origins, and from each one a random destination in every
// band, so the short end is not swamped by the long one.
const originPool = cells.filter((c) => Number(c.places) > 0);
const chosen = [];
const seen = new Set();
while (chosen.length < Math.min(ORIGINS, originPool.length)) {
  const c = pick(originPool);
  if (seen.has(c.code)) continue;
  seen.add(c.code); chosen.push(c);
}

const pairs = [];
for (const origin of chosen) {
  const { rows } = await query(
    `select to_cell, minutes, km from reach where from_cell = $1 and mode = 'driving' and to_cell <> $1`,
    [origin.code]);
  for (const [lo, hi] of BANDS) {
    const inBand = rows.filter((r) => r.minutes > lo && r.minutes <= hi);
    if (!inBand.length) continue;
    const r = pick(inBand);
    const to = byCode.get(r.to_cell);
    if (!to) continue;
    pairs.push({
      from: origin, to, band: `${lo}-${hi}`,
      stored: Number(r.minutes), storedKm: Number(r.km),
      straightKm: kmBetween(origin, to),
      recomputed: estimateTravelMinutes(origin, to, 'driving'),
    });
  }
}
console.log(`origins: ${chosen.length}, pairs: ${pairs.length}`);

// Route them, one request per origin.
const byOrigin = new Map();
for (const p of pairs) { if (!byOrigin.has(p.from.code)) byOrigin.set(p.from.code, []); byOrigin.get(p.from.code).push(p); }
let noRoute = 0;
for (const [code, ps] of byOrigin) {
  try {
    const got = await freeFlow(ps[0].from, ps.map((p) => p.to));
    ps.forEach((p, i) => {
      if (got[i]) { p.real = got[i].minutes; p.realKm = got[i].meters == null ? null : got[i].meters / 1000; }
      else { p.real = null; noRoute += 1; }
    });
  } catch (e) {
    console.error(`  ${code}: ${e.message}`);
    ps.forEach((p) => { p.real = null; });
  }
}

const done = pairs.filter((p) => p.real != null);
console.log(`routed: ${done.length} of ${pairs.length} (${noRoute} with no route)\n`);

// The stored value was written when the cell centres were where they were; if a
// centre has moved since, the stored number is stale in a way that is nothing to
// do with the estimator. Both are reported.
const stale = done.filter((p) => p.stored !== p.recomputed);

const table = (title, rows) => {
  console.log(title);
  console.log(rows.map((r) => r.map((c, i) => String(c).padEnd(i === 0 ? 12 : 9)).join('')).join('\n'));
  console.log('');
};

// ---------------------------------------------------------------------------
console.log('='.repeat(78));
console.log('ERROR = real - stored.  positive: we understated the journey (OVER-REACH).');
console.log('                        negative: we overstated it (LOSS, the dangerous one).');
console.log('='.repeat(78) + '\n');

const rowsFor = (set) => {
  const err = set.map((p) => p.real - p.stored);
  const loss = set.map((p) => p.stored - p.real).filter((x) => x > 0);
  return {
    n: set.length,
    mean: r1(mean(err)), p10: pct(err, 10), p50: pct(err, 50), p90: pct(err, 90),
    min: err.length ? Math.min(...err) : null, max: err.length ? Math.max(...err) : null,
    worstLoss: loss.length ? Math.max(...loss) : 0,
    lossOver5: set.filter((p) => p.stored - p.real > 5).length,
  };
};

const all = rowsFor(done);
table('OVERALL', [
  ['', 'n', 'mean', 'p10', 'p50', 'p90', 'min', 'max'],
  ['error', all.n, all.mean, all.p10, all.p50, all.p90, all.min, all.max],
]);

const bandRows = [['band', 'n', 'mean', 'p10', 'p50', 'p90', 'worstLoss', '>5 lost']];
for (const [lo, hi] of BANDS) {
  const set = done.filter((p) => p.band === `${lo}-${hi}`);
  if (!set.length) continue;
  const s = rowsFor(set);
  bandRows.push([`${lo}-${hi}`, s.n, s.mean, s.p10, s.p50, s.p90, s.worstLoss, s.lossOver5]);
}
table('BY STORED BAND', bandRows);

// The gate: how many pairs would the matrix lose, at each allowance?
console.log('THE GATE — pairs the matrix would never offer, by allowance');
console.log('(a pair is lost when stored - real > allowance: we said too far, the road says within)\n');
const allowances = [0, 3, 5, 8, 10, 15, 20];
const gateRows = [['allowance', 'lost', '% lost']];
for (const a of allowances) {
  const lost = done.filter((p) => p.stored - p.real > a).length;
  gateRows.push([`${a} min`, lost, r1((lost / done.length) * 100) + '%']);
}
// And the proportional proposal.
for (const frac of [0.1, 0.15, 0.2]) {
  const lost = done.filter((p) => p.stored - p.real > Math.max(5, p.stored * frac)).length;
  gateRows.push([`max(5, ${Math.round(frac * 100)}%)`, lost, r1((lost / done.length) * 100) + '%']);
}
table('', gateRows);

const lossValues = done.map((p) => p.stored - p.real).filter((x) => x > 0);
console.log(`LOSS TAIL: worst over-estimate = ${lossValues.length ? Math.max(...lossValues) : 0} min`);
console.log(`           p95 of the loss = ${pct(lossValues, 95)} min, p99 = ${pct(lossValues, 99)} min`);
console.log(`           allowance needed to cover 95% of all pairs = ${pct(done.map((p) => p.stored - p.real), 95)} min`);
console.log(`           allowance needed to cover 99% of all pairs = ${pct(done.map((p) => p.stored - p.real), 99)} min\n`);

console.log('THE TEN WORST LOSSES (stored said too far, the road says within)\n');
console.log(['from', 'to', 'stored', 'real', 'loss', 'straight km', 'road km', 'pts'].map((s, i) => s.padEnd(i < 2 ? 10 : 12)).join(''));
for (const p of [...done].sort((a, b) => (b.stored - b.real) - (a.stored - a.real)).slice(0, 10)) {
  console.log([p.from.label, p.to.label, p.stored, p.real, p.stored - p.real, r1(p.straightKm), r1(p.realKm), `${p.from.points}/${p.to.points}`]
    .map((s, i) => String(s).padEnd(i < 2 ? 10 : 12)).join(''));
}
console.log('');

console.log('THE TEN WORST OVER-REACHES (matrix offered it, the road is further)\n');
console.log(['from', 'to', 'stored', 'real', 'over', 'straight km', 'road km', 'pts'].map((s, i) => s.padEnd(i < 2 ? 10 : 12)).join(''));
for (const p of [...done].sort((a, b) => (b.real - b.stored) - (a.real - a.stored)).slice(0, 10)) {
  console.log([p.from.label, p.to.label, p.stored, p.real, p.real - p.stored, r1(p.straightKm), r1(p.realKm), `${p.from.points}/${p.to.points}`]
    .map((s, i) => String(s).padEnd(i < 2 ? 10 : 12)).join(''));
}
console.log('');

// The detour factor we assume (1.25) against the one the road actually has.
const detours = done.filter((p) => p.realKm && p.straightKm > 0.5).map((p) => p.realKm / p.straightKm);
console.log(`DETOUR FACTOR — we assume 1.25. Measured: mean ${r1(mean(detours))}, p10 ${r1(pct(detours, 10))}, p50 ${r1(pct(detours, 50))}, p90 ${r1(pct(detours, 90))}, max ${r1(Math.max(...detours))}\n`);

// How much of the error is the centre being badly known?
const byPoints = [['postcodes in cell', 'n', 'mean err', 'worst loss']];
for (const [lo, hi, label] of [[1, 1, '1'], [2, 5, '2-5'], [6, 20, '6-20'], [21, 1e9, '21+']]) {
  const set = done.filter((p) => Math.min(p.from.points, p.to.points) >= lo && Math.min(p.from.points, p.to.points) <= hi);
  if (!set.length) continue;
  const err = set.map((p) => p.real - p.stored);
  const loss = set.map((p) => p.stored - p.real);
  byPoints.push([label, set.length, r1(mean(err)), Math.max(...loss)]);
}
table('ERROR BY HOW WELL THE CELL CENTRE IS KNOWN (the smaller of the two cells)', byPoints);

console.log(`STALE ROWS: ${stale.length} of ${done.length} stored values differ from a recompute of the same two centres now.\n`);

// ---------------------------------------------------------------------------
// What the time of day is worth: the same pairs, traffic-aware, as the app buys.
if (TRAFFIC_N > 0) {
  const sub = [...done].sort(() => rnd() - 0.5).slice(0, TRAFFIC_N);
  const subByOrigin = new Map();
  for (const p of sub) { if (!subByOrigin.has(p.from.code)) subByOrigin.set(p.from.code, []); subByOrigin.get(p.from.code).push(p); }
  for (const [, ps] of subByOrigin) {
    try {
      const meter = {};
      const rows = await routeMatrixMinutes({ origins: [ps[0].from], destinations: ps.map((p) => p.to), mode: 'driving', meter });
      requests += 1; elements += ps.length;
      ps.forEach((p, i) => { if (rows?.[0]?.[i]) p.traffic = rows[0][i].minutes; });
    } catch (e) { console.error(`  traffic: ${e.message}`); }
  }
  const withTraffic = sub.filter((p) => p.traffic != null);
  if (withTraffic.length) {
    const delta = withTraffic.map((p) => p.traffic - p.real);
    console.log(`TRAFFIC, at ${new Date().toISOString()} (${withTraffic.length} pairs re-routed traffic-aware)`);
    console.log(`  traffic - free-flow: mean ${r1(mean(delta))}, p50 ${pct(delta, 50)}, p90 ${pct(delta, 90)}, max ${Math.max(...delta)} min`);
    const lossTraffic = withTraffic.filter((p) => p.stored - p.traffic > 5).length;
    console.log(`  pairs lost at a 5-minute allowance against the traffic-aware time: ${lossTraffic} of ${withTraffic.length}\n`);
  }
}

// What it cost, recorded like any other call.
await providerCalls.record(null, 'google-routes', 'bench.reach.accuracy', { 'google-routes': elements });
console.log(`SPENT: ${requests} requests, ${elements} billed elements, recorded to provider_calls as bench.reach.accuracy.`);

await pool.end();
