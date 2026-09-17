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

/** US dollars per billable unit, at the published list prices. */
export const PRICE_PER_UNIT_USD = {
  // Places API, one request per Place Details or Nearby Search call.
  google: 0.017,
  // Routes API, priced per element rather than per request.
  'google-routes': 0.005,
  // Licensed and capped rather than metered in money.
  tripadvisor: 0,
  osm: 0,
  fixtures: 0,
  datathistle: 0,
  liteapi: 0,
  predicthq: 0,
  seatgeek: 0,
  ticketmaster: 0,
};

/**
 * What one call's meter comes to.
 *
 * `units` is what the adapters counted — `{ google: 1 }`, `{ tripadvisor: 2 }`
 * — so a Tripadvisor view that billed two locations is two, not one.
 */
export function costOf(units) {
  // Some callers hand over the meter as an object and some as JSON text — the
  // column is jsonb and both work for it. Only one of them used to be priced,
  // so `/api/places/suggest`'s Google calls went in at no cost and the ceiling
  // could not see them (Codex, 17 Sep 2026).
  const meter = typeof units === 'string'
    ? (() => { try { return JSON.parse(units); } catch { return null; } })()
    : units;
  if (!meter || typeof meter !== 'object') return 0;
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
  const meter = typeof units === 'string'
    ? (() => { try { return JSON.parse(units); } catch { return null; } })()
    : units;
  return meter && typeof meter === 'object' ? Number(meter[provider]) || 0 : 0;
}
