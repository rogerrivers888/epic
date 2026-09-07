/**
 * What the family's stars are allowed to become (owner, 7 Sep 2026: "I'd like
 * to see how I can then find those ratings and how you're going to be using
 * them").
 *
 * A dish somebody keeps starring turns into a food the family loves, and so
 * into a table on the home screen. The rules that keep that honest are all
 * about restraint: three meals before it counts, food only, and never louder
 * than a like somebody typed in themselves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { withStarredFoods, foodTastes } from '../src/domain/tastes.js';

const phoenix = { id: 'p', name: 'Phoenix Sumner-Rivers', likes: [], dislikes: [], diets: [], allergens: [] };
const learned = (over) => ({
  memberId: 'p', name: 'Phoenix Sumner-Rivers', conceptKey: 'dish:bolognese', label: 'Bolognese',
  conceptKind: 'dish', kind: 'like', count: 3, confirmed: true, threshold: 3, net: 2.4, lastOn: '2026-09-06', ...over,
});

test('a dish starred enough times becomes a food they love', () => {
  const [m] = withStarredFoods([phoenix], [learned()]);
  assert.equal(m.likes.length, 1);
  assert.deepEqual(m.likes[0], { value: 'Bolognese', conceptKey: 'dish:bolognese', maxMinutes: null, favourite: false, starred: 3 });
});

test('one good night is not a taste: it counts only once it is confirmed', () => {
  const [m] = withStarredFoods([phoenix], [learned({ confirmed: false, count: 1 })]);
  assert.deepEqual(m.likes, []);
});

test('a dish they would not have again never becomes a like', () => {
  const [m] = withStarredFoods([phoenix], [learned({ kind: 'dislike' })]);
  assert.deepEqual(m.likes, []);
});

test('what is learned about doing things is not a food', () => {
  // Climbing is learned the same way and belongs to the planner, not to a
  // table of the best places to eat it.
  const [m] = withStarredFoods([phoenix], [learned({ conceptKey: 'experience:climbing', conceptKind: 'experience' })]);
  assert.deepEqual(m.likes, []);
});

test('a like somebody typed in themselves is not duplicated or overwritten', () => {
  const typed = { ...phoenix, likes: [{ value: 'spag bol', conceptKey: 'dish:bolognese', maxMinutes: null, favourite: true }] };
  const [m] = withStarredFoods([typed], [learned()]);
  assert.equal(m.likes.length, 1);
  assert.equal(m.likes[0].favourite, true, 'their own favourite survives');
  assert.equal(m.likes[0].said ?? m.likes[0].value, 'spag bol', 'in their own words');
});

test('somebody else’s stars stay on their own plate', () => {
  const gina = { ...phoenix, id: 'g', name: 'Gina Sumner-Rivers' };
  const [p, g] = withStarredFoods([phoenix, gina], [learned()]);
  assert.equal(p.likes.length, 1);
  assert.deepEqual(g.likes, []);
});

test('the table it makes says it came from the stars, not from a list', () => {
  const [m] = withStarredFoods([phoenix], [learned()]);
  const [taste] = foodTastes([m]);
  assert.equal(taste.label.toLowerCase(), 'bolognese');
  assert.equal(taste.loved[0].starred, 3, 'the card can say how many meals put it there');
  assert.equal(taste.loved[0].first, 'Phoenix');
});
