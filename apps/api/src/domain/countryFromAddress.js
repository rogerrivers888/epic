/**
 * A place's country from its own address (owner, 2 Oct 2026: "Italy and the
 * Vatican, UAE for Dubai, from their owned addresses").
 *
 * Only a COUNTRY NAME is evidence, and only where an address puts one: the last
 * component that is not a code. "…, Rome, Lazio, 00153, Italy" is Italy;
 * "…, Vatican City, 00120" is the Vatican (VA — its own country, never Italy);
 * "Iris Bay Tower, Business Bay, Dubai, Dubai, 00000" names no country at all,
 * because Dubai is a city and 00000 is not a postcode. Nothing is inferred from a
 * city, a region or a code — a placeholder like 00000 is skipped, never read.
 *
 * Names come from the runtime's own ISO 3166 region names (Intl.DisplayNames, en),
 * plus the few local and short forms owned addresses actually use. A name that is
 * also a common sub-national place ("Georgia") is refused: in "Atlanta, Georgia"
 * it is a US state, and a wrong country is worse than none.
 */

const AMBIGUOUS = new Set(['georgia', 'jersey', 'guernsey', 'jordan', 'chad']);

const ALIASES = {
  uk: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  italia: 'IT',
  'città del vaticano': 'VA', 'citta del vaticano': 'VA', 'vatican city state': 'VA', 'holy see': 'VA', 'vatican': 'VA',
  uae: 'AE', 'u.a.e.': 'AE', 'the united arab emirates': 'AE',
  usa: 'US', 'u.s.a.': 'US', 'united states of america': 'US', us: 'US',
  'éire': 'IE', eire: 'IE', 'republic of ireland': 'IE',
  españa: 'ES', espana: 'ES', deutschland: 'DE', nederland: 'NL', 'the netherlands': 'NL',
  'ελλάδα': 'GR', hellas: 'GR', türkiye: 'TR', turkiye: 'TR', österreich: 'AT', hrvatska: 'HR',
};

// Codes that name something other than one country: reserved (UK is GB's alias,
// and its name "United Kingdom" would otherwise shadow GB), unions and unknowns.
const NOT_COUNTRIES = new Set(['UK', 'EU', 'EZ', 'UN', 'QO', 'ZZ']);

const fold = (s) => String(s).normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

const NAMES = (() => {
  const names = new Map();
  const en = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      let name;
      try { name = en.of(code); } catch { continue; }
      if (!name || name === code || NOT_COUNTRIES.has(code)) continue;
      if (!names.has(fold(name))) names.set(fold(name), code); // first code to claim a name keeps it
    }
  }
  for (const [k, v] of Object.entries(ALIASES)) names.set(fold(k), v);
  for (const k of AMBIGUOUS) names.delete(k);
  return names;
})();

/** A component that is a code, not a name: digits, or letters-and-digits (00000, SW1A 1AA, D02 X285). */
const isCode = (part) => /\d/.test(part) && !/[a-z]{4,}/i.test(part.replace(/\d/g, ''));

/** The country one address names, or null. */
export function countryNamedIn(address) {
  if (!address) return null;
  const parts = String(address).split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (isCode(parts[i])) continue;           // a postcode, a placeholder — never evidence
    return NAMES.get(fold(parts[i])) ?? null;  // the last real component, and only it
  }
  return null;
}

/**
 * The country a place's owned addresses agree on: `{ code, from }`, or
 * `{ code: null, reason }` — nothing named, or two addresses naming different
 * countries (a disagreement is not resolved by picking one).
 */
export function countryFromAddresses(addresses = []) {
  const named = addresses.map((a) => ({ address: a, code: countryNamedIn(a) })).filter((x) => x.code);
  if (!named.length) return { code: null, reason: 'no owned address names a country' };
  const codes = [...new Set(named.map((x) => x.code))];
  if (codes.length > 1) return { code: null, reason: `owned addresses disagree: ${codes.join(' / ')}` };
  return { code: codes[0], from: named[0].address };
}
