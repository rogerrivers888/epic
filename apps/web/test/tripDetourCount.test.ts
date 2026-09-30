import test from 'node:test';
import assert from 'node:assert/strict';
import { bandCount } from '../src/screens/tripIdeas.ts';

/**
 * The trip's detour count must rise as the band widens (owner, 30 Sep 2026:
 * "switching 10 / 15 / 30 minutes … leaves the number exactly the same"). The
 * filter is client-side over a pool fetched at the widest band, so a pool
 * spread across the minutes must count more at 15 than 10 and more again at 30.
 * The per-place detour minutes are the travel maths's job (see the API's
 * timeReach test); here we pin that the band filter itself is monotonic.
 */
const pool = [4, 8, 9, 12, 14, 18, 22, 26, 29].map((m, i) => ({ venueRef: `v${i}`, detourMinutes: m })) as any[];

test('the trip count rises as the detour widens 10 → 15 → 30', () => {
  const c10 = bandCount(pool, 10);
  const c15 = bandCount(pool, 15);
  const c30 = bandCount(pool, 30);
  assert.ok(c10 < c15 && c15 < c30, `expected 10<15<30, got ${c10} ${c15} ${c30}`);
});

test('a place with no detour minutes is never counted (no page-length inflation)', () => {
  const withNulls = [...pool, { venueRef: 'x', detourMinutes: null }, { venueRef: 'y', detourMinutes: undefined }] as any[];
  assert.equal(bandCount(withNulls, 30), bandCount(pool, 30));
});
