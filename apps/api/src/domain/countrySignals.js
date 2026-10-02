/**
 * What a place's OWN text says about its country, to hold against the stamp
 * (owner, 2 Oct 2026). Iris Bay Tower is a Dubai business stamped GB because its
 * Google pin sits in Heston: the source area, the owned point's cell and the
 * geocoded address all derive from that one point, so a wrong pin is wrong three
 * times over, and nothing read the venue's own words. These are those words — a
 * check, not a rule: each signal names a country (or a currency) or says nothing.
 *
 *   - address  — any owned address whose last name is a country (domain/countryFromAddress.js)
 *   - phone    — an international prefix (+971 is the UAE); a number with none says nothing
 *   - website  — a country domain (.ae, .it); generic and vanity domains say nothing
 *   - currency — an ISO currency code in the published price range (AED, EUR, USD)
 *
 * No city is ever read as a country: "Dubai" is a city, and the check does not guess.
 */

import { countryNamedIn } from './countryFromAddress.js';

/** A country named as the address's very last component, with nothing after it — or null. */
function strictLastCountry(address) {
  const parts = String(address).split(',').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || /\d/.test(last)) return null;
  return countryNamedIn(last);
}

// Calling codes → the countries that use them. Longest prefix wins. Not every code
// on earth — the markets, their neighbours and the commonest elsewhere; a prefix not
// listed is reported as "international, unrecognised", never matched to a guess.
const CALLING = {
  1: ['US', 'CA'], 7: ['RU', 'KZ'], 20: ['EG'], 27: ['ZA'], 30: ['GR'], 31: ['NL'], 32: ['BE'], 33: ['FR'],
  34: ['ES'], 36: ['HU'], 39: ['IT', 'VA', 'SM'], 40: ['RO'], 41: ['CH'], 43: ['AT'], 44: ['GB', 'JE', 'GG', 'IM'],
  45: ['DK'], 46: ['SE'], 47: ['NO'], 48: ['PL'], 49: ['DE'], 52: ['MX'], 54: ['AR'], 55: ['BR'], 61: ['AU'],
  64: ['NZ'], 65: ['SG'], 81: ['JP'], 86: ['CN'], 90: ['TR'], 91: ['IN'], 212: ['MA'], 351: ['PT'], 352: ['LU'],
  353: ['IE'], 354: ['IS'], 356: ['MT'], 357: ['CY'], 358: ['FI'], 359: ['BG'], 385: ['HR'], 386: ['SI'],
  420: ['CZ'], 421: ['SK'], 852: ['HK'], 966: ['SA'], 971: ['AE'], 972: ['IL'], 974: ['QA'],
};

/** The countries a phone number's international prefix names, or null when it has none. */
export function phoneCountries(phone) {
  const m = String(phone ?? '').trim().match(/^(?:\+|00)\s*([\d\s().-]+)/);
  if (!m) return null; // a local number names no country
  const digits = m[1].replace(/\D/g, '');
  for (let n = 3; n >= 1; n -= 1) {
    const list = CALLING[digits.slice(0, n)];
    if (list) return list;
  }
  return ['?']; // international, but a prefix this table does not hold
}

// Two-letter domains used as generic names, not as a country.
const VANITY = new Set(['io', 'co', 'me', 'tv', 'ai', 'ly', 'fm', 'am', 'to', 'is', 'la', 'cc', 'ws', 'nu',
  'sh', 'ac', 'tk', 'gl', 'ag', 'bz', 'vc', 'sc', 'gg', 'im', 'so', 'st', 'eu', 'su', 'cx', 'li', 'mu', 'pw']);

/** The country a website's domain names (`.ae` → AE, `.uk` → GB), or null. */
export function websiteCountry(url) {
  let host;
  try { host = new URL(/^https?:\/\//i.test(String(url)) ? String(url) : `https://${url}`).hostname.toLowerCase(); } catch { return null; }
  const tld = host.split('.').pop();
  if (!/^[a-z]{2}$/.test(tld) || VANITY.has(tld)) return null;
  return tld === 'uk' ? 'GB' : tld.toUpperCase();
}

/** The ISO currency codes a published price range names (AED 399 – AED 1499 → ['AED']). */
export function currenciesIn(priceRange) {
  const s = String(priceRange ?? '');
  const codes = new Set((s.match(/\b(AED|EUR|USD|CHF|AUD|CAD|JPY|INR|SAR|QAR|TRY|DKK|SEK|NOK|PLN|CZK|HUF|GBP)\b/g) ?? []));
  if (s.includes('€')) codes.add('EUR');
  if (s.includes('£')) codes.add('GBP');
  return [...codes];
}

/**
 * Every owned signal that disagrees with the stamped country. `currencyOf` maps a
 * country to its market currency (null where Epic has no market for it — then the
 * currency signal cannot speak).
 */
export function disagreements({ country, addresses = [], phone, website, priceRange }, currencyOf = () => null) {
  const out = [];
  const stamp = String(country || '').toUpperCase();
  if (!stamp) return out;
  // Addresses come as { source, value }. The geocoder's own format is read by its
  // rule (domain/countryFromAddress.js); anyone else's ends with a town as often as
  // a country, so it counts only when its very last component, with nothing after,
  // is a country's name — "…, Lebanon" alone is not read (Codex).
  for (const a of addresses) {
    const value = typeof a === 'string' ? a : a?.value;
    const source = typeof a === 'string' ? 'nominatim' : a?.source;
    if (!value) continue;
    const named = source === 'nominatim' ? countryNamedIn(value) : strictLastCountry(value);
    if (named && named !== stamp) { out.push({ signal: 'address', says: named, evidence: value, source }); break; }
  }
  // Only a conclusive phone objects: the stamp must have a calling code this table
  // holds, and the number a recognised prefix that is not one of its countries'.
  // An unrecognised prefix, or a stamp the table does not cover, says nothing (Codex).
  const p = phoneCountries(phone);
  const stampHasCode = Object.values(CALLING).some((list) => list.includes(stamp));
  if (p && !p.includes('?') && stampHasCode && !p.includes(stamp)) out.push({ signal: 'phone', says: p.join('/'), evidence: phone });
  const w = websiteCountry(website);
  if (w && w !== stamp) out.push({ signal: 'website', says: w, evidence: website });
  const mine = currencyOf(stamp);
  const named = currenciesIn(priceRange);
  if (mine && named.length && !named.includes(mine)) out.push({ signal: 'currency', says: named.join('/'), evidence: priceRange });
  return out;
}
