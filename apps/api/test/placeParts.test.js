// A place that is part of another place.
//
// The owner, 14 Sep 2026: "if you know something is part of Thorpe Park, it all
// lives in Thorpe Park, and we should only ever display Thorpe Park, not Amity
// Beach."

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { withoutParts } = await import('../src/repositories/placeParts.js');

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
