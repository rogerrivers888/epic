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
import { LINES } from '../src/sources/pricing.js';

/** The list price of one line, from the one cost model there is. */
const listPrice = (key) => LINES.find((l) => l.key === key)?.allowance?.beyondUsd ?? 0;

test('a meter with a price becomes money', () => {
  // Read from `sources/pricing.js`, never retyped: a second copy of the prices
  // had already drifted to about half the real ones, and the ceiling is a sum of
  // them (Codex, 17 Sep 2026).
  assert.equal(costOf({ google: 1 }), listPrice('google'));
  assert.equal(costOf({ google: 10 }), Math.round(listPrice('google') * 10 * 1e6) / 1e6);
  // One Tripadvisor view bills two locations, at its own list price — and it is
  // *also* bounded by a hard monthly count, which is the limit that actually
  // stops it.
  assert.equal(costOf({ tripadvisor: 2 }), Math.round(listPrice('tripadvisor') * 2 * 1e6) / 1e6);
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
  // And every price is the model's, so the two cannot drift apart again.
  for (const [key, usd] of Object.entries(PRICE_PER_UNIT_USD)) assert.equal(usd, listPrice(key));
});

test('several providers on one meter add up', () => {
  assert.equal(
    costOf({ google: 2, 'google-routes': 4, osm: 100 }),
    Math.round((listPrice('google') * 2 + listPrice('google-routes') * 4) * 1e6) / 1e6,
  );
});

test('a meter handed over as JSON text is priced the same as an object', () => {
  // `/api/places/suggest` serialises its meter before recording. Only the
  // object form used to be priced, so those Google calls went into the ledger
  // at no cost and the monthly ceiling could not see them (Codex, 17 Sep 2026).
  assert.equal(costOf(JSON.stringify({ google: 3 })), costOf({ google: 3 }));
  assert.equal(unitsOf(JSON.stringify({ tripadvisor: 2 }), 'tripadvisor'), 2);
  // And something that is not JSON at all is nought rather than a throw.
  assert.equal(costOf('not json'), 0);
});

test('a bare count is priced against the provider that was called', () => {
  // `logRouting` passes a number of Routes calls, not a keyed meter. Those rows
  // went into the ledger at no cost, so routing spend was invisible to the
  // ceiling (Codex, 17 Sep 2026).
  assert.equal(costOf(4, 'google-routes'), costOf({ 'google-routes': 4 }));
  assert.equal(costOf('4', 'google-routes'), costOf({ 'google-routes': 4 }));
  // A number with nobody to attribute it to is not guessed at.
  assert.equal(costOf(4), 0);
});
