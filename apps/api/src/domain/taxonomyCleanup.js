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

/** Map furniture. A road bridge is on the map because maps need it. */
export const STRUCTURAL = [
  'arch_bridge', 'bridge', 'footbridge', 'railway_bridge', 'road_bridge',
  'building_complex', 'staff_college',
];

/** Types that are a building, not a visit. Individual places get filed by hand. */
export const CHURCHES_OUT = ['parish_church', 'church_building'];

/** "Those are not places anyone goes." */
export const DELIVERY_OUT = ['food_delivery', 'meal_delivery', 'pizza_delivery'];

/** New subcategories the brief asks for, with the category each belongs to. */
export const NEW_SUBCATEGORIES = [
  { key: 'monuments-memorials', label: 'Monuments & memorials', category: 'culture',
    because: 'Landmarks & monuments split: monument, memorial, lighthouse, pier.' },
  { key: 'notable-structures', label: 'Notable structures', category: 'culture',
    because: 'Landmarks & monuments split: viaducts and landmark bridges only.' },
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
export function agreed({ have = new Set(), words = new Set() } = {}) {
  const out = [];
  const ifWord = (k, ...rest) => { if (words.has(k)) out.push(word(k, ...rest)); };
  const ifSub = (k, ...rest) => { if (have.has(k)) out.push(sub(k, ...rest)); };

  // ---- junk drawers ------------------------------------------------------
  for (const k of STRUCTURAL) {
    ifWord(k, 'exclude', 'Not in Epic',
      'Structural map furniture. It is on the map because maps need it, not because anybody visits it.');
  }
  for (const k of CHURCHES_OUT) {
    ifWord(k, 'exclude', 'Not in Epic',
      'A building, not a visit. Cathedrals, abbeys, minsters and priories stay; individual churches get filed by hand.');
  }
  ifSub('landmarks', 'split', 'Monuments & memorials  ·  Notable structures',
    'Junk drawer. Monument, memorial, lighthouse and pier are one thing; viaducts and landmark bridges are another.');
  ifSub('days-out', 'retire', null,
    'Retire. Rowing and canoeing venue goes to Rowing, paddling & sailing; distilleries to Breweries, wineries & distilleries; heritage railway to Heritage railways.');

  // ---- water -------------------------------------------------------------
  ifSub('water-park', 'fold', 'Water parks',
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

  // ---- the new drawers ---------------------------------------------------
  for (const n of NEW_SUBCATEGORIES) {
    if (have.has(n.key)) continue;
    out.push(sub(n.key, 'create', n.label, n.because, { category: n.category }));
  }
  return out;
}
