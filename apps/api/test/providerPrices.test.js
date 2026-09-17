/**
 * The ledger has to hold money, not only a count.
 *
 * The monthly ceiling is a sum of `estimated_cost_usd`. Every collection path
 * recorded its calls with a meter and no price, so the calls the limit exists
 * to bound were the calls it could not see, and two sequential runs could each
 * spend the whole month (Codex, 17 Sep 2026).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_PER_UNIT_USD, costOf, unitsOf } from '../src/domain/providerPrices.js';

test('a meter with a price becomes money', () => {
  assert.equal(costOf({ google: 1 }), 0.017);
  assert.equal(costOf({ google: 10 }), 0.17);
  // One Tripadvisor view bills two locations. It has no per-call price — it is
  // bounded by a hard monthly count instead — and that is not the same as its
  // being free of limits.
  assert.equal(costOf({ tripadvisor: 2 }), 0);
  assert.equal(unitsOf({ tripadvisor: 2 }, 'tripadvisor'), 2);
});

test('a provider nobody priced is nought, and says so rather than guessing', () => {
  assert.equal(costOf({ somebody_new: 40 }), 0);
  assert.equal(costOf(null), 0);
  assert.equal(costOf({}), 0);
});

test('every priced provider is a name an adapter actually meters', () => {
  // A price under a key nothing counts is a price that never applies, which is
  // the quietest way for a ceiling to stop working.
  for (const key of Object.keys(PRICE_PER_UNIT_USD)) {
    assert.ok(/^[a-z-]+$/.test(key), `${key} is not a meter key`);
  }
  assert.ok(PRICE_PER_UNIT_USD.google > 0, 'the one provider that bills per request has a price');
});

test('several providers on one meter add up', () => {
  assert.equal(costOf({ google: 2, 'google-routes': 4, osm: 100 }), Math.round((0.017 * 2 + 0.005 * 4) * 1e6) / 1e6);
});
