/**
 * The fit, with the short end properly represented.
 *
 * The first fit was trained on pairs sampled by stored minutes, which gave it
 * almost nothing under five minutes — and the short end is what the corridor
 * width, the source radius and the owner's new five-minute default are all
 * worked out from. 187 short pairs (0.3-20km) are added to the training set and
 * 100 more to the holdout, and both are kept separate in the reporting so a
 * good long-range fit cannot hide a bad short-range one.
 */
import { readFileSync } from 'node:fs';
const J = (f) => JSON.parse(readFileSync(f, 'utf8'));
const trainLong = J('train.json'), trainShort = J('short-train.json');
const holdLong = J('holdout.json'), holdShort = J('short-hold.json');
const train = [...trainLong, ...trainShort];

const OLD = { kmh: 28, openKmh: 58, rampKm: 12, detourFactor: 1.25, overhead: 5 };
const DETOUR = 1.4;
const speedFor = (p, km) => p.kmh + (p.openKmh - p.kmh) * (km / (km + p.rampKm));
const predict = (p, km) => Math.round((km * p.detourFactor) / speedFor(p, km) * 60 + (p.overhead ?? p.fixedOverheadMinutes));
const s = (a) => [...a].sort((x, y) => x - y);
const pct = (a, p) => s(a)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const q = s(a); return q.length % 2 ? q[(q.length - 1) / 2] : (q[q.length / 2 - 1] + q[q.length / 2]) / 2; };
const r1 = (n) => Math.round(n * 10) / 10;

function fitOn(set) {
  const go = (g) => {
    let best = null;
    for (let kmh = g.kmh[0]; kmh <= g.kmh[1]; kmh += g.kmh[2])
      for (let open = g.open[0]; open <= g.open[1]; open += g.open[2])
        for (let ramp = g.ramp[0]; ramp <= g.ramp[1]; ramp += g.ramp[2]) {
          if (open <= kmh) continue;
          const base = set.map((p) => (p.straightKm * DETOUR) / speedFor({ kmh, openKmh: open, rampKm: ramp }, p.straightKm) * 60);
          const resid = set.map((p, i) => p.real - base[i]);
          const oh = Math.max(0, median(resid));
          const loss = mean(resid.map((r) => Math.abs(r - oh)));
          if (!best || loss < best.loss) best = { kmh, openKmh: open, rampKm: ramp, overhead: oh, loss };
        }
    return best;
  };
  let f = go({ kmh: [14, 46, 1], open: [50, 130, 2], ramp: [1, 40, 1] });
  f = go({ kmh: [Math.max(5, f.kmh - 2), f.kmh + 2, 0.25], open: [f.openKmh - 4, f.openKmh + 4, 0.5], ramp: [Math.max(0.5, f.rampKm - 3), f.rampKm + 3, 0.25] });
  return f;
}

const f = fitOn(train);
const NEW = { kmh: Math.round(f.kmh * 2) / 2, openKmh: Math.round(f.openKmh), rampKm: Math.round(f.rampKm * 2) / 2, detourFactor: DETOUR, overhead: Math.round(f.overhead) };
console.log('OLD  ', JSON.stringify(OLD));
console.log('FIT#1', JSON.stringify({ kmh: 37, openKmh: 103, rampKm: 35, detourFactor: 1.4, overhead: 4 }), ' (long pairs only)');
console.log('FIT#2', JSON.stringify(NEW), ` (${train.length} pairs, short end included)`);

const line = (name, profile, set) => {
  const err = set.map((p) => predict(profile, p.straightKm) - p.real);
  const lost = set.filter((_, i) => err[i] > 5).length;
  console.log(`  ${name.padEnd(26)} n=${String(set.length).padEnd(5)} |err| mean ${String(r1(mean(err.map(Math.abs)))).padEnd(5)} median ${String(r1(median(err.map(Math.abs)))).padEnd(4)} overstated ${String(r1(100 * err.filter((e) => e > 0).length / set.length) + '%').padEnd(7)} lost@5 ${String(r1(100 * lost / set.length) + '%').padEnd(7)} allowance p95 ${pct(err, 95)}`);
};

for (const [label, profile] of [['OLD', OLD], ['FIT#1', { kmh: 37, openKmh: 103, rampKm: 35, detourFactor: 1.4, overhead: 4 }], ['FIT#2', NEW]]) {
  console.log(`\n${label}`);
  line('holdout, long pairs', profile, holdLong);
  line('holdout, short pairs', profile, holdShort);
  line('holdout, both', profile, [...holdLong, ...holdShort]);
}

// The three knock-ons, worked out from each profile rather than argued about.
console.log('\nWHAT EACH PROFILE DOES TO THE THINGS THAT DEPEND ON IT');
const kmBetween = (a, b) => { const R = 6371, t = (d) => d * Math.PI / 180; const dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng); const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const HOME = { lat: 51.4012, lng: -0.6731 }, CP = { lat: 51.4226, lng: -0.0756 }, THORPE = { lat: 51.404722, lng: -0.513056 }, CHOBHAM = { lat: 51.3733, lng: -0.5867 };
const est = (p, a, b) => predict(p, kmBetween(a, b));
const reachRadiusKm = (p, minutes) => Math.max(0.5, ((minutes - (p.overhead)) / 60) * p.kmh / p.detourFactor);
const offLine = (o, d, v) => { const kx = Math.cos(o.lat * Math.PI / 180); const ax = (d.lng - o.lng) * kx, ay = d.lat - o.lat; const t = Math.max(0, Math.min(1, (ax * (v.lng - o.lng) * kx + ay * (v.lat - o.lat)) / (ax * ax + ay * ay))); return kmBetween({ lat: o.lat + (d.lat - o.lat) * t, lng: o.lng + (d.lng - o.lng) * t }, v); };
console.log(['profile', 'reach15km', 'corridor', 'Chobham in?', 'midway detour', 'hour reaches'].map((x) => x.padEnd(15)).join(''));
for (const [label, p] of [['OLD', OLD], ['FIT#1', { kmh: 37, openKmh: 103, rampKm: 35, detourFactor: 1.4, overhead: 4 }], ['FIT#2', NEW]]) {
  const reach = reachRadiusKm(p, 15);
  const journeyKm = kmBetween(HOME, THORPE);
  const corridor = Math.min(8, Math.max(1, reach / 2, journeyKm * 0.12));
  const chob = offLine(HOME, THORPE, CHOBHAM) < corridor;
  let worst = 0;
  for (let fr = 0.05; fr < 1; fr += 0.05) {
    const v = { lat: HOME.lat + (CP.lat - HOME.lat) * fr, lng: HOME.lng + (CP.lng - HOME.lng) * fr };
    worst = Math.max(worst, est(p, HOME, v) + est(p, v, CP) - est(p, HOME, CP) - p.overhead);
  }
  let hour = 0; for (let km = 1; km < 120; km += 0.5) if (predict(p, km) <= 60) hour = km;
  console.log([label, r1(reach), r1(corridor), chob ? 'IN (bad)' : 'out (good)', worst, r1(hour) + ' km'].map((x) => String(x).padEnd(15)).join(''));
}
