/**
 * Section 4 of the brief: the cleanup that has already been signed off.
 *
 * "These have been reviewed and signed off. Apply them as the first audit, so
 * the flow is exercised on known-good changes."
 *
 * So they are not a migration. They are proposals with the flag `agreed`, and
 * they go through accept, apply and undo like anything the signals find — which
 * is the only way the first use of the flow is on changes somebody already
 * trusts.
 *
 * Everything here is quoted from the brief rather than interpreted. Where the
 * brief says "file individual places by hand", the proposal excludes the *type*
 * and says so; it never touches a place.
 */

const word = (key, action, proposed, because, extra = {}) => ({
  flag: 'agreed', subject_kind: 'word', subject: key, subject_label: null,
  action, now_value: null, proposed, because, numbers: extra, moves: 0,
});
const sub = (key, action, proposed, because, extra = {}) => ({
  flag: 'agreed', subject_kind: 'subcategory', subject: key, subject_label: null,
  action, now_value: null, proposed, because, numbers: extra, moves: 0,
});
/**
 * A Wikidata type, addressed by the QID a rule is stored under.
 *
 * Most of what section 4 names is *not* a Google word. Landmarks & monuments
 * holds 25 rules and 19 of them are `kind` scope — arch bridge is Q158438, not
 * `google:arch_bridge` — so a cleanup that only spoke to Google words left
 * every bridge in place and reported success (found by applying it to
 * production, 20 Sep 2026).
 */
const kind = (qid, label, action, proposed, because) => ({
  flag: 'agreed', subject_kind: 'kind', subject: qid, subject_label: label,
  action, now_value: null, proposed, because, numbers: { qid }, moves: 0,
});

/**
 * The two halves of the Landmarks split, and the words that go to each.
 *
 * Named here rather than left for somebody to type, because the owner named
 * them (20 Sep 2026) and a split whose halves are already decided is an
 * instruction rather than advice.
 */
export const LANDMARK_SPLIT = {
  from: 'landmarks',
  halves: [
    { key: 'monuments-memorials', label: 'Monuments & memorials',
      words: ['monument', 'memorial', 'statue', 'war_memorial'],
      kinds: ['monument', 'memorial', 'statue', 'war memorial', 'sculpture', 'fountain'] },
    { key: 'landmarks-you-can-see', label: 'Landmarks',
      words: ['lighthouse', 'pier', 'tower', 'viaduct', 'observation_wheel', 'ferris_wheel'],
      kinds: ['lighthouse', 'pier', 'tower', 'viaduct', 'railway viaduct', 'windmill',
        'historical landmark', 'cultural landmark', 'historical place'] },
  ],
};

/** Map furniture. A road bridge is on the map because maps need it. */
export const STRUCTURAL = [
  'arch_bridge', 'bridge', 'footbridge', 'railway_bridge', 'road_bridge',
  'building_complex', 'staff_college',
];

/**
 * The same map furniture, as Wikidata calls it. Named rather than QID'd because
 * the QIDs differ per database and the label is what section 4 says.
 */
export const STRUCTURAL_KINDS = [
  'arch bridge', 'bridge', 'footbridge', 'railway bridge', 'road bridge',
  'stone bridge', 'suspension bridge', 'building complex', 'staff college',
  'military academy',
];

/** Types that are a building, not a visit. Individual places get filed by hand. */
export const CHURCHES_OUT = ['parish_church', 'church_building'];

/** "Those are not places anyone goes." */
export const DELIVERY_OUT = ['food_delivery', 'meal_delivery', 'pizza_delivery'];

/** New subcategories the brief asks for, with the category each belongs to. */
export const NEW_SUBCATEGORIES = [
  // The owner corrected his own brief, 20 Sep 2026: "Notable structures is
  // lifeless, and it was also wrong of me to put lighthouses and piers under
  // memorials — a lighthouse isn't a memorial… 'Landmarks' is what a household
  // would actually say."
  { key: 'monuments-memorials', label: 'Monuments & memorials', category: 'culture',
    because: 'Landmarks split, the things raised to remember somebody: monument, memorial, statue, war memorial.' },
  { key: 'landmarks-you-can-see', label: 'Landmarks', category: 'culture',
    because: 'Landmarks split, the things you go and look at: lighthouse, pier, tower, viaduct, notable bridges, observation wheels.' },
  { key: 'breweries-distilleries', label: 'Breweries, wineries & distilleries', category: 'food',
    because: 'Rehomed from Days out: distillery, whisky distillery.' },
  { key: 'heritage-railways', label: 'Heritage railways', category: 'fun',
    because: 'Rehomed from Days out: heritage railway.' },
  { key: 'paintball-lasertag', label: 'Paintball, laser tag & airsoft', category: 'adrenaline',
    because: 'Singletons folded together: paintball centre, adventure sports centre.' },
  { key: 'indoor-snow', label: 'Indoor snow & dry slopes', category: 'adrenaline',
    because: 'Singleton given an honest name: ski resort, in Britain.' },
  { key: 'farm-shops-delis', label: 'Farm shops & delis', category: 'food', because: 'Asked for in section 4.' },
  { key: 'afternoon-tea', label: 'Afternoon tea', category: 'food', because: 'Asked for in section 4.' },
  { key: 'pick-your-own', label: 'Pick-your-own farms', category: 'fun', because: 'Asked for in section 4.' },
  { key: 'model-villages', label: 'Model villages', category: 'fun', because: 'Asked for in section 4.' },
  { key: 'mazes', label: 'Mazes & adventure golf', category: 'fun', because: 'Asked for in section 4.' },
  { key: 'splash-pads', label: 'Splash pads', category: 'fun', because: 'Asked for in section 4.' },
  { key: 'county-shows', label: 'County shows & country fairs', category: 'fun', because: 'Asked for in section 4.' },
];

/**
 * The whole of section 4, as proposals.
 *
 * `have` is the set of subcategory keys that exist, so a proposal about a
 * drawer this database does not have is left out rather than failing at apply.
 */
export function agreed({ have = new Set(), words = new Set(), kinds = new Map() } = {}) {
  const out = [];
  const ifWord = (k, ...rest) => { if (words.has(k)) out.push(word(k, ...rest)); };
  const ifSub = (k, ...rest) => { if (have.has(k)) out.push(sub(k, ...rest)); };
  // `kinds` maps a type's plain name to the QID its rule is stored under, so
  // section 4 can go on naming "arch bridge" rather than Q158438.
  const ifKind = (name, ...rest) => {
    const qid = kinds.get(name);
    if (qid) out.push(kind(qid, name, ...rest));
  };

  // ---- junk drawers ------------------------------------------------------
  const furniture = 'Structural map furniture. It is on the map because maps need it, not because anybody visits it.';
  for (const k of STRUCTURAL) ifWord(k, 'exclude', 'Not in Epic', furniture);
  // The same words again as Wikidata types, which is how most of them are
  // actually filed.
  for (const name of STRUCTURAL_KINDS) ifKind(name, 'exclude', 'Not in Epic', furniture);
  for (const k of CHURCHES_OUT) {
    ifWord(k, 'exclude', 'Not in Epic',
      'A building, not a visit. Cathedrals, abbeys, minsters and priories stay; individual churches get filed by hand.');
  }
  ifSub('landmarks', 'split', 'Monuments & memorials  \u00b7  Landmarks',
    'Junk drawer. What was raised to remember somebody is one thing; what you go and look at is another. A lighthouse is not a memorial.');
  ifSub('days-out', 'retire', null,
    'Retire. Rowing and canoeing venue goes to Rowing, paddling & sailing; distilleries to Breweries, wineries & distilleries; heritage railway to Heritage railways.');

  // ---- water -------------------------------------------------------------
  // The brief says "fold the Fun > Water park singleton into Water parks", and
  // `water-park` *is* the water parks drawer -- there is nothing else to fold
  // it into. So it is the rename the sentence actually asks for, and the three
  // drawers the brief wants then all exist: Water parks, Pools & leisure
  // centres, Lidos & outdoor swimming.
  ifSub('water-park', 'rename', 'Water parks',
    'Resolve water to three drawers: Water parks (indoor), Pools & leisure centres, Lidos & outdoor swimming.');

  // ---- singletons --------------------------------------------------------
  ifSub('miniature-golf-course', 'rename', 'Crazy golf & mini golf', 'Singleton, given the name a household would use.');
  ifSub('skateboard-park', 'rename', 'Skateparks & BMX', 'Singleton renamed, and moved to Active.');
  ifSub('library', 'retire', null, 'Retire; file individual places by hand.');
  ifSub('cultural-centre', 'retire', null, 'Retire; file individual places by hand.');
  ifWord('indoor_golf_course', 'repoint', 'golf', 'Fold into Golf clubs and carry it as a secondary label rather than a drawer of its own.');
  ifSub('barbecue-area', 'fold', 'Parks & commons', 'A facet of a park, not somewhere you browse to.');

  // ---- food and drink ----------------------------------------------------
  ifSub('fast-food', 'rename', 'Quick bites',
    'Somewhere quick and good is a real need on a day out, and Google files genuinely good places under these types.');
  for (const k of DELIVERY_OUT) {
    ifWord(k, 'exclude', 'Not in Epic', 'Not a place anyone goes.');
  }

  // ---- smaller -----------------------------------------------------------
  ifWord('yoga_studio', 'exclude', 'Not in Epic',
    'A weekly class near home is not a day out, and it belongs to Hosting.');

  // The owner settled the shops that sit on the line, 20 Sep 2026: "My
  // exclusion test was about services you book near home — gyms, dentists, nail
  // bars. A deli or a chocolate shop in a market town is a genuine stop on a
  // day out." So they stay, and they are filed rather than excluded. That they
  // should not *lead* a result set is a ranking matter and is not decided here.
  ifWord('chocolate_shop', 'repoint', 'cafes', 'A stop on the wander, not a service you book. Files under Cafés & bakeries.');
  ifWord('cake_shop', 'repoint', 'cafes', 'A stop on the wander, not a service you book. Files under Cafés & bakeries.');
  ifWord('deli', 'repoint', 'farm-shops-delis', 'A stop on the wander. Files under Farm shops & delis.');

  // ---- the new drawers ---------------------------------------------------
  for (const n of NEW_SUBCATEGORIES) {
    if (have.has(n.key)) continue;
    out.push(sub(n.key, 'create', n.label, n.because, { category: n.category }));
  }
  return out;
}
