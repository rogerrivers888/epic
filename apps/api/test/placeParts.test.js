// A place that is part of another place.
//
// The owner, 14 Sep 2026: "if you know something is part of Thorpe Park, it all
// lives in Thorpe Park, and we should only ever display Thorpe Park, not Amity
// Beach."

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { withoutParts, rollUp } = await import('../src/repositories/placeParts.js');

const LIST = [
  { venueRef: 'wikidata:thorpe', name: 'Thorpe Park' },
  { venueRef: 'wikidata:amity', name: 'Amity Beach' },
  { venueRef: 'google:aquapark', name: 'Aquapark Reading' },
];

test('a place inside another is never offered on its own', () => {
  const inside = new Map([['wikidata:amity', 'wikidata:thorpe']]);
  const shown = withoutParts(LIST, inside).map((p) => p.name);
  assert.deepEqual(shown, ['Thorpe Park', 'Aquapark Reading']);
});

test('the parent stays, and a standalone place with the same words is untouched', () => {
  const inside = new Map([['wikidata:amity', 'wikidata:thorpe']]);
  const shown = withoutParts(LIST, inside);
  assert.ok(shown.some((p) => p.venueRef === 'wikidata:thorpe'));
  // Aquapark Reading carries the same Google words as Amity Beach. Nothing a
  // rule could read separates them, which is the whole reason this exists.
  assert.ok(shown.some((p) => p.venueRef === 'google:aquapark'));
});

test('a child is dropped even where its parent did not make the list', () => {
  // The search reached the water park but not the theme park around it.
  const inside = new Map([['wikidata:amity', 'wikidata:somewhere-else']]);
  assert.equal(withoutParts(LIST, inside).length, 2);
});

test('nothing recorded changes nothing', () => {
  assert.equal(withoutParts(LIST, new Map()).length, 3);
  assert.equal(withoutParts(LIST, null).length, 3);
});

test('the parent comes away knowing what was inside it', () => {
  // Owner, 14 Sep 2026: "it appears in theme park, and we have an attribute of
  // that theme park to say it has a water park."
  const items = [
    { venueRef: 'wikidata:thorpe', name: 'Thorpe Park', moods: ['fun'], subcategory: 'theme-parks', attrs: { indoor: { yesno: false } }, indoor: false, forKids: null },
    { venueRef: 'wikidata:amity', name: 'Amity Beach', moods: ['fun'], subcategory: 'water-park', attrs: { 'suits-ages': { from: 5, to: 99 } }, indoor: null, forKids: true },
  ];
  rollUp(items, new Map([['wikidata:amity', 'wikidata:thorpe']]));
  const thorpe = items[0];
  assert.deepEqual(thorpe.contains, ['water-park']);
  // What the parent already said stands; what it had nothing to say about it takes.
  assert.equal(thorpe.indoor, false);
  assert.equal(thorpe.forKids, true);
  assert.deepEqual(thorpe.attrs['suits-ages'], { from: 5, to: 99 });
  assert.deepEqual(thorpe.attrs.indoor, { yesno: false });
  // And only then is the child dropped.
  assert.deepEqual(withoutParts(items, new Map([['wikidata:amity', 'wikidata:thorpe']])).map((p) => p.name), ['Thorpe Park']);
});

test('a child whose parent is not in the list rolls up into nothing, and is still dropped', () => {
  const items = [{ venueRef: 'wikidata:amity', name: 'Amity Beach', moods: ['fun'], subcategory: 'water-park' }];
  const inside = new Map([['wikidata:amity', 'wikidata:thorpe']]);
  rollUp(items, inside);
  assert.equal(withoutParts(items, inside).length, 0);
});
