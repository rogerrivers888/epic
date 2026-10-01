/**
 * Epic's fee by the SX14 rules (Settings revised v2). Every branch, because a
 * fee that is wrong is wrong quietly — it reads like a number either way.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { feeForBooking, feesForPeriod, introState, LEVEL_RATE, MIN_FEE_PENCE } from '../src/domain/hostFees.js';

test('the base rate follows the level', () => {
  assert.equal(feeForBooking({ amountPence: 10000, level: 'verified' }).rate, 20);
  assert.equal(feeForBooking({ amountPence: 10000, level: 'checked' }).rate, 15);
  assert.equal(feeForBooking({ amountPence: 10000, level: 'trusted' }).rate, 10);
  assert.equal(feeForBooking({ amountPence: 10000, level: 'checked' }).feePence, 1500);
  assert.equal(feeForBooking({ amountPence: 10000, level: 'checked' }).label, "Epic's fee 15% · Checked");
});

test('a host inside the intro pays nothing, and the reason counts down the bookings', () => {
  const intro = introState({ hostStartedAt: new Date(), bookingsSoFar: 3 });
  assert.equal(intro.active, true);
  const line = feeForBooking({ amountPence: 10000, level: 'verified', intro });
  assert.equal(line.rate, 0);
  assert.equal(line.feePence, 0);
  assert.equal(line.label, "Epic's fee 0% · intro, 7 bookings left");
});

test('intro ends at ninety days OR ten bookings, whichever is first', () => {
  const old = new Date(Date.now() - 100 * 86_400_000);
  assert.equal(introState({ hostStartedAt: old, bookingsSoFar: 2 }).active, false, 'past 90 days');
  assert.equal(introState({ hostStartedAt: new Date(), bookingsSoFar: 10 }).active, false, 'hit 10 bookings');
  assert.equal(introState({ hostStartedAt: new Date(), bookingsSoFar: 9 }).active, true);
});

test('a host-link booking is 5% at any level, but intro still wins', () => {
  assert.equal(feeForBooking({ amountPence: 10000, level: 'verified', viaHostLink: true }).rate, 5);
  assert.equal(feeForBooking({ amountPence: 10000, level: 'verified', viaHostLink: true }).label, "Epic's fee 5% · your link");
  const intro = introState({ hostStartedAt: new Date(), bookingsSoFar: 0 });
  assert.equal(feeForBooking({ amountPence: 10000, level: 'verified', viaHostLink: true, intro }).rate, 0, 'intro beats the link');
});

test('the £1.50 minimum applies to a small non-intro booking, never to an intro one, never above the booking', () => {
  // 5% of £10 = 50p, below the £1.50 floor.
  const small = feeForBooking({ amountPence: 1000, level: 'verified', viaHostLink: true });
  assert.equal(small.feePence, MIN_FEE_PENCE);
  // An intro booking never gets the floor.
  const intro = introState({ hostStartedAt: new Date(), bookingsSoFar: 0 });
  assert.equal(feeForBooking({ amountPence: 1000, intro }).feePence, 0);
  // The fee never exceeds the booking.
  assert.equal(feeForBooking({ amountPence: 100, level: 'verified' }).feePence, 100);
});

test('a period mixes rates into one line each, with totals (SX18/SX20)', () => {
  const intro = introState({ hostStartedAt: new Date(), bookingsSoFar: 0 });
  const { lines, grossPence, feePence, netPence } = feesForPeriod([
    { amountPence: 10000, level: 'checked' },                 // 15% = 1500
    { amountPence: 10000, level: 'checked', viaHostLink: true }, // 5% = 500
    { amountPence: 10000, level: 'checked', intro },           // 0% = 0
  ]);
  assert.equal(grossPence, 30000);
  assert.equal(feePence, 2000);
  assert.equal(netPence, 28000);
  assert.deepEqual(lines.map((l) => l.rate), [0, 5, 15]);
  assert.equal(lines.find((l) => l.rate === 15).feePence, 1500);
});
