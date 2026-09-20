/**
 * Fit the driving speed curve to real road times, and test it on pairs it has
 * never seen.
 *
 * The model's shape is unchanged (domain/travel.js): a speed that climbs
 * smoothly with the distance, a detour factor, a fixed overhead. Only the four
 * driving numbers are refitted, and the detour factor is pinned to the measured
 * 1.4 (owner, 20 Sep 2026) rather than fitted, so it stays a measured quantity.
 *
 * Loss is absolute error, not squared: the sea-loch pairs are real observations
 * of a fault this model cannot fix, and they must not be allowed to drag the
 * curve for everybody else.
 */
import { readFileSync } from 'node:fs';

const train = JSON.parse(readFileSync('train.json', 'utf8'));
const hold = JSON.parse(readFileSync('holdout.json', 'utf8'));

const OLD = { kmh: 28, openKmh: 58, rampKm: 12, detourFactor: 1.25, overhead: 5 };
const DETOUR = 1.4;

const speedFor = (p, km) => p.kmh + (p.openKmh - p.kmh) * (km / (km + p.rampKm));
const predict = (p, straightKm) => Math.round((straightKm * p.detourFactor) / speedFor(p, straightKm) * 60 + p.overhead);

const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => { const s = sorted(a); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pct = (a, p) => { const s = sorted(a); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const r1 = (n) => Math.round(n * 10) / 10;

// The overhead that minimises absolute error, for a given curve, is the median
// of what the curve leaves behind — so it is solved rather than searched.
function bestOverhead(kmh, openKmh, rampKm, set) {
  const base = set.map((p) => (p.straightKm * DETOUR) / speedFor({ kmh, openKmh, rampKm }, p.straightKm) * 60);
  const resid = set.map((p, i) => p.real - base[i]);
  const oh = Math.max(0, median(resid));
  return { oh, loss: mean(resid.map((r) => Math.abs(r - oh))) };
}

function search(set, grid) {
  let best = null;
  for (let kmh = grid.kmh[0]; kmh <= grid.kmh[1]; kmh += grid.kmh[2])
    for (let openKmh = grid.open[0]; openKmh <= grid.open[1]; openKmh += grid.open[2])
      for (let rampKm = grid.ramp[0]; rampKm <= grid.ramp[1]; rampKm += grid.ramp[2]) {
        if (openKmh <= kmh) continue;
        const { oh, loss } = bestOverhead(kmh, openKmh, rampKm, set);
        if (!best || loss < best.loss) best = { kmh, openKmh, rampKm, overhead: oh, loss };
      }
  return best;
}

let fit = search(train, { kmh: [14, 46, 1], open: [50, 130, 2], ramp: [1, 40, 1] });
fit = search(train, {
  kmh: [Math.max(5, fit.kmh - 2), fit.kmh + 2, 0.25],
  open: [fit.openKmh - 4, fit.openKmh + 4, 0.5],
  ramp: [Math.max(0.5, fit.rampKm - 3), fit.rampKm + 3, 0.25],
});

// Rounded to numbers a person can read and argue with, then re-checked: a
// profile nobody can say out loud is a profile nobody will maintain.
const NEW = {
  kmh: Math.round(fit.kmh * 2) / 2,
  openKmh: Math.round(fit.openKmh),
  rampKm: Math.round(fit.rampKm * 2) / 2,
  detourFactor: DETOUR,
  overhead: Math.round(fit.overhead),
};

const report = (title, profile, set) => {
  const err = set.map((p) => predict(profile, p.straightKm) - p.real); // + = we say longer than the road
  const loss = err;             // stored - real
  const lost5 = set.filter((p, i) => loss[i] > 5).length;
  console.log(`\n${title}  (n=${set.length})`);
  console.log(`  real - stored : mean ${r1(mean(err.map((e) => -e)))}  p10 ${-pct(err, 90)}  p50 ${-pct(err, 50)}  p90 ${-pct(err, 10)}`);
  console.log(`  |error|       : mean ${r1(mean(err.map(Math.abs)))}  median ${r1(median(err.map(Math.abs)))}  p95 ${pct(err.map(Math.abs), 95)}`);
  console.log(`  overstated    : ${set.filter((p, i) => err[i] > 0).length} of ${set.length} (${r1(100 * set.filter((p, i) => err[i] > 0).length / set.length)}%)`);
  console.log(`  lost at 5 min : ${lost5} (${r1(100 * lost5 / set.length)}%)`);
  console.log(`  ALLOWANCE needed: p90 ${pct(loss, 90)}  p95 ${pct(loss, 95)}  p99 ${pct(loss, 99)}  max ${Math.max(...loss)}`);
  return { err, loss };
};

console.log('='.repeat(72));
console.log('OLD PROFILE', JSON.stringify(OLD));
console.log('NEW PROFILE', JSON.stringify(NEW), `   (fitted on ${train.length} training pairs)`);
console.log('='.repeat(72));

report('TRAINING — old', OLD, train);
report('TRAINING — new  [the fit]', NEW, train);
report('HOLDOUT  — old', OLD, hold);
const h = report('HOLDOUT  — new  [the number that counts]', NEW, hold);

console.log('\nHOLDOUT by stored band, new profile');
console.log(['band', 'n', 'mean err', '|err| p95', 'lost@5', 'p95 allow'].map((s) => s.padEnd(11)).join(''));
for (const b of ['0-5', '5-15', '15-30', '30-45', '45-60', '60-95']) {
  const set = hold.filter((p) => p.band === b);
  if (!set.length) continue;
  const err = set.map((p) => predict(NEW, p.straightKm) - p.real);
  console.log([b, set.length, r1(mean(err.map((e) => -e))), pct(err.map(Math.abs), 95),
    set.filter((_, i) => err[i] > 5).length, pct(err, 95)].map((s) => String(s).padEnd(11)).join(''));
}

// The pairs the curve cannot fix: a straight line that crosses water.
console.log('\nHOLDOUT — the ten worst, new profile (a straight line that is not a road)');
console.log(['from', 'to', 'pred', 'real', 'err', 'straight', 'road', 'ratio'].map((s) => s.padEnd(10)).join(''));
for (const p of [...hold].map((p) => ({ ...p, e: predict(NEW, p.straightKm) - p.real }))
  .sort((a, b) => Math.abs(b.e) - Math.abs(a.e)).slice(0, 10)) {
  console.log([p.from.label, p.to.label, predict(NEW, p.straightKm), p.real, p.e, r1(p.straightKm), r1(p.realKm), r1(p.realKm / p.straightKm)]
    .map((s) => String(s).padEnd(10)).join(''));
}

// How much of the tail is water. A road/straight ratio far above the norm is
// the signature, and it is the fault the curve is not allowed to chase.
const ratios = hold.filter((p) => p.realKm && p.straightKm > 1).map((p) => p.realKm / p.straightKm);
console.log(`\nroad / straight on the holdout: p50 ${r1(pct(ratios, 50))}  p90 ${r1(pct(ratios, 90))}  p99 ${r1(pct(ratios, 99))}  max ${r1(Math.max(...ratios))}`);
const normal = hold.filter((p) => p.realKm && p.straightKm > 1 && p.realKm / p.straightKm <= 1.8);
const nerr = normal.map((p) => predict(NEW, p.straightKm) - p.real);
console.log(`excluding the ${hold.length - normal.length} pairs whose road is >1.8x the straight line:`);
console.log(`  |error| mean ${r1(mean(nerr.map(Math.abs)))}  p95 ${pct(nerr.map(Math.abs), 95)}  ALLOWANCE p95 ${pct(nerr, 95)}  max ${Math.max(...nerr)}`);
