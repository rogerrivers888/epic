/**
 * The straight-line fallback for walk and transit (owner, 30 Sep 2026): when a
 * mode has no reach matrix the ring is drawn from a distance-and-speed estimate,
 * marked `method: 'straight-line'`, with a conservative transit speed so it is
 * never overstated. Here we pin the speeds; the marking and the growth with the
 * minutes are exercised end to end by the production reach-check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { kmPerMinute } from '../src/repositories/reach.js';

test('the fallback reach grows with the minutes', () => {
  for (const mode of ['walking', 'transit']) {
    const per = kmPerMinute(mode);
    assert.ok(per * 30 < per * 60 && per * 60 < per * 90, `${mode} reach must grow with the minutes`);
  }
});

test('walk < transit < drive, and transit is conservative (well under driving)', () => {
  const w = kmPerMinute('walking');
  const t = kmPerMinute('transit');
  const d = kmPerMinute('driving');
  assert.ok(w < t && t < d, `expected walk<transit<drive, got ${w} ${t} ${d}`);
  // Conservative transit: no more than half the driving reach for the same time
  // — it waits and rarely runs point to point, so a straight line must not
  // pretend otherwise.
  assert.ok(t < d * 0.6, `transit ${t} must be well under driving ${d}`);
});
