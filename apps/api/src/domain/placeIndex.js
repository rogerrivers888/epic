/**
 * What "ready" means, and what a place's data score is.
 *
 * Owner, 17 Sep 2026, asked for one thing and it decides this whole module:
 * "whether we have sufficient data to meet our required user needs to be able to
 * describe the place properly."
 *
 * The trap that had to be designed out is a flat six columns. A restaurant is
 * not ready without a menu; a playground never has one and was being marked down
 * for it for ever. So the bar is **per kind of place**, held in `ready_bars`,
 * composed in the back office rather than coded, and the score is that bar's
 * weights as a share of the weights *that kind of place is actually judged on* —
 * which is why a playground holding all three of its facts scores 100 exactly as
 * a restaurant holding all four does.
 *
 * Everything here is pure and recomputed from scratch, never adjusted: the same
 * rule as `score()` next door in scoring.js. Changing the bar re-scores every
 * affected place, and the effect is stated before it saves.
 */

/**
 * The facts a bar may ask for. Six, and no more without a decision: every one of
 * them has to be answerable from something we are allowed to keep.
 */
export const FACTS = [
  { key: 'picture',    label: 'A picture we own',            short: 'Picture',
    explain: 'A photograph we own outright, not one rented from a provider.' },
  { key: 'what_it_is', label: 'A sentence saying what it is', short: 'What it is',
    explain: 'A sentence describing the place, written by us.' },
  { key: 'hours',      label: 'Opening hours',                short: 'Hours',
    explain: 'Opening hours, and when they were last checked.' },
  { key: 'menu',       label: 'A menu',                       short: 'Menu',
    explain: 'A menu we could read. Required for somewhere that serves food, never for a playground.' },
  { key: 'prices',     label: 'What it costs',                short: 'Prices',
    explain: 'Recorded when we have it. A place that is free to walk into is not judged on it.' },
  { key: 'step_free',  label: 'Step-free access',             short: 'Step-free',
    explain: 'Recorded when we have it, and only judged where getting in is the question.' },
];
export const FACT_KEYS = FACTS.map((f) => f.key);

/** What each fact is worth when a bar asks for it. */
export const FACT_WEIGHTS = { picture: 30, what_it_is: 25, hours: 20, menu: 25, prices: 15, step_free: 10 };

/**
 * The bar each kind of place starts on.
 *
 * Read as: these subcategories are judged on these facts. A fact not listed is
 * still *recorded* when we have it — it simply never counts against the score,
 * which is the distinction between a dash and `n/a` on every screen that draws
 * one of these.
 */
const DEFAULT_BARS = [
  // Somewhere that serves food is not ready without a menu.
  [['restaurants', 'pubs-bars', 'cafes', 'food-markets', 'fast-food'], ['picture', 'what_it_is', 'hours', 'menu']],
  // Somewhere you pay to get into, and where getting in is a real question.
  [['theme-parks', 'zoos-wildlife', 'castles', 'historic-houses', 'museums', 'galleries'],
   ['picture', 'what_it_is', 'hours', 'prices', 'step_free']],
  [['spas', 'gardens', 'lidos', 'cinema-bowling', 'theatre', 'live-music', 'karting', 'circuits',
    'flying', 'watersports', 'ropes', 'off-road', 'pools', 'climbing', 'skating', 'athletics',
    'racquet-clubs', 'golf', 'racecourses', 'football', 'rugby-cricket', 'arenas', 'markets'],
   ['picture', 'what_it_is', 'hours', 'prices']],
  // Open ground: there are no opening hours on a common, and no price either.
  [['parks', 'woodland', 'coast', 'water', 'hills', 'nature', 'viewpoints', 'trails', 'caves-falls', 'scenic'],
   ['picture', 'what_it_is']],
  // Everything else: a picture, a sentence and when it is open.
  [['play', 'days-out', 'ancient-sites', 'churches', 'landmarks', 'cycling', 'paddling'],
   ['picture', 'what_it_is', 'hours']],
];

/** `{ restaurants: ['picture','what_it_is','hours','menu'], … }` — the seed, not the law. */
export function defaultBars() {
  const out = {};
  for (const [keys, facts] of DEFAULT_BARS) for (const k of keys) out[k] = facts;
  return out;
}

/**
 * One place's score against its own bar.
 *
 * `bar` is the rows `ready_bars` holds for that subcategory: `[{fact, weight,
 * required}]`. `held` is which facts we actually have.
 *
 * A subcategory with no bar returns `{ set: false }` and is neither ready nor
 * scored — "not set" is a real answer and pretending it is zero would put every
 * place in a new subcategory at the bottom of every list.
 */
export function scorePlace({ bar = [], held = {} } = {}) {
  const judged = bar.filter((b) => b.required && FACT_KEYS.includes(b.fact));
  if (!judged.length) {
    return { set: false, score: null, ready: false, parts: { judged: [], held: [], missing: [], notCounted: FACT_KEYS.filter((f) => held[f]) } };
  }
  const total = judged.reduce((n, b) => n + (b.weight ?? FACT_WEIGHTS[b.fact] ?? 0), 0);
  const have = judged.filter((b) => Boolean(held[b.fact]));
  const got = have.reduce((n, b) => n + (b.weight ?? FACT_WEIGHTS[b.fact] ?? 0), 0);
  const missing = judged.filter((b) => !held[b.fact]).map((b) => b.fact);
  return {
    set: true,
    // Weighted completeness over the facts this kind of place needs, 0–100.
    score: total > 0 ? Math.round((got / total) * 100) : 0,
    // Ready is holding all of them. The bar is the definition, so nothing else
    // gets to have an opinion about it (BO2k: "every other board must agree").
    ready: missing.length === 0,
    parts: {
      judged: judged.map((b) => ({ fact: b.fact, weight: b.weight ?? FACT_WEIGHTS[b.fact] ?? 0, held: Boolean(held[b.fact]) })),
      held: have.map((b) => b.fact),
      missing,
      // Facts we happen to hold that this kind of place is not judged on. They
      // are recorded, never counted, and print as `n/a` rather than as a dash.
      notCounted: FACT_KEYS.filter((f) => held[f] && !judged.some((b) => b.fact === f)),
    },
  };
}

/** The share of a set of places that clear their own bar, as a whole percent. */
export const readyShare = (ready, total) => (total > 0 ? Math.round((ready / total) * 100) : null);

/**
 * Which of the three faults a subject is suffering from (Part D, and the demand
 * lens on Places).
 *
 * Never one conversion rate: the three have different owners and a single
 * number hides which of them it was.
 */
export function faultOf({ searches = 0, empty = 0, noClick = 0, noTrip = 0, known = 0 } = {}) {
  if (!searches) return { key: 'none', label: '—', owner: null };
  const share = (n) => n / searches;
  // Nothing held at all, and everything came back empty: a coverage hole, and
  // Collect is the only thing that fixes it.
  if (empty >= searches) return { key: 'empty-always', label: 'Came back empty, every time', owner: 'Collect', act: 'collect' };
  const worst = Math.max(share(empty), share(noClick), share(noTrip));
  const bad = [share(empty), share(noClick), share(noTrip)].filter((s) => s >= 0.2).length;
  if (worst < 0.2) return { key: 'working', label: 'Working', owner: null };
  if (bad >= 3) return { key: 'all-three', label: 'All three', owner: 'Start with Collect', act: 'collect' };
  // The long label is BO4a's column ("Which fault"); the short one is BO2f's.
  // They were sharing a word for two different columns, so a row whose bar shows
  // four of five searches answered read "No places" (Codex, 17 Sep 2026).
  if (worst === share(empty)) return { key: 'no-places', label: 'Came back empty', owner: 'Collect', act: 'collect' };
  if (worst === share(noClick)) return { key: 'wrong-places', label: 'Clicked nothing', owner: 'Categories', act: 'categories' };
  return { key: 'thin-places', label: 'Never tripped', owner: 'The data score', act: 'score' };
}

/**
 * The plain word for a lens's three faults, used where the row has room for the
 * shorter name (BO2f): No places · Wrong places · Thin places.
 */
export const SHORT_FAULT = {
  // "No places" is the plain name for the fault; the long label above says what
  // the figures did. A subject we hold nothing at all for is the first; a
  // subject we hold something for that still came back empty is the second.
  'no-places': 'No places', 'empty-always': 'No places',
  'wrong-places': 'Wrong places', 'thin-places': 'Thin places',
  'all-three': 'All three', working: 'Working', none: '—',
};
