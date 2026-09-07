import test from 'node:test';
import assert from 'node:assert/strict';
import { isMatch, likeness, metresBetween } from '../src/sources/providerMatch.js';

/**
 * The guard that decides whether a place in our atlas and a place at Google are
 * the same place.
 *
 * This is the only thing standing between an attraction and somebody else's
 * reviews, and a wrong match is worse than no match at all: a castle wearing a
 * pizzeria's stars is a lie the screen tells confidently. So both halves are
 * tested — the name has to read as the same name, and the point has to be close
 * enough that it cannot be a different place of the same name elsewhere.
 */

const WINDSOR = { lat: 51.4839, lng: -0.6044 };

test('the same place, written differently, is the same place', () => {
  assert.ok(likeness('Windsor Castle', 'Windsor Castle') === 1);
  assert.ok(likeness('The Savill Garden', 'Savill Garden') >= 0.6, 'a leading "The" is not a difference');
  assert.ok(likeness('Bel & The Dragon', 'Bel and the Dragon') >= 0.6, '& and "and" are the same word');
  assert.ok(likeness('Windsor Castle', 'Windsor Castle, Home Park') >= 0.6, 'extra words do not disqualify the shorter name');
});

test('a different place is not accepted because it shares a word', () => {
  assert.ok(likeness('Windsor Castle', 'Windsor Great Park') < 0.6);
  assert.ok(likeness('Legoland Windsor', 'Windsor Farm Shop') < 0.6);
  assert.ok(likeness('Thorpe Park', 'Thorpe Park Hotel & Spa') >= 0.6, 'but a place and its own hotel do read alike — distance is the other half of the guard');
});

test('distance is measured, not assumed', () => {
  assert.equal(metresBetween(WINDSOR, WINDSOR), 0);
  const a_mile_off = { lat: 51.4839 + 0.0145, lng: -0.6044 };
  assert.ok(metresBetween(WINDSOR, a_mile_off) > 1500, 'a mile is outside the ring');
});

test('both halves must pass for a match', () => {
  const near = { name: 'Windsor Castle', lat: 51.4841, lng: -0.6040 };
  const farSameName = { name: 'Windsor Castle', lat: 53.4808, lng: -2.2426 };  // a pub in Manchester
  const nearOtherName = { name: 'The Crooked House', lat: 51.4841, lng: -0.6040 };

  assert.equal(isMatch('Windsor Castle', WINDSOR, near), true);
  assert.equal(isMatch('Windsor Castle', WINDSOR, farSameName), false, 'the same name two hundred miles away is a different place');
  assert.equal(isMatch('Windsor Castle', WINDSOR, nearOtherName), false, 'next door is not the same place');
});

test('a large site pinned differently by each source still matches', () => {
  // Google pins Windsor Great Park at a car park, Wikidata at its centroid.
  const carPark = { name: 'Windsor Great Park', lat: 51.4839 + 0.008, lng: -0.6044 + 0.008 };
  assert.ok(metresBetween(WINDSOR, carPark) > 900, 'they really are a way apart');
  assert.equal(isMatch('Windsor Great Park', WINDSOR, carPark), true, 'and the ring is generous enough for it');
});
