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
  // The sport and adrenaline drawers Google has no Table A type for. The owner,
  // 21 Sep 2026: "for each sport drawer also make sure there's a Google
  // question: a Table A type where one exists … and a text query where none
  // does, marked text-sourced per the census rule."
  //
  // Only the ones with nothing at all are here. Eleven sport drawers already
  // have a real type doing the work — athletic_field, arena, cycling_park,
  // fishing_charter, golf_course, go_karting_venue, swimming_pool, race_course,
  // tennis_court, ice_skating_rink, adventure_sports_center — and the ordinary
  // census asks those already.
  'skateboard-park': ['skate park', 'skatepark bmx track'],
  'ski-resort': ['dry ski slope', 'indoor ski centre'],
  'indoor-snow': ['indoor snow centre', 'snow dome real snow'],
  'paintball-lasertag': ['paintball centre', 'laser tag arena'],
  'off-road': ['off road driving experience', 'quad biking centre'],
  circuits: ['motor racing circuit', 'race track motorsport'],
  'ancient-sites': ['ancient monument', 'stone circle', 'roman ruins'],
  'historic-houses': ['historic house', 'stately home'],
  'days-out': ['family day out attraction', 'visitor attraction'],
  lidos: ['lido', 'outdoor swimming pool'],
  'caves-falls': ['cave', 'waterfall'],
  // `scenic` was here and is gone: Scenic drives & rides is retired (owner,
  // 21 Sep 2026, "it's an editorial grouping, not a place type"), and a
  // question for a drawer nothing can be filed into is requests spent on
  // nothing. Heritage railways kept its own drawer and its own words.
  football: ['football ground', 'football club stadium'],
  'rugby-cricket': ['rugby club ground', 'cricket ground'],
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

/** Every subcategory Google has no word for, asked in words either way. */
export const WORD_QUESTION_SUBCATEGORIES = [
  ...new Set([...Object.keys(WORD_QUESTIONS), ...Object.keys(TEXT_QUESTIONS)]),
];
