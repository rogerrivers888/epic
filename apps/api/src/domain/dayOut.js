/**
 * The day-out test for a drawer named for a thing (C26, owner 26 Sep 2026).
 *
 * "A sports centre is in Pools only if it has a pool. A sports centre with no
 * pool fails the day-out test and is not in Epic. The same rule applies
 * wherever Google's types pull leisure centres into lidos, athletics,
 * climbing or racquet-clubs: the place must have the thing the drawer is
 * named for."
 *
 * The count that shaped the rule: in OSM a sports centre's own tags almost
 * never say it has a pool. Ascot box, six centres, none tagged — though two
 * are named leisure centres with pools in reality; central Bristol, sixty
 * centres, four tagged, five more with a public `leisure=swimming_pool`
 * object within eighty metres, fifty-one with nothing — and seven of the
 * eight named "Leisure Centre" found. The pool is a separate map object, or a
 * sentence on the venue's page, not a tag on the centre. So the evidence is
 * read in order — the place's own tags, an adjacent object of the named-for
 * kind, owned text — and any one keeps it; when all three are silent the name
 * decides once, *provisionally*, so enrichment reads the page before the
 * place is ranked; and a name that says nothing fails the test.
 *
 * Everything here is pure. Where the evidence comes from (Overpass, the owned
 * record) is `sources/dayOutTest.js`; this is only what counts as evidence.
 */

/** How near a separate map object has to be to count as the place's own. */
export const ADJACENT_M = 80;

/** The three states, in the order a screen should read them. */
export const KEPT = 'kept';
export const PROVISIONAL = 'provisional';
export const OUT = 'out';

const has = (tags, key, ...values) => {
  const v = tags?.[key];
  if (v == null) return false;
  if (!values.length) return true;
  return String(v).split(';').some((x) => values.includes(x.trim()));
};
const sportIs = (tags, ...sports) => has(tags, 'sport', ...sports);

/**
 * What each drawer is named for, and how each kind of evidence shows it.
 *
 *   tag       the place's own tags say so
 *   object    a separate map object of the named-for kind (checked for adjacency by the caller)
 *   text      the venue's page or the encyclopedia say so — owned text only
 *   name      the place's name says so; the provisional keep
 *   selector  the Overpass selector for the places this drawer is fed from
 */
export const NAMED_FOR = {
  pools: {
    thing: 'a pool',
    selector: '["leisure"="sports_centre"]',
    tag: (t) => has(t, 'swimming_pool', 'yes', 'indoor', 'outdoor') || sportIs(t, 'swimming') || has(t, 'leisure', 'swimming_pool'),
    object: (t) => has(t, 'leisure', 'swimming_pool') && !has(t, 'access', 'private') && !has(t, 'swimming_pool', 'private'),
    text: /\b(swimming )?pools?\b|\blido\b|\bbaths\b|\bswim(ming)?\b/i,
    name: /leisure cent(re|er)|\bbaths\b|\blido\b|\bswim(ming)?\b|\bpool\b/i,
  },
  lidos: {
    thing: 'an outdoor pool',
    selector: '["leisure"~"^(sports_centre|swimming_pool)$"]',
    tag: (t) => has(t, 'swimming_pool', 'outdoor') || (has(t, 'leisure', 'swimming_pool') && (has(t, 'location', 'outdoor', 'roof') || has(t, 'indoor', 'no'))),
    object: (t) => has(t, 'leisure', 'swimming_pool') && (has(t, 'location', 'outdoor', 'roof') || has(t, 'indoor', 'no')) && !has(t, 'access', 'private'),
    text: /\blido\b|open[- ]air (swimming )?pool|outdoor (swimming )?pool|\bopen[- ]air\b/i,
    name: /\blido\b|open[- ]air/i,
  },
  athletics: {
    thing: 'a running track',
    selector: '["leisure"~"^(sports_centre|track|stadium)$"]',
    tag: (t) => has(t, 'leisure', 'track') || sportIs(t, 'athletics', 'running'),
    object: (t) => has(t, 'leisure', 'track') && (sportIs(t, 'athletics', 'running') || !has(t, 'sport')),
    text: /\b(running|athletics) track\b|\bathletics\b/i,
    name: /\bathletics?\b|\btrack\b|\bharriers\b/i,
  },
  climbing: {
    thing: 'a climbing wall',
    selector: '["leisure"="sports_centre"]',
    tag: (t) => sportIs(t, 'climbing', 'bouldering') || has(t, 'climbing') || has(t, 'climbing:sport') || has(t, 'climbing:boulder'),
    object: (t) => sportIs(t, 'climbing', 'bouldering'),
    text: /climbing wall|\bbouldering\b|\bclimbing (centre|center|gym)\b/i,
    name: /\bclimb(ing)?\b|\bboulder(ing)?\b|\bwall\b/i,
  },
  'racquet-clubs': {
    thing: 'a court',
    selector: '["leisure"="sports_centre"]',
    tag: (t) => sportIs(t, 'tennis', 'squash', 'badminton', 'padel', 'racquet'),
    object: (t) => (has(t, 'leisure', 'pitch') || has(t, 'leisure', 'sports_centre')) && sportIs(t, 'tennis', 'squash', 'badminton', 'padel'),
    text: /\b(tennis|squash|badminton|padel) courts?\b/i,
    name: /\btennis\b|\bracquet\b|\bracket\b|\bsquash\b|\bpadel\b|\bbadminton\b/i,
  },
};

export const DRAWERS = Object.keys(NAMED_FOR);

/**
 * The verdict on one place for one drawer.
 *
 *   tags       the place's own OSM tags, or null
 *   nearby     tags of separate map objects within ADJACENT_M, already fenced by the caller
 *   text       owned text: the venue's page, the encyclopedia — never a review
 *   name       the place's name
 *
 * `by` names the evidence that decided it, so the screen can say "kept — a
 * pool object 40 m away" rather than "kept". `can't speak` is a real state:
 * a drawer this test does not know is `null`, not `out`.
 */
/**
 * Members-only fails the day-out test, whatever the facilities (owner,
 * 26 Sep 2026: "David Lloyd ×2 in Pools and racquet-clubs. Out").
 *
 * Read from the tags where the map says so (`access=private|members`,
 * `membership=required|yes`), from owned text, and from the brand: the map
 * carries no access tag on a David Lloyd — only `brand=David Lloyd Clubs` —
 * so the chains whose business is a membership are named here. `club=sport`
 * is not on the list on purpose: Absolutely Karting carries it and sells a
 * session to anybody.
 */
export const MEMBERS_ONLY_BRANDS = ['david lloyd', 'nuffield health', 'virgin active', 'bannatyne'];
const MEMBERS_TEXT = /\bmembers[’']?\s*only\b|\bmembership (is )?required\b|\bmembers[’']? club\b|\bprivate members\b/i;

export function membersOnly({ tags = null, text = '', name = '' } = {}) {
  const t = tags ?? {};
  if (has(t, 'access', 'private', 'members', 'membership')) return 'access=private';
  if (has(t, 'membership', 'required', 'yes', 'only')) return 'membership required';
  const brand = String(t.brand ?? t.operator ?? name ?? '').toLowerCase();
  const chain = MEMBERS_ONLY_BRANDS.find((b) => brand.includes(b));
  if (chain) return `a members-only chain (${t.brand ?? t.operator ?? name})`;
  if (text && MEMBERS_TEXT.test(String(text))) return 'its own page says members only';
  return null;
}

/**
 * Whether an adjacent object may speak for this place.
 *
 * Adjacency proves a pool for the sports centre only (owner, 26 Sep 2026):
 * Hengrove's climbing wall, sixty-three metres from the pool, was being kept
 * in Pools. A candidate whose own tags say it is something else — `sport=
 * climbing` — cannot borrow a neighbour's pool; a centre with no sport tag,
 * or one that names the drawer's own sport, can.
 */
const OWN_SPORT = {
  pools: ['swimming', 'multi'], lidos: ['swimming', 'multi'], athletics: ['athletics', 'running', 'multi'],
  climbing: ['climbing', 'bouldering', 'multi'], 'racquet-clubs': ['tennis', 'squash', 'badminton', 'padel', 'racquet', 'multi'],
};
export function mayBorrowAdjacent(drawer, tags = null) {
  const sport = tags?.sport;
  if (sport == null || sport === '') return true;
  return String(sport).split(';').some((s) => OWN_SPORT[drawer]?.includes(s.trim()));
}

export function dayOutVerdict(drawer, { tags = null, nearby = [], text = '', name = '' } = {}) {
  const spec = NAMED_FOR[drawer];
  if (!spec) return null;
  const members = membersOnly({ tags, text, name });
  if (members) return { verdict: OUT, by: 'members', reason: `members only — ${members}` };
  if (tags && spec.tag(tags)) return { verdict: KEPT, by: 'tag', reason: `its own tags say it has ${spec.thing}` };
  const near = mayBorrowAdjacent(drawer, tags) ? (nearby ?? []).find((n) => spec.object(n?.tags ?? n)) : null;
  if (near) return { verdict: KEPT, by: 'object', reason: `${spec.thing} is mapped within ${ADJACENT_M} m`, object: near?.name ?? near?.tags?.name ?? null };
  if (text && spec.text.test(String(text))) return { verdict: KEPT, by: 'text', reason: `its own page or the encyclopedia says it has ${spec.thing}` };
  // The name is borrowed evidence as an adjacent object is: a candidate whose
  // own tags say it is something else — "…Leisure Centre Climbing Wall",
  // sport=climbing — is what its tags say, not what its name borrows.
  if (name && mayBorrowAdjacent(drawer, tags) && spec.name.test(String(name))) {
    return { verdict: PROVISIONAL, by: 'name', reason: `only the name says so — kept until its page is read` };
  }
  return { verdict: OUT, by: null, reason: `nothing says it has ${spec.thing}: not in this drawer` };
}

/** Whether the test applies to a drawer at all. */
export const namedForThing = (drawer) => NAMED_FOR[drawer]?.thing ?? null;

/**
 * The switch. Off means the verdict is computed and reported and changes no
 * filing — the state the owner asked for: "build it, then run the dry run and
 * stop before switching it on".
 */
export const dayOutTestOn = (env = process.env) => String(env.EPIC_DAY_OUT_TEST ?? '').toLowerCase() === 'on';
