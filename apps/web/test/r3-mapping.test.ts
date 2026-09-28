/**
 * Round 3 (29 Sep 2026), agent MAPPING: the Food & drink · Things to do toggle
 * shared by Categories, Facts, Mapping and Collections, and the addresses of
 * the gap report and a picker opened to a fact's values.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SIDE_KEY, SIDE_TABS, asSide, onSide, sideOfCategory, sideParam } from '../src/admin/desk/side.ts';
import { paths, splitHref, withQuery } from '../src/routes.ts';

test('the toggle reads its three values and nothing else', () => {
  assert.equal(asSide('food'), 'food');
  assert.equal(asSide('todo'), 'todo');
  assert.equal(asSide(''), '');
  assert.equal(asSide('drink'), '', 'an unknown spelling is All');
  assert.equal(asSide(null), '');
});

test('Things to do is every category but Food & drink, and naming none is both', () => {
  assert.equal(sideOfCategory('food'), 'food');
  assert.equal(sideOfCategory('fun'), 'todo');
  assert.equal(onSide('food', ['food']), true);
  assert.equal(onSide('todo', ['food']), false);
  assert.equal(onSide('todo', ['culture', 'food']), true);
  assert.equal(onSide('food', []), true);
  assert.equal(onSide('food', [null]), true);
  assert.equal(onSide('', ['fun']), true);
  assert.deepEqual(sideParam(''), {});
  assert.deepEqual(sideParam('todo'), { side: 'todo' });
});

test('the four tabs share the one key, and the gap report and an open fact have addresses', () => {
  assert.deepEqual([...SIDE_TABS], ['categories', 'facts', 'mapping', 'collections']);
  assert.equal(SIDE_KEY, 'side');
  const gaps = paths.filing('categories', { view: 'gaps', side: 'food' });
  assert.equal(splitHref(gaps).query.get('view'), 'gaps');
  assert.equal(splitHref(gaps).query.get('side'), 'food');
  // The toggle is a filter written into the address in place; All is not written.
  assert.equal(splitHref(withQuery(gaps, { side: null })).query.get('side'), null);
  const picker = paths.filing('mapping', { word: 'indian_restaurant', ptab: 'fact', pfact: 'cuisine' });
  assert.equal(splitHref(picker).query.get('pfact'), 'cuisine');
});
