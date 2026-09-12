/**
 * Where a label lands — the answer to "if a place carried only this word,
 * which drawer would it go in?" — and the vocabulary the code already knows.
 *
 * This is the piece that lets the Categories screen show every provider's
 * words lined up against Epic's own categories without a second copy of the
 * mapping anywhere. The maps in the source modules (`TYPE_TO_EXPERIENCE` in
 * google.js, `LEISURE_EXPERIENCE` in osm.js, `ATTRACTION_ROOTS` in
 * wikimedia.js…) stay the one place a provider's word is read into Epic's;
 * this file *runs* them. For one label it builds the venue that provider would
 * have built for a place carrying only that word, and files it exactly as the
 * home screen would — through the same rules and the same resolver — so what
 * the screen says a word does and what the app does with it cannot disagree.
 *
 * Pure apart from what it imports: nothing here asks a provider anything.
 */

import { toVenue as googleVenue, TYPE_TO_CATEGORY, TYPE_TO_EXPERIENCE, FAST_TYPES, SERVICE_TYPES, LODGING, THING_FIRST, SHOP_FIRST } from '../sources/google.js';
import { GOOGLE_TYPES, googleTypeName } from '../sources/googleTypes.js';
import {
  venueFromOsmElement, AMENITY_TO_CATEGORY, SHOP_TO_CATEGORY, AMENITY_EXPERIENCE, TOURISM_EXPERIENCE,
  LEISURE_EXPERIENCE, TOURISM_TO_CATEGORY,
} from '../sources/osm.js';
import { toVenue as tripVenue, TOP_LEVEL } from '../sources/tripadvisor.js';
import { SEGMENT_EXPERIENCE } from '../sources/ticketmaster.js';
import { TAXONOMY_EXPERIENCE } from '../sources/seatgeek.js';
import { CATEGORIES as PHQ_CATEGORIES } from '../sources/predicthq.js';
import { TAG_EXPERIENCE } from '../sources/datathistle.js';
import { ATTRACTION_ROOTS } from '../sources/wikimedia.js';
import { conceptByKey } from './concepts.js';
import { BY_ATLAS_CATEGORY, BY_EXPERIENCE, NO_RULES, NO_VOCAB, shelvesForAtlas, shelvesForVenue } from './moods.js';
import { labelsOf, labelsOfAtlas, parseLabel } from './labels.js';

const humanise = (s) => String(s).replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// the vocabulary the code knows
// ---------------------------------------------------------------------------

/**
 * Every label the code can name without having seen a place: the provider
 * lists and the maps that read them. Written into `taxonomy_labels` once per
 * process, so the table can never say something the code has stopped reading.
 */
export function knownLabels() {
  const out = [];
  const add = (namespace, key, label, note) => out.push({ namespace, key: String(key), label: label ?? null, note: note ?? null });

  // Google: the published list, then whatever google.js reads that the list lacks.
  const listed = new Set();
  for (const { type, group } of GOOGLE_TYPES) { listed.add(type); add('google', type, googleTypeName(type), group); }
  for (const t of [...Object.keys(TYPE_TO_CATEGORY), ...Object.keys(TYPE_TO_EXPERIENCE), ...FAST_TYPES, ...SERVICE_TYPES, ...LODGING, ...THING_FIRST, ...SHOP_FIRST]) {
    if (!listed.has(t)) { listed.add(t); add('google', t, googleTypeName(t), 'read by google.js'); }
  }

  // OpenStreetMap: the tag values the maps read, and the ones a day out is usually tagged with.
  const osm = (k, values, note) => { for (const v of values) add('osm', `${k}=${v}`, humanise(v), note ?? k); };
  osm('amenity', new Set([...Object.keys(AMENITY_TO_CATEGORY), ...Object.keys(AMENITY_EXPERIENCE), 'community_centre', 'library', 'place_of_worship', 'events_venue', 'casino', 'planetarium', 'marketplace']));
  osm('shop', new Set([...Object.keys(SHOP_TO_CATEGORY), 'books', 'farm', 'garden_centre', 'mall', 'antiques', 'gift']));
  osm('tourism', new Set([...Object.keys(TOURISM_EXPERIENCE), ...Object.keys(TOURISM_TO_CATEGORY), 'information', 'picnic_site', 'camp_site', 'caravan_site', 'wine_cellar']));
  osm('leisure', new Set([...Object.keys(LEISURE_EXPERIENCE), 'sports_centre', 'stadium', 'pitch', 'golf_course', 'fitness_centre', 'track', 'horse_riding', 'sauna', 'adventure_park', 'amusement_arcade', 'dance', 'slipway', 'fishing', 'bird_hide', 'common', 'dog_park']));
  osm('historic', ['castle', 'ruins', 'fort', 'manor', 'archaeological_site', 'palace', 'abbey', 'memorial', 'monument', 'church', 'city_gate', 'bath', 'wayside_shrine', 'battlefield', 'aircraft', 'ship', 'building', 'mill', 'tower']);
  osm('natural', ['beach', 'wood', 'peak', 'cave_entrance', 'waterfall', 'water', 'cliff', 'bay', 'heath', 'spring', 'hill']);
  osm('sport', ['swimming', 'climbing', 'ice_skating', 'karting', 'motor', 'equestrian', 'golf', 'tennis', 'football', 'rugby', 'cricket', 'horse_racing', 'skiing', 'water_ski', 'canoe', 'sailing', 'rowing', 'cycling', 'athletics', 'skateboard', 'bowls', 'shooting', 'archery', 'paintball', 'laser_tag', 'trampoline', 'gymnastics', 'multi']);
  osm('attraction', ['roller_coaster', 'water_slide', 'carousel', 'big_wheel', 'maze', 'animal', 'train', 'boat_ride', 'dark_ride', 'drop_tower', 'summer_toboggan']);

  // Tripadvisor: the top level, and the display names the reader looks for.
  for (const k of Object.keys(TOP_LEVEL)) add('tripadvisor', k, k, 'top level');
  for (const k of ['Museums', 'Speciality Museums', 'Art Galleries', 'Art Museums', 'Parks', 'Gardens', 'Nature & Wildlife Areas', 'Zoos', 'Aquariums', 'Theaters', 'Theater & Performances',
    'Historic Sites', 'Landmarks', 'Points of Interest & Landmarks', 'Monuments & Statues', 'Castles', 'Beaches', 'Amusement & Theme Parks', 'Water Parks',
    'Restaurants', 'Bars & Clubs', 'Coffee & Tea', 'Dessert', 'Hotels', 'Speciality Lodging', 'Bed and Breakfast']) add('tripadvisor', k, k, 'display name');

  // The event sources: small, closed lists.
  for (const k of Object.keys(SEGMENT_EXPERIENCE)) add('ticketmaster', k, k, 'segment');
  for (const k of Object.keys(TAXONOMY_EXPERIENCE)) add('seatgeek', k, humanise(k), 'taxonomy');
  for (const k of PHQ_CATEGORIES) add('predicthq', k, humanise(k), 'category');
  for (const k of ['music', 'live music', 'theatre', 'musicals', 'dance', 'comedy', 'film', 'sport', 'walks', 'history', 'heritage', 'markets', 'festivals', 'fairs', 'days out', 'museums', 'art', 'exhibitions', 'books', 'storytime', 'nature', 'outdoors', 'wildlife', 'farm', 'kids', 'families', 'christmas', 'halloween']) add('datathistle', k, humanise(k), 'tag');

  // Epic's own rungs.
  for (const k of Object.keys(BY_ATLAS_CATEGORY)) {
    const roots = Object.values(ATTRACTION_ROOTS).filter((c) => c === k).length;
    add('atlas', k, humanise(k), `${roots} Wikidata root${roots === 1 ? '' : 's'} in ATTRACTION_ROOTS`);
  }
  for (const k of Object.keys(BY_EXPERIENCE)) add('experience', k, conceptByKey(`experience:${k}`)?.label ?? humanise(k), 'domain/concepts.js');
  for (const k of ['restaurant', 'cafe', 'pub', 'bar', 'takeaway', 'bakery', 'attraction', 'hotel', 'event', 'other']) add('venue', k, humanise(k), 'what a search result is');
  for (const k of ['fast-food', 'takeaway']) add('style', k, humanise(k), 'how a food place serves');
  for (const k of ['ticketed', 'good-for-children', 'not-for-children', 'quick-look', 'upmarket', 'reservable']) add('flag', k, humanise(k), 'a yes/no a source stated');

  return out;
}

// ---------------------------------------------------------------------------
// one label as a place
// ---------------------------------------------------------------------------

const experienceFor = (map, key) => map[key] ?? null;
const eventVenue = (source, key, experience) => ({
  source, sourcePlaceId: 'label', name: key, category: 'event',
  experiences: [experience ?? 'festival'], labels: [`${source}:${key}`],
});

/**
 * The venue a provider would build for a place that carried only this word,
 * made by the provider's own `toVenue`, so the reading is the real one. Null
 * when the word cannot be a place on its own (an atlas word, a Wikidata type —
 * those go through the atlas side — or a tag the map reader refuses).
 */
export function venueForLabel(namespace, key) {
  switch (namespace) {
    case 'google':
      return googleVenue({ id: 'label', displayName: { text: key }, types: [key], primaryType: key, location: { latitude: 0, longitude: 0 } });
    case 'osm': {
      const i = key.indexOf('=');
      if (i <= 0) return null;
      return venueFromOsmElement({ type: 'node', id: 0, lat: 0, lon: 0, tags: { name: key, [key.slice(0, i)]: key.slice(i + 1) } });
    }
    case 'tripadvisor':
      return tripVenue({
        id: 0, names: [{ value: key, primary: true }], coordinates: { latitude: 0, longitude: 0 },
        categories: [{ top_level_category: TOP_LEVEL[key] ? key : undefined, display_name: key }],
      });
    case 'ticketmaster': return eventVenue(namespace, key, experienceFor(SEGMENT_EXPERIENCE, key));
    case 'seatgeek': return eventVenue(namespace, key, experienceFor(TAXONOMY_EXPERIENCE, key));
    case 'predicthq': return eventVenue(namespace, key, { community: 'festival', festivals: 'festival', 'performing-arts': 'theatre', concerts: 'live-music', sports: 'sports-game', expos: 'festival' }[key]);
    case 'datathistle': return eventVenue(namespace, key, TAG_EXPERIENCE.find(([re]) => re.test(key))?.[1]);
    case 'experience': return { source: 'epic', sourcePlaceId: 'label', name: key, category: 'attraction', experiences: [key] };
    case 'venue': return { source: 'epic', sourcePlaceId: 'label', name: key, category: key, experiences: [] };
    case 'style': return { source: 'epic', sourcePlaceId: 'label', name: key, category: 'restaurant', experiences: [], styles: [key] };
    case 'flag': return {
      source: 'epic', sourcePlaceId: 'label', name: key, category: 'attraction', experiences: [],
      ticketed: key === 'ticketed', quickLook: key === 'quick-look', upmarket: key === 'upmarket', reservable: key === 'reservable',
      goodForChildren: key === 'good-for-children' ? true : key === 'not-for-children' ? false : null,
    };
    default: return null;
  }
}

/**
 * Where one label lands, and why.
 *
 *   how: 'taught'   a rule decided it — `via` says which
 *        'default'  the code's own map decided it
 *        'fallback' nothing knew the word; it fell to the broadest shelf
 *        'none'     the word cannot be a place on its own
 *
 * `derived` is what Epic read the word into on the way: the experience, the
 * venue category, the styles. That is the ladder the screen draws.
 */
export function landingOf({ namespace, key, kindCategory = null }, rules = NO_RULES, vocab = NO_VOCAB) {
  let filed = null;
  let derived = [];
  if (namespace === 'atlas') {
    filed = shelvesForAtlas({ category: key }, rules, vocab);
    derived = labelsOfAtlas({ category: key });
  } else if (namespace === 'wikidata') {
    filed = shelvesForAtlas({ category: kindCategory, kinds: [key] }, rules, vocab);
    derived = labelsOfAtlas({ category: kindCategory, kinds: [key] });
  } else {
    const v = venueForLabel(namespace, key);
    if (!v) return { category: null, subcategory: null, how: 'none', via: null, derived: [] };
    filed = shelvesForVenue(v, rules, vocab);
    derived = labelsOf(v);
  }
  const why = filed.because?.[0] ?? null;
  const own = `${namespace}:${key}`;
  const how = why && why.scope !== 'default' ? 'taught'
    : why && why.subject == null && namespace !== 'atlas' ? 'fallback'
      : 'default';
  return {
    category: filed.category ?? null,
    subcategory: filed.subcategory ?? null,
    how,
    via: why ? { id: why.id ?? null, scope: why.scope, subject: why.subject ?? null, subject_label: why.subject_label ?? null, labels: why.labels ?? null } : null,
    derived: derived.filter((l) => l !== own),
  };
}

/**
 * Where a *set* of labels lands together — the preview under the rule editor.
 * A mixed set is read the way a place carrying all of it would be: the atlas
 * side if any atlas word or Wikidata type is in it, the search side otherwise,
 * with every provider's word read through its own map first.
 */
export function landingOfSet(labels, { kindCategory = null } = {}, rules = NO_RULES, vocab = NO_VOCAB) {
  const parsed = (labels ?? []).map(parseLabel).filter(Boolean);
  const kinds = parsed.filter((p) => p.namespace === 'wikidata').map((p) => p.key);
  const atlas = parsed.find((p) => p.namespace === 'atlas')?.key ?? null;
  const rest = parsed.filter((p) => p.namespace !== 'wikidata' && p.namespace !== 'atlas');

  if (kinds.length || atlas) {
    const extra = rest.map((p) => `${p.namespace}:${p.key}`);
    return shelvesForAtlas({ category: atlas ?? kindCategory, kinds, labels: extra }, rules, vocab);
  }

  // One venue carrying everything the words say.
  const merged = { source: 'epic', sourcePlaceId: 'try', name: 'try', category: null, experiences: [], styles: [], labels: [] };
  for (const p of rest) {
    const v = venueForLabel(p.namespace, p.key);
    if (!v) continue;
    if (v.category && v.category !== 'attraction' && (!merged.category || merged.category === 'attraction')) merged.category = v.category;
    else if (!merged.category) merged.category = v.category ?? null;
    for (const e of v.experiences ?? []) if (!merged.experiences.includes(e)) merged.experiences.push(e);
    for (const s of v.styles ?? []) if (!merged.styles.includes(s)) merged.styles.push(s);
    for (const l of v.labels ?? []) if (!merged.labels.includes(l)) merged.labels.push(l);
    for (const f of ['ticketed', 'quickLook', 'upmarket', 'reservable']) if (v[f]) merged[f] = true;
    if (v.goodForChildren != null) merged.goodForChildren = v.goodForChildren;
  }
  if (!merged.category) merged.category = 'attraction';
  return shelvesForVenue(merged, rules, vocab);
}
