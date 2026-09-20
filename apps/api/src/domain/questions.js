/**
 * Question sets, and the words a harvest notices.
 *
 * Brief: "Epic — Question sets and the vocabulary harvest", 20 September 2026.
 * One sentence governs the whole module: *an open question produces sprawl and
 * a closed one produces something comparable.* Two water parks asked the same
 * eight questions can be put side by side; two water parks freely described
 * cannot.
 *
 * Everything here is pure. The queries are in `repositories/questionSets.js`
 * and the calls are in `sources/vocabulary.js`, so the two things that decide
 * whether this works at all — what counts as a candidate phrase, and when a
 * subcategory has been sampled enough — can be tested without a database or a
 * provider.
 *
 * The normaliser is `domain/hostSkills.js normalise`, deliberately: Epic has
 * one, it is exercised by the host queue every day, and a second one would
 * drift from it inside a month. *wave machine*, *wavemachine* and *Wave
 * Machines* have to collapse before an administrator sees them.
 */

import { normalise } from './hostSkills.js';

export { normalise };

/** The shapes an answer can take, which are the shapes our labels already have. */
export const SHAPES = ['yesno', 'range', 'oneof'];

/**
 * The answer shape is the label's, never the question's.
 *
 * A question names an entry in `place_attributes` and that entry already says
 * how it is answered — yes/no, a range, one of a list. Storing the shape again
 * on the question would let the two disagree, and then a screen would have to
 * pick a winner.
 */
export const shapeOf = (attribute) => (SHAPES.includes(attribute?.kind) ? attribute.kind : 'yesno');

/** The three answers a place can give. The middle one is the one that gets lost. */
export const ANSWERED = 'answered';
export const NOTHING_FOUND = 'asked_nothing_found';

/**
 * The sources that may answer a question.
 *
 * The provenance rule, in one array: **Google may raise a candidate word;
 * Google may never answer a question about a place.** A fact is kept only when
 * a source Epic owns or may freely read confirms it, which is what makes the
 * provenance line — "Wave machine · from coralreef.co.uk · checked 12 Sep" — a
 * real sentence rather than a formality. The database carries the same list as
 * a check constraint (migration 207); this is for refusing earlier, with a
 * sentence somebody can act on.
 */
export const OWNED_SOURCES = ['site', 'osm', 'wikipedia', 'wikidata', 'fsa', 'atlas', 'household', 'hand'];
/** Sources that may raise a word and never answer for a place. */
export const RENTED_SOURCES = ['google', 'tripadvisor'];
export const mayAnswer = (source) => OWNED_SOURCES.includes(String(source ?? ''));

// ---------------------------------------------------------------------------
// Candidate phrases
// ---------------------------------------------------------------------------

/**
 * Words that cannot be a fact about a place.
 *
 * This is not a frequency filter — the brief is explicit that the harvester
 * does not filter by frequency, because "lockers 19 of 20" beside "wave
 * machine 2 of 20" is exactly what makes materiality obvious to a human. It is
 * a grammar filter: function words, and the handful of evaluative words that
 * carry no fact at all. *Busy*, *queue* and *lockers* are **not** here on
 * purpose — they are real things about a place, they will score as common, and
 * deciding they are not worth asking is a person's job in front of a screen.
 */
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'at', 'by', 'for', 'with', 'about', 'into', 'from', 'to', 'in',
  'on', 'off', 'out', 'over', 'under', 'again', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'would', 'could', 'now', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'it', 'its', 'this',
  'that', 'these', 'those', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'i', 'me', 'my', 'he', 'she',
  'his', 'her', 'him', 'who', 'whom', 'which', 'what', 'as', 'also', 'get', 'got', 'go', 'went', 'one', 'two',
  // Evaluative, and evaluation is the Epic score's job rather than a question's.
  'good', 'great', 'nice', 'lovely', 'amazing', 'excellent', 'brilliant', 'poor', 'bad', 'worst', 'best', 'better',
  'really', 'definitely', 'absolutely', 'well', 'lot', 'lots', 'bit', 'much', 'many', 'quite', 'pretty', 'super',
  'love', 'loved', 'like', 'liked', 'enjoy', 'enjoyed', 'recommend', 'recommended', 'review', 'reviews',
  'reviewers', 'visitors', 'people', 'say', 'said', 'says', 'mention', 'mentioned', 'note', 'noted', 'describe',
  'described', 'place', 'places', 'venue', 'thing', 'things', 'time', 'times', 'day', 'days', 'year', 'years',
  // Filler the first sweep actually raised: "located", "during", "yes" (from a
  // tag value), "photo" (from a fact's field name). None of them is a feature
  // of anywhere. `open` is deliberately *not* here — "open air" is a real
  // answer to a real question, and a stopword would cut the phrase in half.
  'during', 'located', 'include', 'including', 'includes', 'featuring', 'known', 'available',
  'offer', 'offers', 'yes', 'photo', 'photos', 'image', 'images', 'see', 'find', 'found',
  'make', 'made', 'use', 'used', 'need', 'needs', 'come', 'comes', 'way', 'back',
  // The sources' own names, which arrive in the material because a fact
  // records where it came from. "wikipedia newbury" is not a feature of a
  // castle.
  'wikipedia', 'wikidata', 'openstreetmap', 'osm', 'google', 'tripadvisor', 'commons',
]);

/**
 * A token that could be part of the name of something.
 *
 * Anything with a digit in it is thrown away, and that is not fussiness: the
 * first sweep raised `rg18 0tb`, `q109607` and `q1785071 q109607 q23413` as
 * candidate features of a castle. A postcode and a Wikidata Q-number are
 * identifiers that happen to be sitting in the material, and a harvest that
 * offers them to a human to promote is a harvest nobody will read to the end.
 * No feature of a place is named with a digit in it that a question could not
 * be asked without.
 */
const isWord = (t) => t.length > 2 && !STOPWORDS.has(t) && !/\d/.test(t);

/** The longest phrase worth raising. Beyond three words it is a sentence, not a feature. */
export const MAX_PHRASE_WORDS = 3;

/**
 * The candidate phrases in a piece of text.
 *
 * Runs of words with no stopword in them, cut into one-, two- and three-word
 * phrases. The stopwords are the cut points rather than a post-filter, so
 * "a toddler pool and a splash area" yields *toddler*, *pool*, *toddler pool*,
 * *splash*, *area*, *splash area* and never *pool and a splash*.
 *
 * Returns a Map of the normalised key to the first raw form it was seen as, so
 * the candidate row can show an administrator the words as somebody wrote
 * them while still collapsing the spellings.
 */
export function phrasesIn(text) {
  const found = new Map();
  const source = String(text ?? '');
  const clean = source
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}'’\-\s.!?;,]+/gu, ' ');
  if (!clean.trim()) return found;
  let run = [];
  const flush = () => {
    for (let n = 1; n <= MAX_PHRASE_WORDS; n += 1) {
      for (let i = 0; i + n <= run.length; i += 1) {
        const raw = run.slice(i, i + n).join(' ');
        const norm = normalise(raw);
        if (!norm || norm.length < 3) continue;
        if (!found.has(norm)) found.set(norm, raw.toLowerCase());
      }
    }
    run = [];
  };
  for (const token of clean.split(/\s+/)) {
    const t = token.toLowerCase().replace(/^[-'’]+|[-'’.,!?;]+$/g, '');
    // Punctuation ends a run as surely as a stopword does: a phrase may not
    // span a full stop, or "the pool. Parking is free" becomes "pool parking".
    const punctuated = /[.!?;,]/.test(token);
    if (isWord(t)) { run.push(t); if (punctuated) flush(); } else flush();
    if (run.length > 60) flush();
  }
  flush();
  return found;
}

/**
 * The phrases in a piece of text, each with what the text *did* to it.
 *
 * The same extraction as `phrasesIn`, plus the polarity read from the clause
 * the phrase sits in — the one thing that cannot be recovered once the text
 * is discarded, which for a rented summary is immediately.
 */
export function phrasesWithPolarity(text) {
  const out = new Map();
  for (const [norm, raw] of phrasesIn(text)) {
    out.set(norm, { raw, polarity: polarityOf(text, raw) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Polarity: asserted, denied, or merely asked
// ---------------------------------------------------------------------------

/**
 * What a sentence does to the thing it mentions.
 *
 * Brief §5.1, settled 20 September 2026: *"Does it have a wave machine? We
 * couldn't find one"* mentions the feature and means the opposite. **"It
 * cannot be recovered later, so capture it at extraction or not at all"** —
 * once the text is discarded, which for a rented summary is within
 * milliseconds of it arriving, there is nothing left to re-read.
 *
 * Read from the clause the phrase sits in rather than the whole passage: a
 * summary that says a place has a flume and no toddler pool is one sentence
 * with two different answers in it.
 */
export const ASSERTS = 'asserts';
export const DENIES = 'denies';
export const ASKS = 'asks';

/** "no wave machine", "not step free", "without a toddler pool", "the lido closed". */
const DENIAL = /\b(no|not|never|without|lacks?|lacking|missing|nothing|none|neither|nor|closed|removed|gone|no longer|isn'?t|aren'?t|doesn'?t|don'?t|didn'?t|wasn'?t|weren'?t|hasn'?t|haven'?t|couldn'?t|can'?t)\b/i;
/** "does it have…", "is there…", "anyone know if…" — anything that is a question. */
const ENQUIRY = /\?|\b(does|do|is there|are there|was there|were there|has it|have they|anyone know|any idea|wondering|wonder if)\b[^.!?]*$/i;

/**
 * The clause a phrase sits in, which is as much as polarity can honestly be
 * read from.
 */
export function clauseAround(text, phrase) {
  const haystack = String(text ?? '');
  const needle = String(phrase ?? '');
  const at = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return haystack;
  const before = haystack.slice(0, at);
  const after = haystack.slice(at);

  // Breaks on the left: the end of the previous claim. " and " is one of them
  // — "a flume and no toddler pool" is two claims, and reading it whole marks
  // the flume as denied.
  let start = 0;
  for (const mark of ['.', '!', '?', ';', ',', ' but ', ' although ', ' though ', ' however ', ' and ', ' with ', ' plus ']) {
    const i = before.lastIndexOf(mark);
    if (i >= 0) start = Math.max(start, i + mark.length);
  }

  // Breaks on the right: the start of the next claim. A question mark belongs
  // to this clause rather than the next one — cutting it off would turn an
  // enquiry into an assertion.
  let end = after.length;
  for (const mark of ['.', '!', ';', ',', ' but ', ' and ', ' with ', ' plus ', ' as well as ']) {
    const i = after.indexOf(mark, needle.length);
    if (i >= 0) end = Math.min(end, i);
  }
  const q = after.indexOf('?', needle.length);
  if (q >= 0) end = Math.min(end, q + 1);

  return `${before.slice(start)}${after.slice(0, end)}`.trim();
}

/**
 * Asserted, denied or asked, for one phrase in one piece of text.
 *
 * The order matters: a question that also contains a negation ("does it have a
 * wave machine? we couldn't find one") is an enquiry rather than a denial,
 * because somebody wondering is weaker evidence than somebody saying no. Both
 * are the opposite of evidence that it is there, which is the distinction that
 * had to survive.
 */
export function polarityOf(text, phrase) {
  const clause = clauseAround(text, phrase);
  if (ENQUIRY.test(clause)) return ASKS;
  if (DENIAL.test(clause)) return DENIES;
  return ASSERTS;
}

// ---------------------------------------------------------------------------
// Kind: a feature, a condition, an opinion, or not yet known
// ---------------------------------------------------------------------------

export const KINDS = ['feature', 'condition', 'opinion', 'unclear'];

/**
 * Words that are plainly not a question about a place, without asking anybody.
 *
 * Brief §5.1: only features are candidates. *Busy at weekends* is a condition
 * and *rude staff* is an opinion, and neither is something a place either has
 * or has not got — an opinion is the Epic score's job. This first pass is in
 * code and free; a word it cannot call goes to the classifier, and a word the
 * classifier cannot call goes to the holding pen rather than being guessed at.
 */
const OPINION_WORDS = /\b(rude|friendly|helpful|unhelpful|welcoming|attentive|slow|quick|clean|dirty|filthy|tired|dated|shabby|charming|overpriced|expensive|cheap|value|bargain|disappointing|impressive|stunning|beautiful|ugly|boring|magical|worth|rubbish|awful|terrible|fantastic|wonderful|perfect|horrible|favourite|highlight)\b/i;
const CONDITION_WORDS = /\b(busy|quiet|crowded|packed|rammed|empty|queue|queuing|wait|waiting|weekend|weekday|holiday|holidays|peak|season|seasonal|rain|rainy|sunny|weather|early|late|morning|afternoon|evening|sold out|refurbishment|maintenance)\b/i;

/** The kind this phrase plainly is, or null where a model has to decide. */
export function plainKindOf(norm) {
  const w = String(norm ?? '');
  if (OPINION_WORDS.test(w)) return 'opinion';
  if (CONDITION_WORDS.test(w)) return 'condition';
  return null;
}

/**
 * Does a word tell two places apart?
 *
 * Brief §5.3: "4 of 20 is a find; 20 of 20 is a definition of the category,
 * not a question about a place. Gates and age signals are exempt." Returned
 * rather than acted on — promotion is a human act on a reviewed list, and this
 * is what that list sorts and marks by.
 */
export const DISCRIMINATES = { floor: 0.02, ceiling: 0.9 };
export function discriminates(share, { gate = false, ageSignal = false } = {}) {
  if (gate || ageSignal) return true;
  if (share == null) return false;
  return share >= DISCRIMINATES.floor && share <= DISCRIMINATES.ceiling;
}

/**
 * The words that are common and essential at once.
 *
 * The design brief's two exceptions that must not be sorted away: a gate is
 * decisive for the people who need it at any frequency, and an age signal sets
 * the age range whether or not it is rare. Marked here so a screen can lift
 * them above the sort rather than bury them under it.
 */
const GATE_WORDS = /\b(step.?free|level access|wheelchair|accessible|disabled|hearing loop|induction loop|ramp|lift|braille|changing places|blue badge|assistance dog|guide dog|hoist|adapted)\b/i;
const AGE_WORDS = /\b(toddler|baby|babies|infant|pushchair|pram|buggy|high.?chair|baby chang|nappy|soft play|teen|teenager|adult only|family)\b/i;
export const gateWord = (norm) => GATE_WORDS.test(String(norm ?? ''));
export const ageWord = (norm) => AGE_WORDS.test(String(norm ?? ''));

/**
 * The tags on the open map, as candidate phrases.
 *
 * OSM is the best material the harvest has and it needs no language model to
 * read: `leisure=water_park` *is* the phrase "water park", and
 * `changing_table=yes` is "changing table". A tag whose value is a free-text
 * name or a number says nothing about the kind of place, so only the value
 * vocabulary is read — `yes`/`true` takes the key's own words, anything else
 * takes the value's.
 */
const TAG_SKIP = new Set([
  'name', 'note', 'description', 'source', 'operator', 'brand', 'ref', 'website', 'url', 'phone', 'email',
  'addr:street', 'addr:city', 'addr:postcode', 'addr:housenumber', 'wikidata', 'wikipedia', 'fhrs:id', 'opening_hours',
]);
export function phrasesInTags(tags = {}) {
  const found = new Map();
  for (const [key, value] of Object.entries(tags ?? {})) {
    const k = String(key);
    if (TAG_SKIP.has(k) || k.startsWith('addr:') || k.startsWith('source:') || k.startsWith('name:')) continue;
    const v = String(value ?? '').trim().toLowerCase();
    if (!v || v === 'no' || v === 'false') continue;
    // `key=yes` means the key is the fact; `key=something` means the value is.
    const words = v === 'yes' || v === 'true'
      ? k.replace(/[:_]+/g, ' ')
      : `${v.replace(/[;_]+/g, ' ')}`;
    for (const [norm, raw] of phrasesIn(words)) if (!found.has(norm)) found.set(norm, raw);
  }
  return found;
}

/**
 * One place's candidate words, from everything free we hold about it.
 *
 * Each entry says which source raised it, because a word confirmed by the open
 * map *and* the venue's own page is stronger than one that appeared in a
 * single review summary — and because a word raised by Google alone is a word
 * that still has to be answered from somewhere else entirely.
 */
export function candidatesFor({ tags = null, texts = [] } = {}) {
  const out = new Map();
  const add = (norm, raw, source, polarity) => {
    const seen = out.get(norm) ?? { norm, raw, sources: new Set(), asserts: 0, denies: 0, asks: 0 };
    seen.sources.add(source);
    seen[polarity] += 1;
    out.set(norm, seen);
  };
  // A tag is an assertion by construction: `changing_table=yes` is the open map
  // saying there is one, and `=no` never reaches here (`phrasesInTags`).
  if (tags) for (const [norm, raw] of phrasesInTags(tags)) add(norm, raw, 'osm', ASSERTS);
  for (const { source, text } of texts) {
    if (!text) continue;
    for (const [norm, { raw, polarity }] of phrasesWithPolarity(text)) add(norm, raw, source, polarity);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Saturation
// ---------------------------------------------------------------------------

/**
 * How many new words the next ten places are still teaching us.
 *
 * The brief asks for the curve rather than a verdict: "Report the curve per
 * subcategory — it is how we know whether twenty was the right number or
 * whether some subcategories need forty." A subcategory whose last ten places
 * taught three new words is done; one still teaching fifteen was sampled too
 * thinly and should be told so rather than quietly accepted.
 *
 * `perPlace` is the list of normalised keys each sampled place raised, in the
 * order they were sampled.
 */
export const SATURATION_STEP = 10;
export const SATURATED_AT = 3;

export function saturation(perPlace = [], { step = SATURATION_STEP, threshold = SATURATED_AT } = {}) {
  const seen = new Set();
  const curve = [];
  let fresh = 0;
  perPlace.forEach((words, i) => {
    for (const w of words ?? []) {
      if (seen.has(w)) continue;
      seen.add(w);
      fresh += 1;
    }
    if ((i + 1) % step === 0) {
      curve.push({ places: i + 1, newWords: fresh });
      fresh = 0;
    }
  });
  // The tail, so a sample of 23 does not silently report on 20.
  const tail = perPlace.length % step;
  if (tail) curve.push({ places: perPlace.length, newWords: fresh, partial: tail });
  const last = curve.filter((c) => !c.partial).at(-1) ?? curve.at(-1) ?? null;
  return {
    places: perPlace.length,
    distinct: seen.size,
    curve,
    // Saturated only on a full step: a partial last block of three places
    // teaching two words is not evidence of anything.
    //
    // And never on an empty sample. Twenty places that taught nothing because
    // there was nothing to read about them are not a subcategory we have
    // finished with — they are the one that most needs the next pass, and the
    // first run reported twenty-one of them as "saturated".
    saturated: Boolean(last && !last.partial && last.newWords < threshold && seen.size > 0),
    nothingToRead: seen.size === 0,
    threshold,
  };
}

// ---------------------------------------------------------------------------
// The sample
// ---------------------------------------------------------------------------

/**
 * Twenty places per subcategory: twelve top, eight mid-tail.
 *
 * The brief's reasoning, kept because it is the argument rather than the
 * number: review count correlates with how much has been written, so
 * top-reviewed gives rich text — "but an all-top-reviewed sample only teaches
 * you the vocabulary of large commercial venues; you would learn *wave
 * machine* and never learn what a small lido is called."
 *
 * **What counts as mid-tail** (brief §8, "pick something reproducible and
 * record it"): places are ordered by the Epic score, which is ours and is
 * derived from Google's rating and review count among other things — we hold
 * no review count of our own and are not allowed to. Top is the first twelve
 * of that ordering. Mid-tail is eight taken at even intervals from the 40th to
 * the 80th percentile of the same ordering, which is reproducible from the
 * ordering alone and moves with the subcategory rather than with a fixed
 * review-count band that would mean something different for churches and for
 * theme parks.
 */
export const SAMPLE = { top: 12, mid: 8, band: [0.4, 0.8] };

export function pickSample(ranked = [], { top = SAMPLE.top, mid = SAMPLE.mid, band = SAMPLE.band } = {}) {
  const rows = [...ranked];
  if (rows.length <= top + mid) return rows;
  const head = rows.slice(0, top);
  const [lo, hi] = band;
  const from = Math.max(top, Math.floor(rows.length * lo));
  const to = Math.max(from + 1, Math.floor(rows.length * hi));
  const window = rows.slice(from, to);
  const tail = [];
  if (window.length <= mid) tail.push(...window);
  else {
    const stride = window.length / mid;
    for (let i = 0; i < mid; i += 1) tail.push(window[Math.floor(i * stride)]);
  }
  return [...head, ...tail];
}

/**
 * Five regions, one of them coastal and one of them northern.
 *
 * "A single-region sample misses lido, tarn, ghyll, links, promenade, pier,
 * prom, strand — a real slice of UK vocabulary for a product that covers the
 * UK." These are area slugs as `place_areas` holds them, and a region with
 * nothing in the index is reported as a gap rather than quietly skipped: a
 * sample that could not reach the north is a sample that has not been taken.
 */
export const REGIONS = [
  {
    key: 'south-east',
    label: 'South East',
    areas: ['surrey', 'berkshire', 'kent', 'sussex', 'east-sussex', 'west-sussex', 'hampshire', 'oxfordshire', 'buckinghamshire'],
    anchors: ['Surrey', 'Kent'],
  },
  { key: 'london', label: 'London', areas: ['london'], anchors: ['London'] },
  {
    key: 'south-west',
    label: 'South West (coastal)',
    areas: ['bristol', 'devon', 'cornwall', 'dorset', 'somerset', 'gloucestershire'],
    anchors: ['Cornwall', 'Devon'],
  },
  {
    key: 'north',
    label: 'The North',
    areas: ['yorkshire', 'north-yorkshire', 'west-yorkshire', 'lancashire', 'cumbria', 'greater-manchester', 'merseyside', 'northumberland', 'durham', 'tyne-and-wear'],
    anchors: ['Yorkshire', 'Cumbria'],
  },
  {
    key: 'midlands',
    label: 'The Midlands',
    areas: ['west-midlands', 'warwickshire', 'derbyshire', 'nottinghamshire', 'staffordshire', 'leicestershire', 'shropshire', 'worcestershire'],
    anchors: ['Warwickshire', 'Derbyshire'],
  },
];

/** Which region an area slug belongs to, or null — the slugs `place_areas` holds. */
export function regionOfArea(slug) {
  const s = String(slug ?? '').toLowerCase();
  return REGIONS.find((r) => r.areas.includes(s))?.key ?? null;
}

/**
 * Spread a sample across the regions without letting one of them own it.
 *
 * Round-robin rather than a quota: a subcategory that only exists in three
 * regions still fills its twenty, and which regions it reached is recorded so
 * the gap is visible afterwards.
 */
export function spreadByRegion(rows = [], size, regionOf = (r) => r.region) {
  const buckets = new Map();
  for (const row of rows) {
    const key = regionOf(row) ?? 'elsewhere';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const order = [...buckets.keys()];
  const out = [];
  let i = 0;
  while (out.length < size && order.length) {
    const key = order[i % order.length];
    const bucket = buckets.get(key);
    if (bucket?.length) out.push(bucket.shift());
    else { order.splice(i % order.length, 1); continue; }
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** The value columns, in the shape the label's kind decides. Null everywhere is "nothing said". */
export const valueOf = (row) => {
  if (!row) return null;
  if (row.yesno != null) return { yesno: row.yesno };
  if (row.from_value != null || row.to_value != null) return { from: row.from_value, to: row.to_value };
  if (row.choice != null) return { choice: row.choice };
  if (row.number != null) return { number: row.number };
  return null;
};

/** Two values that are both present and not the same thing. */
export function disagree(a, b) {
  const x = valueOf(a);
  const y = valueOf(b);
  if (!x || !y) return false;
  return JSON.stringify(x) !== JSON.stringify(y);
}

/**
 * What a place has to show for one question: the answer, where it came from,
 * and whether anybody disagrees.
 *
 * Rows are every source's answer to one question. An `answered` row beats an
 * `asked_nothing_found` one — silence from the open map is not evidence
 * against the venue's own page — and two `answered` rows that differ are
 * *both* returned, marked unresolved, because the brief says not to resolve it
 * silently.
 */
export function settle(rows = []) {
  const answered = rows.filter((r) => r.state === ANSWERED && valueOf(r));
  if (!answered.length) {
    return rows.length ? { state: NOTHING_FOUND, value: null, sources: rows.map(sourceLine) } : null;
  }
  const [first, ...rest] = answered;
  const conflict = rest.find((r) => disagree(first, r)) ?? null;
  return {
    state: ANSWERED,
    value: valueOf(first),
    unresolved: Boolean(conflict),
    sources: answered.map(sourceLine),
    ...(conflict ? { other: { value: valueOf(conflict), ...sourceLine(conflict) } } : {}),
  };
}

/** The provenance line, as the design brief writes it: what was checked, where, and when. */
export const sourceLine = (row) => ({
  source: row.source,
  url: row.source_url ?? null,
  checkedAt: row.checked_at ?? null,
  confidence: row.confidence ?? null,
});

/** Whether an answer has aged past what its question allows. Null `refresh_days` never expires. */
export function stale(row, { now = Date.now(), refreshDays = null } = {}) {
  if (refreshDays == null || !row?.checked_at) return false;
  return now - new Date(row.checked_at).getTime() > refreshDays * 86_400_000;
}

// ---------------------------------------------------------------------------
// Enrichment, which is built and switched off
// ---------------------------------------------------------------------------

/**
 * When a place earns having its questions answered.
 *
 * "Once questions are approved, answering them per place is demand-driven: a
 * place is enriched when it crosses a threshold of appearances in search or
 * drawer opens." The hook exists now and does nothing: `EPIC_ENRICHMENT` is
 * unset, and the brief says to leave it that way — "Build the hook now, leave
 * it switched off. Do not batch-enrich anything."
 */
export const ENRICH_AFTER = { shown: 25, opened: 5 };
export const enrichmentOn = (env = process.env) => String(env.EPIC_ENRICHMENT ?? '').toLowerCase() === 'on';
export const earnsEnrichment = ({ shown = 0, opened = 0 } = {}, after = ENRICH_AFTER) =>
  shown >= after.shown || opened >= after.opened;
