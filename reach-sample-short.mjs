/**
 * Collect driving pairs and their real road time, and keep them.
 *
 * Owner, 20 Sep 2026: "Do not re-measure on the same 286. Draw a fresh random
 * sample of similar size and report both numbers: the fit on the training set
 * and the error on the holdout."
 *
 * So the sample is collected once and written down, and the fitting is done
 * offline against the file. Routed free-flow, because the estimator has no
 * traffic model and a traffic-aware time would flatter the loss tail.
 *
 * Usage: node reach-sample.mjs <origins> <seed> <out.json> [excludeFile]
 */
import { query, pool } from './apps/api/src/db.js';
import { kmBetween, estimateTravelMinutes } from './apps/api/src/domain/travel.js';
import * as providerCalls from './apps/api/src/repositories/providerCalls.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const ORIGINS = Number(process.argv[2] || 60);
const SEED = Number(process.argv[3] || 20260920);
const OUT = process.argv[4] || '/app/sample.json';
const EXCLUDE = process.argv[5] && existsSync(process.argv[5])
  ? new Set(JSON.parse(readFileSync(process.argv[5], 'utf8')).map((p) => p.from.code)) : new Set();

const BANDS = [[0.3, 2], [2, 5], [5, 10], [10, 20]]; // straight-line km, the short end
const KEY = process.env.GOOGLE_MAPS_API_KEY?.trim();
if (!KEY) { console.error('No GOOGLE_MAPS_API_KEY here.'); process.exit(1); }

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const wp = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
const mins = (d) => Math.round(Number(String(d || '0s').replace('s', '')) / 60);

let requests = 0; let elements = 0;
async function freeFlow(origin, dests) {
  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition' },
    body: JSON.stringify({ origins: [wp(origin)], destinations: dests.map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
    signal: AbortSignal.timeout(25_000),
  });
  requests += 1; elements += dests.length;
  if (!res.ok) throw new Error(`Routes ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const rows = await res.json();
  const out = new Array(dests.length).fill(null);
  for (const r of rows) if (r.condition === 'ROUTE_EXISTS') out[r.destinationIndex ?? 0] = { minutes: mins(r.duration), meters: r.distanceMeters ?? null };
  return out;
}

const cells = (await query(
  `select code, label, lat, lng, points, places from geo_cells
    where scheme = 'sector' and country_code = 'GB' order by code`)).rows;
console.error(`cells: ${cells.length}, excluded origins: ${EXCLUDE.size}`);
const byCode = new Map(cells.map((c) => [c.code, c]));
const poolCells = cells.filter((c) => Number(c.places) > 0);

const chosen = []; const seen = new Set();
let guard = 0;
while (chosen.length < ORIGINS && guard < ORIGINS * 500) {
  guard += 1;
  const c = pick(poolCells);
  if (seen.has(c.code) || EXCLUDE.has(c.code)) continue;
  seen.add(c.code); chosen.push(c);
}

const pairs = [];
for (const origin of chosen) {
  const { rows } = await query(
    `select to_cell, minutes, km from reach where from_cell = $1 and mode = 'driving' and to_cell <> $1`, [origin.code]);
  for (const [lo, hi] of BANDS) {
    const inBand = rows.filter((r) => { const t = byCode.get(r.to_cell); if (!t) return false; const k = kmBetween(origin, t); return k > lo && k <= hi; });
    if (!inBand.length) continue;
    const r = pick(inBand);
    const to = byCode.get(r.to_cell);
    if (!to) continue;
    pairs.push({
      from: { code: origin.code, label: origin.label, lat: Number(origin.lat), lng: Number(origin.lng), points: Number(origin.points) },
      to: { code: to.code, label: to.label, lat: Number(to.lat), lng: Number(to.lng), points: Number(to.points) },
      band: `${lo}-${hi}`, stored: Number(r.minutes), storedKm: Number(r.km),
      straightKm: kmBetween(origin, to),
      liveEstimate: estimateTravelMinutes(origin, to, 'driving'),
    });
  }
}
console.error(`origins: ${chosen.length}, pairs: ${pairs.length}`);

const byOrigin = new Map();
for (const p of pairs) { if (!byOrigin.has(p.from.code)) byOrigin.set(p.from.code, []); byOrigin.get(p.from.code).push(p); }
for (const [code, ps] of byOrigin) {
  try {
    const got = await freeFlow(ps[0].from, ps.map((p) => p.to));
    ps.forEach((p, i) => { if (got[i]) { p.real = got[i].minutes; p.realKm = got[i].meters == null ? null : got[i].meters / 1000; } else p.real = null; });
  } catch (e) { console.error(`  ${code}: ${e.message}`); ps.forEach((p) => { p.real = null; }); }
}

const done = pairs.filter((p) => p.real != null);
writeFileSync(OUT, JSON.stringify(done));
await providerCalls.record(null, 'google-routes', 'bench.reach.accuracy', { 'google-routes': elements });
console.error(`routed ${done.length} of ${pairs.length}; ${requests} requests, ${elements} elements → ${OUT}`);
await pool.end();
