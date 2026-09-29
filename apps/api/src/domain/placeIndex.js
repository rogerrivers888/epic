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
 * The facts a bar may ask for. Seven, and no more without a decision: every one
 * of them has to be answerable from something we are allowed to keep.
 *
 * `where_to_go` was added by the owner on 29 Sep 2026 as one of the basics a
 * household needs everywhere (see BASICS): a place cannot be ready with no way
 * to get to it. It reframed two of the others at the same time — `hours` is
 * "when it's open", whose answer may be "always open" or "dawn to dusk" so open
 * land is not trapped, and `where_to_go` is an arrival point (a postcode or a
 * pin — a car park or a main entrance), not a full postal address.
 */
export const FACTS = [
  { key: 'picture',    label: 'A picture we own',            short: 'Picture',
    explain: 'A photograph we own outright, not one rented from a provider.' },
  { key: 'what_it_is', label: 'A sentence saying what it is', short: 'What it is',
    explain: 'A sentence describing the place, written by us.' },
  { key: 'where_to_go', label: 'Where to go',                short: 'Where to go',
    explain: 'At least one arrival point — a postcode or a pin for a car park or a main entrance. A basic a household needs for every place, even a common.' },
  { key: 'hours',      label: "When it's open",              short: 'When open',
    explain: 'When it is open — a set of hours, or the answer that it is always open or dawn to dusk. Knowing the answer is what is required.' },
  { key: 'menu',       label: 'A menu',                       short: 'Menu',
    explain: 'A menu we could read. Required for somewhere that serves food, never for a playground.' },
  { key: 'prices',     label: 'What it costs',                short: 'Prices',
    explain: 'Recorded when we have it. A place that is free to walk into is not judged on it.' },
  { key: 'step_free',  label: 'Step-free access',             short: 'Step-free',
    explain: 'Recorded when we have it, and only judged where getting in is the question.' },
];
export const FACT_KEYS = FACTS.map((f) => f.key);

/** What each fact is worth when a bar asks for it. */
export const FACT_WEIGHTS = { picture: 30, what_it_is: 25, where_to_go: 20, hours: 20, menu: 25, prices: 15, step_free: 10 };

/**
 * The basics a household needs for *every* place, whatever its kind (owner,
 * 29 Sep 2026): somewhere to go, when it is open, a picture, and a sentence
 * saying what it is. A place cannot be ready — nor score 100 — without them,
 * however lenient its own kind's bar is.
 *
 * This is the fix for Windsor Great Park reading 100/Ready on a Commons picture
 * and a Wikipedia sentence alone: the park bar judges open ground on those two,
 * which was right for what the *kind* is judged on and wrong as a whole answer.
 * The basics are required on top of the bar; the bar still adds the kind's own
 * key facts (a menu for food, a price and step-free for somewhere ticketed).
 *
 * It does not trap genuinely open land: "when it's open" is satisfied by the
 * answer *always open*, and "where to go" by a single arrival point — so a
 * common with a car park and a known access pattern can be ready, while one we
 * hold neither for cannot, which is the honest reading.
 *
 * Reviews never count towards any of this: `held` is computed from owned sources
 * only (repositories/placeIndex.js HELD_SQL), and a question's answer only
 * counts when an owned source confirms it — a rented rating or a review is never
 * a fact here.
 */
export const BASICS = ['picture', 'what_it_is', 'where_to_go', 'hours'];

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
  [['restaurants', 'pubs-bars', 'cafes', 'food-markets', 'fast-food',
    // The food drawers section 4 created. A brewery tour and an afternoon tea
    // are both bookings with a card, and a farm shop lives or dies on what it
    // sells, so all three want a menu like the rest.
    'afternoon-tea', 'breweries-distilleries', 'farm-shops-delis'],
   ['picture', 'what_it_is', 'hours', 'menu']],
  // Somewhere you pay to get into, and where getting in is a real question.
  [['theme-parks', 'zoos-wildlife', 'castles', 'historic-houses', 'museums', 'galleries',
    // Pay at the gate, and getting in is a real question for a family.
    'water-park', 'heritage-railways', 'model-villages', 'mazes', 'county-shows', 'pick-your-own'],
   ['picture', 'what_it_is', 'hours', 'prices', 'step_free']],
  [['spas', 'gardens', 'lidos', 'cinema-bowling', 'theatre', 'live-music', 'karting', 'circuits',
    'flying', 'watersports', 'ropes', 'off-road', 'pools', 'climbing', 'skating', 'athletics',
    'racquet-clubs', 'golf', 'racecourses', 'football', 'rugby-cricket', 'arenas', 'markets',
    // With Off-road & quad biking, which is the drawer riding sat in until 237
    // gave it its own and left it with nothing to be judged on (21 Sep 2026).
    'riding-stables',
    // Everything else you book and pay for by the session.
    'miniature-golf-course', 'karaoke', 'skateboard-park', 'ski-resort', 'indoor-snow',
    'paintball-lasertag', 'paintball-center', 'adventure-sports-center', 'indoor-golf-course',
    'fishing-charter', 'cultural-center'],
   ['picture', 'what_it_is', 'hours', 'prices']],
  // Open ground: there are no opening hours on a common, and no price either.
  [['parks', 'woodland', 'coast', 'water', 'hills', 'nature', 'viewpoints', 'trails', 'caves-falls', 'scenic',
    // A marina and a splash pad have no ticket and no closing time either.
    'marina', 'splash-pads'],
   ['picture', 'what_it_is']],
  // Everything else: a picture, a sentence and when it is open.
  [['play', 'days-out', 'ancient-sites', 'churches', 'landmarks', 'cycling', 'paddling',
    // The two halves of the Landmarks split, judged the way Landmarks was.
    'monuments-memorials', 'landmarks-you-can-see'],
   ['picture', 'what_it_is', 'hours']],
];

/** `{ restaurants: ['picture','what_it_is','hours','menu'], … }` — the seed, not the law. */
export function defaultBars() {
  const out = {};
  for (const [keys, facts] of DEFAULT_BARS) for (const k of keys) out[k] = facts;
  return out;
}

/**
 * One place's score against its own bar, over the basics every place needs.
 *
 * `bar` is the rows `ready_bars` holds for that subcategory: `[{fact, weight,
 * required}]`. `held` is which facts we actually have.
 *
 * A subcategory with no bar returns `{ set: false }` and is neither ready nor
 * scored — "not set" is a real answer and pretending it is zero would put every
 * place in a new subcategory at the bottom of every list.
 *
 * Where a bar *is* set, the facts a place is judged on are the bar's own facts
 * **plus the basics** (BASICS): a picture, a sentence, where to go and when it
 * is open, required whatever the kind. So a place cannot read 100 or be ready
 * on a lenient kind bar alone (owner, 29 Sep 2026) — the fix for a park scoring
 * 100 on a picture and a sentence with no way to get there and no opening
 * answer. The weight of a fact is the bar's where the bar names it, else its
 * default.
 */
export function scorePlace({ bar = [], held = {} } = {}) {
  const barRequired = bar.filter((b) => b.required && FACT_KEYS.includes(b.fact)).map((b) => b.fact);
  // Whether this kind is judged at all: a subcategory with no bar is "not set",
  // and the basics do not conjure a bar where nobody has set one (that would put
  // every place in a brand-new drawer at the bottom of every list).
  if (!barRequired.length) {
    return { set: false, score: null, ready: false, parts: { judged: [], held: [], missing: [], missingBasics: [], notCounted: FACT_KEYS.filter((f) => held[f]) } };
  }
  const weightOf = (fact) => bar.find((b) => b.fact === fact)?.weight ?? FACT_WEIGHTS[fact] ?? 0;
  // The bar's own facts and the basics, each once, in FACT_KEYS order so the
  // board reads the same way every time.
  const judgedKeys = FACT_KEYS.filter((f) => barRequired.includes(f) || BASICS.includes(f));
  const total = judgedKeys.reduce((n, f) => n + weightOf(f), 0);
  const got = judgedKeys.filter((f) => held[f]).reduce((n, f) => n + weightOf(f), 0);
  const missing = judgedKeys.filter((f) => !held[f]);
  return {
    set: true,
    // Weighted completeness over the facts this place needs — its kind's, and
    // the basics — 0–100.
    score: total > 0 ? Math.round((got / total) * 100) : 0,
    // Ready is holding all of them. Missing one basic is enough to fail it.
    ready: missing.length === 0,
    parts: {
      judged: judgedKeys.map((f) => ({ fact: f, weight: weightOf(f), held: Boolean(held[f]), basic: BASICS.includes(f) })),
      held: judgedKeys.filter((f) => held[f]),
      missing,
      // The basics it is missing, named on their own so the place page can say
      // exactly which of the four a household needs are not there yet.
      missingBasics: missing.filter((f) => BASICS.includes(f)),
      // Facts we happen to hold that this place is not judged on. They are
      // recorded, never counted, and print as `n/a` rather than as a dash.
      notCounted: FACT_KEYS.filter((f) => held[f] && !judgedKeys.includes(f)),
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
  //
  // `known` is what tells that apart from the other reason a search comes back
  // empty — the sources fell over, or the search itself was wrong. Ignoring it
  // labelled that "No places" and sent somebody to spend a collection budget on
  // an area that already has the places (Codex, 18 Sep 2026).
  if (empty >= searches && !known) {
    return { key: 'empty-always', label: 'Came back empty, every time', owner: 'Collect', act: 'collect' };
  }
  if (empty >= searches) {
    return { key: 'empty-but-held', label: 'Came back empty, and we hold some', owner: 'The sources', act: 'sources' };
  }
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
  'empty-but-held': 'Empty, not missing',
};

/**
 * What makes a `place_records` row an *owned* place: one fact of our own.
 *
 * Any one of these is enough — a sentence we wrote, the address of their own
 * page, the hours they publish, a price band, a street, a postcode we
 * corrected, a telephone number, whether you can get in without steps, or the
 * fact that somebody curated it. An empty row is a place we have noticed and
 * not researched, and calling that owned is how 1,357 of 1,361 places came to
 * look researched on a board whose average score was ten (17 Sep 2026).
 *
 * The list lives here because five different places ask the question and they
 * have to ask it the same way: the incremental promotion, the full rebuild, the
 * migration that corrected the history, the comparison's "ours" column, and the
 * write that earns the ownership. They had already drifted once — a corrected
 * postcode counted for the rebuild and not for the promotion (Codex, 17 Sep
 * 2026).
 *
 * `name` is deliberately not on it. A name alone is a place we have heard of.
 */
export const OWNED_FACTS = [
  'summary', 'website', 'opening_hours', 'price_range', 'address', 'postcode', 'phone',
];

/** The same question in SQL, against a `place_records` row aliased as `r`. */
export const ownedRecordSql = (alias = 'r') => `(
  coalesce(${OWNED_FACTS.map((f) => `${alias}.${f}`).join(', ')}) is not null
  or ${alias}.accessibility <> '{}'::jsonb
  or ${alias}.curated_at is not null
)`;

/** And in JavaScript, against a row already read. */
export const holdsAnOwnedFact = (r) => Boolean(r) && (
  OWNED_FACTS.some((f) => r[f] != null)
  || (r.accessibility && Object.keys(r.accessibility).length > 0)
  || r.curated_at != null
);
