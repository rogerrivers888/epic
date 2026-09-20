/**
 * The filing desk: what a drawer says, and on what evidence.
 *
 * The Places redesign (20 Sep 2026) draws a drawer's answer in the shape of the
 * control — outline is proposed, filled is set — and draws nothing at all where
 * the places disagree. Those are four different states and the screen cannot
 * invent the difference, so it is pinned here:
 *
 *   - nothing in the drawer has answered → no value, and it says which kind of
 *     nothing it is, because an empty drawer and an unasked one are two
 *     different problems;
 *   - the places mostly agree → that value, proposed;
 *   - a person has agreed → the same value, settled, and "set" outranks every
 *     other sentence the row could say;
 *   - the places disagree past the limit → mixed, which is the *absence* of a
 *     default and must never arrive carrying one.
 *
 * Everything here is pure: no database, the rows handed in by hand exactly as
 * `repositories/filing.js` shapes them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { drawerAnswer, disagreeingIn, sameValue, said } = await import('../src/repositories/filing.js');

const YESNO = { key: 'parking', label: 'Parking', kind: 'yesno', unit: null };
const SCALE = { key: 'how-thrilling', label: 'How thrilling', kind: 'scale', unit: '0 calm · 4 a parachute jump', range_min: 0, range_max: 4 };
const RANGE = { key: 'suits-ages', label: 'Suits ages', kind: 'range', unit: 'years', range_min: 0, range_max: 99 };

/** A `valuesByRef` map from a plain object of ref → attribute → value. */
const valuesOf = (obj) => new Map(Object.entries(obj)
  .map(([ref, attrs]) => [ref, new Map(Object.entries(attrs))]));

const answer = (opts) => drawerAnswer({ spreadLimit: 0.35, defaults: new Map(), ...opts });

test('a value is compared by its shape, not by the order its keys were written', () => {
  assert.equal(sameValue({ yesno: true }, { yesno: true }), true);
  assert.equal(sameValue({ yesno: true }, { yesno: false }), false);
  assert.equal(sameValue({ level: 3 }, { level: 3 }), true);
  // A level arriving as text from a form is the same level.
  assert.equal(sameValue({ level: 3 }, { level: '3' }), true);
  assert.equal(sameValue({ from: 4, to: 12 }, { to: 12, from: 4 }), true);
  assert.equal(sameValue({ from: 4, to: 12 }, { from: 4, to: 14 }), false);
  // Nothing said is never the same as something said, in either direction.
  assert.equal(sameValue(null, { yesno: true }), false);
  assert.equal(sameValue({ yesno: true }, null), false);
});

test('a value reads as its own shape and never as a yes it is not', () => {
  assert.equal(said({ yesno: true }, YESNO), 'Yes');
  assert.equal(said({ yesno: false }, YESNO), 'No');
  // The bug this exists to stop: a scale rendered by a yes/no formatter says
  // "yes" for every number, including nought.
  assert.equal(said({ level: 0 }, SCALE), '0');
  assert.equal(said({ level: 3 }, SCALE), '3');
  assert.equal(said({ from: 4, to: 12 }, RANGE), '4 to 12');
  assert.equal(said(null, YESNO), '—');
});

test('an empty drawer and an unasked drawer say different things, and neither guesses', () => {
  const empty = answer({ attribute: YESNO, refs: [], valuesByRef: new Map() });
  assert.equal(empty.value, null);
  assert.equal(empty.proposed, false);
  assert.equal(empty.why, 'no places to read it from');

  const unasked = answer({ attribute: YESNO, refs: ['a', 'b'], valuesByRef: new Map() });
  assert.equal(unasked.value, null);
  assert.equal(unasked.proposed, false);
  assert.equal(unasked.heard, 0);
  assert.equal(unasked.why, 'no place here has answered yet');
});

test('what the places mostly say is proposed, with the count that proposes it', () => {
  const a = answer({
    attribute: YESNO,
    refs: ['a', 'b', 'c', 'd'],
    valuesByRef: valuesOf({
      a: { parking: { yesno: true } },
      b: { parking: { yesno: true } },
      c: { parking: { yesno: true } },
      d: { parking: { yesno: false } },
    }),
  });
  assert.deepEqual(a.value, { yesno: true });
  assert.equal(a.proposed, true);
  assert.equal(a.settled, false);
  assert.equal(a.agree, 3);
  assert.equal(a.heard, 4);
  assert.equal(a.why, '3 of 4 agree');
  assert.equal(a.mixed, false);
});

test('a place that has not answered is not counted as agreeing', () => {
  const a = answer({
    attribute: YESNO,
    // Four in the drawer, two have ever answered.
    refs: ['a', 'b', 'c', 'd'],
    valuesByRef: valuesOf({ a: { parking: { yesno: true } }, b: { parking: { yesno: true } } }),
  });
  assert.equal(a.heard, 2);
  assert.equal(a.why, '2 of 2 agree');
});

test('"set" outranks every other sentence, and a settled answer is never re-proposed', () => {
  const a = answer({
    attribute: YESNO,
    refs: ['a', 'b'],
    valuesByRef: valuesOf({ a: { parking: { yesno: false } }, b: { parking: { yesno: false } } }),
    defaults: new Map([['parking', { yesno: true, settled: true }]]),
  });
  // The person's answer stands, even though both places say otherwise: that
  // disagreement is what the "what disagrees" column is for, not grounds for
  // the screen to quietly overrule them.
  assert.deepEqual(a.value, { yesno: true });
  assert.equal(a.settled, true);
  assert.equal(a.proposed, false);
  assert.equal(a.why, 'set');
  // And a settled answer is never mixed, however far apart its places are.
  assert.equal(a.mixed, false);
});

test('places that disagree past the limit leave the drawer with no default at all', () => {
  const a = answer({
    attribute: YESNO,
    refs: ['a', 'b', 'c', 'd'],
    valuesByRef: valuesOf({
      a: { parking: { yesno: true } },
      b: { parking: { yesno: true } },
      c: { parking: { yesno: false } },
      d: { parking: { yesno: false } },
    }),
  });
  // Half disagree, which is past 0.35.
  assert.equal(a.mixed, true);
  // And the value is gone, not merely marked: handing a mixed row a value is
  // how every reader downstream comes to pick a side the drawer did not take.
  assert.equal(a.value, null);
  assert.equal(a.said, '—');
});

test('the spread limit is the threshold it is handed, not a number of its own', () => {
  const places = valuesOf({
    a: { parking: { yesno: true } },
    b: { parking: { yesno: true } },
    c: { parking: { yesno: true } },
    d: { parking: { yesno: false } },
  });
  const refs = ['a', 'b', 'c', 'd'];
  // A quarter disagree.
  assert.equal(answer({ attribute: YESNO, refs, valuesByRef: places, spreadLimit: 0.2 }).mixed, true);
  assert.equal(answer({ attribute: YESNO, refs, valuesByRef: places, spreadLimit: 0.35 }).mixed, false);
});

test('the eight are proposed the same way, and a nought is a value like any other', () => {
  const a = answer({
    attribute: SCALE,
    refs: ['a', 'b', 'c'],
    valuesByRef: valuesOf({
      a: { 'how-thrilling': { level: 0 } },
      b: { 'how-thrilling': { level: 0 } },
      c: { 'how-thrilling': { level: 0 } },
    }),
  });
  // The trap: nought is falsy, and a drawer that is genuinely nought-thrilling
  // must not read as one nobody has answered.
  assert.deepEqual(a.value, { level: 0 });
  assert.equal(a.proposed, true);
  assert.equal(a.said, '0');
  assert.equal(a.why, '3 of 3 agree');
  assert.equal(a.anchor, '0 calm · 4 a parachute jump');
});

test('what disagrees names the difference in words, and says when a person set it', () => {
  const answers = [
    { key: 'parking', label: 'Parking', kind: 'yesno', value: { yesno: true }, mixed: false },
    { key: 'how-thrilling', label: 'How thrilling', kind: 'scale', value: { level: 1 }, mixed: false },
  ];
  const out = disagreeingIn({
    refs: ['a', 'b', 'c'],
    valuesByRef: valuesOf({
      a: { parking: { yesno: false } },
      b: { 'how-thrilling': { level: 3, by: 'roger@deliverplus.co.uk' } },
      c: { parking: { yesno: true } },
    }),
    answers,
    recordsByRef: new Map([['a', { name: 'The Berkshire', postcode: 'SL5 8AY' }]]),
  });
  assert.equal(out.length, 2);
  const [a, b] = out;
  assert.equal(a.ref, 'a');
  assert.equal(a.name, 'The Berkshire');
  assert.equal(a.diff, 'parking no');
  assert.equal(a.human, false);
  // A scale says what it is and what was expected, because "how thrilling 3"
  // alone does not tell you it is an argument.
  assert.equal(b.diff, 'how thrilling 3, not 1');
  assert.equal(b.human, true);
  // c agrees, so it is not in the list at all.
  assert.equal(out.some((r) => r.ref === 'c'), false);
});

test('a mixed answer is not something a place can disagree with', () => {
  const out = disagreeingIn({
    refs: ['a'],
    valuesByRef: valuesOf({ a: { parking: { yesno: false } } }),
    answers: [{ key: 'parking', label: 'Parking', kind: 'yesno', value: null, mixed: true }],
    recordsByRef: new Map(),
  });
  assert.deepEqual(out, []);
});

test('a place with no owned name is offered without one rather than with a borrowed one', () => {
  const out = disagreeingIn({
    refs: ['google:abc'],
    valuesByRef: valuesOf({ 'google:abc': { parking: { yesno: false } } }),
    answers: [{ key: 'parking', label: 'Parking', kind: 'yesno', value: { yesno: true }, mixed: false }],
    recordsByRef: new Map(),
  });
  assert.equal(out[0].name, null);
  assert.equal(out[0].ref, 'google:abc');
});
