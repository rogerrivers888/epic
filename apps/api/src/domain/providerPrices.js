/**
 * What a billable unit costs, so the ledger holds money and not just a count.
 *
 * `provider_calls` has both `units` — what the provider bills for, counted by
 * the adapters through `sources/meter.js` — and `estimated_cost_usd`. The
 * collection paths were only writing the count, and the monthly ceiling is a
 * sum of the money. So every Google call made by Collect or Compare was
 * invisible to the limit meant to bound it, and two sequential runs could each
 * spend the whole month (Codex, 17 Sep 2026).
 *
 * A price of nought means **there is no per-call charge**, which is not the
 * same as there being no limit: Tripadvisor is licensed and bounded by a hard
 * monthly count of locations instead (`TRIPADVISOR_CAP`), and the free-tier
 * providers are bounded by their own allowances. Anything not named here is
 * priced at nought and says so rather than guessing.
 */

/**
 * US dollars per billable unit, at the list prices, for the units the adapters
 * actually meter.
 *
 * The one place these numbers live. `sources/pricing.js` reads them for the
 * `beyondUsd` it shows the owner beside each free allowance, and the ledger
 * reads them to fill `estimated_cost_usd` — so the figure on Settings › Usage
 * and the figure the monthly ceiling sums cannot drift apart. They did: a
 * second table here priced Places at $0.017 against the model's $0.032 and
 * photos at nothing, and the ceiling is a sum of these, so it was undercounted
 * by about half (Codex, 17 Sep 2026).
 *
 * This module imports nothing on purpose. It sat above `pricing.js` in the
 * graph and importing it back made a cycle that broke three test files at load
 * — the prices are the leaf, and the model that presents them is not.
 *
 * A meter key that is not here is nought, and says so rather than guessing:
 * `osm`, `fixtures` and the free tiers cannot bill.
 */
export const PRICE_PER_UNIT_USD = {
  // Places API: one billable request per Nearby Search, Text Search or Place
  // Details call, past the 5,000-a-month Pro-tier threshold.
  google: 0.032,
  // Place Photos, past 1,000 a month.
  'google-photos': 0.007,
  // Routes API, priced per element rather than per request, past 5,000.
  'google-routes': 0.01,
  // Tripadvisor: a location, past the 1,000 free for the life of the account —
  // and separately bounded by a hard monthly count, which is the limit that
  // actually stops it (`TRIPADVISOR_CAP`).
  tripadvisor: 0.015,
};

/**
 * Dollars to pounds, for the screens and the ceiling.
 *
 * The provider list prices are in dollars and everything the owner reads is in
 * pounds. One rate, in one place, so the ceiling and the boards cannot disagree
 * about what a call cost. It is a rate we choose rather than one we look up:
 * the real number is on the invoice, and this is for deciding when to look.
 */
export const USD_TO_GBP = 0.79;

/**
 * What one call's meter comes to.
 *
 * `units` is what the adapters counted — `{ google: 1 }`, `{ tripadvisor: 2 }`
 * — so a Tripadvisor view that billed two locations is two, not one.
 */
export function costOf(units, provider = null) {
  // Some callers hand over the meter as an object and some as JSON text — the
  // column is jsonb and both work for it. Only one of them used to be priced,
  // so `/api/places/suggest`'s Google calls went in at no cost and the ceiling
  // could not see them (Codex, 17 Sep 2026).
  const meter = normalise(units, provider);
  if (!meter) return 0;
  const units_ = meter;
  let usd = 0;
  for (const [key, n] of Object.entries(units_)) {
    usd += (PRICE_PER_UNIT_USD[key] ?? 0) * (Number(n) || 0);
  }
  // Six places: a tenth of a cent matters when the ceiling is £250 and the
  // calls are a penny and a half each.
  return Math.round(usd * 1e6) / 1e6;
}

/** How many of a provider's own billable units one meter records. */
export function unitsOf(units, provider) {
  const meter = normalise(units, provider);
  return meter ? Number(meter[provider]) || 0 : 0;
}

/**
 * Every shape a meter arrives in, as one object.
 *
 * Three of them, because three kinds of caller exist and all three are right in
 * their own way: an object (`{ google: 1 }`) from the adapters, JSON text from
 * the callers that stringify before recording, and a bare number from the ones
 * that only ever call one provider — `logRouting` passes a count of Routes
 * calls. That last one was priced at nought, so routing spend was invisible to
 * the ceiling (Codex, 17 Sep 2026); given the provider, a number is a count of
 * that provider's units.
 */
function normalise(units, provider) {
  if (units == null) return null;
  if (typeof units === 'number') return provider && Number.isFinite(units) ? { [provider]: units } : null;
  if (typeof units === 'string') {
    // A number that happens to have been stringified is still a number.
    const n = Number(units);
    if (units.trim() !== '' && Number.isFinite(n)) return provider ? { [provider]: n } : null;
    try {
      const parsed = JSON.parse(units);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { return null; }
  }
  return typeof units === 'object' ? units : null;
}
