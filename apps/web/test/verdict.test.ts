/**
 * The number the family will argue with (owner, 7 Sep 2026: "the review of the
 * dishes should then blend into an overall review from the family review
 * stars").
 *
 * It has to be one they can follow: a star is a star wherever it was given, a
 * person is the unit rather than a plate, and silence stays silent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { verdictOf } from '../src/components/verdict.ts';

const take = (memberId: string, member: string, subject: string, over: Record<string, unknown> = {}) =>
  ({ memberId, member, subject, take: 'loved' as const, comment: null, ...over });

const meal = (id: string, on: string, takes: ReturnType<typeof take>[]) => ({ id, visitedOn: on, takes });

test('a plate starred and the place starred are the same kind of thing', () => {
  const v = verdictOf([meal('v1', '2026-09-06', [
    take('r', 'Roger', 'Penne Arrabbiata', { score: 5 }),
    take('r', 'Roger', 'visit', { score: 3 }),
  ])]);
  assert.equal(v.score, 4, "Roger's two stars average into his one score");
  assert.equal(v.said[0].plates, 1);
  assert.equal(v.said[0].visitScores, 1);
});

test('four courses do not outvote one: the person is the unit', () => {
  const v = verdictOf([meal('v1', '2026-09-06', [
    take('r', 'Roger', 'Antipasti', { score: 5 }),
    take('r', 'Roger', 'Primi', { score: 5 }),
    take('r', 'Roger', 'Secondi', { score: 5 }),
    take('r', 'Roger', 'Dolci', { score: 5 }),
    take('g', 'Gina', 'Burrata', { score: 1 }),
  ])]);
  assert.equal(v.score, 3, 'five and one, not four fives and a one');
});

test('a plate nobody starred was fine, and fine is not a number', () => {
  const v = verdictOf([meal('v1', '2026-09-06', [
    take('r', 'Roger', 'Penne Arrabbiata', { score: 4 }),
    take('g', 'Gina', 'Focaccia', { take: 'fine' }),
  ])]);
  assert.equal(v.score, 4, 'Gina saying nothing does not drag it to a middle');
  assert.equal(v.starsGiven, 1);
});

test('“not great” is carried by name rather than turned into a figure', () => {
  const v = verdictOf([meal('v1', '2026-09-06', [
    take('r', 'Roger', 'Penne Arrabbiata', { score: 5 }),
    take('j', 'Jules', 'Spaghettoni al Ragù', { take: 'not_for_me', comment: 'too salty' }),
  ])]);
  assert.equal(v.score, 5, 'no invented score pulls the average down');
  assert.equal(v.notGreat, 1);
  const jules = v.said.find((s) => s.memberId === 'j')!;
  assert.deepEqual(jules.notGreat, ['Spaghettoni al Ragù']);
  assert.equal(jules.scores.length, 0, 'and it is not a rating of theirs either');
});

test('nobody has said anything: no number, and nothing to draw', () => {
  assert.equal(verdictOf([meal('v1', '2026-09-06', [])]).score, null);
  assert.equal(verdictOf([]).score, null);
});

test('meals come back newest first, with only what somebody actually said', () => {
  const v = verdictOf([
    meal('old', '2026-08-01', [take('r', 'Roger', 'Burrata', { score: 4 })]),
    meal('new', '2026-09-06', [
      take('r', 'Roger', 'Penne Arrabbiata', { score: 5 }),
      take('g', 'Gina', 'Focaccia', { take: 'fine' }),
    ]),
  ]);
  assert.deepEqual(v.meals.map((m) => m.id), ['new', 'old']);
  assert.equal(v.meals[0].lines.length, 1, 'the plate nobody said anything about is not a line');
  assert.equal(v.meals[0].lines[0].what, 'Penne Arrabbiata');
});

test('the place itself is named as such when it is expanded', () => {
  const v = verdictOf([meal('v1', '2026-09-06', [take('r', 'Roger', 'visit', { score: 5 })])]);
  assert.equal(v.meals[0].lines[0].what, 'the place itself');
});

test('a name comes from the household when the rating does not carry one', () => {
  const v = verdictOf([meal('v1', '2026-09-06', [{ memberId: 'p', subject: 'Ribs', take: 'loved' as const, comment: null, score: 5 }])],
    [{ id: 'p', name: 'Phoenix Sumner-Rivers' }]);
  assert.equal(v.said[0].first, 'Phoenix');
});
