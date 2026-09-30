/**
 * Wording, from the database.
 *
 * `resolve` takes the household's own locale and — by design, so it cannot be
 * done by accident — has no parameter for a place, a market or a country. See
 * `domain/wording.js` for why that matters.
 */

import { query } from '../db.js';
import { pickWording, DEFAULT_LOCALE } from '../domain/wording.js';

/**
 * The locale a market seeds a household with when it registers there. This is
 * the ONLY place a market's wording locale is read, and it is read to seed a
 * household — never to render a place. After registration the household's own
 * `wording_locale` is the source of truth.
 */
export async function defaultLocaleForMarket(code) {
  if (!code) return DEFAULT_LOCALE;
  const { rows } = await query(
    'select default_wording_locale from markets where code = $1', [String(code).toUpperCase()]);
  return rows[0]?.default_wording_locale ?? DEFAULT_LOCALE;
}

/**
 * A household's own locale — the thing, and the only thing, that wording
 * follows. Never a place's market.
 */
export async function localeOfHousehold(householdId) {
  if (!householdId) return DEFAULT_LOCALE;
  const { rows } = await query('select wording_locale from households where id = $1', [householdId]);
  return rows[0]?.wording_locale ?? DEFAULT_LOCALE;
}

/**
 * Resolve one key for a locale. Logs a miss when en-US was asked for and only
 * en-GB is held, and still returns en-GB (register 6). The locale is the
 * household's own; there is deliberately no way to pass a place or its market.
 */
export async function resolve(namespace, key, { locale = DEFAULT_LOCALE, fallback = null, logMiss = true } = {}) {
  const { rows } = await query(
    'select en_gb, en_us from market_wording where namespace = $1 and key = $2', [namespace, key]);
  // Registration via resolve() (owner, 29 Sep 2026): a key wired into a screen
  // with its en-GB literal — the `fallback` — earns a row the first time it is
  // resolved, so the wording desk can see it and offer its American form. This
  // is how "wiring resolve() into a screen" and "registering the key" become the
  // same act; the count of registered keys grows as screens are wired. It is
  // idempotent (on conflict do nothing) so a key registers once and every later
  // resolve is a pure read, and it only fires when we actually hold the en-GB to
  // register — a key referenced with no fallback has nothing to seed the NOT NULL
  // en_gb from, so it stays a logged miss (the "referenced but never added" gap).
  if (!rows[0]?.en_gb && fallback != null) {
    await registerKey(namespace, key, fallback);
    return fallback;
  }
  const picked = pickWording(rows[0], locale);
  if (picked.miss && logMiss) await recordMiss(namespace, key, locale);
  // A key with a row renders itself; a genuinely absent key renders the caller's
  // own en-GB default so nothing ever renders blank or the key (register 6). The
  // fallback is the en-GB literal the call site already holds.
  return picked.text ?? fallback;
}

/**
 * Register a key from the en-GB literal a screen already holds, once. Idempotent
 * — on conflict it does nothing, so it never overwrites a curated en-GB, bumps a
 * version, or touches an American form; it only fills the gap where no row
 * existed. `machine_allowed` follows the namespace rule (false for collection,
 * whose copy is handwritten in every variant — register 7).
 */
async function registerKey(namespace, key, enGb) {
  await query(
    `insert into market_wording (namespace, key, en_gb, machine_allowed)
       values ($1, $2, $3, $4)
     on conflict (namespace, key) do nothing`,
    [namespace, key, enGb, namespace !== 'collection']).catch(() => null);
}

/** One up-to-the-minute record of a locale asking for a key we did not have. */
async function recordMiss(namespace, key, locale) {
  await query(
    `insert into wording_misses (namespace, key, locale) values ($1, $2, $3)
     on conflict (namespace, key, locale)
       do update set seen = wording_misses.seen + 1, last_seen = now()`,
    [namespace, key, locale]).catch(() => null);
}

/**
 * Whether a subcategory is offered in a market. Absence of a row means yes (the
 * default everywhere); a row with applicable = false is the deliberate "not
 * applicable in this market", whose count reads "not applicable here", not 0.
 *
 * This is the single point the market-aware board will call to render that count
 * (step 4/6). It is not yet wired into the count paths, which are Britain-only
 * today — the status is the settled part, the count rendering the provisional
 * part (owner, 29 Sep 2026). See docs/markets.md.
 */
export async function subcategoryApplicable(marketCode, subcategory) {
  if (!marketCode || !subcategory) return true;
  const { rows } = await query(
    'select applicable from market_subcategories where market_code = $1 and subcategory = $2',
    [String(marketCode).toUpperCase(), subcategory]);
  return rows[0]?.applicable ?? true;
}
