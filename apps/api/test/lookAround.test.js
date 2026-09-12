import test from 'node:test';
import assert from 'node:assert/strict';
import { needsLookAround, lookAroundOutcome } from '../src/domain/lookAround.js';

test('a town the sweep has not reached gets the look-around', () => {
  assert.equal(needsLookAround([], 5), true);
  assert.equal(needsLookAround(null, 5), true);
});

test('swept places a long way off do not make the town look covered', () => {
  // Bath is swept and 18 km from Bristol; Bristol is still unswept.
  assert.equal(needsLookAround([{ km: 18.2 }, { km: 31 }], 5), true);
});

test('one swept place in the town is enough to trust the sweep', () => {
  assert.equal(needsLookAround([{ km: 18.2 }, { km: 1.4 }], 5), false);
});

test('the outcome says when a source refused, so the screen never claims there is nowhere', () => {
  assert.deepEqual(lookAroundOutcome({ ran: false }), { live: false, why: null, failed: false });
  assert.deepEqual(lookAroundOutcome({ ran: true, why: 'unswept', degraded: [] }), { live: true, why: 'unswept', failed: false });
  assert.deepEqual(lookAroundOutcome({ ran: true, why: 'unswept', degraded: [{ source: 'osm', slow: true }] }), { live: true, why: 'unswept', failed: false });
  assert.deepEqual(lookAroundOutcome({ ran: true, why: 'asked', degraded: [{ source: 'google', slow: false }] }), { live: true, why: 'asked', failed: true });
});
