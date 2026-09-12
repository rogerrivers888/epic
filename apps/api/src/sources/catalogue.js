/**
 * The catalogue of sources — every app and API Epic calls, every field each
 * one offers, and which of those fields Epic actually reads.
 *
 * The owner, 12 Sep 2026: "a screen that shows all of the apps and APIs that we
 * use, what they give us, and, very specifically, every single field that we
 * utilise… a deduped master list of fields, and then we can have columns for
 * each one of the providers and which ones of those master fields they
 * actually provide… an ownership tag so that, for sources where we can own the
 * data, I can filter at the top." And, on fields a provider offers that we do
 * not ask for: "absolutely, you should just add that as a tag… Fields that I
 * actually want, like the one about parking, I want that."
 *
 * Two halves, kept honestly apart:
 *
 *   `used`    — what the code reads today. This half is checked against the
 *               adapters (the field masks in google.js, the property reads in
 *               every other module) and a test holds it to them.
 *   `offered` — what the provider documents and we do not request. This half
 *               is a hand-kept list from the provider's own reference, dated
 *               in `checked`, because nothing in our code can know what a
 *               provider could have told us.
 *
 * Every provider carries its `keep` grade, which is the ownership tag:
 *
 *   'own'  — the licence lets us keep the answer for good (ODbL, CC0, CC BY-SA,
 *            a publisher's own page). This is what feeds place_records.
 *   'id'   — the identifier may be kept and nothing else; every display field
 *            is fetched at the moment it is shown (Technical Constraints §4).
 *   'none' — nothing is kept beyond the session, not even an identifier.
 *
 * Nothing here is a call. The screen behind it (/admin/sources) joins this
 * catalogue to the database — place_facts for how much of each owned field we
 * hold, provider_calls for how often each source is asked — so that the
 * catalogue says what could be true and the numbers say what is.
 */

/** The day the `offered` lists were last read against the providers' references. */
export const CHECKED_ON = '2026-09-12';

// ---------------------------------------------------------------------------
// the master list
// ---------------------------------------------------------------------------

export const DOMAINS = [
  { key: 'identity', label: 'Identity', what: 'What a place is called and what kind of thing it is' },
  { key: 'location', label: 'Location', what: 'Where it is, down to the door' },
  { key: 'contact', label: 'Contact', what: 'How to reach it and how to book' },
  { key: 'hours', label: 'Hours', what: 'When it is open' },
  { key: 'price', label: 'Price', what: 'What it costs' },
  { key: 'kitchen', label: 'Kitchen', what: 'What it serves, and for whom' },
  { key: 'service', label: 'Service & access', what: 'What it is like to be there' },
  { key: 'family', label: 'Family', what: 'Whether children are welcome' },
  { key: 'reviews', label: 'Reviews', what: 'What other people made of it' },
  { key: 'photos', label: 'Pictures', what: 'What it looks like, and whether we may keep the picture' },
  { key: 'hotel', label: 'Hotels', what: 'Beds, rooms and rates' },
  { key: 'event', label: 'Events', what: 'Things that happen on a date' },
  { key: 'places', label: 'Areas & transit', what: 'Towns, counties, postcodes and stations' },
  { key: 'routes', label: 'Routes', what: 'Getting from one stop to the next' },
  { key: 'text', label: 'Text', what: 'Prose we may read and, sometimes, keep' },
];

/**
 * One row of the matrix. `key` is what every provider maps its own paths on
 * to; `label` is what the screen prints; `note` is the one sentence that says
 * what the row means when two providers call the same thing by different
 * names.
 */
const F = (key, domain, label, note = null) => ({ key, domain, label, note });

export const FIELDS = [
  // identity
  F('id', 'identity', 'Provider identifier', 'The one thing every licence lets us keep.'),
  F('name', 'identity', 'Name'),
  F('alt_names', 'identity', 'Other names', 'Official, native, former or brand names.'),
  F('brand', 'identity', 'Brand or chain'),
  F('category', 'identity', 'Primary category'),
  F('categories', 'identity', 'All categories'),
  F('tags', 'identity', 'Attributes and tags', 'Free-form labels: "Romantic", "Family-friendly", every OSM tag.'),
  F('description', 'identity', 'Description', 'Prose about the place, from whoever wrote it.'),
  F('editorial_summary', 'identity', 'Provider editorial summary', "A provider's own one-liner."),
  F('ai_summary', 'identity', 'Generated summary', 'A provider-side AI summary of reviews or the place.'),
  F('business_status', 'identity', 'Business status', 'Open, closed for good, moved.'),
  F('opened', 'identity', 'Year opened'),
  F('wikidata_id', 'identity', 'Wikidata item'),
  F('wikipedia', 'identity', 'Wikipedia article'),
  F('osm_ref', 'identity', 'OpenStreetMap reference'),
  F('provider_ids', 'identity', 'Other providers\' identifiers', 'Google, Tripadvisor and social IDs held by an open source.'),
  F('website', 'identity', 'Official website'),
  F('provider_page', 'identity', "Provider's own page for it"),
  F('attributions', 'identity', 'Attribution lines the licence demands'),
  F('popularity', 'identity', 'Popularity signal', 'Page views, sitelinks, visitor counts, rank.'),
  F('heritage', 'identity', 'Heritage designation'),
  F('awards', 'identity', 'Awards and accolades'),
  // location
  F('lat_lng', 'location', 'Coordinates'),
  F('address', 'location', 'Formatted address'),
  F('address_parts', 'location', 'Address components', 'Street, number, suburb, town, county, country.'),
  F('postcode', 'location', 'Postcode'),
  F('plus_code', 'location', 'Plus code'),
  F('viewport', 'location', 'Bounds or viewport'),
  F('outline', 'location', 'Outline polygon'),
  F('timezone', 'location', 'Time zone'),
  F('entrances', 'location', 'Entrances and navigation points'),
  F('containing_place', 'location', 'Containing or sub-destinations', 'The mall this is inside; the stages inside this park.'),
  F('neighbourhood', 'location', 'Neighbourhood'),
  F('distance', 'location', 'Distance from the search point'),
  // contact
  F('phone', 'contact', 'Phone'),
  F('phone_intl', 'contact', 'Phone (international form)'),
  F('email', 'contact', 'E-mail'),
  F('socials', 'contact', 'Social profiles'),
  F('booking_url', 'contact', 'Booking link'),
  F('menu_url', 'contact', 'Menu link'),
  // hours
  F('hours_regular', 'hours', 'Regular hours'),
  F('hours_current', 'hours', 'Hours this week', 'With holidays applied.'),
  F('open_now', 'hours', 'Open now'),
  F('next_change', 'hours', 'Next opens or closes at'),
  F('hours_secondary', 'hours', 'Secondary hours', 'Kitchen, delivery, drive-through, happy hour.'),
  F('last_edited', 'hours', 'When the fact was last checked', 'A listing\'s own edit date, so a stale price can say so.'),
  // price
  F('price_level', 'price', 'Price level', 'One to four, or £ to ££££.'),
  F('price_range', 'price', 'Price range', 'A stated range in money.'),
  F('admission_fee', 'price', 'Admission fee or free entry'),
  F('offers', 'price', 'Published offers and ticket prices'),
  F('currency', 'price', 'Currency'),
  // kitchen
  F('cuisine', 'kitchen', 'Cuisine'),
  F('diets', 'kitchen', 'Diets catered for', 'Vegetarian, vegan, halal, kosher, gluten-free, dairy-free.'),
  F('meals', 'kitchen', 'Meals served', 'Breakfast, brunch, lunch, dinner.'),
  F('drinks', 'kitchen', 'Drinks served', 'Beer, wine, cocktails.'),
  F('coffee', 'kitchen', 'Serves coffee'),
  F('dessert', 'kitchen', 'Serves dessert'),
  F('menu_items', 'kitchen', 'Menu items and prices', 'The dishes themselves, read off the menu.'),
  F('experiences', 'kitchen', 'Styles and experiences', 'Fine dining, gastropub, tapas.'),
  // service
  F('reservable', 'service', 'Takes reservations'),
  F('delivery', 'service', 'Delivers'),
  F('takeout', 'service', 'Takeaway'),
  F('dine_in', 'service', 'Dine in'),
  F('curbside', 'service', 'Kerbside pickup'),
  F('outdoor_seating', 'service', 'Outdoor seating'),
  F('live_music', 'service', 'Live music'),
  F('toilets', 'service', 'Toilets'),
  F('good_for_groups', 'service', 'Good for groups'),
  F('sports_screens', 'service', 'Good for watching sport'),
  F('payment', 'service', 'Payment options'),
  F('parking', 'service', 'Parking'),
  F('ev_charging', 'service', 'EV charging'),
  F('fuel', 'service', 'Fuel'),
  F('wheelchair', 'service', 'Wheelchair access'),
  F('dogs', 'service', 'Dogs allowed'),
  F('wifi', 'service', 'Wi-Fi'),
  F('smoking', 'service', 'Smoking'),
  F('capacity', 'service', 'Capacity'),
  // family
  F('good_for_children', 'family', 'Good for children'),
  F('kids_menu', 'family', "Children's menu"),
  F('kids_area', 'family', 'Play area'),
  F('min_age', 'family', 'Minimum age'),
  F('family_rooms', 'family', 'Family rooms'),
  F('changing_table', 'family', 'Baby changing'),
  // reviews
  F('rating', 'reviews', 'Rating'),
  F('rating_count', 'reviews', 'Number of ratings'),
  F('subratings', 'reviews', 'Sub-ratings', 'Food, service, value, atmosphere.'),
  F('rating_histogram', 'reviews', 'Rating histogram'),
  F('ranking', 'reviews', 'Rank within its area'),
  F('review_text', 'reviews', 'Review text'),
  F('review_title', 'reviews', 'Review title'),
  F('review_rating', 'reviews', "Reviewer's own rating"),
  F('review_author', 'reviews', 'Reviewer'),
  F('review_date', 'reviews', 'Review date'),
  F('review_summary', 'reviews', 'Summary of reviews'),
  // photos
  F('photo_ref', 'photos', 'Photo reference'),
  F('photo_bytes', 'photos', 'Photo itself'),
  F('photo_attribution', 'photos', 'Photo credit'),
  F('photo_licence', 'photos', 'Photo licence'),
  F('photo_size', 'photos', 'Photo size and type'),
  F('photo_date', 'photos', 'Photo date'),
  F('image_caption', 'photos', 'Caption'),
  F('street_photo', 'photos', 'Street-level photo'),
  F('heading', 'photos', 'Camera heading'),
  F('street_objects', 'photos', 'Objects seen from the street', 'Signs, benches, crossings detected in street imagery.'),
  F('logo', 'photos', 'Logo or icon'),
  F('commons_category', 'photos', 'Commons category'),
  // hotel
  F('stars', 'hotel', 'Star rating'),
  F('rooms', 'hotel', 'Number of rooms'),
  F('facilities', 'hotel', 'Facilities', 'Pool, kitchen, breakfast, garden, air conditioning.'),
  F('hotel_type', 'hotel', 'Type of stay'),
  F('guest_score', 'hotel', 'Guest score'),
  F('guest_count', 'hotel', 'Number of guest reviews'),
  F('hotel_photo', 'hotel', "Provider's hotel photo"),
  F('hotel_description', 'hotel', "Provider's hotel description"),
  F('rate', 'hotel', 'Live room rate'),
  F('board', 'hotel', 'Board basis'),
  F('refundable', 'hotel', 'Cancellation terms'),
  F('room_name', 'hotel', 'Room type'),
  F('hotel_accessibility', 'hotel', 'Accessibility attributes'),
  F('checkin_times', 'hotel', 'Check-in and check-out times'),
  // event
  F('event_id', 'event', 'Event identifier'),
  F('event_title', 'event', 'Event title'),
  F('event_description', 'event', 'Event description'),
  F('event_start', 'event', 'Start'),
  F('event_end', 'event', 'End'),
  F('event_time_tbd', 'event', 'Time to be announced'),
  F('event_duration', 'event', 'Duration'),
  F('event_venue', 'event', 'Venue name'),
  F('event_venue_address', 'event', 'Venue address'),
  F('event_category', 'event', 'Event category'),
  F('event_labels', 'event', 'Event labels'),
  F('event_price', 'event', 'Ticket price'),
  F('event_url', 'event', 'Ticket or event link'),
  F('performers', 'event', 'Performers'),
  F('event_images', 'event', 'Event images'),
  F('sales_dates', 'event', 'On-sale dates'),
  F('event_status', 'event', 'Event status', 'On sale, cancelled, postponed.'),
  F('event_rank', 'event', 'Expected size or rank'),
  F('promoter', 'event', 'Promoter'),
  F('seatmap', 'event', 'Seat map'),
  F('event_accessibility', 'event', 'Accessibility notes'),
  // places
  F('station', 'places', 'Nearest station'),
  F('station_lines', 'places', 'Lines at the station'),
  F('modes', 'places', 'Transport modes'),
  F('stop_type', 'places', 'Stop type'),
  F('station_distance', 'places', 'Distance to the station'),
  F('rail_usage', 'places', 'Railway usage', 'Main line, branch, tourist, disused.'),
  F('network', 'places', 'Network or operator'),
  F('transit_status', 'places', 'Line status and arrivals'),
  F('outcode', 'places', 'Postcode district'),
  F('admin_district', 'places', 'District or town'),
  F('county', 'places', 'County'),
  F('region', 'places', 'Region or nation'),
  F('country', 'places', 'Country'),
  F('locality_kind', 'places', 'Kind of place', 'City, town, village, suburb.'),
  F('ancestors', 'places', 'Place hierarchy'),
  F('population', 'places', 'Population'),
  F('statistical_areas', 'places', 'Statistical areas', 'Ward, constituency, LSOA, NHS area.'),
  // routes
  F('duration', 'routes', 'Travel time'),
  F('distance_m', 'routes', 'Travel distance'),
  F('polyline', 'routes', 'Route line'),
  F('route_exists', 'routes', 'Whether a route exists'),
  F('steps', 'routes', 'Turn-by-turn steps'),
  F('travel_mode', 'routes', 'Mode per step'),
  F('transit_line', 'routes', 'Transit line details'),
  F('transit_stops', 'routes', 'Boarding and alighting stops'),
  F('transit_times', 'routes', 'Departure and arrival times'),
  F('traffic_aware', 'routes', 'Traffic-aware timing'),
  F('tolls', 'routes', 'Tolls'),
  F('fuel_use', 'routes', 'Estimated fuel use'),
  F('alternatives', 'routes', 'Alternative routes'),
  // text
  F('extract', 'text', 'Article introduction'),
  F('sections', 'text', 'Article sections'),
  F('article_categories', 'text', 'Article categories'),
  F('infobox', 'text', 'Infobox facts'),
  F('voyage_listing', 'text', 'Travel-guide listing'),
  F('dimensions', 'text', 'Dimensions', 'Height, length, top speed — for a ride or a tower.'),
  F('built_by', 'text', 'Built or made by'),
  F('meta_description', 'text', 'Page meta description'),
];

export const fieldByKey = new Map(FIELDS.map((f) => [f.key, f]));

// ---------------------------------------------------------------------------
// the providers
// ---------------------------------------------------------------------------

const GOOGLE_CONSOLE = { label: 'Google Cloud quotas', url: 'https://console.cloud.google.com/google/maps-apis/quotas?project=epic-507516' };

/**
 * `used` and `offered` map a master field to the provider's own path for it.
 * `lands` says where a used field ends up; a provider-level `lands` is the
 * default and a per-field `kept` overrides it (only owned providers keep
 * anything). `calls` are the `provider_calls.provider` tokens that count as
 * this provider, and `facts` the `place_facts.source` value, where there is one.
 */
export const PROVIDERS = [
  {
    key: 'google', label: 'Google Places', short: 'Google', kind: 'data', keep: 'id',
    licence: 'Google Maps Platform Terms', retention: 'Place ID for ever; coordinates 30 days; every display field none',
    attribution: 'Google', cost: '5,000 free Nearby and Text searches a month per kind, then about $0.032; photos 1,000 free then $0.007',
    envKey: 'GOOGLE_MAPS_API_KEY', file: 'apps/api/src/sources/google.js', console: GOOGLE_CONSOLE,
    docs: 'https://developers.google.com/maps/documentation/places/web-service/data-fields',
    calls: ['google', 'google-places'],
    lands: 'Working memory for the session only; the place ID goes to provider_matches',
    used: {
      id: 'id', name: 'displayName.text', address: 'formattedAddress', lat_lng: 'location', categories: 'types', category: 'primaryType',
      rating: 'rating', rating_count: 'userRatingCount', price_level: 'priceLevel',
      hours_regular: 'regularOpeningHours.weekdayDescriptions', hours_current: 'currentOpeningHours.weekdayDescriptions',
      open_now: 'currentOpeningHours.openNow', next_change: 'currentOpeningHours.nextCloseTime / nextOpenTime', timezone: 'utcOffsetMinutes',
      website: 'websiteUri', provider_page: 'googleMapsUri', photo_ref: 'photos[].name', photo_attribution: 'photos[].authorAttributions',
      photo_bytes: 'places/{photo}/media (proxied through /api/photos/google)',
      good_for_children: 'goodForChildren', kids_menu: 'menuForChildren', diets: 'servesVegetarianFood', reservable: 'reservable',
      editorial_summary: 'editorialSummary.text', review_text: 'reviews[].text.text; contextualContents.justifications', review_rating: 'reviews[].rating',
      review_author: 'reviews[].authorAttribution', review_date: 'reviews[].relativePublishTimeDescription', phone: 'nationalPhoneNumber',
      duration: 'routingSummaries[].legs[].duration', distance_m: 'routingSummaries[].legs[].distanceMeters',
    },
    offered: {
      address_parts: 'addressComponents / postalAddress', plus_code: 'plusCode', viewport: 'viewport', business_status: 'businessStatus / movedPlaceId',
      phone_intl: 'internationalPhoneNumber', price_range: 'priceRange', hours_secondary: 'regularSecondaryOpeningHours / currentSecondaryOpeningHours',
      ai_summary: 'generativeSummary', review_summary: 'reviewSummary', neighbourhood: 'neighborhoodSummary', entrances: 'entrances / navigationPoints',
      containing_place: 'containingPlaces / subDestinations', opened: 'openingDate', wheelchair: 'accessibilityOptions', dogs: 'allowsDogs',
      curbside: 'curbsidePickup', delivery: 'delivery', dine_in: 'dineIn', takeout: 'takeout', outdoor_seating: 'outdoorSeating', live_music: 'liveMusic',
      toilets: 'restroom', good_for_groups: 'goodForGroups', sports_screens: 'goodForWatchingSports', payment: 'paymentOptions', parking: 'parkingOptions',
      ev_charging: 'evChargeOptions / evChargeAmenitySummary', fuel: 'fuelOptions', meals: 'servesBreakfast / servesBrunch / servesLunch / servesDinner',
      drinks: 'servesBeer / servesWine / servesCocktails', coffee: 'servesCoffee', dessert: 'servesDessert', station: 'transitStation',
      attributions: 'attributions', tags: 'googleMapsTypeLabel / primaryTypeDisplayName',
    },
  },
  {
    key: 'google-routes', label: 'Google Routes', short: 'Routes', kind: 'data', keep: 'none',
    licence: 'Google Maps Platform Terms', retention: 'Nothing beyond the session; caching is forbidden',
    attribution: 'Google', cost: '5,000 free elements a month on the traffic-aware tier, then $0.01',
    envKey: 'GOOGLE_MAPS_API_KEY', file: 'apps/api/src/sources/routing.js', console: GOOGLE_CONSOLE,
    docs: 'https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes',
    calls: ['google-routes'],
    lands: 'Never written; the drawer fetches directions when it opens',
    used: {
      duration: 'routes.duration; matrix duration', distance_m: 'routes.distanceMeters', polyline: 'routes.polyline.encodedPolyline',
      route_exists: 'condition = ROUTE_EXISTS', steps: 'legs.steps.navigationInstruction.instructions', travel_mode: 'legs.steps.travelMode',
      transit_line: 'transitDetails.transitLine (name, vehicle, agency, colour)', transit_stops: 'transitDetails.stopDetails / stopCount / headsign',
      transit_times: 'transitDetails.localizedValues.departureTime / arrivalTime', traffic_aware: 'routingPreference TRAFFIC_AWARE',
    },
    offered: {
      tolls: 'routes.travelAdvisory.tollInfo', fuel_use: 'routes.travelAdvisory.fuelConsumptionMicroliters', alternatives: 'computeAlternativeRoutes',
      viewport: 'routes.viewport', address: 'legs.startLocation / endLocation', event_status: 'routes.travelAdvisory.speedReadingIntervals',
    },
  },
  {
    key: 'tripadvisor', label: 'Tripadvisor', short: 'Tripadv.', kind: 'data', keep: 'id',
    licence: 'Tripadvisor Content API terms', retention: 'Location ID only; reviews must not be crawlable, so /api answers robots.txt with Disallow',
    attribution: 'Tripadvisor', cost: '1,000 locations free for the life of the account, then $0.015 a location',
    envKey: 'TRIPADVISOR_API_KEY', file: 'apps/api/src/sources/tripadvisor.js',
    console: { label: 'Tripadvisor developer portal', url: 'https://www.tripadvisor.com/developers' },
    docs: 'https://tripadvisor-content-api.readme.io/reference/getlocationdetails',
    calls: ['tripadvisor'],
    lands: 'Working memory for the session only',
    note: 'We call the Terra endpoints; the offered list is read from the Content API reference, which carries the same content under older names.',
    used: {
      id: 'id', name: 'names[] (primary, by language)', categories: 'categories[]', category: 'categories[].top_level_category',
      provider_page: 'urls.tripadvisor.main', website: 'urls.official', tags: 'attributes[].name', price_level: 'price_level',
      rating: 'traveler_ratings.overall.rating / overall_rating', rating_count: 'traveler_ratings.overall.count', address: 'addresses[].formatted',
      lat_lng: 'coordinates', hours_regular: 'opening_hours.formatted', review_text: 'reviews[].text', review_title: 'reviews[].title',
      review_rating: 'reviews[].rating', review_author: 'reviews[].user.username', review_date: 'reviews[].publish_ts',
    },
    offered: {
      description: 'description', email: 'email', phone: 'phone', timezone: 'timezone', ranking: 'ranking_data', subratings: 'subratings',
      rating_histogram: 'review_rating_count', photo_ref: 'see_all_photos / photo_count', facilities: 'amenities', experiences: 'styles / features',
      cuisine: 'cuisine', awards: 'awards', neighbourhood: 'neighborhood_info', ancestors: 'ancestors', brand: 'brand / parent_brand',
      address_parts: 'address_obj', hours_secondary: 'hours.periods',
    },
  },
  {
    key: 'osm', label: 'OpenStreetMap', short: 'OSM', kind: 'data', keep: 'own',
    licence: 'ODbL', retention: 'For good, with attribution', attribution: '© OpenStreetMap contributors', cost: 'Free; fair use of about a request a second',
    envKey: null, file: 'apps/api/src/sources/osm.js', docs: 'https://wiki.openstreetmap.org/wiki/Map_features',
    calls: ['osm', 'osm-overpass', 'overpass'], facts: 'osm',
    lands: 'place_records, attractions, transit_stops',
    used: {
      osm_ref: 'type/id', lat_lng: 'lat / lon (centre for ways)', name: 'name', alt_names: 'int_name / official_name / alt_name (matching only)',
      category: 'amenity / tourism / leisure / shop / historic / man_made', cuisine: 'cuisine',
      diets: 'diet:vegetarian / vegan / halal / kosher / gluten_free / dairy_free', kids_area: 'kids_area', min_age: 'min_age',
      website: 'website / contact:website', hours_regular: 'opening_hours', address_parts: 'addr:housenumber / street / suburb / city',
      postcode: 'addr:postcode', brand: 'brand', stars: 'stars', rooms: 'rooms', admission_fee: 'fee', phone: 'phone / contact:phone', email: 'email / contact:email',
      facilities: 'swimming_pool / kitchen / breakfast / air_conditioning / garden / view', parking: 'parking / amenity=parking', dogs: 'dog',
      family_rooms: 'rooms:family / family_rooms', wheelchair: 'wheelchair / toilets:wheelchair / wheelchair:description',
      station: 'railway=station / halt', rail_usage: 'usage / disused / abandoned', network: 'network / operator', modes: 'subway / light_rail / tram',
    },
    offered: {
      wifi: 'internet_access', smoking: 'smoking', outdoor_seating: 'outdoor_seating', takeout: 'takeaway', delivery: 'delivery',
      reservable: 'reservation', payment: 'payment:*', toilets: 'toilets', changing_table: 'changing_table', capacity: 'capacity',
      description: 'description', wikidata_id: 'wikidata', wikipedia: 'wikipedia', photo_ref: 'image', hours_secondary: 'opening_hours:kitchen',
      ev_charging: 'amenity=charging_station', socials: 'contact:facebook / contact:instagram', opened: 'start_date', heritage: 'heritage / listed_status',
      drinks: 'real_ale / brewery', meals: 'breakfast / lunch / dinner', live_music: 'live_music', tags: 'every other tag', entrances: 'entrance nodes',
      outline: 'way geometry', containing_place: 'building / level',
    },
  },
  {
    key: 'nominatim', label: 'Nominatim', short: 'Nominatim', kind: 'data', keep: 'own',
    licence: 'ODbL', retention: 'For good, with attribution; one request a second', attribution: '© OpenStreetMap contributors', cost: 'Free',
    envKey: null, file: 'apps/api/src/sources/geocode.js', docs: 'https://nominatim.org/release-docs/latest/api/Output/',
    calls: ['osm-nominatim', 'nominatim'], facts: 'nominatim',
    lands: 'place_records address and postcode; localities; household_places',
    used: {
      address: 'display_name', address_parts: 'address.road / suburb / village / town / city / county / state / country', postcode: 'address.postcode',
      lat_lng: 'lat / lon', category: 'class / type', osm_ref: 'osm_type / osm_id', outline: 'geojson (polygon_geojson)', locality_kind: 'addresstype', name: 'name',
      county: 'address.county', country: 'address.country_code',
    },
    offered: {
      viewport: 'boundingbox', wikidata_id: 'extratags.wikidata', website: 'extratags.website', hours_regular: 'extratags.opening_hours',
      alt_names: 'namedetails', popularity: 'importance / place_rank', population: 'extratags.population',
    },
  },
  {
    key: 'photon', label: 'Photon', short: 'Photon', kind: 'data', keep: 'own',
    licence: 'ODbL', retention: 'For good, with attribution', attribution: '© OpenStreetMap contributors · search by Photon', cost: 'Free, no key',
    envKey: null, file: 'apps/api/src/sources/areas.js', docs: 'https://github.com/komoot/photon',
    calls: ['photon'],
    lands: 'localities',
    used: {
      lat_lng: 'geometry.coordinates', name: 'properties.name', country: 'properties.country / countrycode', county: 'properties.county',
      admin_district: 'properties.district / city', postcode: 'properties.postcode', address_parts: 'properties.street / housenumber',
      category: 'properties.osm_key / osm_value', osm_ref: 'properties.osm_type / osm_id', region: 'properties.state',
    },
    offered: { viewport: 'properties.extent', locality_kind: 'properties.type' },
  },
  {
    key: 'postcodes', label: 'postcodes.io (ONS)', short: 'ONS', kind: 'data', keep: 'own',
    licence: 'Open Government Licence', retention: 'For good', attribution: 'Contains OS and ONS data © Crown copyright', cost: 'Free, unmetered',
    envKey: null, file: 'apps/api/src/sources/postcodeAreas.js', docs: 'https://postcodes.io/docs',
    calls: ['ons-postcodes', 'postcodes'],
    lands: 'localities and attractions.outcode',
    used: { outcode: 'outcode', lat_lng: 'latitude / longitude', admin_district: 'admin_district', county: 'admin_county', country: 'country' },
    offered: { region: 'region / european_electoral_region', statistical_areas: 'parliamentary_constituency / admin_ward / lsoa / msoa / nhs_ha / pfa', population: 'none' },
  },
  {
    key: 'tfl', label: 'Transport for London', short: 'TfL', kind: 'data', keep: 'own',
    licence: 'TfL open data (OGL)', retention: 'For good, with attribution', attribution: 'Powered by TfL Open Data', cost: 'Free, about 50 requests a minute',
    envKey: null, file: 'apps/api/src/sources/where.js', docs: 'https://api.tfl.gov.uk/swagger/ui/index.html',
    calls: ['tfl'],
    lands: 'household_places.station / station_lines',
    used: { station: 'stopPoints[].commonName', station_lines: 'stopPoints[].lines[].name', station_distance: 'stopPoints[].distance', modes: 'stopPoints[].modes', stop_type: 'stopPoints[].stopType' },
    offered: { wheelchair: 'StopPoint additionalProperties (Lifts, Toilets, WiFi)', transit_status: '/Line/{id}/Status and /StopPoint/{id}/Arrivals', facilities: 'additionalProperties' },
  },
  {
    key: 'ticketmaster', label: 'Ticketmaster', short: 'Ticketm.', kind: 'data', keep: 'id',
    licence: 'Ticketmaster Discovery API terms', retention: 'Identifiers only; display fields none', attribution: 'Events by Ticketmaster', cost: 'Free; 5,000 requests a day',
    envKey: 'TICKETMASTER_API_KEY', file: 'apps/api/src/sources/ticketmaster.js',
    console: { label: 'Ticketmaster developer account', url: 'https://developer-account.ticketmaster.com/' },
    docs: 'https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/',
    calls: ['ticketmaster'],
    lands: 'Working memory for the session only',
    used: {
      event_id: 'id', event_title: 'name', lat_lng: '_embedded.venues[0].location', event_venue: '_embedded.venues[0].name',
      event_start: 'dates.start.dateTime / localDate / localTime', event_category: 'classifications[0].segment.name', event_labels: 'classifications[].family',
      event_price: 'priceRanges[0].min', event_description: 'info / pleaseNote', event_url: 'url',
    },
    offered: {
      event_end: 'dates.end', event_time_tbd: 'dates.start.timeTBA / dateTBD', event_venue_address: 'venues[].address / city / postalCode',
      event_images: 'images[]', sales_dates: 'sales.public / presales', event_status: 'dates.status.code', promoter: 'promoter / promoters',
      seatmap: 'seatmap.staticUrl', event_accessibility: 'accessibility.info', performers: '_embedded.attractions[]', parking: 'venues[].parkingDetail',
      timezone: 'dates.timezone', currency: 'priceRanges[].currency', description: 'description / additionalInfo',
    },
  },
  {
    key: 'seatgeek', label: 'SeatGeek', short: 'SeatGeek', kind: 'data', keep: 'id',
    licence: 'SeatGeek Platform terms', retention: 'Identifiers only; display fields none', attribution: 'Events by SeatGeek', cost: 'Free',
    envKey: 'SEATGEEK_CLIENT_ID', file: 'apps/api/src/sources/seatgeek.js',
    console: { label: 'SeatGeek platform', url: 'https://platform.seatgeek.com/' }, docs: 'https://platform.seatgeek.com/',
    calls: ['seatgeek'],
    lands: 'Working memory for the session only',
    used: {
      event_id: 'id', event_title: 'title', lat_lng: 'venue.location', event_venue: 'venue.name', event_venue_address: 'venue.address / city',
      event_time_tbd: 'time_tbd', event_start: 'datetime_utc', event_category: 'type', event_labels: 'taxonomies[].name',
      event_price: 'stats.lowest_price', performers: 'performers[].name', event_url: 'url',
    },
    offered: {
      event_images: 'performers[].image', event_rank: 'score / popularity', capacity: 'venue.capacity', timezone: 'venue.timezone',
      event_status: 'status', sales_dates: 'announce_date / visible_until_utc', offers: 'stats.average_price / highest_price',
    },
  },
  {
    key: 'predicthq', label: 'PredictHQ', short: 'PredictHQ', kind: 'data', keep: 'id',
    licence: 'PredictHQ terms', retention: 'Identifiers only; display fields none', attribution: 'Events by PredictHQ', cost: 'Free plan after a 14-day trial',
    envKey: 'PREDICTHQ_API_KEY', file: 'apps/api/src/sources/predicthq.js',
    console: { label: 'PredictHQ control center', url: 'https://control.predicthq.com/' }, docs: 'https://docs.predicthq.com/resources/events',
    calls: ['predicthq'],
    lands: 'Working memory for the session only',
    used: {
      lat_lng: 'location', event_start: 'start', event_end: 'end', event_id: 'id', event_title: 'title', event_labels: 'labels / phq_labels[].label',
      event_category: 'category', event_description: 'description', event_venue: 'entities[type=venue].name',
      event_venue_address: 'entities[].formatted_address / geo.address.formatted_address', event_rank: 'rank',
    },
    offered: {
      event_duration: 'duration', timezone: 'timezone', event_status: 'state', country: 'country', ancestors: 'place_hierarchies',
      promoter: 'entities[type=organizer]', popularity: 'phq_attendance / local_rank / aviation_rank',
    },
  },
  {
    key: 'datathistle', label: 'Data Thistle', short: 'Thistle', kind: 'data', keep: 'id',
    licence: 'Data Thistle terms', retention: 'Identifiers only; display fields none', attribution: 'Listings by Data Thistle', cost: '1,000 requests a month free',
    envKey: 'DATATHISTLE_API_KEY', file: 'apps/api/src/sources/datathistle.js',
    console: { label: 'Data Thistle account', url: 'https://www.datathistle.com/' }, docs: 'https://api.datathistle.com/',
    calls: ['datathistle'],
    lands: 'Working memory for the session only',
    used: {
      tags: 'tags[]', event_title: 'name', event_description: 'descriptions[] / description', event_images: 'images[0].url + picture_credits',
      event_id: 'event_id', event_url: 'website / performances[].links[0].url', lat_lng: 'schedules[].place.lat / lon', event_venue: 'schedules[].place.name',
      event_venue_address: 'place.address / town / postal_code', event_price: 'schedules[].ticket_summary',
      event_start: 'schedules[].start_ts / performances[].ts', event_time_tbd: 'performances[].time_unknown', event_duration: 'performances[].duration',
    },
    offered: { event_end: 'schedules[].end_ts', event_category: 'categories', min_age: 'age_range', event_accessibility: 'accessibility', phone: 'place.phone', website: 'place.website' },
  },
  {
    key: 'liteapi', label: 'LiteAPI (Nuitée)', short: 'LiteAPI', kind: 'data', keep: 'none',
    licence: 'LiteAPI terms', retention: 'Nothing: names, photos, scores and prices are fetched at display and never written', attribution: 'Hotels, prices and availability © Nuitée (LiteAPI)',
    cost: 'Free to search; LiteAPI earns on a booking, and Epic takes none',
    envKey: 'LITEAPI_KEY', file: 'apps/api/src/sources/liteapi.js',
    console: { label: 'LiteAPI dashboard', url: 'https://dashboard.liteapi.travel/' }, docs: 'https://docs.liteapi.travel/reference/get_data-hotels',
    calls: ['liteapi'],
    lands: 'Never written; a picked hotel is re-found in OpenStreetMap and that record is kept instead',
    used: {
      lat_lng: 'latitude / longitude', id: 'id / hotelId', hotel_type: 'hotelType / hotelTypeId', name: 'name', address: 'address', admin_district: 'city',
      postcode: 'zip', stars: 'stars / starRating', guest_score: 'rating', guest_count: 'reviewCount', brand: 'chain', facilities: 'facilityIds[] (+ /data/facilities)',
      hotel_photo: 'main_photo / thumbnail', rate: 'roomTypes[].offerRetailRate / rates[].retailRate.total', currency: 'retailRate.currency',
      room_name: 'rates[].name / roomType.name', board: 'boardName / boardType', refundable: 'cancellationPolicies.refundableTag / cancelPolicyInfos',
    },
    offered: {
      hotel_description: 'hotelDescription', hotel_accessibility: 'accessibilityAttributes', country: 'country', checkin_times: 'checkinCheckoutTimes (/data/hotel)',
      photo_ref: 'hotelImages (/data/hotel)', phone: 'phone (/data/hotel)', email: 'email (/data/hotel)', rooms: 'rooms (/data/hotel)', review_text: '/data/reviews',
      description: 'hotelImportantInformation',
    },
  },
  {
    key: 'wikidata', label: 'Wikidata', short: 'Wikidata', kind: 'data', keep: 'own',
    licence: 'CC0', retention: 'For good', attribution: 'None required', cost: 'Free',
    envKey: null, file: 'apps/api/src/sources/wikimedia.js', docs: 'https://www.wikidata.org/wiki/Wikidata:List_of_properties',
    calls: ['wikidata'], facts: 'wikidata',
    lands: 'attractions; place_records.website / wikidata_id',
    used: {
      wikidata_id: '?item', name: 'rdfs:label', description: 'schema:description', popularity: 'wikibase:sitelinks; P1174 visitors', photo_ref: 'P18',
      wikipedia: 'schema:about sitelink', lat_lng: 'P625', osm_ref: 'P402', commons_category: 'P373', website: 'P856', heritage: 'P1435',
      categories: 'P31', awards: 'P166', opened: 'P571', dimensions: 'P2048 / P2043 / P2052', built_by: 'P176', capacity: 'P1436', network: 'P137 operator',
    },
    offered: {
      email: 'P968', phone: 'P1329', address: 'P6375', postcode: 'P281', socials: 'P2013 Facebook / P2002 Twitter / P2003 Instagram',
      population: 'P1082', provider_ids: 'P3749 Google Maps CID / P3134 Tripadvisor ID / P1902 Spotify / P4264 LinkedIn', alt_names: 'P1448 / P1705',
      admission_fee: 'P2555', brand: 'P1716 / P127 owned by', ancestors: 'P131 located in', outline: 'P3896 geoshape', hours_regular: 'P3025 open days',
    },
  },
  {
    key: 'wikipedia', label: 'Wikipedia', short: 'Wikipedia', kind: 'data', keep: 'own',
    licence: 'CC BY-SA 4.0', retention: 'For good, with credit and a link; share-alike on the text', attribution: 'Wikipedia — “title”, CC BY-SA 4.0', cost: 'Free',
    envKey: null, file: 'apps/api/src/sources/encyclopedia.js', docs: 'https://www.mediawiki.org/wiki/API:Properties',
    calls: ['wikipedia'], facts: 'wikipedia',
    lands: 'place_records.summary / wikipedia_url; attractions',
    used: {
      extract: 'prop=extracts&exintro', sections: 'prop=extracts (whole article)', wikipedia: 'info.fullurl', photo_ref: 'pageimages.original',
      wikidata_id: 'pageprops.wikibase_item', article_categories: 'prop=categories', name: 'title', distance: 'geosearch dist',
      popularity: 'REST pageviews per article (monthly)',
    },
    offered: { lat_lng: 'prop=coordinates', infobox: 'prop=revisions wikitext (opening hours, phone, website in the infobox)', last_edited: 'revisions.timestamp', alt_names: 'prop=langlinks / redirects' },
  },
  {
    key: 'wikivoyage', label: 'Wikivoyage', short: 'Wikivoy.', kind: 'data', keep: 'own',
    licence: 'CC BY-SA 3.0', retention: 'For good, with credit; a price must carry its lastedit date', attribution: 'Wikivoyage, CC BY-SA', cost: 'Free',
    envKey: null, file: 'apps/api/src/sources/wikimedia.js', docs: 'https://en.wikivoyage.org/wiki/Wikivoyage:Listings',
    calls: [],
    lands: 'attractions (listing facts)',
    used: {
      voyage_listing: '{{see|do|eat|drink|sleep}} templates', description: 'content', price_range: 'price', hours_regular: 'hours', website: 'url',
      phone: 'phone', address: 'address', wikidata_id: 'wikidata', last_edited: 'lastedit',
    },
    offered: { email: 'email', checkin_times: 'checkin / checkout', lat_lng: 'lat / long', wifi: 'wifi', wheelchair: 'wheelchair' },
  },
  {
    key: 'commons', label: 'Wikimedia Commons', short: 'Commons', kind: 'data', keep: 'own',
    licence: 'Per file: CC BY, CC BY-SA, CC0, public domain, OGL', retention: 'For good when the file licence allows; a file whose licence cannot be read is never downloaded',
    attribution: 'Per file: artist, licence, link', cost: 'Free',
    envKey: null, file: 'apps/api/src/sources/wikimedia.js', docs: 'https://commons.wikimedia.org/wiki/Commons:API/MediaWiki',
    calls: ['wikimedia', 'commons'],
    lands: 'image_assets (bytes, licence, credit)',
    used: {
      photo_ref: 'imageinfo.url / thumburl', photo_bytes: 'upload.wikimedia.org', photo_licence: 'LicenseShortName / LicenseUrl / UsageTerms / AttributionRequired / Restrictions',
      photo_attribution: 'Artist / Credit', image_caption: 'ImageDescription / ObjectName', photo_size: 'width / height / mime', commons_category: 'category members',
    },
    offered: { photo_date: 'DateTimeOriginal', lat_lng: 'GPSLatitude / GPSLongitude', tags: 'categories / structured data depicts' },
  },
  {
    key: 'kartaview', label: 'KartaView', short: 'KartaView', kind: 'data', keep: 'own',
    licence: 'CC BY-SA 4.0', retention: 'For good, with credit and a link', attribution: 'KartaView contributors, CC BY-SA 4.0', cost: 'Free, no key',
    envKey: null, file: 'apps/api/src/sources/streetLevel.js', docs: 'https://api.openstreetcam.org/api/doc.html',
    calls: [],
    lands: 'image_assets',
    used: { street_photo: 'fileurlLTh / imageLthUrl / fileurlTh', lat_lng: 'lat / lng', heading: 'heading', photo_size: 'width / height', photo_date: 'shotDate / dateAdded', id: 'id / sequenceId' },
    offered: { street_objects: 'none', photo_attribution: 'username' },
  },
  {
    key: 'mapillary', label: 'Mapillary', short: 'Mapillary', kind: 'data', keep: 'own',
    licence: 'CC BY-SA 4.0', retention: 'For good, with credit and a link', attribution: 'Mapillary contributors, CC BY-SA 4.0', cost: 'Free with a token',
    envKey: 'MAPILLARY_TOKEN', file: 'apps/api/src/sources/streetLevel.js', docs: 'https://www.mapillary.com/developer/api-documentation',
    calls: [],
    lands: 'image_assets',
    used: { street_photo: 'thumb_1024_url', lat_lng: 'computed_geometry / geometry', heading: 'computed_compass_angle / compass_angle', photo_size: 'width / height', photo_date: 'captured_at', photo_attribution: 'creator.username', id: 'id' },
    offered: { street_objects: 'detections (signs, benches, crossings)', photo_bytes: 'thumb_2048_url / thumb_original_url', tags: 'is_pano / camera_type / sequence' },
  },
  {
    key: 'site', label: "The venue's own website", short: 'Own site', kind: 'data', keep: 'own',
    licence: 'Published for republication (schema.org); prose is not taken beyond the meta description', retention: 'For good', attribution: 'The venue', cost: 'Free; robots.txt honoured',
    envKey: null, file: 'apps/api/src/sources/site.js', docs: 'https://schema.org/LocalBusiness',
    calls: [], facts: 'site',
    lands: 'place_records; image_assets (logos); menus',
    note: 'Also menuLink.js, menuRead.js (Claude reads the menu page), accolades.js and logo.js.',
    used: {
      phone: 'telephone', address: 'address / PostalAddress', postcode: 'address.postalCode', hours_regular: 'openingHours / openingHoursSpecification',
      cuisine: 'servesCuisine', price_range: 'priceRange', booking_url: 'acceptsReservations / booking links', menu_url: 'hasMenu / menu links',
      admission_fee: 'isAccessibleForFree', offers: 'offers[].price / priceSpecification', meta_description: 'meta description / og:description',
      socials: 'sameAs / social links', email: 'email / mailto:', website: 'canonical', logo: 'apple-touch-icon / favicon / Organization.logo',
      awards: 'Michelin / AA / Good Food Guide mentions', menu_items: 'menu page read by Claude (menuRead.js)',
    },
    offered: {
      lat_lng: 'geo.latitude / longitude', photo_ref: 'image', rating: 'aggregateRating (often a copy of Google\'s; treat with care)', facilities: 'amenityFeature',
      payment: 'paymentAccepted', smoking: 'smokingAllowed', dogs: 'petsAllowed', checkin_times: 'checkinTime / checkoutTime', stars: 'starRating',
      event_title: 'Event (schema.org)', opened: 'foundingDate', currency: 'currenciesAccepted', hours_secondary: 'openingHoursSpecification per department',
    },
  },
];

export const providerByKey = new Map(PROVIDERS.map((p) => [p.key, p]));

/**
 * The services: what Epic pays for that yields no field about a place. They
 * live on the same screen, in their own section, because "who do we use, and
 * for what" has to include them (owner, 12 Sep 2026).
 */
export const SERVICES = [
  { key: 'anthropic', label: 'Claude (Anthropic)', what: 'Understands what a household said and turns it into a plan; reads menus (Sonnet); the local scout reads what\'s-on pages with web search.', unit: 'tokens', envKey: 'ANTHROPIC_API_KEY', file: 'apps/api/src/claude.js', calls: ['anthropic'], console: { label: 'Anthropic console', url: 'https://console.anthropic.com/' } },
  { key: 'openai', label: 'OpenAI', what: 'Turns speech into words — a recording, or live captions over a socket — and drafts the plan preview as the words arrive.', unit: 'minutes of speech', envKey: 'OPENAI_API_KEY', file: 'apps/api/src/sources/openai.js', calls: ['openai'], console: { label: 'OpenAI usage', url: 'https://platform.openai.com/usage' } },
  { key: 'resend', label: 'Resend', what: 'Sends the sign-in links and household invitations by e-mail.', unit: 'e-mails', envKey: 'RESEND_API_KEY', file: 'apps/api/src/sources/mail.js', calls: [], console: { label: 'Resend', url: 'https://resend.com/' } },
  { key: 'twilio', label: 'Twilio', what: 'Sends household invitations by text message.', unit: 'messages', envKey: 'TWILIO_ACCOUNT_SID', file: 'apps/api/src/sources/sms.js', calls: [], console: { label: 'Twilio console', url: 'https://console.twilio.com/' } },
  { key: 'notify', label: 'Reminder webhook', what: 'Group reminders are posted as JSON to whatever sends them — a provider, a queue, a Zap. Without the URL they are written, kept and marked undelivered.', unit: 'reminders', envKey: 'NOTIFY_WEBHOOK_URL', file: 'apps/api/src/sources/notify.js', calls: [], console: null },
];

// ---------------------------------------------------------------------------
// reading it
// ---------------------------------------------------------------------------

/** Every field a provider names, used or offered, as { key, path, status }. */
export function cellsOf(provider) {
  const out = [];
  for (const [key, path] of Object.entries(provider.used ?? {})) out.push({ key, path, status: 'used' });
  for (const [key, path] of Object.entries(provider.offered ?? {})) {
    if (!(key in (provider.used ?? {}))) out.push({ key, path, status: 'offered' });
  }
  return out;
}

/**
 * The matrix: one row per master field, one cell per provider, plus the two
 * things the screen filters on — whether anybody reads the field, and the best
 * ownership grade among the providers that supply it.
 */
export function matrix() {
  const rank = { own: 3, id: 2, none: 1 };
  const rows = FIELDS.map((f) => {
    const cells = {};
    let used = false;
    let keep = null;
    for (const p of PROVIDERS) {
      const path = p.used?.[f.key] ?? null;
      const offered = p.offered?.[f.key] ?? null;
      if (path == null && offered == null) continue;
      cells[p.key] = { status: path != null ? 'used' : 'offered', path: path ?? offered };
      if (path != null) {
        used = true;
        if (p.keep === 'own' && p.kept?.[f.key] !== false) keep = 'own';
        else if (keep == null || rank[p.keep] > rank[keep]) keep = p.keep;
      }
    }
    return { ...f, cells, used, keep, providers: Object.keys(cells).length };
  });
  return rows;
}
