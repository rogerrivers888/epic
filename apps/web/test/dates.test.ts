/**
 * Picking the dates of a trip (owner, 7 Sep 2026).
 *
 * The rules are short and they are the ones every date-range picker has, but
 * getting them wrong made a set of dates impossible to correct: "If I select
 * the 15th, it goes from the 7th to the 15th. If I touch 15 and then touch 30,
 * it still goes from the 7th to the 30th."
 *
 * The picker itself is a React component, so what is under test here is the
 * decision it makes — lifted out whole, and imported by the component, so the
 * two cannot drift apart.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRange, nightsBetween } from '../src/components/dateRange.ts';

const on = (d: number) => `2026-09-${String(d).padStart(2, '0')}`;

test('nothing is chosen until somebody chooses it', () => {
  assert.deepEqual(nextRange({ start: null, end: null }, on(15)), { start: on(15), end: null });
});

test('a second, later date closes the range', () => {
  assert.deepEqual(nextRange({ start: on(15), end: null }, on(19)), { start: on(15), end: on(19) });
});

test('an earlier second date starts again from there, rather than running backwards', () => {
  assert.deepEqual(nextRange({ start: on(15), end: null }, on(9)), { start: on(9), end: null });
});

test('tapping the one chosen date clears it', () => {
  assert.deepEqual(nextRange({ start: on(15), end: null }, on(15)), { start: null, end: null });
});

/**
 * The one the owner asked for by name. With the 7th to the 15th already set,
 * tapping the 15th makes it the *start*, and the 30th then closes the range —
 * so "click on 15 twice" gives the 15th to the 30th.
 */
test('a finished range plus a tap starts again from that date', () => {
  const had = { start: on(7), end: on(15) };
  // The old behaviour: tapping the 30th extended from the 7th. Not any more.
  assert.deepEqual(nextRange(had, on(30)), { start: on(30), end: null });

  // And the sequence he described, in full.
  let range: { start: string | null; end: string | null } = { start: on(7), end: null };
  range = nextRange(range, on(15));               // 7 → 15
  assert.deepEqual(range, { start: on(7), end: on(15) });
  range = nextRange(range, on(15));               // the second tap on the 15th
  assert.deepEqual(range, { start: on(15), end: null });
  range = nextRange(range, on(30));               // and the finish date
  assert.deepEqual(range, { start: on(15), end: on(30) });
  assert.equal(nightsBetween(range.start!, range.end!), 15);
});

test('tapping the start of a finished range collapses it to that one day', () => {
  assert.deepEqual(nextRange({ start: on(15), end: on(19) }, on(15)), { start: on(15), end: null });
});
