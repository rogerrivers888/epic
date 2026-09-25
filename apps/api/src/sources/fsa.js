/**
 * The Food Standards Agency's hygiene register, for one place.
 *
 * Open data under the Open Government Licence v3.0, which lets us keep what
 * it says for good. The register is already the count the census is measured
 * against (`groundCounts.js`); this is the other use — one place's rating, the
 * date it was given and the register's own id, as owned facts.
 *
 * Matched on the postcode, then on the name, and it fails closed: two
 * establishments at one postcode that both look like the place is "could not
 * tell", never a guess. A place the register does not know — a castle, a
 * hill — is an honest nothing.
 */

import * as providerCalls from '../repositories/providerCalls.js';

const ROOT = 'https://api.ratings.food.gov.uk';
const HEADERS = {
  'x-api-version': '2',
  accept: 'application/json',
  'user-agent': 'Epic/0.1 (+https://github.com/rogerrivers888/epic)',
};

export const FSA_ATTRIBUTION = 'Contains Food Standards Agency data © Crown copyright and database right; Open Government Licence v3.0';

const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const postcodeOf = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '');

/** Whether two names are the same business, loosely: one holds the other's first words. */
export function sameName(a, b) {
  const x = squash(a); const y = squash(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  // The shorter name's words — up to two, ignoring the furniture — all in the
  // longer: "The Bull" is "Bull Inn", "The Crown" is "Crown & Anchor", and
  // "Sunningdale Bakery" is not "Sunningdale Golf Club".
  const words = (s) => s.split(' ').filter((w) => w && !['the', 'a', 'and', 'at', 'of', 'inn', 'restaurant', 'cafe', 'bar', 'pub'].includes(w));
  const [short, long] = [words(x), words(y)].sort((p, q) => p.length - q.length);
  const need = short.slice(0, 2);
  return need.length > 0 && need.every((w) => long.includes(w));
}

/**
 * Pick the one establishment that is this place, or say why not.
 *
 * Pure, so the matching is testable without the register.
 */
export function pick(establishments, { name, postcode }) {
  const pc = postcodeOf(postcode);
  const here = (establishments ?? []).filter((e) => postcodeOf(e.PostCode) === pc);
  if (!here.length) return { match: null, problem: 'nothing at that postcode' };
  const named = here.filter((e) => sameName(e.BusinessName, name));
  if (named.length === 1) return { match: named[0], problem: null };
  if (named.length > 1) return { match: null, problem: `${named.length} establishments at that postcode look like it` };
  if (here.length === 1 && !name) return { match: here[0], problem: null };
  return { match: null, problem: 'nothing at that postcode by that name' };
}

const factsOf = (e) => ({
  id: String(e.FHRSID),
  rating: e.RatingValue ?? null,
  ratedAt: e.RatingDate ? String(e.RatingDate).slice(0, 10) : null,
  scheme: e.SchemeType ?? null,
  businessType: e.BusinessType ?? null,
});

/**
 * Look one place up. Free, attributed like everything else, and never a guess.
 */
export async function lookup({ name, postcode, householdId = null, venueRef = null } = {}) {
  if (!postcode) return { facts: null, problem: 'no postcode to ask with' };
  const qs = new URLSearchParams({ address: String(postcode), pageSize: '10' });
  if (name) qs.set('name', String(name).slice(0, 60));
  let json;
  try {
    const res = await fetch(`${ROOT}/Establishments?${qs}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`FSA ${res.status}`);
    json = await res.json();
  } catch (err) {
    await providerCalls.record(householdId, 'fsa', 'own.hygiene', { fsa: 1 }, null, venueRef).catch(() => null);
    return { facts: null, problem: `the hygiene register: ${String(err?.message ?? err).slice(0, 80)}` };
  } finally {
    // recorded above on failure; on success below, once
  }
  await providerCalls.record(householdId, 'fsa', 'own.hygiene', { fsa: 1 }, null, venueRef).catch(() => null);
  const { match, problem } = pick(json?.establishments ?? [], { name, postcode });
  return { facts: match ? factsOf(match) : null, problem };
}
