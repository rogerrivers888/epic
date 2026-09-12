import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BENCHABLE, judge, tally } from '../src/domain/sourceBench.js';

/**
 * The correctness bench judges a kept fact against a rented one. These hold
 * the rules to what a person would say looking at the two values.
 */

test('names agree when the words agree, whatever the punctuation', () => {
  assert.equal(judge('name', 'The Bull & Butcher', 'Bull and Butcher').verdict, 'agree');
  assert.equal(judge('name', 'Côte Brasserie', 'Cote').verdict, 'agree');
  assert.equal(judge('name', 'The Crown', 'The Anchor').verdict, 'differ');
});

test('an address is judged on its postcode when both have one', () => {
  assert.equal(judge('address', '12 High St, Henley-on-Thames RG9 2AJ', 'High Street, Henley-on-Thames, RG9 2AJ, UK').verdict, 'agree');
  assert.equal(judge('address', '12 High St RG9 2AJ', 'High Street SL4 1AA').verdict, 'differ');
  assert.equal(judge('address', 'Somewhere on the hill', 'The hill, near the church').verdict, 'unknown');
});

test('phones and websites ignore formatting', () => {
  assert.equal(judge('phone', '+44 1491 573 500', '01491 573500').verdict, 'agree');
  assert.equal(judge('website', 'https://www.example.co.uk/menu', 'example.co.uk').verdict, 'agree');
  assert.equal(judge('website', 'example.co.uk', 'other.com').verdict, 'differ');
});

test('coordinates agree within a door, are unsure within a street, and differ beyond', () => {
  const here = { lat: 51.5362, lng: -0.9021 };
  assert.equal(judge('lat_lng', here, { lat: 51.5363, lng: -0.9022 }).verdict, 'agree');
  assert.equal(judge('lat_lng', here, { lat: 51.5375, lng: -0.9021 }).verdict, 'unknown');
  assert.equal(judge('lat_lng', here, { lat: 51.55, lng: -0.9 }).verdict, 'differ');
});

test('hours are only judged on which days are closed; the rest is for the owner', () => {
  assert.equal(judge('hours_regular', 'Mo off; Tu-Su 12:00-22:00', ['Monday: Closed', 'Tuesday: 12:00 – 10:00 PM']).verdict, 'unknown');
  assert.equal(judge('hours_regular', 'Mo-Su 12:00-22:00', ['Monday: Closed', 'Tuesday: 12:00 – 10:00 PM']).verdict, 'differ');
});

test('a missing side is its own verdict, and the tally keeps it apart from a comparison', () => {
  assert.equal(judge('phone', null, '0123').verdict, 'ours_missing');
  assert.equal(judge('phone', '0123', null).verdict, 'theirs_missing');
  const t = tally([{ verdict: 'agree' }, { verdict: 'differ' }, { verdict: 'unknown' }, { verdict: 'ours_missing' }]);
  assert.deepEqual(t, { compared: 3, agreed: 1, differed: 1, unknown: 1, oursMissing: 1, theirsMissing: 0 });
  assert.ok(BENCHABLE.includes('name') && BENCHABLE.includes('lat_lng'));
});
