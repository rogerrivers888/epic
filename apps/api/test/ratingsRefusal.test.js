/**
 * What the cards are told when the source will not answer.
 *
 * Every square on Inspire now draws a rating slot (owner, 8 Sep 2026: "I want
 * to see it on every single square"), which puts a new weight on the empty
 * answer: with a hundred slots on screen, "nothing came back" said the wrong
 * way becomes a hundred claims that these places have no ratings. It is also
 * the moment a spent quota could quietly write off the whole atlas, because a
 * failed match used to be remembered as *no match* for good.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { googleSource } from '../src/sources/google.js';
import { ratingsFor } from '../src/sources/providerMatch.js';
import { pool } from '../src/db.js';

// Every outbound call is attributed in `provider_calls`, which opens a pool the
// runner would otherwise sit and wait on after the last assertion.
test.after(() => pool.end());

/** A place Google already owns, so no match has to be looked up or written. */
const REF = 'google:ChIJtest_ratings_refusal';
const PLACES = new Map([[REF, { name: 'Somewhere', lat: 51.4839, lng: -0.6044 }]]);

const withRating = async (rating, run) => {
  const was = googleSource.rating;
  googleSource.rating = rating;
  try { return await run(); } finally { googleSource.rating = was; }
};

test('a source over its allowance says so, and claims nothing about the places', async () => {
  const got = await withRating(
    async () => { throw new Error('Google Places 429: {"error":{"status":"RESOURCE_EXHAUSTED"}}'); },
    () => ratingsFor([REF], { places: PLACES }),
  );
  assert.deepEqual(got.ratings, {}, 'no rating is invented for a place nobody could ask about');
  assert.match(got.sourceError, /used up today's allowance/);
  assert.doesNotMatch(got.sourceError, /429|RESOURCE_EXHAUSTED/, 'the provider’s own words never travel');
});

test('a refusal stops the batch rather than spending the rest of it', async () => {
  let asked = 0;
  const refs = ['a', 'b', 'c'].map((k) => `google:ChIJbatch_${k}`);
  const places = new Map(refs.map((r) => [r, { name: 'Somewhere', lat: 51.4839, lng: -0.6044 }]));
  const got = await withRating(
    async () => { asked += 1; throw new Error('Google Places 429: Exceeded your metric'); },
    () => ratingsFor(refs, { places }),
  );
  assert.equal(asked, 1, 'the second and third places are not bought against a quota that is already spent');
  assert.deepEqual(got.ratings, {});
  assert.ok(got.sourceError);
});

test('an answer is still an answer', async () => {
  const got = await withRating(
    async () => ({ rating: 4.5, ratingCount: 3241 }),
    () => ratingsFor([`google:ChIJgood_${Date.now()}`], {
      places: new Map([[`google:ChIJgood_${Date.now()}`, { name: 'Somewhere', lat: 51.4839, lng: -0.6044 }]]),
    }),
  );
  assert.equal(got.sourceError, null, 'nothing to explain when the source answered');
});
