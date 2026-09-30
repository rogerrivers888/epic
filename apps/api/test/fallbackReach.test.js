/**
 * The straight-line fallback for walk and transit (owner, 30 Sep 2026): when a
 * mode has no reach matrix the ring is drawn from a distance-and-speed estimate,
 * marked `method: 'straight-line'`, with a conservative transit speed so it is
 * never overstated. One estimator (`straightLineReachKm`) draws both the count
 * ring and the display fence, so they describe the same reach. Here we pin the
 * estimator; the marking and the growth are exercised end to end by the
 * production reach-check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { straightLineReachKm } from '../src/domain/travel.js';

test('the straight-line reach grows with the minutes', () => {
  for (const mode of ['walking', 'transit', 'cycling']) {
    const a = straightLineReachKm(mode, 30);
    const b = straightLineReachKm(mode, 60);
    const c = straightLineReachKm(mode, 90);
    assert.ok(a < b && b < c, `${mode} reach must grow with the minutes (${a} ${b} ${c})`);
  }
});

test('walk < transit < drive, and transit is conservative (well under driving)', () => {
  const w = straightLineReachKm('walking', 30);
  const t = straightLineReachKm('transit', 30);
  const d = straightLineReachKm('driving', 30);
  assert.ok(w < t && t < d, `expected walk<transit<drive, got ${w} ${t} ${d}`);
  // Conservative transit: well under half the driving reach for the same time —
  // it waits and rarely runs point to point, so a straight line must not pretend.
  assert.ok(t < d * 0.6, `transit ${t} must be well under driving ${d}`);
});

test('drive and walk spellings normalise before the reach is computed', () => {
  assert.equal(straightLineReachKm('walk', 30), straightLineReachKm('walking', 30));
  assert.equal(straightLineReachKm('drive', 30), straightLineReachKm('driving', 30));
});
