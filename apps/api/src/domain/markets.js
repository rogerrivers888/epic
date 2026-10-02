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

/**
 * The market the census counts (markets step 6, owner 2 Oct 2026). The census
 * slices ONS postcode sectors and rolls up to GB outcodes, so every area count it
 * writes is a GB count — named here and passed to every write and read of
 * `area_counts`, which no longer defaults its country (migration 357). A census of
 * another market passes that market's code instead.
 */
export const CENSUS_MARKET = 'GB';

/**
 * `<column> = 'GB'` — the census market as a SQL condition, for the reads of
 * `area_counts` (markets step 6: every read names its country, or counts mix
 * across markets). Inlined, not a parameter, because several of those queries
 * build their parameter lists on the fly; safe because the value is this file's
 * own two-letter constant, checked here, never anything a caller typed.
 */
if (!/^[A-Z]{2}$/.test(CENSUS_MARKET)) throw new Error(`CENSUS_MARKET must be a two-letter code, not ${CENSUS_MARKET}`);
export const IN_CENSUS_MARKET = (column = 'country_code') => `${column} = '${CENSUS_MARKET}'`;
