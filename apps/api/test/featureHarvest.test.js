/**
 * What reaches the extractor, and what the corpus does with the answer.
 *
 * The first harvest raised 46,000 "features" and produced nought decisions.
 * The words it raised were licence footers, opening-hours syntax, place names
 * and menu items — `by-sa`, `mo-su`, `bristol`, `prawn linguine` — each seen on
 * exactly one place. These pin the two halves of the fix: what is taken out
 * before the model is asked anything, and the fact that the *corpus* counts the
 * answer rather than the model.
 *
 * Pure: no database, no model call.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { looksLikeMenu, namesOf, strip } = await import('../src/domain/boilerplate.js');
const { countAcross, evidenced, poolFor, textOf } = await import('../src/sources/featureHarvest.js');

// --- boilerplate -----------------------------------------------------------

test('a licence footer is not a feature of a day out', () => {
  // `by-sa` was raised as a candidate feature on more than a hundred places.
  const out = strip('A restored waterwheel. Text available under CC BY-SA 4.0 via Wikimedia Commons.');
  assert.match(out, /restored waterwheel/);
  assert.doesNotMatch(out, /by-sa/i);
  assert.doesNotMatch(out, /wikimedia/i);
});

test('opening hours are a syntax, not a sentence', () => {
  // `mo-su` came out of OpenStreetMap's opening_hours grammar.
  const out = strip('Mo-Su 10:00-18:00; Dec 25 off. There is a café and a shop.');
  assert.match(out, /caf/);
  assert.doesNotMatch(out, /mo-su/i);
  assert.doesNotMatch(out, /10:00/);
});

test('24/7 and public-holiday markers go too', () => {
  const out = strip('Open 24/7. PH off. Free parking on site.');
  assert.match(out, /parking/);
  assert.doesNotMatch(out, /24\/7/);
});

test('a place’s own name is the one phrase guaranteed to say nothing', () => {
  // "aberdulais" and "aberdulais falls" were both raised as features.
  const names = namesOf({ name: 'Aberdulais Falls', town: 'SA10' });
  const out = strip('Aberdulais Falls is in SA10. Aberdulais has a waterwheel and a tearoom.', { names });
  assert.doesNotMatch(out, /aberdulais/i);
  assert.doesNotMatch(out, /SA10/);
  assert.match(out, /waterwheel/);
  assert.match(out, /tearoom/);
});

test('a name made of ordinary words does not take those words out of the text', () => {
  // Stripping "The Lookout" must not remove the word "lookout" from a sentence
  // about a viewing platform — that would delete the feature with the name.
  const names = namesOf({ name: 'The Lookout' });
  const out = strip('The Lookout has a lookout tower and a café.', { names });
  assert.match(out, /lookout tower/i);
});

test('a short name fragment is not stripped', () => {
  // "Odds Farm" must not take "farm" out of every sentence in the drawer.
  const names = namesOf({ name: 'Odds Farm Park' });
  const out = strip('A working farm with a park and a barn.', { names });
  assert.match(out, /working farm/);
  assert.match(out, /park/);
});

test('stripping leaves a space, so two sentences do not fuse', () => {
  // Deleting the footer outright would join "waterwheel" to "There", and the
  // extractor would see a phrase nobody wrote.
  const out = strip('A waterwheel. © 2026 Someone. There is a shop.');
  assert.doesNotMatch(out, /waterwheelThere/);
  assert.match(out, /waterwheel\.\s+There/);
});

// --- menus -----------------------------------------------------------------

test('a menu is recognised by its shape, not by its words', () => {
  // Every false feature in the first harvest's restaurants drawer was a dish.
  assert.equal(looksLikeMenu('Prawn linguine £14.50\nTomahawk pork £22\nEgg benedict £9\nLobster mac £16'), true);
  assert.equal(looksLikeMenu('Starters\nSoup\nBread\nOlives\nMains\nSteak\nFish'), true);
});

test('a description that mentions food is not a menu', () => {
  const prose = 'A converted mill beside the river, with a tearoom serving lunch and a shop selling local produce. '
    + 'There is step-free access to the ground floor and parking for thirty cars.';
  assert.equal(looksLikeMenu(prose), false);
});

test('a dish never reaches the feature path', () => {
  // The routing, end to end: menu text is dropped and counted, not extracted.
  const { text, menus } = textOf({
    name: 'The Bull', postcode: 'RG10',
    summary: 'Sunday roast £18\nRibeye £26\nMoussaka £15\nSea bass £19\nLamb shank £20\nTiramisu £7',
    accessibility: {}, experiences: [],
  });
  assert.equal(menus, 1);
  assert.equal(text, '');
});

// --- the corpus counts -----------------------------------------------------

const kept = [
  { ref: 'a', text: 'There is a wave machine and a flume.' },
  { ref: 'b', text: 'The wave machine runs on the hour.' },
  { ref: 'c', text: 'A quiet pool with lane swimming.' },
];

test('the model proposes and the corpus counts', () => {
  // A feature the model was sure about is still a feature seen on two places.
  assert.deepEqual(countAcross({ name: 'Wave machine' }, kept), { seen: 2, on: ['a', 'b'] });
});

test('a feature nothing in the corpus mentions counts nought, however confident the answer', () => {
  assert.deepEqual(countAcross({ name: 'Hearing loop' }, kept), { seen: 0, on: [] });
});

test('a feature matches its words, not its exact phrase', () => {
  // "the wave machine" and "wave machines" are the same feature.
  const plural = [{ ref: 'a', text: 'Two wave machines.' }, { ref: 'b', text: 'The wave machine.' }];
  assert.equal(countAcross({ name: 'Wave machine' }, plural).seen, 2);
});

test('a feature does not match a word that merely contains its own', () => {
  // "machine" alone must not count a vending machine as a wave machine.
  const vending = [{ ref: 'a', text: 'A vending machine in the lobby.' }];
  assert.equal(countAcross({ name: 'Wave machine' }, vending).seen, 0);
});

// --- evidence --------------------------------------------------------------

test('a quote that is not in the corpus means the model wrote the feature', () => {
  const pooled = 'There is a wave machine and a flume.';
  assert.equal(evidenced({ evidence: 'There is a wave machine' }, pooled), true);
  assert.equal(evidenced({ evidence: 'The hearing loop covers the whole pool' }, pooled), false);
});

test('a quote too short to be evidence is not evidence', () => {
  // "a pool" appears in half the corpus and proves nothing.
  assert.equal(evidenced({ evidence: 'pool' }, 'A quiet pool with lane swimming.'), false);
});

test('evidence matching survives reflowed whitespace', () => {
  // The pooled text is joined with newlines between places; a quote copied
  // across a line break must still be found.
  const pooled = 'There is a wave\n   machine and a flume.';
  assert.equal(evidenced({ evidence: 'There is a wave machine' }, pooled), true);
});

// --- pooling ---------------------------------------------------------------

test('places with nothing written about them are not pooled', () => {
  // They would contribute no evidence and would only flatter the denominator.
  const { kept: k, pooled } = poolFor([
    { venue_ref: 'a', name: 'A', summary: 'A lake with a boathouse and a jetty.', accessibility: {}, experiences: [] },
    { venue_ref: 'b', name: 'B', summary: null, accessibility: {}, experiences: [] },
  ]);
  assert.equal(k.length, 1);
  assert.match(pooled, /place 1/);
  assert.doesNotMatch(pooled, /place 2/);
});

test('a day abbreviation inside an ordinary word is not opening hours', () => {
  // `th` in "There", `fr` in "Front", `su` in "Sunset", `mo` in "Motorway".
  // Without a trailing word boundary the hours expression ate the first two
  // letters of each and left text nobody wrote — "ere is a shop".
  const out = strip('There is a shop at the front. Sunset views from the terrace, off the motorway.');
  assert.match(out, /There is a shop/);
  assert.match(out, /front/);
  assert.match(out, /Sunset/);
  assert.match(out, /motorway/);
});

test('a real day range is still stripped', () => {
  assert.doesNotMatch(strip('Mo-Fr 09:00-17:00. Café on site.'), /Mo-Fr/i);
  assert.doesNotMatch(strip('Open Sa-Su. Parking free.'), /Sa-Su/i);
  assert.match(strip('Open Sa-Su. Parking free.'), /Parking/);
});

// --- what Codex found ------------------------------------------------------

const { asserted } = await import('../src/sources/featureHarvest.js');

test('an accessibility field we looked at and did not find is not a facility', () => {
  // `own.js` writes a key for every field it checked, including the absent
  // ones. Reading the keys alone presented all of them as things the place
  // provides — so a drawer where nobody had a hearing loop would still have
  // raised "hearing loop" as recurring, and the corpus check would have agreed,
  // because the words really were in every place's text.
  const { text } = textOf({
    name: 'A', postcode: 'RG1', experiences: [],
    summary: 'A lake with a boathouse and a jetty for hire.',
    accessibility: { stepFree: true, hearingLoop: false, wheelchairToilet: null, audioGuide: 'no' },
  });
  assert.match(text, /step free/);
  assert.doesNotMatch(text, /hearing/i);
  assert.doesNotMatch(text, /wheelchair/i);
  assert.doesNotMatch(text, /audio/i);
});

test('a camelCase accessibility key is said in words', () => {
  // The extractor reads English; `stepFree` is a token and "step free" is a
  // facility.
  const { text } = textOf({
    name: 'A', postcode: 'RG1', experiences: [], summary: 'A long enough description to keep.',
    accessibility: { stepFree: true },
  });
  assert.match(text, /step free/);
  assert.doesNotMatch(text, /stepFree/);
});

test('a feature word does not match inside an unrelated word', () => {
  // "wave machine" counted a place saying "waveform" and "machinery" — two
  // substrings, no feature, and the corpus check defeated.
  const decoys = [
    { ref: 'a', text: 'A waveform display and some machinery.' },
    { ref: 'b', text: 'More machinery beside the waveform.' },
  ];
  assert.equal(countAcross({ name: 'Wave machine' }, decoys).seen, 0);
});

test('a plural is the same feature', () => {
  const plural = [
    { ref: 'a', text: 'Two wave machines.' },
    { ref: 'b', text: 'One wave machine.' },
  ];
  assert.equal(countAcross({ name: 'Wave machine' }, plural).seen, 2);
});
