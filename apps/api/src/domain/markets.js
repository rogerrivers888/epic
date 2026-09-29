/**
 * Markets: the idea of a country, and the door blocked ones may not pass.
 *
 * Register entry 4 (owner, 29 Sep 2026): "Google's prohibited territories are
 * enforced in code. No call may be issued for a blocked market." This constant
 * is that one source of truth — deliberately *not* rows in the `markets` table,
 * so there is no `status = 'blocked'` value that could drift out of step with
 * Google's own list. Nothing paid may be issued for a blocked market and no
 * place from one may be stored.
 *
 * Vietnam is the one that will catch someone out: a real British holiday
 * destination, and on Google's list. A blocked market must fail cleanly and
 * visibly, never as an empty result that reads as "nothing there".
 *
 * Three of the nine — Crimea, Donetsk, Luhansk — are territories within Ukraine,
 * not ISO-3166 countries, so they carry no `code` and cannot be caught by a
 * country code alone; catching them needs a geofence at the point of the call.
 * They are recorded here so the list is complete and the enforcement change
 * (its own commit, wiring this into the paid door) has the whole set to read.
 */
export const BLOCKED_MARKETS = Object.freeze([
  { code: 'CN', name: 'China' },
  { code: 'CU', name: 'Cuba' },
  { code: 'IR', name: 'Iran' },
  { code: 'KP', name: 'North Korea' },
  { code: 'SY', name: 'Syria' },
  { code: 'VN', name: 'Vietnam' },
  { code: null, name: 'Crimea',  within: 'UA', note: 'territory, not an ISO country — needs a geofence' },
  { code: null, name: 'Donetsk', within: 'UA', note: 'territory, not an ISO country — needs a geofence' },
  { code: null, name: 'Luhansk', within: 'UA', note: 'territory, not an ISO country — needs a geofence' },
]);

/** The blocked country codes, upper-cased, for a quick membership test. */
const BLOCKED_CODES = new Set(
  BLOCKED_MARKETS.map((m) => m.code).filter(Boolean).map((c) => c.toUpperCase()),
);

/**
 * Is this market's data forbidden by Google's terms?
 *
 * A country code only — the sub-national territories (Crimea, Donetsk, Luhansk)
 * are not caught here and must be fenced by position where a call is made.
 */
export function isBlockedMarket(code) {
  return Boolean(code) && BLOCKED_CODES.has(String(code).toUpperCase());
}

/** The statuses a real market row may carry. Blocked is never one of them. */
export const MARKET_STATUSES = Object.freeze(['live', 'soft', 'groundwork']);
