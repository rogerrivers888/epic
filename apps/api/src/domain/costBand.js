/**
 * The place-page cost scale (Markets design v2.2, M5/M6; increment 4).
 *
 * A four-step scale — Free · £ · ££ · £££ — with one step filled, and a
 * definition sentence built from the PLACE's market's absolute money bands.
 *
 * The band comes from Google's `priceLevel` (0–4), which is the V1 signal and
 * NOT the destination: `priceLevel` is a *relative*, food-weighted judgement,
 * so labelling it with our absolute money range is a known interim (see
 * docs/markets.md §3.3). The destination is the venue's own admission price.
 *
 * A place with no `priceLevel` has no band: the row reads "not known yet",
 * never Free, never a guess (owner, 30 Sep 2026).
 */

const CURRENCY_SYMBOL = { GBP: '£', USD: '$', EUR: '€', TRY: '₺', AED: 'AED ' };

/** The scale symbols for a market's currency: Free · £ · ££ · £££. */
export function scaleFor(currency) {
  const s = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return ['Free', s, `${s}${s}`, `${s}${s}${s}`];
}

/**
 * The scale index Google's price level fills: 0 Free, 1 £, 2 ££, 3 or 4 £££.
 * Null when there is no level — the "not known yet" case.
 */
export function bandIndexForLevel(level) {
  if (level == null || Number.isNaN(Number(level))) return null;
  const n = Number(level);
  if (n <= 0) return 0;
  return Math.min(n, 3);
}

/** A minor-unit amount (pence, cents) in a market's currency. */
export function money(minor, currency) {
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const major = minor / 100;
  return `${sym}${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

/**
 * The whole cost decision for a place, from its market and Google's price level.
 * Everything the display needs except the wording, which is the route's to
 * resolve. It is "known" only when there is a level AND a market AND that market
 * has its absolute money bands set: no level, no market, or a market with no
 * bands (Portugal, Greece, Turkey, the UAE are all seeded null) each reads "not
 * known yet" rather than a symbol scale with no monetary meaning (Codex;
 * docs/markets.md, "never a guess"). Free returns a null range — a known band
 * with no money sentence — which is not the same as unknown.
 */
export function costBandFor(market, level) {
  const index = bandIndexForLevel(level);
  if (index == null || !market) return { known: false };
  const bands = Array.isArray(market.cost_bands) ? market.cost_bands : null;
  if (!bands || !bands.length) return { known: false };
  const currency = market.currency;
  const scale = scaleFor(currency);
  return { known: true, scale, index, band: scale[index], currency, range: rangeText(bands, index, currency) };
}

/**
 * The money range for a band — "under £10", "£10–25", "over £25" — from the
 * market's own cost bands. Free and a bandless market both return null (no
 * money sentence to make).
 */
export function rangeText(bands, index, currency) {
  if (!Array.isArray(bands) || index === 0) return null;
  const b = bands[index];
  if (!b) return null;
  if (b.max == null) return `over ${money(b.min, currency)}`;
  if (b.min <= 1) return `under ${money(b.max, currency)}`;
  const hi = money(b.max, currency).replace(CURRENCY_SYMBOL[currency] ?? '', '');
  return `${money(b.min, currency)}–${hi}`;
}
