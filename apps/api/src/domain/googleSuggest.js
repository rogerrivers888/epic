/**
 * A suggested home for each of Google's place types.
 *
 * The owner, 12 Sep 2026: "show unmapped categories and create a mapping tool
 * so that I can select immediately, on the fly, right there, from a dropdown…
 * You could also suggest the category, and I could approve it or change it."
 *
 * So every Google type Epic has not decided about comes with a suggestion:
 * one of our subcategories, or "not a day out". A suggestion is only ever a
 * suggestion — nothing here writes a rule; the screen does, when he approves.
 * The list is hand-kept against Table A (sources/googleTypes.js) and says
 * nothing where the answer is not obvious (paintball, a ski resort, a skate
 * park have no drawer yet), because a wrong suggestion approved in bulk is
 * worse than a blank.
 *
 * Whole groups that are never a day out — Automotive, Finance, Government,
 * Services, Transportation, Lodging (beds are the stay wizard's) — are
 * suggested aside, one type at a time, so approving a group is one press.
 */

/** Google type → our subcategory key. */
const TO_SUBCATEGORY = {
  // Entertainment and Recreation
  adventure_sports_center: 'ropes', amphitheatre: 'theatre', amusement_center: 'cinema-bowling', amusement_park: 'theme-parks',
  aquarium: 'zoos-wildlife', barbecue_area: 'parks', botanical_garden: 'gardens', bowling_alley: 'cinema-bowling',
  city_park: 'parks', comedy_club: 'live-music', concert_hall: 'theatre', cultural_center: 'galleries', cycling_park: 'cycling', go_karting_venue: 'karting',
  dance_hall: 'live-music', dog_park: 'parks', event_venue: 'live-music', ferris_wheel: 'theme-parks', garden: 'gardens',
  hiking_area: 'trails', historical_landmark: 'landmarks', indoor_playground: 'play', karaoke: 'live-music',
  live_music_venue: 'live-music', marina: 'paddling', miniature_golf_course: 'days-out', movie_theater: 'cinema-bowling',
  national_park: 'nature', night_club: 'pubs-bars', observation_deck: 'viewpoints', off_roading_area: 'off-road',
  opera_house: 'theatre', park: 'parks', philharmonic_hall: 'theatre', picnic_ground: 'parks', planetarium: 'museums',
  roller_coaster: 'theme-parks', state_park: 'nature', video_arcade: 'cinema-bowling', water_park: 'theme-parks',
  wildlife_park: 'zoos-wildlife', wildlife_refuge: 'nature', zoo: 'zoos-wildlife',
  // Sports
  arena: 'arenas', athletic_field: 'athletics', fishing_pier: 'coast', fishing_pond: 'water', fitness_center: 'pools',
  golf_course: 'golf', gym: 'pools', ice_skating_rink: 'skating', indoor_golf_course: 'golf', playground: 'play',
  race_course: 'racecourses', sports_complex: 'pools', stadium: 'arenas', swimming_pool: 'pools', tennis_court: 'racquet-clubs',
  // Culture
  art_gallery: 'galleries', art_museum: 'galleries', auditorium: 'theatre', castle: 'castles', cultural_landmark: 'landmarks',
  fountain: 'landmarks', historical_place: 'landmarks', history_museum: 'museums', monument: 'landmarks', museum: 'museums',
  performing_arts_theater: 'theatre', sculpture: 'landmarks',
  // Natural Features
  beach: 'coast', island: 'coast', lake: 'water', mountain_peak: 'hills', nature_preserve: 'nature', river: 'water',
  scenic_spot: 'viewpoints', woods: 'woodland',
  // Places of Worship
  buddhist_temple: 'churches', church: 'churches', place_of_worship: 'churches', hindu_temple: 'churches', mosque: 'churches', shinto_shrine: 'churches', synagogue: 'churches',
  // Shopping — the browsing kind only
  book_store: 'browsing', farmers_market: 'food-markets', flea_market: 'markets', market: 'markets', shopping_mall: 'browsing',
  garden_center: 'browsing', gift_shop: 'browsing', thrift_store: 'browsing', department_store: 'browsing', toy_store: 'browsing',
  // Health and Wellness — the day-out kind only
  spa: 'spas', massage_spa: 'spas', sauna: 'spas', wellness_center: 'spas', yoga_studio: 'spas',
  // Education
  library: 'browsing',
  // Food and Drink, by the shape of the word: the drink
  bar: 'pubs-bars', wine_bar: 'pubs-bars', cocktail_bar: 'pubs-bars', lounge_bar: 'pubs-bars', sports_bar: 'pubs-bars', hookah_bar: 'pubs-bars',
  beer_garden: 'pubs-bars', brewery: 'pubs-bars', brewpub: 'pubs-bars', gastropub: 'pubs-bars', irish_pub: 'pubs-bars', pub: 'pubs-bars',
  winery: 'pubs-bars', vineyard: 'pubs-bars',
  // the cup and the counter
  cafe: 'cafes', coffee_shop: 'cafes', coffee_stand: 'cafes', coffee_roastery: 'cafes', tea_house: 'cafes', bakery: 'cafes', cake_shop: 'cafes',
  pastry_shop: 'cafes', dessert_shop: 'cafes', dessert_restaurant: 'cafes', ice_cream_shop: 'cafes', confectionery: 'cafes', chocolate_shop: 'cafes',
  chocolate_factory: 'cafes', acai_shop: 'cafes', juice_shop: 'cafes', donut_shop: 'cafes', bagel_shop: 'cafes', candy_store: 'cafes', cat_cafe: 'cafes', dog_cafe: 'cafes',
  // eaten standing up
  fast_food_restaurant: 'fast-food', hamburger_restaurant: 'fast-food', meal_takeaway: 'fast-food', meal_delivery: 'fast-food',
  pizza_delivery: 'fast-food', food_court: 'fast-food', hot_dog_stand: 'fast-food', hot_dog_restaurant: 'fast-food', kebab_shop: 'fast-food',
  sandwich_shop: 'fast-food', snack_bar: 'fast-food', cafeteria: 'fast-food', fish_and_chips_restaurant: 'fast-food', food_delivery: 'fast-food',
  // a table
  restaurant: 'restaurants', bistro: 'restaurants', diner: 'restaurants', deli: 'cafes',
  noodle_shop: 'restaurants', salad_shop: 'cafes',
};

/** Words in a `*_restaurant` type that say how you eat, not what: no cuisine to keep. */
const GENERIC_CUISINE = new Set(['fine dining', 'fast food', 'family', 'buffet', 'brunch', 'breakfast', 'dessert', 'fusion', 'western']);

/** Google's groups that are never a day out: every type in them is suggested aside. */
const ASIDE_GROUPS = new Set(['Automotive', 'Business', 'Education', 'Facilities', 'Finance', 'Geographical Areas', 'Government', 'Housing', 'Lodging', 'Services', 'Transportation']);

/** Types in a day-out group that are still not a day out. */
const ASIDE_TYPES = new Set([
  'banquet_hall', 'casino', 'childrens_camp', 'community_center', 'convention_center', 'internet_cafe', 'movie_rental', 'plaza',
  'visitor_center', 'wedding_venue', 'sports_coaching', 'sports_school', 'art_studio',
  'chiropractor', 'dental_clinic', 'dentist', 'doctor', 'drugstore', 'general_hospital', 'hospital', 'massage', 'medical_center', 'medical_clinic',
  'medical_lab', 'pharmacy', 'physiotherapist', 'skin_care_clinic', 'tanning_studio',
]);

/**
 * The suggestion for one Google type, or null where nothing is obvious.
 *
 *   { subcategory: 'castles', why }   — a drawer of ours
 *   { aside: true, why }              — not a day out
 *
 * A restaurant of any cuisine (`*_restaurant`) is Restaurants unless the map
 * above says it is really a counter. Shops not named above are aside: a
 * hardware store is not a browse. Only drawers that exist are suggested.
 */
export function suggestFor(type, group, subcategoryKeys) {
  const has = (k) => subcategoryKeys.includes(k);
  const named = TO_SUBCATEGORY[type];
  if (named) return has(named) ? { subcategory: named, why: 'the obvious subcategory for this word' } : null;
  // A steakhouse and a bar and grill are restaurants with a cuisine of their own.
  if (type === 'steak_house') return has('restaurants') ? { subcategory: 'restaurants', cuisine: 'steakhouse', why: 'a restaurant; steakhouse is kept as its cuisine' } : null;
  if (type === 'bar_and_grill') return has('restaurants') ? { subcategory: 'restaurants', cuisine: 'bar and grill', why: 'a restaurant; bar and grill is kept as its cuisine' } : null;
  if (ASIDE_TYPES.has(type)) return { aside: true, why: 'not somewhere a family goes for the day' };
  if (ASIDE_GROUPS.has(group)) return { aside: true, why: `Google files it under ${group}` };
  if (/_restaurant$/.test(type)) {
    if (!has('restaurants')) return null;
    // The cuisine is not a third level under Restaurants: it is a separate
    // attribute google.js already reads off the type (an Indian restaurant is a
    // restaurant whose cuisine is Indian), so the suggestion says both.
    const cuisine = type.replace(/_restaurant$/, '').replace(/_/g, ' ');
    return GENERIC_CUISINE.has(cuisine)
      ? { subcategory: 'restaurants', why: 'a restaurant' }
      : { subcategory: 'restaurants', cuisine, why: `a restaurant; the cuisine, ${cuisine}, is kept as its own attribute` };
  }
  if (group === 'Shopping') return { aside: true, why: 'a shop, not a browse' };
  return null;
}
