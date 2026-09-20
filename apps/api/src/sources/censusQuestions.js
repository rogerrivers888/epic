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

/** The questions for one subcategory, or none. */
export const wordQuestionsFor = (subcategory) => WORD_QUESTIONS[subcategory] ?? [];

/** Every subcategory that is asked in words because Google has no word for it. */
export const WORD_QUESTION_SUBCATEGORIES = Object.keys(WORD_QUESTIONS);
