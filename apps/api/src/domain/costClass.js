/**
 * What a pound of provider spend was for.
 *
 * The reporting handoff's first non-negotiable: **cost is classified on
 * `(purpose × actor)`, never a prefix match.** Four classes:
 *
 *   · **library** — building the place index. Paid once per place and amortised
 *     across the whole estate, so it is not a unit cost of serving anybody.
 *   · **serve** — marginal, and belongs to the household that caused it.
 *   · **office** — somebody using the back office.
 *   · **research** — production endpoints exercised deliberately to learn
 *     something. Charged to no household, and shown as an unallocated line.
 *
 * The reason a purpose alone cannot decide it, from the production audit: the
 * $96.46 that read as "cost of serving a household" was the owner exercising
 * the planning endpoints as an administrator. The purposes were `plan.*`,
 * `trip.*` and `places.*` — indistinguishable from a household planning a day
 * out. The actor is what tells them apart.
 *
 * **Where this is derived and where it should be stored.** The brief calls for
 * `provider_calls.class`, resolved and written at the moment of the call, so a
 * later rule change cannot rewrite last quarter. That column does not exist
 * yet, and adding it means touching every call site — the attribution spine is
 * its own build. Until it does, the class is derived here at read time, and
 * every screen that shows it says so. The resolution rule is written once, in
 * this file, so that the day the column arrives there is one function to move.
 */

/**
 * What each purpose is for, before the actor is considered.
 *
 * Listed rather than pattern-matched: a prefix rule is what produced the wrong
 * figure, and a purpose that nobody has classified should read as unknown
 * rather than quietly land in `serve`.
 */
export const PURPOSE_CLASSES = {
  // Building the index. Paid once per place.
  'own.seed': 'library',
  'own.lead': 'library',
  'own.encyclopedia': 'library',
  'own.site': 'library',
  'atlas.types': 'library',
  'atlas.match': 'library',
  'atlas.where': 'library',
  'atlas.rating': 'library',
  'atlas.photos': 'library',
  'census.slice': 'library',
  'sweep.rate': 'library',
  'sweep.search': 'library',
  'scout.events': 'library',
  'scout.places': 'library',
  'collect.search': 'library',
  'curate.rank': 'library',
  'menu.read': 'library',
  'menu.find': 'library',
  'reach.matrix': 'library',

  // Serving a household. Marginal, and theirs.
  'places.search': 'serve',
  'places.suggest': 'serve',
  'places.detail': 'serve',
  photo: 'serve',
  'plan.preview': 'serve',
  'plan.interpret': 'serve',
  'plan.retrieve': 'serve',
  'plan.refine': 'serve',
  'plan.journey': 'serve',
  'plan.matrix': 'serve',
  'plan.corridor': 'serve',
  'plan.corridor.detour': 'serve',
  'plan.inspire': 'serve',
  'plan.inspire.things': 'serve',
  'plan.tastes': 'serve',
  'plan.tastes.routing': 'serve',
  'trip.along': 'serve',
  'trip.journey.day': 'serve',
  'trip.journey.shortlist': 'serve',
  'trip.shortlist.search': 'serve',
  'inside.restrictions': 'serve',
  'stays.search': 'serve',
  'voice.transcribe': 'serve',
  'voice.interpret': 'serve',
  'tripadvisor.drawer': 'serve',

  // The back office itself.
  'admin.lookup': 'office',
  'admin.lookup.rate': 'office',
  'admin.compare': 'office',
  'admin.reading': 'office',

  // Learning something on purpose.
  'bench.research': 'research',
  'bench.google': 'research',
  'bench.tripadvisor': 'research',
};

export const COST_CLASSES = ['library', 'serve', 'office', 'research'];

export const CLASS_LABELS = {
  library: 'Library',
  serve: 'Serving households',
  office: 'Back office',
  research: 'Research',
  unclassified: 'Not classified',
};

/**
 * The class of one call.
 *
 * Two steps, and the order is the point:
 *
 *  1. start from the purpose's own class — `office` for an admin purpose stays
 *     `office`, a library purpose stays `library`;
 *  2. **if the session's account holds any back-office capability, downgrade
 *     `serve` to `research`.** Somebody with the back office open is not a
 *     household, whatever endpoint they called.
 *
 * Defaulting to non-serve and requiring an explicit purpose to be counted as
 * serving is deliberate: defaulting the other way is what produced the bad
 * figure. An unrecognised purpose is `unclassified`, and shows on screen under
 * its own name rather than being folded into a class nobody chose.
 */
export function classOf({ purpose, actorHoldsBackOffice = false }) {
  const base = PURPOSE_CLASSES[purpose] ?? 'unclassified';
  if (base === 'serve' && actorHoldsBackOffice) return 'research';
  return base;
}

/** The purpose half of the rule, as SQL. `alias` is the `provider_calls` alias. */
export function purposeClassExpression(alias = 'c') {
  const arms = Object.entries(PURPOSE_CLASSES)
    .map(([purpose, cls]) => `      when ${alias}.purpose = '${purpose}' then '${cls}'`)
    .join('\n');
  return `case\n${arms}\n      else 'unclassified'\n    end`;
}

/**
 * The actor half: **does whoever made this call hold the back office?**
 *
 * `provider_calls.session_id` resolves through `api_sessions` to an account. An
 * account with a `role_id`, or the literal owner role, holds a back-office
 * role. A call with no session at all is a server-side job or the shared
 * passcode — which is the owner (auth.js) — so it counts as the back office
 * too. That default is deliberate: the brief's rule is to default to non-serve
 * and require an explicit household to be charged, because defaulting the other
 * way is what produced the $96.46 that read as a unit cost and was not one.
 */
export function backOfficeActorExpression(alias = 'c') {
  return `coalesce((
      select (a.role = 'owner' or a.role_id is not null)
        from api_sessions s
        join accounts a on a.id = s.account_id
       where s.id = ${alias}.session_id
       limit 1
    ), true)`;
}

/**
 * The whole rule, as one SQL expression, so every query classifies identically.
 *
 * Written as a `case` over the two halves rather than a prefix match on
 * `purpose`, which is the thing the handoff forbids by name.
 */
export function classExpression(alias = 'c') {
  const purpose = purposeClassExpression(alias);
  const actor = backOfficeActorExpression(alias);
  return `case
      when (${purpose}) = 'serve' and (${actor}) then 'research'
      else (${purpose})
    end`;
}
