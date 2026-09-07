/**
 * What a menu's words are allowed to become (Epic 2 C7 — no silent merges).
 *
 * A rating screen offers "this is bolognese" so a star on one restaurant's
 * plate counts at every restaurant that serves the dish. That is only worth
 * having while the suggestion is right: a wrong one is tapped through once and
 * then lives in somebody's profile as a taste they never had.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestConcept, resolveConcept } from '../src/domain/concepts.js';

test('a menu that names the dish outright needs no suggestion at all', () => {
  assert.equal(resolveConcept('Penne Arrabbiata', { kinds: ['dish'] })?.key, 'dish:arrabbiata');
});

test('a dish said another way is offered, because the words overlap', () => {
  // "Spaghettoni al Ragù" is bolognese by way of "tagliatelle al ragù".
  assert.equal(suggestConcept('Spaghettoni al Ragù')?.key, 'dish:bolognese');
  assert.equal(suggestConcept('kids LINGUINE BOLOGNESE')?.key, 'dish:bolognese');
});

test('a dish that only spells like another one is not offered', () => {
  // Burrata is not a burrito. Four shared letters is not a shared dish, and
  // this is the class of match that ends up in somebody's profile.
  assert.equal(suggestConcept('Burrata'), null);
});

test('sharing nothing but the little words a menu joins names with is not a match', () => {
  assert.equal(suggestConcept('Bistecca alla Fiorentina'), null);
  assert.equal(suggestConcept('Bruschetta Classica'), null);
});

test('a dish Epic has never heard of says so rather than guessing', () => {
  assert.equal(suggestConcept('Gamberoni alla Sebastian'), null);
  assert.equal(suggestConcept('Patate al Rosmarino'), null);
});
