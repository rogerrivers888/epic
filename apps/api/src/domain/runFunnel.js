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
/**
 * Below this share written down, most of what was raised died.
 *
 * `stored` has to mean written-down-*or-updated* for this to be true. Counting
 * only newly inserted rows made a second harvest of the same set read as
 * though its words had died, when they had merely been seen again — a
 * confident verdict, printed on the Runs tab, that the run had failed when it
 * had worked (Codex via epic-f2, 21 Sep 2026).
 */
export const KEPT_FLOOR = 0.4;

/**
 * Below this many words judged, no share of them is a rate.
 *
 * The collapse test already had a floor. The holding-pen and kept tests had
 * none, so a run that raised thirteen words and kept nine was told "the
 * holding pen is taking half" — nine of nine, which is a fraction rather than
 * a rate — and a run that raised nothing at all from sixty places was told
 * "drop-off looks normal", which is a confident verdict on an empty funnel.
 *
 * Both were on the deployed Runs screen, and both break the rule this project
 * was given on 21 Sep 2026: every diagnostic has a can't-speak state, and a
 * signal without enough evidence says so rather than recommending an action.
 */
export const ENOUGH_TO_SPEAK = 20;

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
  if (!f) return { says: 'not recorded', at: null, healthy: true, recorded: false, spoke: false };
  const collapse = f.raw ? (f.raw - f.collapsed) / f.raw : 0;
  const judged = f.collapsed || 0;
  if (f.raw >= ENOUGH_TO_JUDGE && collapse < COLLAPSE_FLOOR) {
    return { says: 'the resolver is not collapsing', at: 'collapsed', healthy: false, recorded: true, spoke: true };
  }
  if (judged >= ENOUGH_TO_SPEAK && (f.held ?? 0) / judged > PEN_CEILING) {
    return { says: 'the holding pen is taking half', at: 'held', healthy: false, recorded: true, spoke: true };
  }
  // A run that recorded no `stored` at all cannot be judged on its kept share:
  // every run from before the funnel counted written-down-or-updated is in
  // that state, and accusing them all is worse than saying nothing.
  if (judged >= ENOUGH_TO_SPEAK && f.stored != null && f.stored / judged < KEPT_FLOOR) {
    return { says: 'most words die unconfirmed', at: 'stored', healthy: false, recorded: true, spoke: true };
  }
  // Nothing above could be asked of a run this small, so the answer is that
  // there is not enough here to judge — not that it looks fine. "Normal" on an
  // empty funnel is the worst of the two, because it is the only one somebody
  // would act on.
  //
  // Not unhealthy: a run nobody can judge is not a run that went wrong, and
  // putting an alarm beside it would teach the screen's loudest signal to mean
  // nothing. `spoke` is how the screen can draw the difference between a
  // verdict and a shrug.
  if ((f.raw ?? 0) < ENOUGH_TO_JUDGE && judged < ENOUGH_TO_SPEAK) {
    return {
      says: (f.read ?? 0) ? 'too little came through to judge it' : 'it did not get far enough to say',
      at: null, healthy: true, recorded: true, spoke: false,
    };
  }
  return { says: 'drop-off looks normal', at: null, healthy: true, recorded: true, spoke: true };
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

/** The stages that can be listed out of the candidates a run raised. */
export const LISTABLE = new Set(['collapsed', 'thin', 'held', 'stored', 'waiting']);

/**
 * What one stage of one run holds, and what may honestly be said about it.
 *
 * A funnel is a shape, and a shape is not evidence: "1,290 after the resolver"
 * is a claim somebody has to be able to open and disagree with. Five of the
 * seven stages can be listed from the candidates the run raised. Two cannot,
 * and say so rather than showing something close:
 *
 *   · **places read** is a count and never a list — a run records how many
 *     places it read, not which — and building one from the drawer's places
 *     today would be a different set, because places have been added since.
 *   · **words out** is mentions before normalisation, and those are gone by
 *     design: read out of rented text in memory and never written down. That
 *     is the data policy working, not a hole in the record.
 *
 * **The list is what the run raised for the first time, and on a repeat run
 * that is fewer than the count.** A candidate is found by `first_seen`, which
 * never moves, so a word this harvest saw again belongs to the run that first
 * found it — while the funnel counted it as passing through this one. Both are
 * true and they are different questions. The recorded count therefore wins and
 * the list says what it is, rather than the list quietly replacing the count
 * with a smaller number and calling it exact (Codex, 21 Sep 2026).
 *
 * `count` is null only where a stage cannot be listed *and* the run did not
 * record it. Nought there would read as "nothing came through", which is the
 * one thing it does not mean.
 */
export function stageOf({ stage, funnel, places, items }) {
  const recorded = funnel?.[stage] ?? (stage === 'read' ? places ?? null : null);
  const listed = items.length;
  const listable = LISTABLE.has(stage);
  const count = recorded ?? (listable ? listed : null);
  return {
    key: stage,
    count,
    listed,
    recorded: recorded != null || listable,
    // The list is every word the stage holds only when the two agree. On a
    // repeat run it is the newly raised ones, and the screen has to be able to
    // say so rather than imply the rest are missing.
    exact: !listable ? false : count === listed,
  };
}

/**
 * How long a run may go untouched before the screen stops believing in it.
 *
 * Long enough that a slow subcategory is not mistaken for a corpse — a sweep
 * reading a few hundred venue pages politely can be quiet for a while — and
 * short enough that nobody watches a dead run for an afternoon.
 */
export const STALL_AFTER_MS = 12 * 60 * 1000;

/**
 * Is this run alive, stalled, or neither?
 *
 * A run interrupted between starting and finishing keeps `status = 'running'`
 * for ever, because the process that would have written the ending is gone —
 * and every deploy restarts the process a sweep lives inside. Reading `status`
 * alone therefore makes the live panel claim a sweep is going, with a red Stop
 * beside it, until somebody edits the database.
 *
 * Stalled is deliberately its own answer rather than "finished". We do not know
 * how it ended; we know only that nothing has touched it. Saying it finished
 * would invent a result, and saying it is running would keep the lie going.
 */
export function livenessOf(run, now = Date.now()) {
  if (!run || run.finished_at) return 'done';
  const last = +new Date(run.touched_at ?? run.started_at);
  return now - last > STALL_AFTER_MS ? 'stalled' : 'running';
}
