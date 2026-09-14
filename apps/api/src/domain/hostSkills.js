/**
 * Host skills: the words, and the rules about them.
 *
 * Briefs: "Epic Host Skills — Claude Code" (schema, API, back office) and
 * "Epic Host Skills — design brief" with the 18-artboard handoff, both
 * 13 September 2026. One sentence governs both: **the model gets more precise
 * while the host is asked less.**
 *
 * Five fields sit behind an offer and the host is shown two of them. Tags are
 * typed; the format is picked in plain words; the browse category is *inferred
 * from the tags* and shown back for a nod; the place facet is inferred from
 * where the offer happens and offered as a suggestion; credentials are asked
 * once, elsewhere, and are a different axis entirely.
 *
 * Everything here is pure. The resolver's three passes live in
 * `repositories/hostSkills.js` because they are queries; what decides whether
 * that resolver works at all is `normalise` below.
 */

/** Up to six, said before it is hit — never a silent refusal of a seventh. */
export const TAG_CAP = 6;
/**
 * Two facets, not one: where a host holds two and one is narrower, the brief
 * says keep both and show the narrower first. More than two and the card turns
 * to soup.
 */
export const FACET_CAP = 2;

export const VOCABS = ['tag', 'facet'];
export const FACET_KINDS = ['place', 'subject', 'species', 'monument', 'period'];
export const PROPOSAL_STATES = ['open', 'approved', 'merged', 'rejected'];
export const CREDENTIAL_STATES = ['stated', 'pending', 'confirmed', 'rejected'];

/**
 * Normalisation decides whether the review queue is workable.
 *
 * *fossils*, *Fossils*, *fossil hunting* and *Fossil Hunting* must collapse
 * before an administrator ever sees them, or the queue fills with four
 * spellings of one thing inside a week — the failure mode that killed every
 * folksonomy without one.
 *
 * Lowercase, strip diacritics, drop punctuation, collapse whitespace, and fold
 * a trailing plural. The plural fold is deliberately shallow — 's', 'es' after
 * a sibilant, 'ies' → 'y' — because an aggressive stemmer collapses words that
 * are genuinely different (*bass* and *bas*, *lens* and *len*) and a false
 * merge is much more expensive here than a duplicate proposal.
 */
export function normalise(raw) {
  const base = String(raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // café → cafe
    .toLowerCase()
    .replace(/['’]/g, '')                                // hadrian's → hadrians
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (!base) return '';
  return base.split(' ').map(singular).join(' ');
}

/**
 * Singular nouns that end in -s and would lose it.
 *
 * The rules below catch `-ss`, `-us` and `-is`, which is most of them; these
 * are the ones left, chosen for a vocabulary about crafts, tools and the
 * outdoors. *lens* becoming *len* is what this list is for — a host typing
 * "lens" and a host typing "lenses" must meet, and neither must meet "len".
 */
const KEEPS_ITS_S = new Set([
  'lens', 'gas', 'news', 'series', 'species', 'canvas', 'atlas', 'bias', 'chaos',
  // Tools and garments that only exist in the plural: folding them invents a word.
  'bellows', 'scissors', 'shears', 'pliers', 'tongs', 'trousers', 'braces',
]);

/** The shallow plural fold. Words shorter than four letters are left alone. */
function singular(word) {
  if (word.length < 4 || KEEPS_ITS_S.has(word)) return word;
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;          // ammonites stays; potteries → pottery
  if (/(ss|us|is)$/.test(word)) return word;                              // glass, fungus, basis
  if (/sses$/.test(word)) return word.slice(0, -2);                       // glasses → glass
  // `-ses` takes one letter, not two: the singular of *houses*, *courses* and
  // *horses* keeps its e, and taking two gave `hous` — so the plural and the
  // singular stopped meeting and each raised its own proposal (Codex,
  // 14 Sep 2026). Unless two letters lands on a word that keeps its own s,
  // which is how *lenses* finds *lens*.
  if (/ses$/.test(word)) {
    return KEEPS_ITS_S.has(word.slice(0, -2)) ? word.slice(0, -2) : word.slice(0, -1);
  }
  if (/(ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);        // churches → church
  if (/s$/.test(word)) return word.slice(0, -1);                          // fossils → fossil
  return word;
}

/** The key a new canonical tag is given: the normalised wording, hyphenated. */
export const keyFor = (raw) => normalise(raw).replace(/ /g, '-').slice(0, 60);

/**
 * The three prompts, and the only thing that changes between them.
 *
 * The **Local** host is the one a skills taxonomy loses. The dad who knows
 * every playground is an expert in nothing a taxonomy recognises; ask him what
 * he is an expert in and he types nothing and abandons the wizard, and Epic
 * loses its warmest category. So he is asked what he is *into*, and who it is
 * good for — his answer is a place plus an activity plus a family shape.
 *
 * The Guide's credentials are a separate axis and never enter the tag list.
 * Blue Badge is evidence, not expertise.
 *
 * Keyed by `hosts.type` (079): skill · meetups · expert, which are the
 * Practitioner, Local and Guide of the design brief under the owner's own
 * words for them (12 Sep 2026).
 */
export const PROMPTS = {
  skill: {
    badge: 'Practitioner',
    title: 'What are you an expert in?',
    sub: 'Disciplines, crafts and techniques. Whatever depth it takes.',
    placeholder: 'Sourdough? Wheel throwing? Ammonites?',
    kicker: 'Suggestions, ordered for you',
  },
  expert: {
    badge: 'Guide',
    title: 'What do you guide on?',
    sub: 'Subjects, places and periods. Your badge goes somewhere else.',
    placeholder: 'Roman Britain? The Jurassic Coast? Street art?',
    kicker: 'Suggestions, ordered for you',
    // The Guide's credentials are a separate axis and must never enter the tag
    // list. Blue Badge is evidence, not expertise.
    asideTitle: 'Your Blue Badge goes in the trust step',
    aside: 'A badge is evidence, not expertise. It is asked for once and shown next to your tags, never inside them.',
  },
  meetups: {
    badge: 'Local',
    title: 'What are you into, and who is it good for?',
    sub: 'No qualification needed. The places you know and who they suit.',
    placeholder: 'Sea swimming? Record shops? Every playground within ten miles?',
    kicker: 'Suggestions, ordered for you',
  },
};
export const promptFor = (hostType) => PROMPTS[hostType] ?? PROMPTS.skill;

/**
 * Who it is good for — the Local host's third axis (S8). Age bands only, never
 * a child's name, and never a rank.
 */
export const AGE_BANDS = [
  { key: 'under5', label: 'Under 5s' },
  { key: '5to8', label: '5–8' },
  { key: '9to12', label: '9–12' },
  { key: 'teens', label: 'Teenagers' },
  { key: 'grownups', label: 'Grown-ups' },
  { key: 'buggy', label: 'Buggy-friendly' },
];

/**
 * A count is shown **only when it flatters**. "34 hosts" reads well; "0 hosts"
 * reads as an empty shelf and tells the host they are alone on a platform they
 * have not joined yet. Below the floor the row shows its breadcrumb instead,
 * which is the thing that made them feel recognised in the first place.
 */
export const FLATTER_FLOOR = 3;
export const flatters = (n) => Number(n) >= FLATTER_FLOOR;

/**
 * The browse category, derived from the tags rather than chosen.
 *
 * Tag *Fossil hunting* and *Ammonites* and the answer is Geology and fossils.
 * The rule is the commonest category among the resolved tags, and the first
 * tag wins a tie — because the first tag is the one the host dragged to the
 * front, and it is what shows on the card.
 *
 * Returns null when nothing is resolved yet. A host who skipped the step is
 * asked for a category directly rather than guessed at.
 */
export function categoryFrom(tags) {
  const counts = new Map();
  let first = null;
  for (const t of tags ?? []) {
    const key = t?.categoryKey ?? t?.category_key ?? null;
    if (!key) continue;
    if (first === null) first = key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return null;
  let best = first;
  let bestN = counts.get(first) ?? 0;
  for (const [key, n] of counts) if (n > bestN) { best = key; bestN = n; }
  return best;
}

/**
 * The old word, offered as a starting suggestion.
 *
 * `host_offers.category` held one of a short list of passions. Offers carrying
 * one are asked for a category and a format on next edit with this as the
 * suggestion — deliberately not a data migration, because a guess written into
 * the database is indistinguishable afterwards from a host's own answer.
 */
const FROM_PASSION = {
  painting: 'art-photography', photography: 'art-photography', pottery: 'crafts',
  cooking: 'food-drink', baking: 'food-drink', wine: 'food-drink', coffee: 'food-drink', food: 'food-drink',
  foraging: 'nature', 'sea-swimming': 'on-the-water', running: 'sport-games', climbing: 'sport-games',
  cycling: 'sport-games', skateboarding: 'sport-games', yoga: 'wellbeing',
  history: 'heritage', music: 'music', records: 'markets-shops', 'with-kids': 'families',
  'night-out': 'night-out', business: null, ai: null,
};
export const categoryForPassion = (passion) => (passion ? FROM_PASSION[passion] ?? null : null);

/**
 * The same map as two parallel lists, for a query that has to do the folding
 * itself. Counting in JavaScript over grouped rows counted a host twice when
 * two of their old words fell in one bucket (Codex, 14 Sep 2026).
 */
export const passionBuckets = () => {
  const pairs = Object.entries(FROM_PASSION).filter(([, bucket]) => bucket);
  return { passions: pairs.map(([p]) => p), buckets: pairs.map(([, b]) => b) };
};

/**
 * The same map read the other way: which old words land in this bucket.
 *
 * The browse row filters on the new column *and* on these, so an offer written
 * before the skills work still appears under the bucket it belongs to instead
 * of vanishing from every filter until somebody edits it (Codex, 13 Sep 2026).
 */
export function passionsForCategory(categoryKey) {
  if (!categoryKey) return [];
  return Object.entries(FROM_PASSION).filter(([, bucket]) => bucket === categoryKey).map(([passion]) => passion);
}

/**
 * What the tag rows show beneath the label: the parent chain, as context in one
 * glance. "Fossil hunting — Geology and fossils › Palaeontology" tells the host
 * the platform already knows their world, and that feeling is the point.
 *
 * It is never navigation: not tappable, and there is no tree to walk.
 * `chainOf` is given the tag and a lookup of every tag by key, and stops at
 * three levels because a fourth does not fit at 390px.
 */
export function breadcrumb(tag, byKey, categories) {
  const parts = [];
  const cat = (categories ?? {})[tag?.category_key ?? tag?.categoryKey];
  if (cat) parts.push(cat);
  const chain = [];
  let at = byKey?.[tag?.parent_key ?? tag?.parentKey] ?? null;
  let guard = 0;
  while (at && guard++ < 3) {
    chain.unshift(at.label);
    at = byKey?.[at.parent_key ?? at.parentKey] ?? null;
  }
  return [...parts, ...chain].join(' › ') || null;
}

/**
 * What stops an offer going live, from this brief's side only.
 *
 * The owner, 13 Sep 2026, answering §9: both mandatory to go live, neither to
 * draft. So the step stays skippable in the wizard — it has its own `Skip for
 * now` — and the two facts are asked for at publish, where a host is already
 * being told what is missing. A host who skipped tags is not stuck: the
 * category can be set directly from the confirmation line.
 *
 * A pending tag never blocks anything. The offer goes up with the pending chip
 * on it and the word goes to the queue; that is the whole point of §4 of the
 * design brief.
 */
export function skillBlockers(offer) {
  const out = [];
  if (!offer?.category_key) out.push('Say what it is about — tag it, or pick a category.');
  if (!offer?.format_key) out.push('Say what actually happens — a walk, a workshop, a dig.');
  return out;
}

/**
 * Which credential types are a condition of hosting in this category rather
 * than a badge. A food business registration is the law, not a boast.
 */
export function gatingTypes(types, categoryKey) {
  if (!categoryKey) return [];
  return (types ?? []).filter((t) => (t.gates_categories ?? t.gatesCategories ?? []).includes(categoryKey));
}

/**
 * A confirmed credential can go stale. Null expiry means it does not.
 *
 * The day is clamped to the target month rather than left to `setMonth`, which
 * rolls over: 31 January plus one month becomes 3 March, and a credential would
 * quietly be accepted for three days longer than it should be (Codex,
 * 13 Sep 2026).
 */
export function expiryFor(type, at = new Date()) {
  const months = type?.expires_months ?? type?.expiresMonths ?? null;
  if (!months) return null;
  const from = new Date(at);
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), lastDayOfTarget);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * Whether a credential is shown to a guest, and how it is labelled.
 *
 * Required-evidence types do not display until the back office confirms, and
 * then display with the date. Ones not requiring evidence display as the
 * host's own claim, labelled as stated rather than confirmed — the difference
 * between "we have seen this" and "she told us this" is the whole value of the
 * trust work, and collapsing it would undo it.
 */
export function credentialDisplay(credential, type, today = new Date().toISOString().slice(0, 10)) {
  const state = credential?.state ?? 'pending';
  if (state === 'rejected' || state === 'pending') return null;
  if (state === 'confirmed') {
    // A confirmation that has run out is a document nobody has looked at for
    // three years. It stops showing, here as well as on the public query, so
    // the host is not told it is live while Publish says it is stale (Codex,
    // 14 Sep 2026).
    if (expired(credential, today)) return null;
    return { label: type?.label ?? credential?.type_key, how: 'confirmed', at: credential?.confirmed_at ?? null };
  }
  return { label: type?.label ?? credential?.type_key, how: 'stated', at: null };
}

/** Confirmed once, and past the date that confirmation was good for. */
export const expired = (credential, today = new Date().toISOString().slice(0, 10)) =>
  Boolean(credential?.state === 'confirmed' && credential.expires_on && credential.expires_on < today);

/**
 * A Wikidata description that says this is a *work*, a person or a place rather
 * than the thing itself.
 *
 * Needed because a unique name match is not a safe match. Wikidata has exactly
 * one item called "Bell Ringing" — an episode of Teletubbies — and exactly one
 * called "Beach Days", a painting by Joseph Syddall. Both were the only thing
 * carrying their name, so both looked like certainties, and neither is the
 * craft anybody meant (14 Sep 2026, reading the first run's output).
 *
 * Matched on whole words, not substrings: the description of bookbinding says
 * "binding books", of animal husbandry says "husbandry", and of a display case
 * says "display" — none of which are a book, a husband or a play (Codex,
 * 14 Sep 2026).
 */
const NOT_THE_THING = [
  // Works
  'painting', 'paintings', 'sculpture', 'drawing', 'artwork', 'photograph',
  'episode', 'series', 'film', 'movie', 'documentary', 'television', 'tv',
  'album', 'song', 'opera', 'musical', 'band',
  'novel', 'book', 'poem', 'manga', 'anime', 'comic', 'magazine',
  'article', 'journal', 'thesis', 'encyclopedia', 'dictionary',
  // People
  'actor', 'actress', 'musician', 'singer', 'songwriter', 'composer',
  'writer', 'author', 'novelist', 'poet', 'journalist', 'painter', 'artist',
  'politician', 'footballer', 'cricketer', 'athlete', 'player', 'wrestler',
  'engineer', 'physician', 'scientist', 'historian', 'philosopher',
  'businessman', 'businesswoman', 'entrepreneur', 'aristocrat', 'noble',
  'surname', 'forename', 'nickname', 'pseudonym',
  // Places and organisations
  'city', 'town', 'village', 'hamlet', 'suburb', 'settlement', 'parish',
  'county', 'district', 'region', 'province', 'prefecture', 'commune',
  'municipality', 'island', 'river', 'mountain', 'lake', 'valley',
  'company', 'brand', 'corporation', 'firm', 'charity', 'foundation',
];
const NOT_THE_THING_RE = new RegExp(`\\b(${NOT_THE_THING.join('|')})\\b`, 'i');
/** Two-word marks a single word would miss or would over-reach on. */
const NOT_THE_THING_PHRASES = [
  'published in', 'directed by', 'written by', 'family name', 'given name',
  'human settlement', 'video game', 'board game', 'fictional',
  // Words that are a craft in one reading and a work in another. Papermaking
  // is described as "the craft of making paper", so `paper` cannot be a word
  // on its own (Codex, 14 Sep 2026); only the phrases that can only be a work.
  'academic paper', 'research paper', 'studio album', 'single by', 'play by',
  'ep by', 'television series', 'stage play',
];

/** Is this candidate the activity, or something merely named after it? */
export function namesTheThing(description) {
  const d = String(description ?? '').toLowerCase();
  if (!d) return true; // no description at all is not evidence against it
  if (NOT_THE_THING_PHRASES.some((w) => d.includes(w))) return false;
  return !NOT_THE_THING_RE.test(d);
}
