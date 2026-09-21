/**
 * Where a run's volume went, and what that shape means.
 *
 * The judgements the Runs screen is built on, kept out of the route so they
 * can be exercised without a database. Each one has a wrong answer that is
 * quiet: a run whose middle was never written down reading as healthy; a
 * backlog that is growing reading the same as one that is clearing; a stage
 * called "validated" when nothing was validated.
 */

/**
 * The seven stages a run is drawn as, in the order volume passes through.
 *
 * `thin` and `waiting` are not in a run's own record and cannot be: they are
 * facts about the queue *now*, not about the run then. A word raised in August
 * and decided yesterday is not still waiting, and a frozen figure would go on
 * saying it was. They are counted at read time against the run's own window.
 *
 * The drawing calls the sixth stage "validated". A harvest validates nothing —
 * it reads rented text, normalises it and writes the survivors down, and what
 * confirms a word against an owned source is a separate run. Calling "we wrote
 * it down" validation would claim the one thing the Labels tab exists to keep
 * honest, so the stage is named for what it is.
 */
export const STAGES = [
  ['read', 'places read'],
  ['raw', 'words out'],
  ['collapsed', 'after the resolver'],
  ['thin', 'too thin'],
  ['held', 'held'],
  ['stored', 'written down'],
  ['waiting', 'waiting on you'],
];

/** Below this collapse rate on a real pile of words, the resolver is not working. */
export const COLLAPSE_FLOOR = 0.3;
/** Enough raw words for a collapse rate to mean anything. */
export const ENOUGH_TO_JUDGE = 100;
/** Above this share into the holding pen, the classifier is the bottleneck. */
export const PEN_CEILING = 0.4;
/** Below this share written down, most of what was raised died. */
export const KEPT_FLOOR = 0.4;

/**
 * What went wrong with a run, named.
 *
 * The first test that fires is the one reported, because a run with two faults
 * has one worst one and a screen listing both makes somebody choose. `at` is
 * the stage the funnel enlarges, so exactly one number per run is loud.
 *
 * `recorded` is the distinction that matters most here: a run that did not
 * write its middle down has an *unknown* middle, which is not a healthy one.
 * Without it the oldest runs would all read as a clean bill of health.
 */
export function diagnose(f) {
  if (!f) return { says: 'not recorded', at: null, healthy: true, recorded: false };
  const collapse = f.raw ? (f.raw - f.collapsed) / f.raw : 0;
  const judged = f.collapsed || 0;
  if (f.raw >= ENOUGH_TO_JUDGE && collapse < COLLAPSE_FLOOR) {
    return { says: 'the resolver is not collapsing', at: 'collapsed', healthy: false, recorded: true };
  }
  if (judged && (f.held ?? 0) / judged > PEN_CEILING) {
    return { says: 'the holding pen is taking half', at: 'held', healthy: false, recorded: true };
  }
  if (judged && (f.stored ?? 0) / judged < KEPT_FLOOR) {
    return { says: 'most words die unconfirmed', at: 'stored', healthy: false, recorded: true };
  }
  return { says: 'drop-off looks normal', at: null, healthy: true, recorded: true };
}

/**
 * The sustainability answer, in the title rather than left to be inferred.
 *
 * "The queue grew by 43 last week" is the sentence somebody opens this screen
 * to read, and it is the one thing a list of runs cannot say.
 */
export function headlineOf(weeks) {
  const last = weeks[weeks.length - 1];
  if (!last) return 'Nothing has run yet';
  const by = last.raised - last.decided;
  if (by > 0) return `The queue grew by ${by} last week`;
  if (by < 0) return `You are ${Math.abs(by)} ahead of the harvest`;
  return 'The queue held level last week';
}

/**
 * Whether deciding outruns raising, in a sentence.
 *
 * A single backlog total looks identical whether you are slowly catching up or
 * slowly losing, which is the whole reason this line exists. Equal rates do
 * *not* clear: a backlog held level for ever is a backlog that never clears,
 * and rounding that up to good news is how a screen lies politely.
 */
export function clearsOf(weeks) {
  const n = weeks.length || 1;
  const raised = weeks.reduce((a, w) => a + w.raised, 0) / n;
  const decided = weeks.reduce((a, w) => a + w.decided, 0) / n;
  if (!raised && !decided) {
    return { says: 'Nothing raised and nothing decided', note: 'No runs in the last four weeks.', ever: true };
  }
  const rates = `Deciding ${Math.round(decided)} a week against ${Math.round(raised)} raised`;
  if (decided <= raised) {
    return {
      says: 'At this rate the backlog never clears.',
      note: `${rates} — either harvest less often or decide in bulk.`,
      ever: false,
    };
  }
  return { says: 'The backlog is clearing.', note: `${rates}.`, ever: true };
}

/**
 * A set's saturation, and what is waiting beside it.
 *
 * Three verdicts and not two. A set at 0.4 with eight waiting has *stopped
 * growing* and is not finished, and that used to look exactly like finished.
 */
export function verdictOf({ rate, waiting, limit }) {
  if (rate > limit) return { verdict: 'still growing · read more', tone: 'growing' };
  if (waiting) return { verdict: `stopped growing, ${waiting} waiting`, tone: 'stuck' };
  return { verdict: 'settled · no more reviews read', tone: 'settled' };
}

/** Every set's saturation, its queue, and its verdict. */
export function saturationOf(sets, candidates, limits) {
  return sets.map((s) => {
    const subs = s.subcategories ?? [];
    const mine = candidates.filter((c) => subs.includes(c.subcategory));
    const waiting = mine.filter((c) => c.status === 'new' && c.kind === 'feature'
      && (c.places_seen ?? 0) >= limits.sightingFloor).length;
    /**
     * New words per ten *places read* — so the denominator is how many places
     * were read, never how often the commonest word turned up.
     *
     * `places_seen` is a word's own frequency, and using it read a hundred
     * words each seen once across a hundred places as a rate of a thousand
     * rather than ten, which would have reported a settled set as still
     * growing for ever (Codex, 21 Sep 2026). `places_total` is what the
     * harvest recorded as the size of the sample, and it is per subcategory,
     * so the set's denominator is the sum of its drawers' samples.
     */
    const places = subs.reduce((n, sub) => {
      const here = mine.filter((c) => c.subcategory === sub);
      return n + here.reduce((m, c) => Math.max(m, c.places_total ?? 0), 0);
    }, 0);
    const rate = places ? Number(((mine.length / places) * 10).toFixed(1)) : 0;
    return {
      set: s.name,
      rate,
      trend: [],
      waiting,
      ...verdictOf({ rate, waiting, limit: limits.saturationLimit }),
    };
  });
}
