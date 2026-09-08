/**
 * Whether the public can actually go there.
 *
 * The atlas is harvested from Wikidata, which knows what a building *is* and
 * not whether you may walk in. So the owner's Culture row read: Windsor Castle,
 * then Bagshot Park Mansion — the Duke of Edinburgh's house — then Cumberland
 * Lodge, then Fort Belvedere, a private residence inside Windsor Great Park.
 * All of them outrank Virginia Water Lake in the atlas, because notability is
 * what Wikidata measures and notability is a different question.
 *
 * The owner, 7 Sep 2026: "We're going to need to develop something that makes
 * sure we never show private residences. That would be a nonsense, and we get
 * very significant complaints… If you're not sure, I'd err on the side of
 * caution and not show it."
 *
 * So this answers three ways and the caller treats them differently:
 *
 *   'yes'  something establishes that the public may visit
 *   'no'   something establishes that they may not
 *   null   nobody has established it — and under a deny-by-default screen that
 *          is not shown either. The verdict stays separate from the decision
 *          because "we looked and found nothing" and "we found a refusal" are
 *          different facts, and only one of them is worth a person's time.
 *
 * **A refusal beats every acceptance.** The complaint the owner is protecting
 * against can only come from a false *yes*, so one signal has to be able to
 * overrule the rest: `residentialVeto` runs before anything is allowed to say
 * yes, and nothing downstream can undo it.
 *
 * Four sources, all of them open and ours to keep — Wikidata types, the
 * OpenStreetMap tags on the same feature, the categories on its Wikipedia
 * article, and (only for a place we were already asking about for other
 * reasons) what Google calls it. They are complementary rather than redundant:
 * OSM has lakes and woods, Wikipedia has the stately homes that open to
 * visitors, Wikidata has the museums. Highclere Castle is `building=yes
 * historic=castle` in OSM and invisible there, and sits in "Historic house
 * museums in Hampshire" on Wikipedia. Virginia Water Lake is the other way
 * round.
 */

/**
 * Types that are a statement about *function*: the place exists to be visited.
 *
 * These outrank the residential veto, because a museum housed in a mansion is
 * still a museum and the mansion is still tagged `building=house`.
 */
export const STRONG_OPEN_KINDS = new Set([
  'Q2087181',    // historic house museum
  'Q33506',      // museum
  'Q16735822',   // history museum
  'Q115154402',  // independent museum
  'Q115154345',  // local authority museum
  'Q1595639',    // local museum
  'Q207694',     // art museum
  'Q22698',      // park
  'Q1107656',    // garden
  'Q15835',      // Japanese garden
  'Q179049',     // nature reserve
]);

/**
 * Types that are a statement about *fabric*: usually somewhere you can go, but
 * describing what a place is built as rather than what it is for.
 *
 * Most castles are visitable and some are somebody's house, so these do not
 * outrank the veto — they only speak when nothing has refused.
 */
export const WEAK_OPEN_KINDS = new Set([
  'Q23413',      // castle
  'Q16560',      // palace
  'Q24354',      // theatre building
  'Q483110',     // stadium
  'Q39614',      // cemetery
  // Public infrastructure. You cross a bridge; nobody's front door is a bridge.
  // Sixty-one of the places left unestablished were bridges of one sort or
  // another, the Iron Bridge, the Menai Suspension Bridge and the Severn Bridge
  // among them.
  'Q12280',      // bridge
  'Q537127',     // road bridge
  'Q1210334',    // railway bridge
  'Q12042110',   // steel bridge
  'Q158218',     // truss bridge
  'Q158555',     // cable-stayed bridge
  'Q39715',      // lighthouse
  // Places of worship. A parish church is somewhere you walk into.
  'Q16970',      // church building
  'Q108325',     // chapel
  'Q160742',     // abbey
  // Heritage and antiquity. A scheduled monument is not somebody's living room.
  'Q839954',     // archaeological site
  'Q14752696',   // ancient Roman structure
  'Q88205',      // castrum
  'Q91312',      // tower house
  // Things run as an attraction, which is most of what is left.
  'Q420962',     // heritage railway
  'Q1112477',    // narrow-gauge railway
  'Q10373548',   // whisky distillery
  'Q1154710',    // association football venue
  'Q1076486',    // sports venue
]);

/** Everything that can establish a place is open, for callers that only want the question answered. */
export const OPEN_KINDS = new Set([
  'Q2087181',    // historic house museum
  'Q33506',      // museum
  'Q16735822',   // history museum
  'Q115154402',  // independent museum
  'Q115154345',  // local authority museum
  'Q1595639',    // local museum
  'Q207694',     // art museum
  'Q22698',      // park
  'Q1107656',    // garden
  'Q15835',      // Japanese garden
  'Q179049',     // nature reserve
  'Q23413',      // castle
  'Q24354',      // theatre building
  'Q483110',     // stadium
  'Q39614',      // cemetery
  // Palaces. Holyrood, Hampton Court, Kensington and the State Rooms at
  // Buckingham Palace are all somewhere you buy a ticket, and Holyrood calls
  // itself "the official residence of the monarch in Scotland" in its own first
  // sentence — which is how it was wrongly hidden before this line existed.
  'Q16560',      // palace
]);

/**
 * Wikidata types that mean you cannot simply turn up.
 *
 * Deliberately short. Each was found on the owner's own home screen and checked
 * against everything else that carries it.
 */
export const CLOSED_KINDS = new Map([
  ['Q917182', 'a military academy'],
  ['Q209465', 'a university campus'],
]);

/*
 * "Residence of the British Royal Family" (Q131986827) is deliberately not in
 * that list. It lives in `residentialVeto` instead, which fires only when
 * nothing else about the place says people visit — so it still catches Bagshot
 * Park, Highgrove and Gatcombe Park, and no longer catches Windsor Castle,
 * Sandringham, Osborne House or the Palace of Holyroodhouse, which are all
 * royal residences you can buy a ticket for. Held in one place rather than two
 * because it was in both, and the copy in this list ran first and overruled the
 * exception the other copy was carefully making.
 */

/** Said outright, in the words these summaries actually use. */
const SAYS_OPEN = /national trust|english heritage|historic houses|cadw|open to the public|open to visitors|country park|visitor cent|now a museum|houses a museum|is a museum|open all year|admission charge/i;

const SAYS_CLOSED = /private residence|private home|is a private house|remains a private|not open to the public|closed to the public|official residence|family residence of|country home of|country house of the prime minister/i;

/**
 * A house that stopped being private is a house that opened. Wentworth
 * Woodhouse runs tours and its summary reads "…until it ceased to be privately
 * owned – often listed as the largest private residence in the United Kingdom".
 */
const WAS_ONCE = /ceased to be private|no longer (a )?private|formerly a private|opened to the public/i;

// ---------------------------------------------------------------------------
// OpenStreetMap
// ---------------------------------------------------------------------------

/**
 * Somewhere the map says people go.
 *
 * `historic` is deliberately absent. It says what a thing is, not who may come
 * in: Chequers is `historic=manor` and Fort Belvedere is `historic=castle`, and
 * both are somebody's home. The ruins and abbeys it used to carry are caught by
 * their Wikipedia category instead, which is a claim about the institution.
 */
const OSM_PUBLIC_KEYS = ['tourism', 'leisure', 'natural', 'shop', 'aeroway'];

/** A building that is somebody's home. `access` is the legal statement; this is the physical one. */
const DWELLINGS = new Set(['house', 'residential', 'detached', 'semidetached_house', 'terrace',
  'apartments', 'bungalow', 'villa', 'dormitory', 'farm', 'static_caravan']);

/**
 * The one test that can overrule everything else.
 *
 * `access=private` and `access=no` are OpenStreetMap's own words for "the
 * public may not come in" (`access=customers` is emphatically not one of them —
 * Kew Gardens is tagged that way and you buy a ticket). A building tagged as a
 * dwelling with nothing public on it is the other half: that is what Bagshot
 * Park, Highgrove and Tittenhurst Park all look like on the map.
 */
export function residentialVeto({ osm = null, kinds = [] } = {}) {
  const set = new Set(kinds || []);
  if (osm) {
    if (osm.access === 'private' || osm.access === 'no') {
      return `OpenStreetMap has it as access=${osm.access}`;
    }
    const publicTag = OSM_PUBLIC_KEYS.some((k) => osm[k]) || osm.opening_hours;
    if (DWELLINGS.has(osm.building) && !publicTag) {
      return `OpenStreetMap has it as a dwelling (building=${osm.building})`;
    }
  }
  // A royal residence that is not also a museum, which is the same test the
  // closed types make — hoisted here so nothing downstream can talk it round.
  if (set.has('Q131986827') && ![...set].some((q) => OPEN_KINDS.has(q))) {
    return 'a residence of the royal family, and not a museum';
  }
  return null;
}

/** Whether the map says this is somewhere people go. */
export function osmSaysPublic(osm) {
  if (!osm) return null;
  for (const k of OSM_PUBLIC_KEYS) if (osm[k]) return `OpenStreetMap has it as ${k}=${osm[k]}`;
  if (osm.boundary === 'protected_area' || osm.boundary === 'national_park') return 'OpenStreetMap has it as protected land';
  if (osm.amenity === 'place_of_worship') return 'OpenStreetMap has it as a place of worship';
  if (osm.opening_hours) return 'OpenStreetMap has published opening hours for it';
  if (osm.fee && osm.fee !== 'no') return 'OpenStreetMap records an admission charge for it';
  // Somebody runs it. English Heritage runs Witley Court and the Welsh
  // Government runs the Menai Suspension Bridge, and both were sitting
  // unestablished with the answer in a tag nothing read.
  if (osm.operator) return `OpenStreetMap has it run by ${osm.operator}`;
  return null;
}

// ---------------------------------------------------------------------------
// Wikipedia
// ---------------------------------------------------------------------------

/**
 * Category names that mean the article is about somewhere you can go.
 *
 * The one that matters is "historic house museums": it is how Highclere Castle
 * and Chatsworth House are distinguished from Cumberland Lodge and Birkhall,
 * none of which OpenStreetMap has anything public on.
 */
const CATEGORY_SAYS_OPEN = /visitor attraction|tourist attraction|museum|country park|national trust|english heritage|historic scotland|cadw|botanical garden|arboretum|zoo|theme park|art galler|national park|heritage site|open-air|nature reserve|country house.*open|gardens open/i;

export function wikipediaSaysPublic(categories) {
  const hit = (categories || []).find((c) => CATEGORY_SAYS_OPEN.test(c));
  return hit ? `Wikipedia files it under "${hit}"` : null;
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

/**
 * What Google calls the place.
 *
 * Only ever consulted for a place we were already asking Google about for its
 * rating, and only the conclusion is kept — never their name, rating, hours,
 * photographs or the type list itself. `types` rides along free on a request
 * that already asks for `rating`, because Places bills once at the highest tier
 * asked for and a rating is a tier above a type.
 */
const GOOGLE_PUBLIC = new Set(['tourist_attraction', 'museum', 'art_gallery', 'park', 'national_park',
  'zoo', 'aquarium', 'amusement_park', 'water_park', 'historical_landmark', 'historical_place',
  'monument', 'church', 'mosque', 'synagogue', 'hindu_temple', 'place_of_worship', 'stadium',
  'garden', 'botanical_garden', 'hiking_area', 'wildlife_park', 'observation_deck', 'castle',
  'cultural_landmark', 'performing_arts_theater', 'visitor_center', 'campground', 'beach']);

export function googleSaysPublic({ types = [], primaryType = null, ratingCount = null } = {}) {
  const all = [primaryType, ...(types || [])].filter(Boolean);
  const hit = all.find((t) => GOOGLE_PUBLIC.has(t));
  if (hit) return `Google lists it as ${String(hit).replace(/_/g, ' ')}`;
  // Thousands of people have rated it, so thousands of people have been.
  if (Number(ratingCount) >= 200) return 'Google has hundreds of visitor ratings for it';
  return null;
}

/**
 * @returns {{ visiting: 'yes'|'no'|null, because: string|null, by: string|null }}
 */
export function judgeVisiting({ kinds = [], summary = '', osm = null, categories = null, google = null } = {}) {
  const set = new Set(kinds || []);
  const text = String(summary || '');

  /*
   * 1. Statements about the whole place, which outrank the veto.
   *
   * The veto reads OpenStreetMap tags, and a tag is attached to one feature: the
   * mansion at Nostell Priory is `building=house` and the estate road at
   * Balmoral is `access=private`, and both places sell tickets. Run absolutely,
   * the veto hid Hatfield House, Muncaster Castle, Castle Campbell, Forde Abbey
   * and The Homewood — several of them National Trust.
   *
   * A Wikipedia category is a different kind of claim: "Historic house museums
   * in Cheshire" is about the institution, not a structure. Checked against the
   * refusals by hand, it calls 15 of 18 genuinely-open places public and none of
   * 18 private houses. So it goes first, along with the Wikidata types that
   * describe function rather than fabric, and a description that says outright
   * that the public may come.
   */
  const byWiki = wikipediaSaysPublic(categories);
  if (byWiki) return { visiting: 'yes', because: byWiki, by: 'wikipedia' };

  // An admission charge settles it on its own. Nobody sells tickets to their own
  // house, and the tag is about the place rather than one of its buildings —
  // which is how Castle Campbell came to be refused for `building=house` while
  // carrying `fee=yes` a few characters away.
  if (osm?.fee && osm.fee !== 'no') {
    return { visiting: 'yes', because: 'OpenStreetMap records an admission charge for it', by: 'osm' };
  }

  for (const q of set) {
    if (STRONG_OPEN_KINDS.has(q)) return { visiting: 'yes', because: 'it is a museum, a park or a garden — somewhere whose purpose is being visited', by: 'kinds' };
  }
  const open = text.match(SAYS_OPEN);
  if (open) return { visiting: 'yes', because: `its description says "${open[0].toLowerCase()}"`, by: 'summary' };

  // 2. The veto. Nothing below this line can overturn it.
  const vetoed = residentialVeto({ osm, kinds });
  if (vetoed) return { visiting: 'no', because: vetoed, by: 'veto' };

  // 3. Refusals that are not vetoes.
  for (const [q, why] of CLOSED_KINDS) if (set.has(q)) return { visiting: 'no', because: why, by: 'kinds' };

  // 4. Weaker acceptances, which only speak once nothing has refused.
  for (const q of set) {
    if (WEAK_OPEN_KINDS.has(q)) return { visiting: 'yes', because: 'it is a castle, a palace or another building of the kind people visit', by: 'kinds' };
  }
  const byOsm = osmSaysPublic(osm);
  if (byOsm) return { visiting: 'yes', because: byOsm, by: 'osm' };

  const byGoogle = google ? googleSaysPublic(google) : null;
  if (byGoogle) return { visiting: 'yes', because: byGoogle, by: 'google' };

  // Only the defining sentence counts. Read over the whole summary this was
  // wrong as often as right: "Following its dissolution in 1536, the buildings
  // were converted to a private residence" hid Reigate Priory, which is a
  // school, a museum and a public park. What an article says first is what the
  // place *is*; everything after it is history, and history is not opening
  // hours.
  const first = text.split(/(?<=\.)\s/)[0] ?? '';
  const shut = first.match(SAYS_CLOSED);
  if (shut && !WAS_ONCE.test(first)) {
    return { visiting: 'no', because: `its description opens "${shut[0].toLowerCase()}"`, by: 'summary' };
  }

  // Google was asked and had nothing public to say about it, which for a place
  // Google knows at all is close to an answer — but not one worth recording as
  // a refusal, because Google not listing a thing is mostly about Google.
  return { visiting: null, because: null, by: null };
}
