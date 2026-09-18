// What "ready" means, and the three faults.
//
// These two pieces of arithmetic are the ones every figure on the Places screen
// is built out of, and both are silent when they are wrong: a bar that quietly
// counts a fact it should not marks thousands of places down for ever, and a
// fault classifier that leans the wrong way sends the collection budget to the
// wrong county. So the properties held here are the ones the design states as
// laws rather than the ones that happen to be easy to test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACTS, FACT_KEYS, FACT_WEIGHTS, defaultBars, scorePlace, readyShare, faultOf, SHORT_FAULT,
} from '../src/domain/placeIndex.js';

const bar = (...facts) => FACT_KEYS.map((f) => ({ fact: f, weight: FACT_WEIGHTS[f], required: facts.includes(f) }));

test('a playground with all three of its facts scores what a restaurant with all four does', () => {
  // The whole point of a per-kind bar: "a restaurant is not ready without a
  // menu; a playground never has one and must not be marked down for it."
  const playground = scorePlace({
    bar: bar('picture', 'what_it_is', 'hours'),
    held: { picture: true, what_it_is: true, hours: true },
  });
  const restaurant = scorePlace({
    bar: bar('picture', 'what_it_is', 'hours', 'menu'),
    held: { picture: true, what_it_is: true, hours: true, menu: true },
  });
  assert.equal(playground.score, 100);
  assert.equal(restaurant.score, 100);
  assert.equal(playground.ready, true);
  assert.equal(restaurant.ready, true);
});

test('equal completeness scores equally, and the heaviest fact costs most', () => {
  const b = bar('picture', 'what_it_is', 'hours');   // 30 / 25 / 20
  const noPicture = scorePlace({ bar: b, held: { what_it_is: true, hours: true } });
  const noHours = scorePlace({ bar: b, held: { picture: true, what_it_is: true } });
  // Two of three either way, and the one that is missing decides the number.
  assert.equal(noPicture.score, 60);
  assert.equal(noHours.score, 73);
  assert.ok(noPicture.score < noHours.score, 'missing the picture must cost more than missing the hours');

  // The law the design states: equal inputs produce equal outputs.
  const a = scorePlace({ bar: b, held: { picture: true } });
  const c = scorePlace({ bar: b, held: { picture: true } });
  assert.equal(a.score, c.score);
});

test('a fact this kind of place is not judged on is recorded and never counted', () => {
  // "Recorded is not the same as required. A playground holds a price but is not
  // judged on one." So it never moves the score, and it is reported separately
  // so a screen can print `n/a` rather than a dash.
  const without = scorePlace({ bar: bar('picture', 'what_it_is'), held: { picture: true, what_it_is: true } });
  const with_ = scorePlace({ bar: bar('picture', 'what_it_is'), held: { picture: true, what_it_is: true, prices: true, step_free: true } });
  assert.equal(without.score, with_.score);
  assert.equal(with_.ready, true);
  assert.deepEqual(with_.parts.notCounted.sort(), ['prices', 'step_free']);
  assert.deepEqual(without.parts.notCounted, []);
});

test('a subcategory nobody has set a bar for is "not set", never nought', () => {
  // A new drawer with no bar must not put every place in it at the bottom of
  // every list. `set: false` is a state the screen draws as "not set".
  const none = scorePlace({ bar: [], held: { picture: true } });
  assert.equal(none.set, false);
  assert.equal(none.score, null);
  assert.equal(none.ready, false);
  // What it happens to hold is still reported, so the row is not blank either.
  assert.deepEqual(none.parts.notCounted, ['picture']);
});

test('missing names the facts that are missing, and only the judged ones', () => {
  const out = scorePlace({ bar: bar('picture', 'what_it_is', 'hours'), held: { hours: true, prices: true } });
  assert.deepEqual(out.parts.missing.sort(), ['picture', 'what_it_is']);
  assert.deepEqual(out.parts.held, ['hours']);
  assert.equal(out.parts.judged.length, 3);
});

test('every seeded bar names facts that exist, and every fact has a weight', () => {
  const seed = defaultBars();
  for (const [key, facts] of Object.entries(seed)) {
    assert.ok(facts.length, `${key} has an empty bar`);
    for (const f of facts) {
      assert.ok(FACT_KEYS.includes(f), `${key} asks for ${f}, which is not a fact`);
      assert.ok(FACT_WEIGHTS[f] > 0, `${f} has no weight`);
    }
  }
  // Somewhere that serves food is judged on a menu; open ground never is.
  assert.ok(seed.restaurants.includes('menu'));
  assert.ok(!seed.parks.includes('menu'));
  assert.ok(!seed.parks.includes('hours'), 'there are no opening hours on a common');
  assert.ok(seed.play.includes('picture') && !seed.play.includes('menu'));
  // Every fact carries an explanation, because a column cannot ship without one.
  for (const f of FACTS) assert.ok(f.explain.length > 20, `${f.key} has no explanation`);
});

test('the ready share is a whole percent, and nothing out of nothing is nothing to say', () => {
  assert.equal(readyShare(1, 3), 33);
  assert.equal(readyShare(0, 10), 0);
  assert.equal(readyShare(0, 0), null, 'no places is not nought per cent');
});

test('the three faults are told apart, and never averaged into one rate', () => {
  // Shown nothing, every time: a coverage hole, and Collect is the only fix.
  const none = faultOf({ searches: 214, empty: 214 });
  assert.equal(none.key, 'empty-always');
  assert.equal(none.act, 'collect');
  assert.equal(SHORT_FAULT[none.key], 'No places');

  // Empty every time in an area that is full of them is not a coverage hole:
  // the sources fell over, or the search asked for the wrong thing. Sending
  // somebody to Collect would spend a budget on places already held.
  const held = faultOf({ searches: 214, empty: 214, known: 380 });
  assert.equal(held.key, 'empty-but-held');
  assert.equal(held.owner, 'The sources');
  assert.notEqual(held.act, 'collect');
  assert.equal(SHORT_FAULT[held.key], 'Empty, not missing');

  // Shown things and opened none: the wrong things were shown.
  const wrong = faultOf({ searches: 1106, empty: 0, noClick: 604, noTrip: 188, known: 512 });
  assert.equal(wrong.key, 'wrong-places');
  assert.equal(wrong.owner, 'Categories');

  // Opened and never taken anywhere: the record is too thin to convince.
  const thin = faultOf({ searches: 688, empty: 30, noClick: 201, noTrip: 388, known: 164 });
  assert.equal(thin.key, 'thin-places');
  assert.equal(thin.owner, 'The data score');

  // All three at once is its own answer rather than the worst of the three.
  const all = faultOf({ searches: 341, empty: 90, noClick: 96, noTrip: 102, known: 38 });
  assert.equal(all.key, 'all-three');

  // And a subject that is working says so rather than being ranked anyway.
  const fine = faultOf({ searches: 1661, empty: 10, noClick: 161, noTrip: 130, known: 2318 });
  assert.equal(fine.key, 'working');
  assert.equal(fine.owner, null);

  // Nothing asked is nothing to diagnose.
  assert.equal(faultOf({ searches: 0 }).key, 'none');
});

test('every fault has a short word, and the two ladders never share one', () => {
  for (const key of ['no-places', 'empty-always', 'empty-but-held', 'wrong-places', 'thin-places', 'all-three', 'working', 'none']) {
    assert.ok(SHORT_FAULT[key], `${key} has no short word`);
  }
  // "One word, one meaning": the fault words and the rating bands are disjoint.
  const ratings = new Set(['top', 'high', 'mixed', 'poor', 'good']);
  for (const word of Object.values(SHORT_FAULT)) assert.ok(!ratings.has(word.toLowerCase()));
});
