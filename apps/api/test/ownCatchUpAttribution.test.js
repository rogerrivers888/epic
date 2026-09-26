/**
 * The catch-up loop researches on somebody's account, or not at all.
 *
 * Owner, 26 Sep 2026: "It spends with no household attached, against a
 * ceiling nobody can attribute and a cap that cannot refuse it — which is
 * exactly the hole the cap was built to close. Then attribute it properly and
 * turn it back on. Do not leave it running unattributed."
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeCatchUp } from '../src/sources/own.js';

test('a claimed place is researched on its claimant\'s account, an unclaimed one on the founding household\'s', () => {
  const { queue, skipped } = attributeCatchUp(
    ['google:a', 'google:b', 'google:c'],
    { 'google:a': 'hh-1', 'google:b': 'hh-2' },
    'hh-founding');
  assert.deepEqual(queue, [['google:a', 'hh-1'], ['google:b', 'hh-2'], ['google:c', 'hh-founding']]);
  assert.deepEqual(skipped, []);
});

test('with nobody to attribute it to, a place is left unresearched rather than researched on no account', () => {
  const { queue, skipped } = attributeCatchUp(['google:a', 'google:b'], { 'google:a': 'hh-1' }, null);
  assert.deepEqual(queue, [['google:a', 'hh-1']], 'the claimed one still goes');
  assert.deepEqual(skipped, ['google:b'], 'the unclaimed one waits for a household to exist');
});
