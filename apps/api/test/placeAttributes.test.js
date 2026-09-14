// Attributes: what a place is like, read narrowest first.
//
// The owner, 14 Sep 2026: "there's a very big difference between what a
// 5-year-old can do and what a 12-year-old can do."

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolveFor } = await import('../src/repositories/placeAttributes.js');

const VOCAB = {
  list: [
    { key: 'indoor', kind: 'yesno', active: true },
    { key: 'suits-ages', kind: 'range', active: true },
    { key: 'step-free', kind: 'yesno', active: false },
  ],
  bySubcategory: new Map([
    ['play', new Map([['indoor', { yesno: true }], ['suits-ages', { from: 1, to: 7 }]])],
  ]),
};

test('a place inherits its drawer, and says so', () => {
  const got = resolveFor({ subcategory: 'play' }, new Map(), VOCAB);
  assert.deepEqual(got['suits-ages'], { from: 1, to: 7, setAt: 'subcategory' });
  assert.deepEqual(got.indoor, { yesno: true, setAt: 'subcategory' });
});

test('what the place says beats what the drawer says, and the range survives', () => {
  // The bug this pins: the provenance field was called `from`, which is also a
  // range's lower bound, so setting one silently ate the other.
  const own = new Map([['suits-ages', { from: 11, to: 99, reason: 'Height limits on the big rides.' }]]);
  const got = resolveFor({ subcategory: 'play' }, own, VOCAB);
  assert.equal(got['suits-ages'].from, 11);
  assert.equal(got['suits-ages'].to, 99);
  assert.equal(got['suits-ages'].setAt, 'place');
  assert.equal(got['suits-ages'].reason, 'Height limits on the big rides.');
  // The one it did not override still comes from the drawer.
  assert.equal(got.indoor.setAt, 'subcategory');
});

test('nothing said is not the same as no, and a retired attribute is not asked', () => {
  const got = resolveFor({ subcategory: 'castles' }, new Map(), VOCAB);
  assert.deepEqual(got, {});
  const withStepFree = resolveFor({ subcategory: 'play' }, new Map([['step-free', { yesno: true }]]), VOCAB);
  assert.equal(withStepFree['step-free'], undefined);
});

test('a place in no drawer at all still carries what it was told', () => {
  const own = new Map([['indoor', { yesno: false }]]);
  assert.deepEqual(resolveFor({ subcategory: null }, own, VOCAB).indoor, { yesno: false, setAt: 'place' });
});
