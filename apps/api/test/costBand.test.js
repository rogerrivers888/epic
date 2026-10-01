/**
 * The place-page cost scale (domain/costBand.js; Markets M5/M6, increment 4).
 *
 * The band comes from Google's price level (V1 signal, not the destination —
 * docs/markets.md §3.3); a place with no level has no band and reads "not known
 * yet", never Free.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleFor, bandIndexForLevel, bandIndexForPrice, bandIndexForChoice, COST_CHOICES, rangeText, money, costBandFor, fillDefinition } from '../src/domain/costBand.js';

test('an owned admission choice fills the scale index it lines up with', () => {
  assert.deepEqual(COST_CHOICES, ['free', 'cheap', 'moderate', 'expensive']);
  assert.equal(bandIndexForChoice('free'), 0);
  assert.equal(bandIndexForChoice('cheap'), 1);
  assert.equal(bandIndexForChoice('moderate'), 2);
  assert.equal(bandIndexForChoice('expensive'), 3);
  assert.equal(bandIndexForChoice('nonsense'), null);
  assert.equal(bandIndexForChoice(null), null);
});

// The GB bands from migration 300, half-open [min, max) in pence.
const GB_BANDS = [
  { symbol: 'Free', min: 0, max: 0 },
  { symbol: '£', min: 1, max: 1000 },
  { symbol: '££', min: 1000, max: 2500 },
  { symbol: '£££', min: 2500, max: null },
];

test('an owned admission price fills the band its money lands in', () => {
  assert.equal(bandIndexForPrice(0, GB_BANDS), 0, 'free is Free, exactly nought');
  assert.equal(bandIndexForPrice(1, GB_BANDS), 1, 'a penny is £');
  assert.equal(bandIndexForPrice(999, GB_BANDS), 1, 'just under the ££ floor is £');
  assert.equal(bandIndexForPrice(1000, GB_BANDS), 2, 'the ££ floor is ££ (half-open)');
  assert.equal(bandIndexForPrice(2499, GB_BANDS), 2);
  assert.equal(bandIndexForPrice(2500, GB_BANDS), 3, 'the £££ floor is £££');
  assert.equal(bandIndexForPrice(10000, GB_BANDS), 3, 'an unbounded top band');
  assert.equal(bandIndexForPrice(null, GB_BANDS), null, 'no price → no band');
  assert.equal(bandIndexForPrice(500, null), null, 'no bands → no band');
  assert.equal(bandIndexForPrice(500, []), null);
  assert.equal(bandIndexForPrice(-5, GB_BANDS), null, 'a negative is not a price');
  assert.equal(bandIndexForPrice('nope', GB_BANDS), null);
});

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
  // The query is client-controlled: a non-integer, a negative, or out of range
  // is not a Google level, so it is "not known" — never Free, never a
  // fractional index that fills no step (Codex).
  assert.equal(bandIndexForLevel(1.5), null, 'a fractional level is not a level');
  assert.equal(bandIndexForLevel(-1), null, 'a negative is not Free');
  assert.equal(bandIndexForLevel(5), null, 'above 4 is not a level');
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

test('costBandFor: known only with a level AND a market AND that market\'s bands', () => {
  const gb = { name: 'United Kingdom', currency: 'GBP', cost_bands: [
    { symbol: 'Free', min: 0, max: 0 }, { symbol: '£', min: 1, max: 1000 },
    { symbol: '££', min: 1000, max: 2500 }, { symbol: '£££', min: 2500, max: null },
  ] };
  // The happy path: a level, a market, bands — a known band with its range.
  assert.deepEqual(costBandFor(gb, 2),
    { known: true, scale: ['Free', '£', '££', '£££'], index: 2, band: '££', currency: 'GBP', range: '£10–25' });
  // Free is known, with no money sentence (range null) — not "unknown".
  assert.deepEqual(costBandFor(gb, 0),
    { known: true, scale: ['Free', '£', '££', '£££'], index: 0, band: 'Free', currency: 'GBP', range: null });
  // No level → not known yet (never Free).
  assert.deepEqual(costBandFor(gb, null), { known: false });
  // No market at all → not known yet.
  assert.deepEqual(costBandFor(null, 2), { known: false });
  // A market whose bands are not set (Portugal, Greece, Turkey, the UAE are all
  // seeded null) → not known yet, never a symbol scale with no meaning (Codex).
  assert.deepEqual(costBandFor({ name: 'Portugal', currency: 'EUR', cost_bands: null }, 2), { known: false });
  assert.deepEqual(costBandFor({ name: 'Greece', currency: 'EUR', cost_bands: [] }, 2), { known: false });
});

test('fillDefinition keeps a $-currency band whole (the live US "$$"→"$" bug)', () => {
  // A $-currency band is the case String.replace mangled: "$$" in a replacement
  // string is the escape for a single "$". split/join keeps it literal.
  assert.equal(
    fillDefinition('In {market}, {band} means {range} a person', { market: 'United States', band: '$$', range: '$15–40' }),
    'In United States, $$ means $15–40 a person');
  assert.equal(
    fillDefinition('{band} means {range} a person', { band: '$$$', range: 'over $40' }),
    '$$$ means over $40 a person');
  // And it still fills the £/€ markets it always did.
  assert.equal(
    fillDefinition('{band} means {range} a person', { band: '££', range: '£10–25' }),
    '££ means £10–25 a person');
  assert.equal(
    fillDefinition('In {market}, {band} means {range} a person', { market: 'Ireland', band: '€€', range: '€12–30' }),
    'In Ireland, €€ means €12–30 a person');
});

test('money formats minor units in the market currency', () => {
  assert.equal(money(1000, 'GBP'), '£10');
  assert.equal(money(1250, 'EUR'), '€12.50');
  assert.equal(money(1500, 'USD'), '$15');
});
