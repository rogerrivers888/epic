import test from 'node:test';
import assert from 'node:assert/strict';
import { browseOf, mergeBrowse } from '../src/domain/browse.js';

test('a household that has never said anything wants nothing in particular', () => {
  assert.deepEqual(browseOf({}), { food: {}, things: {} });
  assert.deepEqual(browseOf(null), { food: {}, things: {} });
});

test('"I just want to find restaurants" is remembered, and Italian with it', () => {
  const h = { browse_defaults: { food: { type: 'restaurant', cuisine: 'italian' } } };
  assert.deepEqual(browseOf(h).food, { type: 'restaurant', cuisine: 'italian' });
});

test('a patch merges rather than replaces, so setting a cuisine keeps the type', () => {
  const h = { browse_defaults: { food: { type: 'restaurant' } } };
  assert.deepEqual(mergeBrowse(h, { food: { cuisine: 'italian' } }).food, { type: 'restaurant', cuisine: 'italian' });
});

test('clearing one is sayable, and does not clear the other', () => {
  const h = { browse_defaults: { food: { type: 'restaurant', cuisine: 'italian' } } };
  assert.deepEqual(mergeBrowse(h, { food: { cuisine: null } }).food, { type: 'restaurant' });
  assert.deepEqual(mergeBrowse(h, { food: { cuisine: '' } }).food, { type: 'restaurant' });
});

test('a kind nobody mentioned is left exactly as it was', () => {
  const h = { browse_defaults: { food: { type: 'restaurant' }, things: { type: 'walk' } } };
  assert.deepEqual(mergeBrowse(h, { food: { type: 'pub' } }), { food: { type: 'pub' }, things: { type: 'walk' } });
});

test('nonsense is not stored', () => {
  assert.deepEqual(browseOf({ browse_defaults: { food: { type: '   ' }, things: { type: 'x'.repeat(50) } } }), { food: {}, things: {} });
  assert.deepEqual(browseOf({ browse_defaults: { food: { colour: 'blue' } } }).food, {});
  assert.deepEqual(mergeBrowse({}, 'not an object'), { food: {}, things: {} });
});

test('a value is stored in the words the filter tests against — lower case, trimmed', () => {
  assert.deepEqual(mergeBrowse({}, { food: { cuisine: '  Italian ' } }).food, { cuisine: 'italian' });
});
