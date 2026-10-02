/**
 * The host's Upcoming rows (hostTabKit.offerDateGroups): a live offer's dates
 * still to come are rows even before anybody books (Codex, 2 Oct 2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerDateGroups } from '../src/screens/host/hostDates.ts';

const ahead = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

test('a live one-off with no bookings still has its date as a row', () => {
  const groups = offerDateGroups({ shape: 'oneoff', state: 'live', startsOn: ahead(10), bookings: [] } as any);
  assert.deepEqual(groups.map((g) => [g.on, g.bookings]), [[ahead(10), 0]]);
});

test('a series lists every session to come; a booking folds into its own date', () => {
  const dates = [ahead(-7), ahead(7), ahead(14)];
  const groups = offerDateGroups({
    shape: 'series', state: 'live', firstDate: dates[0], dates,
    bookings: [{ state: 'confirmed', occurrence: dates[1], heads: 2, amountPence: 1000, paymentStatus: 'recorded' }],
  } as any);
  assert.deepEqual(groups.map((g) => [g.on, g.heads]), [[dates[1], 2], [dates[2], 0]], 'the past unbooked session is not a row; the future ones are');
});

test('a draft has no rows until it is live', () => {
  assert.deepEqual(offerDateGroups({ shape: 'oneoff', state: 'draft', startsOn: ahead(3), bookings: [] } as any), []);
});
