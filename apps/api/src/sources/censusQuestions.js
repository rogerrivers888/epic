/**
 * The questions Google has no word for.
 *
 * The census asks one Text Search per Google place type inside each Epic
 * subcategory, and a subcategory with no mapped type generates **no queries at
 * all** — so it comes back nought, and nought is indistinguishable from "there
 * are none in the south of England". For a climbing wall that is obviously
 * false (brief, *The big census run*, 20 Sep 2026, §2).
 *
 * Five subcategories are in that position, and working the not-sure queue
 * against them turns up the reason: **Google's Table A has no type for any of
 * them.** There is no climbing word, no rowing word, no zip-line word, no
 * wakeboarding word. Checked against the published list on 2026-09-12 (see
 * `googleTypes.js`), the nearest words are group names — `sports_activity_location`,
 * `sports_club` — that stand for hundreds of other things as well.
 *
 * So the question is asked in two parts, and **both parts fence it**:
 *
 *   · `type` is a real Table A type, sent as `includedType`. Google itself
 *     guarantees every place it returns carries it.
 *   · `words` are sent as the text query. They narrow that type to the thing
 *     we actually mean.
 *
 * That distinction is the whole reason this file is not simply a text search.
 * A bare text query on the IDs Only mask cannot be checked against anything —
 * there is no `types` field to read back, because that field is Pro and the
 * census may not buy it — so "landmark" would have counted everything *named*
 * Landmark as a landmark. A census that invents membership is worse than one
 * with a hole in it, because the hole is visible and the invention is not
 * (Codex, 19 Sep 2026). With `includedType` set, the worst case is a sports
 * activity location that is not a climbing wall: a wrong member of a real
 * category, not a made-up one — and the OSM cross-check on the same box is
 * what shows whether that is happening.
 *
 * **These are questions, not mappings.** Which drawer a place is filed under
 * is `shelf_rules`' business and is still taught in the back office; this says
 * only how to ask Google about a drawer whose Google word does not exist. That
 * is also why the broad type is not taught as a rule: teaching
 * `google:sports_activity_location` onto Climbing would file every gym class
 * and five-a-side pitch there for ever, where asking it with words files only
 * what came back to the words.
 *
 * Adding one is a line here and costs nothing but the requests it asks.
 */

/**
 * Subcategory key -> the questions to ask for it.
 *
 * `type` must be a type Google will accept in `includedType` (Table A, and not
 * in `NOT_ASKABLE`); `words` are what a person would type.
 */
export const WORD_QUESTIONS = {
  // No climbing word anywhere in Table A. Walls and bouldering centres come
  // back as sports activity locations, and a few as gyms — both are asked,
  // because a bouldering gym typed `gym` is the commonest miss of the two.
  climbing: [
    { type: 'sports_activity_location', words: 'climbing wall' },
    { type: 'sports_activity_location', words: 'bouldering centre' },
    { type: 'gym', words: 'climbing wall bouldering' },
  ],
  // `marina` exists and is already Outdoors' drawer — a marina is a place on
  // the water, not a club that takes you out on it. The clubs are what this
  // subcategory means, and they are typed as clubs.
  paddling: [
    { type: 'sports_club', words: 'sailing club' },
    { type: 'sports_club', words: 'rowing club' },
    { type: 'sports_activity_location', words: 'kayaking canoeing centre' },
  ],
  // Flying has three real types of its own (taught as rules in migration 213),
  // so this is only what they miss: a drop zone is not an airstrip.
  flying: [
    { type: 'sports_activity_location', words: 'skydiving centre' },
    { type: 'sports_activity_location', words: 'gliding club' },
  ],
  ropes: [
    { type: 'sports_activity_location', words: 'high ropes course' },
    { type: 'sports_activity_location', words: 'zip line' },
    { type: 'amusement_park', words: 'aerial adventure course' },
  ],
  watersports: [
    { type: 'sports_activity_location', words: 'wakeboarding cable park' },
    { type: 'sports_activity_location', words: 'water ski club' },
  ],
  // There is no `horse_riding` type. There is `stable`, which Google files
  // under Facilities beside public baths — so it is a real Table A type and
  // this drawer gets fenced questions rather than bare text. `stable` alone
  // would miss the riding schools that type themselves as activity locations,
  // which is what the second and third ask for.
  'riding-stables': [
    { type: 'stable', words: 'riding stables' },
    { type: 'sports_activity_location', words: 'horse riding school' },
    { type: 'sports_activity_location', words: 'pony trekking centre' },
  ],

  // The drawers that were asked in bare text until 25 Sep 2026, re-fenced.
  //
  // Owner, 25 Sep 2026, on the text-sourced table: "Historic houses at 8,159
  // places all from a text query means most of them are estate agents, pubs
  // called The Manor, and street names — the drawer is right and the query is
  // wrong. Map each to its real Google type: historical_place, stadium,
  // sports_complex, off_roading_area, swimming_pool and so on, then drop the
  // bare-text query." The type here is the fence; the words still say which
  // members of it the drawer means, because `historical_place` is already
  // Landmarks' rule, `stadium` is Arenas' and `swimming_pool` is Pools' — a
  // typed rule files, a fenced question only asks.
  'historic-houses': [
    { type: 'historical_place', words: 'historic house' },
    { type: 'historical_place', words: 'stately home' },
    { type: 'historical_landmark', words: 'stately home' },
  ],
  'ancient-sites': [
    { type: 'historical_landmark', words: 'ancient monument' },
    { type: 'historical_landmark', words: 'stone circle' },
    { type: 'historical_place', words: 'roman ruins' },
  ],
  football: [
    { type: 'stadium', words: 'football ground' },
    { type: 'stadium', words: 'football club stadium' },
    { type: 'sports_complex', words: 'football club ground' },
  ],
  'rugby-cricket': [
    { type: 'sports_club', words: 'rugby club' },
    { type: 'sports_club', words: 'cricket club' },
    { type: 'sports_complex', words: 'rugby ground' },
    { type: 'sports_complex', words: 'cricket ground' },
  ],
  lidos: [
    { type: 'swimming_pool', words: 'lido' },
    { type: 'swimming_pool', words: 'outdoor swimming pool' },
  ],
  'caves-falls': [
    { type: 'tourist_attraction', words: 'cave' },
    { type: 'tourist_attraction', words: 'waterfall' },
    { type: 'hiking_area', words: 'waterfall' },
  ],
  circuits: [
    { type: 'stadium', words: 'motor racing circuit' },
    { type: 'event_venue', words: 'motor racing circuit' },
    { type: 'sports_complex', words: 'race track motorsport' },
  ],
  'days-out': [
    { type: 'tourist_attraction', words: 'family day out attraction' },
    { type: 'tourist_attraction', words: 'visitor attraction' },
  ],
  // Paintball has its own Table A type and a typed rule already asks it; laser
  // tag has none, so it is asked of the amusement centres by name.
  'paintball-lasertag': [
    { type: 'amusement_center', words: 'laser tag arena' },
  ],
};

/**
 * The nine with no typed form at all, asked in plain words and labelled as
 * such.
 *
 * Owner, 21 September 2026: "The nine drawers with no Table A type: add a text
 * query for each before the run, but mark the slice as text-sourced. On the
 * board, a text-sourced count carries that label, and a place found only by a
 * text query is filed under that drawer with found_by = text, so I can open
 * twenty in the Places tab and judge precision before trusting the number.
 * **This is different from the earlier P1: that was a text fallback for invalid
 * typed queries; these questions have no typed form at all.**"
 *
 * That distinction is the whole licence for this file's second half. The thing
 * Codex stopped in September was a slice quietly *rephrasing* a type Google
 * rejected into a text search and counting the answer as that type — membership
 * invented where nobody could see it, on a mask with no `types` field to check
 * it against. Here there was never a type to fall back from, the slice says so
 * on its own row, the count says so on the board, and the places say so on
 * themselves. An answer a person can audit and reject is a different object
 * from one that hides.
 *
 * So these are asked bare: no `includedType`, because there is no honest one.
 * Two or three phrasings each, which is what a person would type, and no more —
 * every phrasing is a question of every tile in the region.
 */
export const TEXT_QUESTIONS = {
  // Empty since 25 Sep 2026, and kept so the shape of the plan and the label
  // on the board do not change under it. Thirteen drawers were asked here:
  // eight are fenced word questions above now; four — Skateboard parks,
  // Indoor snow and dry slopes, Off-road driving and Paintball — have a typed
  // rule of their own that already asks (skateboard_park, ski_resort,
  // off_roading_area, paintball_center), and their text was only ever adding
  // places that carried none of those types; Ski resort is folded into Indoor
  // snow and dry slopes and gets no question, so it empties as its tiles come
  // round again. Nothing found by text was deleted: the places keep
  // `found_by = text` for the owner to judge, and `textStillAsked` below is
  // what stops them being counted as the drawer's number.
};

/**
 * What a slice was sourced from, which travels with every count made of it.
 *
 *   type  — an `includedType` Google guarantees. The ordinary census.
 *   words — words narrowing a real type, for the five Google has no word for.
 *   text  — words and nothing else, for the nine with no typed form at all.
 */
export const SOURCED = { TYPE: 'type', WORDS: 'words', TEXT: 'text' };

/** The questions for one subcategory: the type-fenced ones, then the bare text. */
export const wordQuestionsFor = (subcategory) => [
  ...(WORD_QUESTIONS[subcategory] ?? []).map((q) => ({ ...q, sourced: SOURCED.WORDS })),
  // Last, deliberately. A place a typed question already found keeps that
  // question as its `found_by`, so "found only by a text query" means exactly
  // that — which is what makes the twenty a person opens the right twenty.
  ...(TEXT_QUESTIONS[subcategory] ?? []).map((words) => ({ type: null, words, sourced: SOURCED.TEXT })),
];

/**
 * Whether a drawer still asks a bare text question.
 *
 * A surfacing marked `text` was an answer to a question that no longer
 * exists once the drawer is re-fenced, and a count that went on including it
 * would carry the inflation the re-fencing was for until every tile had come
 * round again. So the roll-up and the ring count read this: a text-sourced
 * surfacing counts only while its drawer is still asked in text. The rows
 * themselves stay, because "a place found only by a text query is filed under
 * that drawer with found_by = text, so I can open twenty in the Places tab
 * and judge precision" (owner, 21 Sep 2026) is still the point of them.
 */
export const textStillAsked = (subcategory) => Boolean(TEXT_QUESTIONS[subcategory]?.length);

/** Every subcategory Google has no word for, asked in words either way. */
export const WORD_QUESTION_SUBCATEGORIES = [
  ...new Set([...Object.keys(WORD_QUESTIONS), ...Object.keys(TEXT_QUESTIONS)]),
];
