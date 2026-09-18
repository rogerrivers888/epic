import test from 'node:test';
import assert from 'node:assert/strict';
import { cameFrom, hold, letGo, positionOf, standingOn } from '../src/searchCards.ts';

/**
 * Which search a card belongs to — all four cases at once.
 *
 * Four rounds of review moved this rule back and forth, each fix breaking the
 * case the one before it had settled, because nothing held all four together.
 * They are the product of two questions: is this answer adding to what is on
 * screen or replacing it, and did the log manage to write the search down?
 *
 * The thing that makes it matter: an event about a place is resolved from these
 * mappings alone, so a card owned by the wrong search moves that search's
 * outcome — a search that showed forty places and was ignored reads as one that
 * worked, which is the opposite of what Demand is for.
 */

test('a replacement takes the surface over: the old cards go, the new ones are its own', () => {
  letGo('places');
  hold('places', 'q1', ['a', 'b']);
  hold('places', 'q2', ['b', 'c']);
  assert.equal(cameFrom('places', 'a'), null, 'a place the new answer did not show belongs to nothing');
  assert.equal(cameFrom('places', 'b'), 'q2', 'one that appears in both belongs to the answer on screen');
  assert.equal(cameFrom('places', 'c'), 'q2');
  assert.equal(standingOn('places'), 'q2');
});

test('a replacement whose log failed owns nothing, and hands nothing back to the search before it', () => {
  letGo('places');
  hold('places', 'q1', ['a', 'b']);
  hold('places', null, ['b', 'c']);
  assert.equal(cameFrom('places', 'b'), null, 'the previous search does not get to claim the next tap');
  assert.equal(cameFrom('places', 'a'), null);
  assert.equal(standingOn('places'), null);
});

test('an append leaves the earlier cards with the ask that produced them', () => {
  letGo('plan');
  hold('plan', 'q1', ['a', 'b']);
  hold('plan', 'q2', ['a', 'b', 'c', 'd'], { append: true });
  assert.equal(cameFrom('plan', 'a'), 'q1', 'the ones already there keep their ask');
  assert.equal(cameFrom('plan', 'b'), 'q1');
  assert.equal(cameFrom('plan', 'c'), 'q2', 'and the new ones belong to the ask that produced them');
  assert.equal(cameFrom('plan', 'd'), 'q2');
});

test('an append whose search is not written down yet keeps the earlier cards all the same', () => {
  letGo('plan');
  hold('plan', 'q1', ['a', 'b']);
  // "Show me 5 more" publishes the ideas before the search is written down.
  hold('plan', null, ['a', 'b', 'c'], { append: true });
  assert.equal(cameFrom('plan', 'a'), 'q1', 'wiping these is how round 124’s fault came back');
  assert.equal(cameFrom('plan', 'b'), 'q1');
  assert.equal(cameFrom('plan', 'c'), null, 'only the new card goes unattributed');
  // And when the id does arrive it takes the new card and leaves the old ones.
  hold('plan', 'q2', ['a', 'b', 'c'], { append: true });
  assert.equal(cameFrom('plan', 'a'), 'q1');
  assert.equal(cameFrom('plan', 'c'), 'q2');
});

test('letting go of a surface lets go of its cards too', () => {
  letGo('trip');
  hold('trip', 'q1', ['a']);
  letGo('trip');
  assert.equal(cameFrom('trip', 'a'), null);
  assert.equal(standingOn('trip'), null);
});

test('one surface never answers for another', () => {
  letGo('places'); letGo('inspire');
  hold('places', 'q1', ['a']);
  hold('inspire', 'q2', ['a']);
  assert.equal(cameFrom('places', 'a'), 'q1', 'the same place on two surfaces is two cards');
  assert.equal(cameFrom('inspire', 'a'), 'q2');
  hold('places', 'q3', ['b']);
  assert.equal(cameFrom('inspire', 'a'), 'q2', 'and replacing one surface leaves the other alone');
});

test('the position is where the card sat in the list that showed it', () => {
  letGo('find');
  hold('find', 'q1', ['a', 'b', 'c']);
  assert.equal(positionOf('q1', 'a'), 1);
  assert.equal(positionOf('q1', 'c'), 3);
  assert.equal(positionOf('q1', 'never-shown'), null);
  // A blank in the list is skipped rather than counted: an idea the geocoder
  // could not place has no reference, and it must not shift the ones after it.
  letGo('plan');
  hold('plan', 'q2', ['a', null, 'c']);
  assert.equal(positionOf('q2', 'c'), 3, 'the position is where it sat, gaps included');
});
