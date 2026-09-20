/**
 * The filing desk's judgements — src/admin/filing/say.ts.
 *
 * These are the places where a wrong answer is *silent*. A screenshot cannot
 * tell you that a word reads "kept as a label" when somebody answered parking,
 * or that a row nobody has hearted reads "0%" as though households had looked
 * and declined. So each one is pinned here, including the cases that only
 * happen on an empty or a very young database — which is exactly the state the
 * back office is in now, and the state that produced the audit's first bad run.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FADES_AFTER_DAYS, appliedSays, heartAge, pointsAt, rung, setMarks, shareSays, sortLabel,
  startsDescending, thinSomewhere, tooManyQuestions, waiting,
} from '../src/admin/filing/say.ts';

// --- where a word points ---------------------------------------------------

test('a word pointing at a drawer says the drawer, whatever else it carries', () => {
  assert.equal(
    pointsAt({ pointsAt: { key: 'museums', label: 'Museums' }, decision: 'mapped', answer: null }),
    'Museums');
  // A word can be mapped *and* carry a decision. Pointing at a drawer is the
  // stronger fact, and this reading is not a bug.
  assert.equal(
    pointsAt({ pointsAt: { key: 'museums', label: 'Museums' }, decision: 'mapped', answer: 'generic' }),
    'Museums');
});

test('the two answers that are not a drawer keep their own words', () => {
  // These are real decisions somebody made — parking, and the chemist beside
  // the museum — and both vanish into "kept as a label" if only the screen's
  // four states survive.
  assert.equal(pointsAt({ pointsAt: null, decision: 'secondary', answer: 'travel' }),
    'Kept as a label · how you get there');
  assert.equal(pointsAt({ pointsAt: null, decision: 'secondary', answer: 'nearby' }),
    'Kept as a label · what is nearby');
  assert.equal(pointsAt({ pointsAt: null, decision: 'secondary', answer: 'generic' }), 'Kept as a label');
  assert.equal(pointsAt({ pointsAt: null, decision: 'secondary', answer: null }), 'Kept as a label');
});

test('excluded and unanswered are different things', () => {
  assert.equal(pointsAt({ pointsAt: null, decision: 'notinepic', answer: 'aside' }), 'Not in Epic');
  assert.equal(pointsAt({ pointsAt: null, decision: 'notsure', answer: null }), 'not answered');
});

// --- sorting ---------------------------------------------------------------

test('the sort button says its direction in words, not with an arrow', () => {
  assert.equal(sortLabel('brings', true), 'Sorted by places it brings in · most first');
  assert.equal(sortLabel('brings', false), 'Sorted by places it brings in · fewest first');
});

test('a name sorts the opposite way round from a count', () => {
  // `desc` on a count is most-first; `desc` on a name is Z to A. One flag
  // cannot mean the same thing for both, and reading it as though it did is
  // how a column ends up claiming the opposite of what it shows.
  assert.equal(sortLabel('word', false), 'Sorted by google’s word · A to Z');
  assert.equal(sortLabel('word', true), 'Sorted by google’s word · Z to A');
  assert.equal(sortLabel('points', false), 'Sorted by where it points · A to Z');
});

test('ever opened counts up, because the useless ones are the ones to see', () => {
  assert.equal(sortLabel('opens', true), 'Sorted by ever opened · fewest first');
});

test('a column somebody has just switched to starts the way that column is read', () => {
  assert.equal(startsDescending('brings'), true);
  assert.equal(startsDescending('flags'), true);
  assert.equal(startsDescending('word'), false);
  assert.equal(startsDescending('points'), false);
});

// --- candidates ------------------------------------------------------------

test('a word on few places is distinctive; a word on nearly all tells you nothing', () => {
  assert.equal(rung(2, 60, 0.2, 0.8), 'distinctive');
  assert.equal(rung(30, 60, 0.2, 0.8), 'ordinary');
  assert.equal(rung(58, 60, 0.2, 0.8), 'useless');
});

test('the rungs move when the thresholds do', () => {
  // They were set on one district of data and are meant to move, so nothing
  // may bake them in.
  assert.equal(rung(20, 60, 0.2, 0.8), 'ordinary');
  assert.equal(rung(20, 60, 0.4, 0.8), 'distinctive');
  assert.equal(rung(40, 60, 0.2, 0.6), 'useless');
});

test('a word nothing was read for is not distinctive', () => {
  // Nought of nought is an absence of evidence, not a thin spread. Drawing it
  // large would put the loudest thing on the screen on the word we know least
  // about.
  assert.equal(rung(0, 0, 0.2, 0.8), 'ordinary');
});

test('settled and settling do not look the same', () => {
  assert.deepEqual(setMarks({ state: 'settled', tooFewForTooMany: false, questions: 4 }), ['SETTLED']);
  assert.deepEqual(setMarks({ state: 'settling', tooFewForTooMany: false, questions: 4 }), ['SETTLING']);
  assert.deepEqual(setMarks({ state: null, tooFewForTooMany: false, questions: 4 }), []);
});

test('a set can be settled and still spread too thin', () => {
  assert.deepEqual(
    setMarks({ state: 'settled', tooFewForTooMany: true, questions: 3 }),
    ['SETTLED', 'TOO FEW FOR TOO MANY']);
});

test('eight questions is where a set is asking too much of every place', () => {
  assert.equal(tooManyQuestions(7), false);
  assert.equal(tooManyQuestions(8), true);
});

// --- rows ------------------------------------------------------------------

const fill = (counts: Record<string, number>) => Object.fromEntries(
  Object.entries(counts).map(([k, n]) => [k, { count: n, places: [] as string[] }]));

test('only a hearted row waits', () => {
  // An unhearted row below the fill is a row that does not apply here.
  // Marking it WAITING would promise something nobody asked for.
  assert.equal(waiting({ hearted: true, fill: fill({ SL5: 2 }) }, 'SL5', 4), true);
  assert.equal(waiting({ hearted: false, fill: fill({ SL5: 2 }) }, 'SL5', 4), false);
  assert.equal(waiting({ hearted: true, fill: fill({ SL5: 9 }) }, 'SL5', 4), false);
});

test('a district the row has never filled counts as nought, not as unknown', () => {
  assert.equal(waiting({ hearted: true, fill: fill({ SL5: 9 }) }, 'RG17', 4), true);
});

test('thin anywhere is thin, because the preview is three districts', () => {
  // The whole point of the preview is that a rule returning fourteen in Ascot
  // returns two in Hungerford.
  assert.equal(thinSomewhere({ fill: fill({ SL5: 14, RG45: 6, RG17: 2 }) }, ['SL5', 'RG45', 'RG17'], 4), true);
  assert.equal(thinSomewhere({ fill: fill({ SL5: 14, RG45: 6, RG17: 5 }) }, ['SL5', 'RG45', 'RG17'], 4), false);
});

test('nobody yet is not nought per cent', () => {
  // "0%" is a claim that households looked and declined. "nobody yet" is a
  // fact about how young the product is. The screens draw them differently and
  // must never be able to swap.
  assert.equal(shareSays(null), 'nobody yet');
  assert.equal(shareSays(0), '0%');
  assert.equal(shareSays(0.43), '43%');
});

test('a heart older than four months is said in months and marked fading', () => {
  assert.deepEqual(heartAge(1), { says: 'hearted 1 day ago', fading: false });
  assert.deepEqual(heartAge(9), { says: 'hearted 9 days ago', fading: false });
  assert.equal(heartAge(FADES_AFTER_DAYS).fading, false);
  assert.deepEqual(heartAge(148), { says: 'hearted 5 months ago · fading', fading: true });
});

// --- the audit -------------------------------------------------------------

test('an apply reports what it did, not what it was asked for', () => {
  // Some proposals cannot be applied without somebody naming something — a
  // split with unnamed halves. Reporting "21 applied" when one is still open
  // is the quiet lie that makes an audit worthless.
  assert.equal(appliedSays(21, 0), '21 applied');
  assert.equal(appliedSays(20, 1), '20 applied, 1 still needs you');
  assert.equal(appliedSays(18, 3), '18 applied, 3 still need you');
});
