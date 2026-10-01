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
  if (level == null) return null;
  const n = Number(level);
  // Google's price level is one of 0–4 and nothing else: a non-integer, a
  // negative, or an out-of-range number is not a level (the query is
  // client-controlled), so it is "not known", never Free and never a fractional
  // index that fills no scale step (Codex).
  if (!Number.isInteger(n) || n < 0 || n > 4) return null;
  if (n === 0) return 0;
  return Math.min(n, 3);
}

/**
 * The `cost-band` label's `oneof` options (migration 246), in scale order: they line
 * up index-for-index with the Free·£·££·£££ scale, so an owned admission answer's
 * choice is turned into a band by its position here, and a price is turned into a
 * choice by `bandIndexForPrice` then this (owner, 1 Oct 2026; parks admission).
 */
export const COST_CHOICES = ['free', 'cheap', 'moderate', 'expensive'];

/** The scale index an owned admission choice fills, or null if it is not one of them. */
export function bandIndexForChoice(choice) {
  const i = COST_CHOICES.indexOf(String(choice));
  return i < 0 ? null : i;
}

/**
 * The scale index an actual admission price fills, from the market's own money
 * bands (owner, 1 Oct 2026; parks admission). This is how an OWNED admission fact —
 * a price read from a venue's own page — becomes a band, where `bandIndexForLevel`
 * turns Google's 0–4 signal into one. The bands are half-open [min, max) in minor
 * units (migration 300): a price `p` fills the band whose `min <= p < max`, a null
 * max is unbounded, and 0 is exactly Free (the Free band is {0,0} and matches no
 * paid interval). Caps at 3, like the level scale. Null when there is nothing to
 * read it against — no price, or a market with no bands.
 */
export function bandIndexForPrice(minor, bands) {
  if (minor == null || !Array.isArray(bands) || !bands.length) return null;
  const n = Number(minor);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n === 0) return 0; // Free — exactly nought, never a rounded-down cheap price
  for (let i = 0; i < bands.length; i += 1) {
    const min = Number(bands[i]?.min) || 0;
    const max = bands[i]?.max == null ? Infinity : Number(bands[i].max);
    if (n >= min && n < max) return Math.min(i, 3);
  }
  return Math.min(bands.length - 1, 3);
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
 * Fill a definition template's {market}/{band}/{range} tokens. Done by
 * split/join, not String.replace: a band or range symbol is a currency sign,
 * and `$$` in a String.replace *replacement* is the escape for a single `$`, so
 * `'{band}'.replace('{band}', '$$')` silently produced "$" — "In United States,
 * $ means $15–40" instead of "$$ means …" on the live site (owner verification,
 * 30 Sep 2026). split/join treats every value as a literal.
 */
export function fillDefinition(template, { market, band, range }) {
  return String(template)
    .split('{market}').join(market ?? '')
    .split('{band}').join(band ?? '')
    .split('{range}').join(range ?? '');
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
