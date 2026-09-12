/**
 * Labels — everything a source says about a place, in one vocabulary.
 *
 * The owner, 12 Sep 2026: "Do we label particular attributes of a place as an
 * attribute, and then could we, for each category or subcategory, add the
 * combination of labels that determine whether that particular activity lives
 * in that particular subcategory?"
 *
 * A label is one fact, stated by one source, in that source's own words, with
 * the source's name in front: `google:museum`, `osm:tourism=museum`,
 * `wikidata:Q33506`, `tripadvisor:Museums`. Epic's own derived words are
 * labels too — `experience:museum`, `atlas:museum`, `venue:restaurant`,
 * `style:fast-food`, `flag:ticketed` — because a rule should be writable
 * against whichever rung of the ladder is the honest one: "every place Google
 * types as a stadium" and "every place we read as watching sport" are
 * different claims, and the second is true of more providers than the first.
 *
 * This file is pure and imports nothing, so the resolver in `moods.js` can
 * read it and the provider modules can be read *by* the landing code without
 * anybody going round in a circle.
 */

/**
 * Where a label can come from, in the order the screens list them. `provider`
 * is the key the sources catalogue uses (sources/catalogue.js), so the two
 * screens agree on what a provider is called.
 */
export const NAMESPACES = [
  { key: 'google', label: 'Google Places', provider: 'google', own: false,
    what: 'A place type from Google Places (New), Table A — the primary type and every secondary one' },
  { key: 'osm', label: 'OpenStreetMap', provider: 'osm', own: true,
    what: 'A tag on the open map, as key=value: amenity, tourism, leisure, historic, shop, sport, natural, attraction' },
  { key: 'wikidata', label: 'Wikidata', provider: 'wikidata', own: true,
    what: 'An "instance of" type the atlas harvest kept on the place — the Q-number, and its English name once "Name the types" has run' },
  { key: 'tripadvisor', label: 'Tripadvisor', provider: 'tripadvisor', own: false,
    what: 'A category from the Content API: the top level (Eat & Drink, Attraction) and the display names under it' },
  { key: 'ticketmaster', label: 'Ticketmaster', provider: 'ticketmaster', own: false, what: 'The classification segment on an event' },
  { key: 'seatgeek', label: 'SeatGeek', provider: 'seatgeek', own: false, what: 'A taxonomy name on an event' },
  { key: 'predicthq', label: 'PredictHQ', provider: 'predicthq', own: false, what: 'The category of an event' },
  { key: 'datathistle', label: 'Data Thistle', provider: 'datathistle', own: false, what: 'A tag on a listing' },
  { key: 'atlas', label: 'Epic — atlas category', provider: 'epic', own: true,
    what: 'The eight words the atlas uses for what a thing is (ATTRACTION_ROOTS in sources/wikimedia.js): landmark, museum, arts, outdoors, active, family, heritage, animals' },
  { key: 'experience', label: 'Epic — experience', provider: 'epic', own: true,
    what: 'The closed experience vocabulary in domain/concepts.js that every provider\'s words are read into' },
  { key: 'venue', label: 'Epic — venue category', provider: 'epic', own: true,
    what: 'What a search result is: restaurant, cafe, pub, bar, takeaway, bakery, attraction, hotel, event' },
  { key: 'style', label: 'Epic — style', provider: 'epic', own: true,
    what: 'How a food place serves: fast-food, takeaway' },
  { key: 'flag', label: 'Epic — flag', provider: 'epic', own: true,
    what: 'A yes/no a source stated: ticketed, good-for-children, not-for-children, quick-look, upmarket, reservable' },
];

export const NAMESPACE_KEYS = NAMESPACES.map((n) => n.key);
export const namespaceOf = (label) => String(label).split(':', 1)[0];

/** `google:museum` → `{ namespace: 'google', key: 'museum' }`. */
export function parseLabel(label) {
  const s = String(label ?? '').trim();
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const namespace = s.slice(0, i);
  const key = s.slice(i + 1);
  if (!NAMESPACE_KEYS.includes(namespace) || !key) return null;
  return { namespace, key };
}

/** One label, spelled the one way the tables spell it. */
export const labelOf = (namespace, key) => `${namespace}:${String(key).trim()}`;

/**
 * The set of labels a live search result carries.
 *
 * Provider words arrive on `venue.labels`, put there by the source module that
 * made the venue (google.js types, osm.js tags, tripadvisor.js categories, the
 * event sources' segments). Epic's own derived words are read off the fields
 * the rest of the app already uses, so a venue from before `labels` existed
 * still has a full set of the derived ones.
 */
export function labelsOf(venue) {
  const out = new Set();
  for (const l of venue?.labels ?? []) if (l) out.add(String(l));
  if (venue?.category) out.add(`venue:${venue.category}`);
  for (const e of venue?.experiences ?? []) if (e) out.add(`experience:${e}`);
  for (const s of venue?.styles ?? []) if (s) out.add(`style:${s}`);
  if (venue?.ticketed) out.add('flag:ticketed');
  if (venue?.goodForChildren === true) out.add('flag:good-for-children');
  if (venue?.goodForChildren === false) out.add('flag:not-for-children');
  if (venue?.quickLook) out.add('flag:quick-look');
  if (venue?.upmarket) out.add('flag:upmarket');
  if (venue?.reservable) out.add('flag:reservable');
  return [...out];
}

/** The set of labels an atlas attraction carries: its atlas word and its Wikidata types. */
export function labelsOfAtlas({ category, kinds = [], labels = [] } = {}) {
  const out = new Set(labels.filter(Boolean).map(String));
  if (category) out.add(`atlas:${category}`);
  for (const q of kinds ?? []) if (q) out.add(`wikidata:${q}`);
  return [...out];
}

/**
 * The one spelling of a combination, which is what `shelf_rules.subject` holds
 * for a `labels` rule and what `unique (scope, subject)` compares. Order and
 * repetition do not make a different rule.
 */
export function canonical(labels) {
  const clean = [...new Set((labels ?? []).map((l) => String(l ?? '').trim()).filter(Boolean))].sort();
  return { labels: clean, subject: clean.join(' + ') };
}

/**
 * Which label rules fire for this set of labels — and only the most specific
 * of them.
 *
 * A rule fires when the place carries every label it names. Among the rules
 * that fire, the ones naming the most labels are the answer: "stadium and
 * tourist attraction" beats "stadium", because it says more. Two rules of the
 * same length both fire and are combined the way every scope is combined — the
 * strongest claim per shelf, the first drawer named. Returned as subjects, in
 * the shape the chain in `moods.js` walks.
 */
export function labelHits(labelRules, labels) {
  if (!labelRules?.size) return [];
  const have = new Set((labels ?? []).map(String));
  const hits = [];
  for (const rule of labelRules.values()) {
    const need = rule?.labels ?? [];
    if (need.length && need.every((l) => have.has(l))) hits.push(rule);
  }
  if (!hits.length) return [];
  const top = Math.max(...hits.map((r) => r.labels.length));
  return hits.filter((r) => r.labels.length === top).map((r) => r.subject);
}

/**
 * Where a rule about these labels is written.
 *
 * A rule about exactly one Wikidata type, one atlas word or one experience is
 * the same thing the back office has always taught, said in the new words, so
 * it goes to that scope and keeps its place in the order — narrowest first,
 * `labels` above `kind`. Anything else — a provider's own word, or several
 * labels at once — is a `labels` rule.
 */
export function scopeFor(labels) {
  const { labels: clean, subject } = canonical(labels);
  if (clean.length === 1) {
    const one = parseLabel(clean[0]);
    if (one?.namespace === 'wikidata') return { scope: 'kind', subject: one.key, labels: clean };
    if (one?.namespace === 'atlas') return { scope: 'category', subject: one.key, labels: clean };
    if (one?.namespace === 'experience') return { scope: 'experience', subject: one.key, labels: clean };
  }
  return { scope: 'labels', subject, labels: clean };
}

/** The labels a legacy rule is about, so every rule can be shown the same way. */
export function labelsOfRule(rule) {
  if (!rule) return [];
  if (rule.scope === 'labels') return rule.labels ?? [];
  if (rule.scope === 'kind') return [`wikidata:${rule.subject}`];
  if (rule.scope === 'category') return [`atlas:${rule.subject}`];
  if (rule.scope === 'experience') return [`experience:${rule.subject}`];
  return [];
}
