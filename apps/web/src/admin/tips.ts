/**
 * What every figure on these screens means, in the owner's own words.
 *
 * The law the design package states first: **no prose on any screen.** Not a
 * sentence of commentary, ever — if something needs explaining it goes in a
 * hover. So every column header, every stat label and **every data cell**
 * explains itself, and a cell inherits its column's explanation automatically
 * rather than being wired one at a time. A new column cannot ship with
 * unexplained figures under it, because the column definition carries the tip.
 *
 * Kept in one file rather than beside each table so that the same word means the
 * same thing in every lens — "one word, one meaning" is the sixth of the laws,
 * and two tables that had drifted apart would be impossible to notice.
 *
 * Copy is the design's, verbatim.
 *
 * **Nothing unused lives here.** Thirty-three of these were defined and
 * referenced by nothing (17 Sep 2026, the verification audit), in three
 * different ways: superseded by a hover the screen composes with the real
 * figures in it, duplicated from a source of truth on the API side — the fact
 * definitions in `domain/placeIndex.js`, the run definitions in
 * `repositories/runs.js`, the owed-item states in `HowItWorks.tsx` — or
 * unreachable because the figure the words explain is not on any board. All
 * three are the same mistake: a second place for the words to live, which is
 * exactly what this file exists to prevent. A tip whose figure is not drawn is
 * a missing figure, not a spare sentence.
 */

/** `[title, body]` — the title is the lime line above, the body the sentence under it. */
export type Tip = readonly [title: string, body: string];

export const TIPS = {
  afterTheChange: ['After the change', 'How many would meet the bar you are composing, as a share and a count.'],
  askedFor: ['Asked for', 'The subject a household searched for in the last 30 days.'],
  avgScore: ['Average score', 'The mean data score here, 0 to 100 — weighted completeness over the facts that kind of place needs. Not a place\'s Epic score, which ranks how good it is.'],
  avgScoreCategory: ['Average score', 'The mean data score of the places in this category here.'],
  avgScoreSubcategory: ['Average score', 'The mean data score of the places in this subcategory here.'],
  beenThere: ['Been there', 'How many people have left a review, added across every provider that has returned this place and banded at the moment of the call. A fact about how busy it is, not how good it is — and a word rather than a figure, because the figure is somebody else\'s and is never written down.'],
  britainOverall: ['Britain overall', 'The national readiness figure before and after the change.'],
  cap: ['Cap', 'The ceiling enforced before the call is made, not after.'],
  ceiling: ['Ceiling', 'The monthly spend limit. Nothing spends past it.'],
  checked: ['Checked', 'When we last confirmed it against its source.'],
  cityOrTown: ['City or town', 'Break the same level down by town instead of county. A town nests under its county; an outcode does not.'],
  collect: ['Collect', 'What we could get for this area, which sources could supply it and what each would cost. Starting a run happens here, where the gap is; the Runs page only watches what is already going.'],
  costs: ['Costs', 'What one run of this spends.'],
  countiesWhoseFigureMoves: ['Counties whose figure moves', 'How many counties would report a different readiness after this change.'],
  country: ['Country', 'Every place we have ever seen in that country, and whether its travel times are worked out yet.'],
  county: ['County', 'A county is a shape, so it needs no radius — a town or a postcode may take one.'],
  dataScore: ['Data score', 'Weighted completeness over the facts this kind of place needs, worked out again from scratch each time.'],
  dataScoreBand: ['Data score band', 'How many places here score in that range, out of 100.'],
  distancesComputed: ['Distances computed', 'None, because the answer was worked out once rather than per search.'],
  dwell: ['Dwell', 'How long they stayed on the place before leaving.'],
  editableColumn: ['Ours, so editable', 'We wrote or derived this, so it can be changed here. A provider\'s column cannot be edited — it changes when they change it.'],
  editableValue: ['Ours, so editable', 'Values we wrote or derived can be changed here. A provider\'s value cannot — it changes when they change it.'],
  empty: ['Came back empty', 'Of those searches, the ones we showed nothing for. A coverage hole, and Collect is where it gets fixed.'],
  emptyTotal: ['Came back empty', 'Searches we showed nothing for. A coverage hole.'],
  fact: ['Fact', 'One field a household would expect to see on the place.'],
  fault: ['Fault', 'Which of the three numbers on the left is the worst, named plainly. No places — we hold none, so nothing could be shown. Wrong places — we showed some and nobody opened them, so the mapping is off. Thin places — they were opened and nobody went, so the records are too sparse to convince. Under a fifth on all three reads Working; a fifth or more on all three reads All three.'],
  field: ['Field', 'Every field a place can carry, whether or not we hold it.'],
  fromHouseholds: ['From households', 'Photographs a household sent us. Ours to keep, unlike a provider\'s.'],
  google: ['Google', 'Rented: identifiers and counts only, with nothing stored.'],
  googleOnlyNoName: ['Google only, no name', 'Of those, the ones only Google has returned, so we hold no name for them. Fetching a name costs £0.014 each.'],
  hours: ['Hours', 'Opening hours, and when they were last checked.'],
  howWeGotToHigh: ['How we got to this word', 'The rating every provider returned, pulled towards 4.15 in proportion to how few reviews there are, then banded: 4.55 and above is top, 4.3 to 4.54 high, 4.0 to 4.29 good, below that mixed. Only the word is kept — the rating and the counts are never written down.'],
  howWeGotToVeryBusy: ['How we got to this word', 'How many people have left a review, added across every provider that returned this place, banded at the moment of the call: two thousand and over is thousands, five hundred is many, a hundred is hundreds, below that a few. The figure itself is not stored.'],
  identifiedOnly: ['Identified only', 'We know from Google that the place exists and we own nothing about it. A place a household has saved is counted as Claimed rather than here.'],
  input: ['Input', 'One thing that went into the score.'],
  itsScore: ['Its score', 'That place\'s data score at the time they were shown it.'],
  known: ['Known', 'Every place any source has ever seen here, however little we hold about it.'],
  lastRun: ['Last run', 'When this last completed.'],
  menu: ['Menu', 'A menu we could read. Required for somewhere that serves food, never for a playground.'],
  missing: ['Missing', 'Of the three facts a playground needs — a picture, what it is, opening hours — how many we do not hold. Sortable.'],
  nearest: ['Nearest', 'How far the closest one is, as an estimate.'],
  nearestPostcodeArea: ['Nearest postcode area', 'A search from a map pin or a town name snaps to the nearest one.'],
  needsLookingAt: ['Needs looking at', 'Runs that stopped, failed or were never picked up.'],
  neverTripped: ['Never tripped', 'They opened a place and never added it to a trip, so the place itself was too thin to convince.'],
  noClick: ['Clicked nothing', 'They were shown places and opened none of them, so the wrong things were shown and the category rules need changing.'],
  noClickShort: ['Clicked nothing', 'They were shown places and opened none, so the wrong things were shown and the category rules need changing.'],
  noMatch: ['No match', 'We looked and this place is not in Wikidata.'],
  noRating: ['No rating', 'OSM carries no ratings, and no rating-bearing source has returned this place, so there is no band.'],
  notAsked: ['Not asked', 'We have never spent a call asking this source about this place, so we hold no id for it there. Different from asking and finding nothing.'],
  notCounted: ['Not counted', 'A playground is not judged on this, so it never counts against the score. The bar is set per kind of place.'],
  nothingToCount: ['Nothing to count', 'No source that carries review counts has returned this place, so there is no figure — not a figure of zero.'],
  oldestFactBand: ['Oldest fact', 'How long ago the stalest fact on those places was last checked.'],
  oldestFactNever: ['Oldest fact', 'Places where nothing has ever been checked.'],
  oldestFactOver12: ['Oldest fact', 'These look complete and are not. Completeness on its own never shows this.'],
  oldestFactPlace: ['Oldest fact', 'How long ago the stalest fact on this place was checked.'],
  oneSourceOnly: ['One source only', 'Places here that a single source has ever returned. If that source went dark we would lose them.'],
  openTheRow: ['Open the row', 'Expands to the exact record and key it came from, and the raw value as the source returned it.'],
  opened: ['Opened', 'How many of them they tapped into.'],
  openingHours: ['Opening hours', 'When it is open, and how long ago we last checked.'],
  openstreetmap: ['OpenStreetMap', 'Ours to keep under its licence, which is why most of our names come from here.'],
  ourCategory: ['Our category', 'One of our 8. Every one is listed whether or not anything landed in it, because an empty one is the finding.'],
  ourScore: ['Our score', 'The composite we keep, worked out again from scratch every time rather than adjusted.'],
  ourSubcategory: ['Our subcategory', 'One of ours. Every one is listed whether or not anything landed in it, because an empty one is the finding.'],
  ours: ['Ours', 'Places here we hold our own research on.'],
  oursFault: ['Our own fault', 'Failures caused by our bugs rather than by the venue, kept separate so they cannot be skimmed past.'],
  oursFaultRow: ['Our own fault', 'How many failed this way. This one is a bug, not a venue problem.'],
  owned: ['Owned', 'We hold our own research on it, so it survives every provider going dark. A place a household merely saved is Claimed, not this.'],
  claimed: ['Claimed', 'A household saved, shortlisted or visited it, so it matters — but we still hold nothing of our own about it. The shortest list of places worth researching.'],
  ownedInput: ['Owned', 'Yes means we can keep this input for good — our own research, or a public register. No means it is licensed: we may read it to work out a band, but not store it, so it has to be fetched again.'],
  pictureFact: ['Picture', 'A photograph we own outright and may keep.'],
  pictures: ['Pictures', 'Photographs we own outright. Rented ones cannot be stored and do not count.'],
  placeRow: ['Place', 'Open it for every field, where each came from, and how it scored.'],
  placeWorth: ['Place', 'The place itself. Open it for every fact and where each came from.'],
  placesThatStopBeingReady: ['Places that stop being ready', 'How many fall below the new bar. The number going down is the point — it was wrong before.'],
  placesWithNoPicture: ['Places with no picture', 'Places where we hold no image we are allowed to keep.'],
  position: ['Position', 'Where it sat in the list they were shown. Anything they never reached is still logged.'],
  postcodeAreasInReach: ['Postcode areas in reach', 'How many areas fall inside the ring, read straight from what was worked out in advance.'],
  prices: ['Prices', 'Recorded when we have it. A playground is not judged on it, so it never counts against the score.'],
  providerSpend: ['Provider spend', 'What answering this cost in outbound calls.'],
  rating: ['Rating', 'A word, not a figure. At the moment of the call we read every provider\'s rating and how many people left it, pull the rating towards the average of everything the more thinly it is reviewed, and pick a band: 4.55 and above is top, 4.3 to 4.54 high, 4.0 to 4.29 good, below that mixed. The figures are then thrown away and only the word is kept, so a five from eleven diners cannot out-rank a 4.6 from two thousand.'],
  read: ['Read', 'Menus we successfully read.'],
  ready: ['Ready', 'Enough data to describe the place properly to a household. The bar is set per kind of place: a restaurant needs a menu, a playground never has one.'],
  readyShort: ['Ready', 'Enough data to describe the place properly to a household, with the bar set per kind of place.'],
  rented: ['Rented', 'It exists on Google but we cannot store it, so it does not count as a picture we own.'],
  reported: ['Reported', 'Content somebody has flagged. A different job on a different clock, so it jumps the queue.'],
  restaurantsReadyNow: ['Restaurants ready now', 'How many meet the current bar, as a share and a count.'],
  rowsRead: ['Rows read', 'How many database rows answered this ring. One, because the reachable set was worked out in advance.'],
  runTripadvisorCap: ['Tripadvisor', 'Opt-in and capped at 120 locations a month, enforced before the call is made.'],
  running: ['Running', 'Runs in flight now.'],
  saved: ['Saved', 'How many they kept.'],
  scoreNow: ['Score', 'This place\'s data score now, 0 to 100.'],
  scoreWeights: ['Score', 'Weighted completeness over the three facts a playground needs — a picture 30, what it is 25, opening hours 20. Equal completeness scores equally, and missing the picture costs most.'],
  searches: ['Searches', 'Searches for places in this area in the last 30 days.'],
  searchesRing: ['Searches', 'Searches from inside this ring in the last 30 days.'],
  seenBy: ['Seen by', 'How many providers have ever returned this place.'],
  shelf: ['Shelf', 'Which of our subcategories the place lands in.'],
  shown: ['Shown', 'How many places that household was given.'],
  source: ['Source', 'Where the value came from. Ours means we wrote or derived it, and those are the editable ones.'],
  sourceAtlas: ['The attraction harvest', 'Wikidata and Wikipedia, ours to keep.'],
  sourceSweep: ['The postcode sweep', 'Our own food census of an outcode.'],
  sourceTripadvisor: ['Tripadvisor', 'Opt-in and capped at 120 locations a month, so an empty column usually means we did not spend the call.'],
  spentThisMonth: ['Spent this month', 'Every outbound call is attributed, so this is the real figure and not an estimate.'],
  spentThisMonthCeiling: ['Spent this month', 'Every outbound call is attributed, so this is the real figure and not an estimate. Nothing spends past the ceiling.'],
  state: ['State', 'Where it has got to. There is no done state until something is done.'],
  subcategory: ['Subcategory', 'Which of our subcategories that place sits in.'],
  theRun: ['The run', 'One way of getting more data, with what it costs and what its cap is.'],
  theThreeFaultsAsABar: ['The three faults, as a bar', 'Left to right: came back empty, clicked nothing, never tripped. The widest band is where that subject is failing.'],
  thisIsTheRuleNotThisPlace: ['This is the rule, not this place', 'Changing it moves every place the rule catches. To change only Thorpe Park, pin it — a pin survives the next re-rank.'],
  travelTimes: ['Travel times', 'Whether we can answer "within 30 minutes" here. We work out the driving time between every postcode area once, so a search reads one row instead of doing sums.'],
  travelTimesWorkedOut: ['Travel times worked out', 'When we last worked out the driving times. Redone yearly, or when the roads change materially.'],
  tried: ['Tried', 'Menus we attempted to read.'],
  tripped: ['Tripped', 'Whether any of it ended up in a trip.'],
  unseenBy: ['Unseen by', 'Sources that have never returned this place. One is named; more than one shows the count — open the place for which.'],
  unseenByPlace: ['Unseen by', 'Sources that have never returned this place. Listed on the right with what each would cost.'],
  waiting: ['Waiting', 'Household-made content nobody has looked at yet.'],
  weKnowOf: ['We know of', 'How many places we hold here for that subject, however little we hold about each.'],
  website: ['Website', 'The venue\'s own site, which is where we are allowed to read from.'],
  weight: ['Weight', 'What this input is worth when it applies.'],
  weightAssumption: ['Weight', 'What we assume before we know anything else about a place of that kind.'],
  weightAssumptionCounts: ['Weight', 'How much the starting assumption is allowed to move the score.'],
  weightSplit: ['Weight', 'How the three parts of the score are balanced against each other.'],
  whatIsInReach: ['What is in reach', 'Everything inside the ring, read from the matrix rather than calculated.'],
  whatItGaveUs: ['What it gave us', 'The word or figure this input contributed. Hover any value below for the arithmetic behind it.'],
  whatItIsFact: ['What it is', 'A sentence of our own saying what the place is.'],
  whatItNeeds: ['What it needs', 'The facts this kind of place must have before it counts as ready.'],
  whatTheyDid: ['What they did', 'Whether they scrolled past it, opened it, saved it or never reached it.'],
  whatTheyWereShown: ['What they were shown', 'The results that household saw, in the order they saw them.'],
  whatWasAskedFor: ['What was asked for', 'The subject a household searched for. No subject given means they just asked what was on.'],
  whatWeHold: ['What we hold', 'Our own value. A dash is a hole to fill; n/a means this kind of place is not judged on it.'],
  whatWeOwe: ['What we owe', 'An obligation this work creates. A thing we have not done is said plainly rather than left off.'],
  whereItGotTo: ['Where it got to', 'How far the run reached. A deploy kills a run in flight, and it has to be told to pick up.'],
  whereOursCameFrom: ['Where ours came from', 'Which source gave us our version, and when it was last checked.'],
  wherePlace: ['Where', 'The postcode area the place sits in.'],
  whereRow: ['Where', 'A town, or an outcode our places fall in. They are listed together because an outcode does not nest under a county.'],
  whichFault: ['Which fault', 'Shown nothing, clicked nothing, or never tripped — three different faults.'],
  whoFixesIt: ['Who fixes it', 'Each fault has one owner, which is why there is no single rate on this screen.'],
  whose: ['Whose', 'Who has to act on it.'],
  withoutTheLicensedBit: ['Without the licensed bit', 'The same score with the two rented inputs removed — what survives a provider going dark.'],
  worth: ['Worth', 'What each input contributed. The column adds to the score above it.'],
  ourLabel: ['Their word', 'A word a provider uses for a kind of place, in our vocabulary — `namespace:key`. Every one is listed whether or not anything here carries it, because a word we have written a rule for and nothing lands on is a finding too.'],
  pointsAt: ['Points at', 'Which of our own labels this provider\'s word means. It is what lets a rule written in our words read a place said in theirs.'],
  unscored: ['Not scored yet', 'Places in a subcategory nobody has set a bar for. They are not nought — there is nothing yet to judge them against.'],
  edgeMinutes: ['A few minutes generous', 'The matrix is read a few minutes past what was asked, so a place at the edge of its postcode area is offered rather than lost. The exact pass then fences it.'],
} as const satisfies Record<string, Tip>;

export type TipKey = keyof typeof TIPS;

/** A tip by key, or a pair written in place where a figure explains only itself. */
export const tipOf = (t: TipKey | Tip | null | undefined): Tip | null =>
  (t == null ? null : typeof t === 'string' ? (TIPS[t] ?? null) : t);
