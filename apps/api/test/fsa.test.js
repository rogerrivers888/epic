/**
 * The hygiene register, for one place — src/sources/fsa.js.
 *
 * Matched on the postcode and then the name, failing closed: two
 * establishments at one postcode that both look like the place is "could not
 * tell", never a guess. Pure where it can be; the register is stubbed where
 * it cannot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../test/helpers/db.js';

const { pool } = await testDatabase();
const { pick, sameName, lookup } = await import('../src/sources/fsa.js');

test.after(() => pool.end());

const est = (name, pc, rating = '5', id = 1) => ({ FHRSID: id, BusinessName: name, PostCode: pc, RatingValue: rating, RatingDate: '2025-03-04T00:00:00', SchemeType: 'FHRS', BusinessType: 'Restaurant/Cafe/Canteen' });

test('a name is the same business loosely, and not by a shared word', () => {
  assert.equal(sameName('The Bull', 'Bull Inn'), true);
  assert.equal(sameName('Bella Italia', 'Bella Italia Windsor'), true);
  assert.equal(sameName('Sunningdale Golf Club', 'Sunningdale Bakery'), false);
  // One word is only the same as one word: a shared token at a shared
  // postcode would keep somebody else's rating for good (Codex, 25 Sep 2026).
  assert.equal(sameName('The Crown', 'Crown & Anchor'), false);
  assert.equal(sameName('The Ivy', 'The Ivy Asia'), false);
  assert.equal(sameName('Sunningdale Cafe', 'Sunningdale Golf Club'), false);
  assert.equal(sameName('Cafe', 'Cafe Rouge'), false);
});

test('the postcode is the first gate, the name the second, and two matches is no match', () => {
  assert.equal(pick([est('Bull Inn', 'SL5 9JH')], { name: 'The Bull', postcode: 'sl59jh' }).match.FHRSID, 1);
  assert.match(pick([est('Bull Inn', 'SL5 9JH')], { name: 'The Bull', postcode: 'SL5 0AA' }).problem, /nothing at that postcode$/);
  assert.match(pick([est('Bakery', 'SL5 9JH')], { name: 'The Bull', postcode: 'SL5 9JH' }).problem, /by that name/);
  const two = pick([est('Bull Inn', 'SL5 9JH', '5', 1), est('The Bull Restaurant', 'SL5 9JH', '3', 2)], { name: 'The Bull', postcode: 'SL5 9JH' });
  assert.equal(two.match, null);
  assert.match(two.problem, /2 establishments/);
});

test('a place the register does not know is an honest nothing, and one it does is kept as facts', async () => {
  const wasFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify({ establishments: /SL5/.test(String(url)) ? [est('Bull Inn', 'SL5 9JH', 'AwaitingInspection', 77)] : [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const none = await lookup({ name: 'Windsor Castle', postcode: 'SL4 1NJ' });
    assert.equal(none.facts, null);
    assert.match(none.problem, /nothing at that postcode/);
    const got = await lookup({ name: 'The Bull', postcode: 'SL5 9JH' });
    assert.deepEqual(got.facts, { id: '77', rating: 'AwaitingInspection', ratedAt: '2025-03-04', scheme: 'FHRS', businessType: 'Restaurant/Cafe/Canteen' });
    assert.equal((await lookup({ name: 'x', postcode: null })).problem, 'no postcode to ask with');
  } finally { globalThis.fetch = wasFetch; }
});
