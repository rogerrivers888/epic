/**
 * A row's rule is data, and the shorthand is rendered from it.
 *
 * The design prototype carries a caption beside a JavaScript predicate and
 * filters on the predicate, so editing the caption to "anything at all" leaves
 * the row returning exactly what it returned before. That is the failure this
 * module exists to prevent, and these pin the three things that prevent it:
 * a rule that cannot be run is refused before it is saved, the shorthand is
 * derived rather than stored, and nothing known is never read as a no.
 *
 * A rule is over categories, labels, ranges and the cost band, and nothing
 * else (the axes brief, 25 Sep 2026). The graded clauses the grammar used to
 * have are refused, and a rule written against a retired label says so.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { attributesIn, checkPredicate, evaluate, matches, retiredIn, shorthand } =
  await import('../src/domain/browseRows.js');

const ATTRS = new Map([
  ['indoor', { key: 'indoor', label: 'Indoors', kind: 'yesno', active: true }],
  ['step-free', { key: 'step-free', label: 'Step free', kind: 'yesno', active: true }],
  ['suits-ages', { key: 'suits-ages', label: 'Suits ages', kind: 'range', active: true, range_min: 0, range_max: 99 }],
  ['duration', { key: 'duration', label: 'Duration', kind: 'range', active: true, range_min: 0, range_max: 720 }],
  ['cost-band', { key: 'cost-band', label: 'Cost band', kind: 'oneof', active: true, options: ['free', 'cheap', 'moderate', 'expensive'] }],
  // The two kinds of gone: a graded axis, and a label somebody switched off.
  ['how-much-walking', { key: 'how-much-walking', label: 'How much walking', kind: 'scale', active: false }],
  ['rainy-day', { key: 'rainy-day', label: 'Rainy day', kind: 'yesno', active: false }],
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
    { attribute: 'duration', to: 120 },
    { any: [{ attribute: 'indoor', yes: true }, { subcategory: ['coast'] }] },
    { not: { attribute: 'cost-band', choice: 'expensive' } },
  ] };
  assert.deepEqual(attributesIn(p).sort(), ['cost-band', 'duration', 'indoor']);
});

test('a rule that cannot be run is refused before it is saved', () => {
  const refuses = (clause, matching) => assert.throws(
    () => checkPredicate(clause, CONTEXT),
    (err) => { assert.match(err.message, matching); assert.equal(err.status, 400); return true; });

  refuses({}, /has to say something/);
  refuses({ all: [] }, /has to say something/);
  refuses({ attribute: 'how-tall', from: 2 }, /not one of our facts/);
  refuses({ subcategory: ['bowling'] }, /not one of our subcategories/);
  refuses({ category: ['nonsense'] }, /not one of our categories/);
  // A yes or no is not a range, and a range is not a yes or no.
  refuses({ attribute: 'indoor', from: 2 }, /is a yes or no/);
  refuses({ attribute: 'suits-ages', yes: true }, /is a range/);
  // One thing at a time, or the row means two things and matches neither.
  refuses({ attribute: 'duration', from: 2, to: 3 }, /Say one thing/);
  // A number is a number.
  refuses({ attribute: 'duration', to: 'three' }, /wants a number/);
  refuses({ attribute: 'suits-ages', overlaps: [4] }, /overlaps two numbers/);
  // One of a list is asked by naming which, and only from the list.
  refuses({ attribute: 'cost-band', yes: true }, /is one of a list/);
  refuses({ attribute: 'cost-band', choice: [] }, /Say which/);
  refuses({ attribute: 'cost-band', choice: 'ruinous' }, /not one of Cost band's choices/);
  // The graded clauses are gone, and so are the labels they were written for.
  refuses({ attribute: 'how-much-walking', atLeast: 3 }, /graded axes, which are gone/);
  refuses({ attribute: 'rainy-day', yes: true }, /is retired/);
  // A clause in a shape the grammar no longer has is not "one thing said".
  refuses({ attribute: 'duration', atLeast: 3 }, /Say one thing about Duration, not 0/);

  // The good ones go through.
  checkPredicate({ all: [
    { attribute: 'duration', to: 120 },
    { attribute: 'indoor', yes: false },
    { attribute: 'suits-ages', overlaps: [0, 3] },
    { attribute: 'cost-band', choice: ['free', 'cheap'] },
    { not: { subcategory: ['coast'] } },
  ] }, CONTEXT);
});

test('a rule written against a retired label is named, so the rewrite knows what it meant', () => {
  const p = { all: [{ attribute: 'indoor', yes: true }, { attribute: 'how-much-walking', atLeast: 3 }] };
  assert.deepEqual(retiredIn(p, ATTRS), ['how-much-walking']);
  assert.deepEqual(retiredIn({ attribute: 'rainy-day', yes: true }, ATTRS), ['rainy-day']);
  assert.deepEqual(retiredIn({ attribute: 'indoor', yes: true }, ATTRS), []);
  // And it never answers: a value still in the table under it is not read.
  const walked = place('golf', { indoor: { yesno: true }, 'how-much-walking': { level: 4 } });
  assert.equal(evaluate(p, walked, valueOf), 'unknown');
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
    { attribute: 'indoor', yes: true },      // known, and false
    { attribute: 'duration', to: 120 },      // nobody has said
  ] } };
  assert.equal(evaluate(rule.not, p, valueOf), 'unknown');
  assert.equal(matches(rule, p, valueOf), false);

  // Once the unknown is answered it settles, both ways.
  const quick = place('golf', { indoor: { yesno: false }, duration: { from: 45, to: 90 } });
  assert.equal(matches(rule, quick, valueOf), false);
  const long = place('golf', { indoor: { yesno: false }, duration: { from: 300, to: 480 } });
  assert.equal(matches(rule, long, valueOf), true);
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

test('the cost band is one of a list, and a rule may name several of it', () => {
  const free = place('coast', { 'cost-band': { choice: 'free' } });
  const dear = place('golf', { 'cost-band': { choice: 'expensive' } });
  assert.equal(matches({ attribute: 'cost-band', choice: 'free' }, free, valueOf), true);
  assert.equal(matches({ attribute: 'cost-band', choice: ['free', 'cheap'] }, free, valueOf), true);
  assert.equal(matches({ attribute: 'cost-band', choice: ['free', 'cheap'] }, dear, valueOf), false);
  // Unasked is unasked, not "not free".
  assert.equal(evaluate({ attribute: 'cost-band', choice: 'free' }, place('golf', {}), valueOf), 'unknown');
});

test('a range overlaps rather than contains, because that is how ages are asked', () => {
  const toddlers = { attribute: 'suits-ages', overlaps: [0, 3] };
  // Suits 2 to 8: overlaps the toddler band even though it runs past it.
  assert.equal(matches(toddlers, place('golf', { 'suits-ages': { from: 2, to: 8 } }), valueOf), true);
  assert.equal(matches(toddlers, place('golf', { 'suits-ages': { from: 8, to: 14 } }), valueOf), false);
  // An open end is read as the label's own end, not as nothing.
  assert.equal(matches(toddlers, place('golf', { 'suits-ages': { from: null, to: 6 } }), valueOf), true);
});

test('one end of a range reads the label’s own end where the value is open, and is unknown otherwise', () => {
  const adults = { attribute: 'suits-ages', from: 16 };
  const twoHours = { attribute: 'duration', to: 120 };
  // "Suits ages to 6" is from nought, because Suits ages runs from nought —
  // with the vocabulary to hand. Without it, an open end is not a number.
  assert.equal(matches(adults, place('golf', { 'suits-ages': { from: null, to: 6 } }), valueOf, ATTRS), false);
  assert.equal(evaluate(adults, place('golf', { 'suits-ages': { from: null, to: 6 } }), valueOf), 'unknown');
  assert.equal(matches(adults, place('golf', { 'suits-ages': { from: 18, to: null } }), valueOf), true);
  // Two hours, tops: a place worth 45 to 90 minutes answers; one worth all day does not.
  assert.equal(matches(twoHours, place('golf', { duration: { from: 45, to: 90 } }), valueOf), true);
  assert.equal(matches(twoHours, place('golf', { duration: { from: 300, to: 480 } }), valueOf), false);
  // The trap the old grammar had: an open upper end read as 99, which is a
  // number of years and not of minutes. Now it is the label's own end.
  assert.equal(matches(twoHours, place('golf', { duration: { from: 30, to: null } }), valueOf, ATTRS), false);
});

test('all and any are what they say', () => {
  const p = place('water', { indoor: { yesno: false }, 'cost-band': { choice: 'free' } });
  assert.equal(matches({ all: [
    { attribute: 'indoor', yes: false }, { attribute: 'cost-band', choice: 'free' },
  ] }, p, valueOf), true);
  assert.equal(matches({ all: [
    { attribute: 'indoor', yes: true }, { attribute: 'cost-band', choice: 'free' },
  ] }, p, valueOf), false);
  assert.equal(matches({ any: [
    { attribute: 'indoor', yes: true }, { subcategory: ['water'] },
  ] }, p, valueOf), true);
});

test('the shorthand is rendered from the rule, so the two cannot come apart', () => {
  assert.equal(
    shorthand({ all: [
      { attribute: 'duration', to: 120 },
      { attribute: 'indoor', yes: true },
    ] }, LABELS),
    'duration to 120 · indoors');
  assert.equal(
    shorthand({ any: [{ subcategory: ['water', 'coast'] }] }, LABELS),
    'Lakes & rivers or Beaches & coast');
  assert.equal(
    shorthand({ not: { attribute: 'indoor', yes: true } }, LABELS),
    'not indoors');
  assert.equal(
    shorthand({ attribute: 'suits-ages', overlaps: [0, 3] }, LABELS),
    'suits ages overlaps 0–3');
  assert.equal(
    shorthand({ attribute: 'cost-band', choice: ['free', 'cheap'] }, LABELS),
    'cost band free or cheap');
  // A yes/no said as "no" reads as the negative rather than as "indoors false".
  assert.equal(shorthand({ attribute: 'indoor', yes: false }, LABELS), 'not indoors');
  // A rule written before the axes went is shown as what it was, not hidden:
  // the rewrite has to be able to read it.
  assert.equal(shorthand({ attribute: 'how-much-walking', atLeast: 3 }, LABELS), 'how much walking ≥ 3');
});

test('there is no clause for how far away somewhere is, and that is deliberate', () => {
  // How far belongs to one fence (`domain/band.js`) and depends on who is
  // asking. A row holding its own idea of "near" would be a second fence, and
  // the first thing it would do is disagree with the first one.
  assert.throws(() => checkPredicate({ within: 30 }, CONTEXT), /has to say something/);
  assert.throws(() => checkPredicate({ attribute: 'minutes', to: 30 }, CONTEXT), /not one of our facts/);
});
