/**
 * The place-page cost scale (domain/costBand.js; Markets M5/M6, increment 4).
 *
 * The band comes from Google's price level (V1 signal, not the destination —
 * docs/markets.md §3.3); a place with no level has no band and reads "not known
 * yet", never Free.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleFor, bandIndexForLevel, rangeText, money } from '../src/domain/costBand.js';

test('the scale is Free and three currency symbols', () => {
  assert.deepEqual(scaleFor('GBP'), ['Free', '£', '££', '£££']);
  assert.deepEqual(scaleFor('EUR'), ['Free', '€', '€€', '€€€']);
  assert.deepEqual(scaleFor('USD'), ['Free', '$', '$$', '$$$']);
});

test('a price level fills a step; no level fills none (not known yet, never Free)', () => {
  assert.equal(bandIndexForLevel(0), 0, 'level 0 is Free');
  assert.equal(bandIndexForLevel(1), 1);
  assert.equal(bandIndexForLevel(2), 2);
  assert.equal(bandIndexForLevel(3), 3);
  assert.equal(bandIndexForLevel(4), 3, 'the fourth level caps at £££');
  assert.equal(bandIndexForLevel(null), null, 'no level → no band');
  assert.equal(bandIndexForLevel(undefined), null);
  assert.equal(bandIndexForLevel(NaN), null);
});

test('the range comes from the market bands; Free and a bandless market make no money sentence', () => {
  // UK-style bands in pence: Free, £ under 1000, ££ 1000–2500, £££ over 2500.
  const bands = [
    { symbol: 'Free', min: 0, max: 0 },
    { symbol: '£', min: 1, max: 1000 },
    { symbol: '££', min: 1000, max: 2500 },
    { symbol: '£££', min: 2500, max: null },
  ];
  assert.equal(rangeText(bands, 0, 'GBP'), null, 'Free has no range');
  assert.equal(rangeText(bands, 1, 'GBP'), 'under £10');
  assert.equal(rangeText(bands, 2, 'GBP'), '£10–25');
  assert.equal(rangeText(bands, 3, 'GBP'), 'over £25');
  assert.equal(rangeText(null, 2, 'GBP'), null, 'a market with no bands makes no sentence');
});

test('money formats minor units in the market currency', () => {
  assert.equal(money(1000, 'GBP'), '£10');
  assert.equal(money(1250, 'EUR'), '€12.50');
  assert.equal(money(1500, 'USD'), '$15');
});
