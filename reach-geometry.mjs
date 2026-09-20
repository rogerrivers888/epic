/**
 * The other half of the allowance: how far a place sits from its sector's centre.
 *
 * The holdout residual measures the estimator, centre to centre. EDGE_MINUTES
 * has to cover that *and* the fact that the place itself is not at the centre.
 * This is the second term, and it costs nothing to measure.
 */
import { query, pool } from './apps/api/src/db.js';
import { kmBetween } from './apps/api/src/domain/travel.js';

const NEW = { kmh: 37, openKmh: 103, rampKm: 35, detourFactor: 1.4, overhead: 4 };
const speedFor = (p, km) => p.kmh + (p.openKmh - p.kmh) * (km / (km + p.rampKm));
// No overhead: this is an offset within a journey already under way, not a
// second journey with its own getting-going time.
const offsetMinutes = (km) => (km * NEW.detourFactor) / speedFor(NEW, km) * 60;

const { rows } = await query(
  `select p.venue_ref, p.lat as plat, p.lng as plng, g.lat as clat, g.lng as clng, g.points, g.label
     from place_cells p join geo_cells g on g.code = p.cell
    where p.lat is not null and p.cell is not null`);

const km = rows.map((r) => kmBetween({ lat: Number(r.plat), lng: Number(r.plng) }, { lat: Number(r.clat), lng: Number(r.clng) }));
const minutes = km.map(offsetMinutes);
const s = (a) => [...a].sort((x, y) => x - y);
const pct = (a, p) => s(a)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const r1 = (n) => Math.round(n * 10) / 10;

console.log(`places stamped with a point and a cell: ${rows.length}`);
console.log(`distance from the place to its cell centre, km : p50 ${r1(pct(km, 50))}  p90 ${r1(pct(km, 90))}  p95 ${r1(pct(km, 95))}  p99 ${r1(pct(km, 99))}  max ${r1(Math.max(...km))}`);
console.log(`the same, in minutes at the new profile        : p50 ${r1(pct(minutes, 50))}  p90 ${r1(pct(minutes, 90))}  p95 ${r1(pct(minutes, 95))}  p99 ${r1(pct(minutes, 99))}  max ${r1(Math.max(...minutes))}`);

// A cell whose centre is one postcode is the one most likely to be wrong.
for (const [lo, hi, label] of [[1, 1, 'centre from 1 postcode'], [2, 5, '2-5'], [6, 1e9, '6+']]) {
  const set = rows.map((r, i) => ({ n: Number(r.points), m: minutes[i] })).filter((x) => x.n >= lo && x.n <= hi);
  if (!set.length) continue;
  const ms = set.map((x) => x.m);
  console.log(`  ${label.padEnd(24)} n=${String(set.length).padEnd(7)} p95 ${r1(pct(ms, 95))} min   max ${r1(Math.max(...ms))} min`);
}
import { writeFileSync } from 'node:fs';
writeFileSync('/app/offsets.json', JSON.stringify(minutes.map((m) => Math.round(m * 100) / 100)));
console.log('wrote /app/offsets.json');
await pool.end();
