/**
 * A row's rule is data, and the shorthand is rendered from it.
 *
 * The design prototype carries a caption beside a JavaScript predicate and
 * filters on the predicate, so editing the caption to "anything at all" leaves
 * the row returning exactly what it returned before. That is the failure this
 * module exists to prevent, and these pin the three things that prevent it:
 * a rule that cannot be run is refused before it is saved, the shorthand is
 * derived rather than stored, and nothing known is never read as a no.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { attributesIn, checkPredicate, evaluate, matches, shorthand } =
  await import('../src/domain/browseRows.js');

const ATTRS = new Map([
  ['how-much-walking', { key: 'how-much-walking', label: 'How much walking', kind: 'scale' }],
  ['how-smart', { key: 'how-smart', label: 'How smart', kind: 'scale' }],
  ['indoor', { key: 'indoor', label: 'Indoors', kind: 'yesno' }],
  ['suits-ages', { key: 'suits-ages', label: 'Suits ages', kind: 'range' }],
  ['cuisine', { key: 'cuisine', label: 'Cuisine', kind: 'oneof' }],
]);
const CONTEXT = {
  attributes: ATTRS,
  subcategories: new Set(['coast', 'water', 'golf']),
  categories: new Set(['outdoors', 'sport']),
};
const LABELS = new Map([
  ...[...ATTRS].map(([k, a]) => [k, { label: a.label }]),
  ['coast', { label: 'Beaches & coast' }],
  ['water', { label: 'Lakes & rivers' }],
]);

/** A place with its resolved values, in the shape the evaluator is handed. */
const place = (subcategory, values, category = 'outdoors') => ({
  ref: `r:${subcategory}`, subcategory, category, values,
});
const valueOf = (p, key) => p.values[key] ?? null;

test('a rule names the attributes it asks about, so only those need fetching', () => {
  const p = { all: [
    { attribute: 'how-much-walking', atLeast: 3 },
    { any: [{ attribute: 'indoor', yes: true }, { subcategory: ['coast'] }] },
    { not: { attribute: 'how-smart', atMost: 1 } },
  ] };
  assert.deepEqual(attributesIn(p).sort(), ['how-much-walking', 'how-smart', 'indoor']);
});

test('a rule that cannot be run is refused before it is saved', () => {
  const refuses = (clause, matching) => assert.throws(
    () => checkPredicate(clause, CONTEXT),
    (err) => { assert.match(err.message, matching); assert.equal(err.status, 400); return true; });

  refuses({}, /has to say something/);
  refuses({ all: [] }, /has to say something/);
  refuses({ attribute: 'how-tall', atLeast: 2 }, /not one of our labels/);
  refuses({ subcategory: ['bowling'] }, /not one of our subcategories/);
  refuses({ category: ['nonsense'] }, /not one of our categories/);
  // A scale is not a yes or no, and a yes or no is not a scale.
  refuses({ attribute: 'how-much-walking', yes: true }, /is a scale/);
  refuses({ attribute: 'indoor', atLeast: 2 }, /is a yes or no/);
  refuses({ attribute: 'suits-ages', atLeast: 2 }, /is a range/);
  // One thing at a time, or the row means two things and matches neither.
  refuses({ attribute: 'how-much-walking', atLeast: 2, atMost: 3 }, /Say one thing/);
  // A number is a number.
  refuses({ attribute: 'how-much-walking', atLeast: 'three' }, /wants a number/);
  refuses({ attribute: 'suits-ages', overlaps: [4] }, /overlaps two numbers/);
  // And the one shape a row genuinely cannot ask about yet says so plainly.
  refuses({ attribute: 'cuisine', is: 1 }, /one of a list/);

  // The good ones go through.
  checkPredicate({ all: [
    { attribute: 'how-much-walking', atLeast: 3 },
    { attribute: 'indoor', yes: false },
    { attribute: 'suits-ages', overlaps: [0, 3] },
    { not: { subcategory: ['coast'] } },
  ] }, CONTEXT);
});

test('nothing known is not a no', () => {
  const rule = { attribute: 'indoor', yes: false };
  // A place nobody has asked does not answer "indoors" and does not answer
  // "not indoors" either. Reading an absent value as false is how a row fills
  // up with places nobody has checked.
  assert.equal(matches(rule, place('golf', {}), valueOf), false);
  assert.equal(matches(rule, place('golf', { indoor: { yesno: false } }), valueOf), true);
  assert.equal(matches(rule, place('golf', { indoor: { yesno: true } }), valueOf), false);
});

test('"not" over something unknown is still unknown, and sweeps nothing in', () => {
  const rule = { not: { attribute: 'indoor', yes: true } };
  // The trap: a plain negation would make this true of every place nobody has
  // ever asked, which on a young estate is nearly all of them.
  assert.equal(matches(rule, place('golf', {}), valueOf), false);
  assert.equal(matches(rule, place('golf', { indoor: { yesno: false } }), valueOf), true);
  assert.equal(matches(rule, place('golf', { indoor: { yesno: true } }), valueOf), false);
  // A drawer is always known, so a "not" over one behaves normally.
  assert.equal(matches({ not: { subcategory: ['coast'] } }, place('golf', {}), valueOf), true);
  assert.equal(matches({ not: { subcategory: ['coast'] } }, place('coast', {}), valueOf), false);
});

test('unknown survives nesting, however deep somebody buries it', () => {
  // The one a boolean cannot do. `any` of a known-false and an unknown is
  // *unknown*, not false — so negating it must not produce a match. A first
  // attempt asked "knowable?" and "true?" in two passes and got this wrong:
  // the `any` had one known child so it looked knowable, returned false, and
  // the negation turned that into a yes for a place nobody had asked.
  const p = place('golf', { indoor: { yesno: false } });
  const rule = { not: { any: [
    { attribute: 'indoor', yes: true },          // known, and false
    { attribute: 'how-much-walking', atLeast: 3 }, // nobody has said
  ] } };
  assert.equal(evaluate(rule.not, p, valueOf), 'unknown');
  assert.equal(matches(rule, p, valueOf), false);

  // Once the unknown is answered it settles, both ways.
  const walked = place('golf', { indoor: { yesno: false }, 'how-much-walking': { level: 1 } });
  assert.equal(matches(rule, walked, valueOf), true);
  const strode = place('golf', { indoor: { yesno: false }, 'how-much-walking': { level: 4 } });
  assert.equal(matches(rule, strode, valueOf), false);
});

test('an "all" with one unknown in it is unknown, not false', () => {
  const p = place('golf', { indoor: { yesno: true } });
  // Knowing a place is indoors does not answer "indoors and step free".
  assert.equal(evaluate({ all: [
    { attribute: 'indoor', yes: true }, { attribute: 'step-free', yes: true },
  ] }, p, valueOf), 'unknown');
  // But one plain no settles it without needing the rest.
  assert.equal(evaluate({ all: [
    { attribute: 'indoor', yes: false }, { attribute: 'step-free', yes: true },
  ] }, p, valueOf), 'no');
});

test('an empty list of drawers is a rule that can never match, and is refused', () => {
  assert.throws(() => checkPredicate({ subcategory: [] }, CONTEXT), /at least one subcategory/);
  assert.throws(() => checkPredicate({ category: [] }, CONTEXT), /at least one category/);
});

test('a scale is compared as a number, and nought is a value', () => {
  const p = place('golf', { 'how-much-walking': { level: 0 } });
  assert.equal(matches({ attribute: 'how-much-walking', atMost: 1 }, p, valueOf), true);
  assert.equal(matches({ attribute: 'how-much-walking', is: 0 }, p, valueOf), true);
  assert.equal(matches({ attribute: 'how-much-walking', atLeast: 1 }, p, valueOf), false);
  // The falsy trap: nought must not read as "nothing said".
  assert.equal(matches({ attribute: 'how-much-walking', atLeast: 0 }, p, valueOf), true);
});

test('a range overlaps rather than contains, because that is how ages are asked', () => {
  const toddlers = { attribute: 'suits-ages', overlaps: [0, 3] };
  // Suits 2 to 8: overlaps the toddler band even though it runs past it.
  assert.equal(matches(toddlers, place('golf', { 'suits-ages': { from: 2, to: 8 } }), valueOf), true);
  assert.equal(matches(toddlers, place('golf', { 'suits-ages': { from: 8, to: 14 } }), valueOf), false);
  // An open end is read as the label's own end, not as nothing.
  assert.equal(matches(toddlers, place('golf', { 'suits-ages': { from: null, to: 6 } }), valueOf), true);
});

test('all and any are what they say', () => {
  const p = place('water', { indoor: { yesno: false }, 'how-much-walking': { level: 3 } });
  assert.equal(matches({ all: [
    { attribute: 'indoor', yes: false }, { attribute: 'how-much-walking', atLeast: 3 },
  ] }, p, valueOf), true);
  assert.equal(matches({ all: [
    { attribute: 'indoor', yes: true }, { attribute: 'how-much-walking', atLeast: 3 },
  ] }, p, valueOf), false);
  assert.equal(matches({ any: [
    { attribute: 'indoor', yes: true }, { subcategory: ['water'] },
  ] }, p, valueOf), true);
});

test('the shorthand is rendered from the rule, so the two cannot come apart', () => {
  assert.equal(
    shorthand({ all: [
      { attribute: 'how-much-walking', atLeast: 3 },
      { attribute: 'indoor', yes: true },
    ] }, LABELS),
    'how much walking ≥ 3 · indoors');
  assert.equal(
    shorthand({ any: [{ subcategory: ['water', 'coast'] }] }, LABELS),
    'Lakes & rivers or Beaches & coast');
  assert.equal(
    shorthand({ not: { attribute: 'indoor', yes: true } }, LABELS),
    'not indoors');
  assert.equal(
    shorthand({ attribute: 'suits-ages', overlaps: [0, 3] }, LABELS),
    'suits ages overlaps 0–3');
  // A yes/no said as "no" reads as the negative rather than as "indoors false".
  assert.equal(shorthand({ attribute: 'indoor', yes: false }, LABELS), 'not indoors');
});

test('there is no clause for how far away somewhere is, and that is deliberate', () => {
  // How far belongs to one fence (`domain/band.js`) and depends on who is
  // asking. A row holding its own idea of "near" would be a second fence, and
  // the first thing it would do is disagree with the first one.
  assert.throws(() => checkPredicate({ within: 30 }, CONTEXT), /has to say something/);
  assert.throws(() => checkPredicate({ attribute: 'minutes', atMost: 30 }, CONTEXT), /not one of our labels/);
});
