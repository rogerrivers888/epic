/**
 * What the filing desk's screens are given.
 *
 * These are the shapes the screens draw, not the shapes the tables hold. Two
 * rules run through all of them, both agreed with the session writing the API
 * (epic-fe, 20 Sep 2026):
 *
 *  - **A reason is a sentence, and it is written on the server.** No screen
 *    composes a number into prose. "seen in reviews of 2 of 60 · confirmed on
 *    2 venue pages · 1 OSM tag" arrives as one string, because the rules for
 *    when each clause appears are data rules and belong beside the data.
 *  - **A count arrives with its denominator, never pre-divided.** `seen` and
 *    `of`, not a share; `answered` and `places`, not a percentage. A screen
 *    that is handed 0.8 cannot tell 4 of 5 from 800 of 1,000, and the whole
 *    point of the candidates list is that those two are different.
 *
 * Anything a screen may need to *draw differently* — distinctive, useless,
 * thin, argued-with — is a flag or a number here and never a colour. Colour is
 * the screen's business; which rung of the ladder a row is on is the server's.
 */

// ---------------------------------------------------------------------------
// Labels — question sets
// ---------------------------------------------------------------------------

/** One question set, as the Question sets table draws it. */
export type SetRow = {
  key: string;
  name: string;
  /**
   * `settled` only when the judgeable queue is empty (handoff §6). A set that
   * has stopped producing words but still has candidates waiting is
   * `settling`, and the two must not look the same — "a set at 0.4 with a
   * queue is not finished, and that used to look identical to finished".
   */
  state: 'settled' | 'settling' | null;
  /** Four or more subcategories sharing fewer than six questions. */
  tooFewForTooMany: boolean;
  /** The subcategories it covers, by their own labels. */
  usedBy: string[];
  questions: number;
  places: number;
  /** Candidates waiting on a person. */
  waiting: number;
};

/**
 * One set, opened.
 *
 * `usedBy` carries keys here and bare labels on the list row, because on this
 * screen each one is a removable pill that has to know what it would detach.
 * `state` has no `settling`: that distinction is a fact about the queue, and
 * the queue is the three candidate lists sitting beside it.
 */
export type SetDetail = {
  key: string;
  name: string;
  state: 'settled' | null;
  usedBy: { key: string; label: string }[];
  places: number;
};

/** A question being asked of every place in a set. */
export type SetQuestion = {
  id: number;
  name: string;
  /** "Yes or no", "A number", "A range" — the label's kind, said in words. */
  shape: string;
  gate: boolean;
  /** "62% say yes · 34 answered", or "1.8 average · 12 answered". */
  share: string;
  /** Answered by fewer than six places, so the share means little yet. */
  thin: boolean;
};

/** A label asked of everything, inherited by every set. */
export type GlobalLabel = { key: string; name: string; shape: string };

export type CandidateState = 'confirmed' | 'notconfirmed' | 'validating' | 'seen' | 'held';

/** A word the harvest raised, waiting to be judged. */
export type Candidate = {
  id: number;
  word: string;
  /** Seen on `seen` of the `of` places that were read. Never pre-divided. */
  seen: number;
  of: number;
  state: CandidateState;
  /** GATE or AGE — what promoting it would make it. */
  mark: string | null;
  /** The provenance line, written server-side. */
  provenance: string;
  /** "raised 18 Sep". */
  raised: string;
  /**
   * Polarity, captured at extraction or not at all (§5.1, 20 Sep 2026).
   * "Does it have a wave machine? We couldn't find one" mentions the feature
   * and means the opposite, and once the rented text is gone there is nothing
   * to re-read. Null where the harvest predates polarity.
   */
  denies: number | null;
  /** Kept quotes, from sources Epic owns or may freely read. */
  quotes: { text: string; place: string; source: string }[];
  /**
   * The transient review extract. It is rented text: held only while the word
   * is under review, then gone. `expired` is a different thing from absent —
   * "the extract has expired" and "there never was one" read differently.
   */
  snippet: { text: string; place: string; expired: boolean } | null;
  /** The places that raised it, as chips. */
  places: string[];
  /** Why the classifier could not call it — holding pen only. */
  why: string | null;
  /** What the machine is doing with it — in-flight rows only. */
  doing: string | null;
};

/** A word a human typed that nothing asks yet. */
export type PendingWord = {
  id: number;
  word: string;
  times: number;
  /** Where it came from: "Inspect · Coral Reef and 6 others". */
  from: string;
  /** The closest labels we already have. */
  near: string[];
  /** What a merge would repoint: "38 places · 2 subcategories". */
  repoint: string;
};

/** One of Epic's own labels, and where it is asked. */
export type VocabRow = {
  key: string;
  name: string;
  /** Everywhere, in n sets, or nowhere — the third is the orphan case. */
  scope: 'everywhere' | 'sets' | 'nowhere';
  /** The sets it is asked in, by name. */
  sets: string[];
  places: number;
};

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** A flag on a mapping row: a suggestion with its reason, never an error. */
export type Flag = {
  key: 'nobody' | 'notvisitable' | 'singleton' | 'mixed' | 'orphan' | 'mismatch';
  name: string;
  /** The reason, on hover. Written server-side. */
  why: string;
  /** Whether this one means danger rather than doubt. */
  grave: boolean;
};

/** One of a provider's words, and where it points. */
export type WordRow = {
  word: string;
  label: string;
  /** Places it brings in, and how many of those anybody ever opened. */
  brings: number;
  opens: number;
  /** The subcategory it points at, or null. */
  pointsAt: { key: string; label: string } | null;
  decision: 'mapped' | 'notsure' | 'secondary' | 'notinepic';
  /**
   * Our own word for the decision, beside the screen's four.
   *
   * They are not the same vocabulary. `aside` is Not in Epic and `generic` is
   * a label rather than a drawer, but **`travel` and `nearby` are real answers
   * somebody gave** — parking, and the chemist beside the museum — and both
   * collapse into "kept as a label" if only the four survive. A person who
   * answered `travel` has to be able to see that they did.
   */
  answer: string | null;
  /** Labels riding along on every place it brings. */
  labels: string[];
  flags: Flag[];
};

/**
 * What the signals could see when they last ran.
 *
 * One flagged row out of 479 does not mean the mapping is clean — it means the
 * signals could not see. `demandBlind` is the case that bit us in production:
 * with 29 opens against the 200 a demand signal needs, "nobody goes" was true
 * of everything and the first audit proposed excluding `restaurant`. So the
 * screen says what the run was working from rather than letting an unflagged
 * table read as a healthy one.
 */
export type MappingEvidence = {
  words: number;
  subcategories: number;
  opensKnownFor: number;
  shownKnownFor: number;
  primaryKnownFor: number;
  researched: number;
  tooThinToJudge: number;
  drawersTooThinToJudge: number;
  demandBlind: { opens: number; needs: number } | null;
};

/** A word kept out of Epic, and why. */
export type ExcludedRow = { word: string; label: string; brings: number; why: string };

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * A rule, and the two different ways it can be wrong.
 *
 * `contradicted` is computed — how many of the places it files disagree with
 * what it sets. `overridden` is human — how many times somebody corrected it
 * by hand (epic-1c's `rule_overrides`). Roger asked for both, and they are
 * different problems: "12 places contradict this" is a rule that may be too
 * broad, "41 people have called it wrong" is a rule that is simply wrong.
 */
export type RuleRow = {
  id: number;
  /** What it sets: "How thrilling · 3". */
  what: string;
  level: string;
  where: string;
  places: number;
  contradicted: number;
  overridden: number;
  overriddenAt: string | null;
  /** Contradicted by most of what it files — it is doing more harm than good. */
  dead: boolean;
  subcategory: string | null;
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** A district the rows are previewed in. */
export type District = { code: string; town: string; density: string };

/** A browse row: a title, a copy line and a rule. Never a drawer. */
export type BrowseRow = {
  id: string;
  group: string;
  title: string;
  copy: string;
  /** The rule in shorthand: "how much walking ≥ 3". */
  rule: string;
  /** What it returns per district, keyed by district code. */
  fill: Record<string, { count: number; places: string[] }>;
  /** Below the minimum fill somewhere. */
  thin: boolean;
  hearted: boolean;
  /** Who hearted it, and how long ago in days. */
  heartedBy: string | null;
  heartedDays: number | null;
  /** The share of households that heart it, or null where nobody has. */
  share: number | null;
};

/**
 * Somebody in the household, for the first-heart question.
 *
 * Named `HouseMember` and not `Member` because `api.ts` already exports a
 * `Member` — the household record proper, with birthdays and constraints. This
 * is the four fields the preview needs, and two types called `Member` in one
 * import graph is how the wrong one gets passed.
 */
export type HouseMember = { id: string; name: string; role: 'adult' | 'child'; age: number | null };

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** One stage of a run's funnel, with what is in it. */
export type Stage = {
  key: string;
  /** "places read", "after the resolver" — the words under the number. */
  name: string;
  /**
   * Null where the run never wrote this stage down, which is not nought: an
   * unknown middle and an empty one are different facts and are drawn
   * differently — an em dash rather than a number.
   */
  count: number | null;
  /**
   * The biggest bad drop, which the screen enlarges and reddens. At most one
   * stage per run carries it, and it arrives with the reason named.
   */
  bad: boolean;
};

/** A run, and where its volume died. */
export type RunRow = {
  id: string;
  name: string;
  at: string;
  /** "18 Sep · 620 places · 30 subcategories · Berkshire". */
  scope: string;
  sources: string;
  cost: number;
  funnel: Stage[];
  /**
   * The diagnosis, in words: "the resolver is not collapsing", "the holding
   * pen is taking half", "most words die unconfirmed", or "drop-off looks
   * normal". Written server-side from the thresholds.
   */
  diagnosis: string;
  healthy: boolean;
  /**
   * Whether the run wrote its middle down at all.
   *
   * `recorded: false` is not `healthy: true`. A run from before the funnel was
   * recorded has an *unknown* middle: its stages come back null and the
   * diagnosis reads "not recorded". Drawn in the same dim as "drop-off looks
   * normal" it would claim something nobody measured, so it gets a third
   * reading of its own (epic-f4, 21 Sep 2026).
   */
  recorded: boolean;
  state: 'done' | 'running' | 'failed';
};

/** A run somebody could start, with what it would cost before they do. */
export type Trigger = {
  key: 'free' | 'harvest' | 'validate';
  name: string;
  scope: string;
  sources: string;
  /** "£0.00", or "£2.04" — and "0.33p a place" where there is a rate. */
  cost: string;
  rate: string | null;
  action: string;
};

/** A week of raised against decided. */
export type RunWeek = { label: string; raised: number; decided: number };

/** A set's saturation, with what is waiting beside it. */
export type Saturation = {
  set: string;
  /** New words per ten places. */
  rate: number;
  trend: number[];
  waiting: number;
  /** settled · still growing · stopped growing with a queue. */
  verdict: string;
  tone: 'settled' | 'growing' | 'stuck';
};

/** One decision, for the log. */
export type Decision = {
  id: number;
  word: string;
  set: string | null;
  decision: 'approved' | 'ignored' | 'merged' | 'parked' | 'rejected' | 'held';
  /** The decision said in full: "merged into Play & soft play". */
  said: string;
  at: string;
};

/** A word's whole trail, from first sighting to what it is asked of. */
export type Trail = { word: string; steps: { when: string; what: string }[] };

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * One of the six numbers the screens judge by.
 *
 * Read from the server, never held as a constant in a screen: they govern
 * behaviour, they were set on one district of data, and the screens say so.
 */
export type Threshold = {
  key: string;
  name: string;
  value: number;
  step: number;
  min: number;
  max: number;
  why: string;
  /** Moved from what it shipped as. */
  changed: boolean;
};
