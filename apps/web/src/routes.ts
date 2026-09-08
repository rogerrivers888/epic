/**
 * Epic's addresses, in one place.
 *
 * Every page has one, every layer inside a page has one, and both directions —
 * an address read into a route, a route written back into an address — live
 * here so they cannot drift apart. `test/routes.test.ts` walks every shape both
 * ways.
 *
 *   /                                  the home screen
 *   /inspire                           what there is to do near you
 *   /inspire/search                       …the where-search, open
 *   /inspire/culture                      …one category, opened out as a list
 *   /inspire/culture?within=museums       …one drawer inside it
 *   /inspire/food                         …the other mode: what to eat
 *   /inspire/food/italian                 …one cuisine, or one kind of place
 *   /inspire?place=<ref>                  …a place's drawer, over any of them
 *   /plan                              the conversational planner
 *   /places                            the atlas: near home, the UK, abroad
 *   /places/home                          …everything close to home
 *   /places/GB                            …one country: its areas, its trips
 *   /places/GB/London                     …one area
 *   /places/GB/London?place=<ref>         …a place's drawer
 *   /trips                             the trips
 *   /trips/search                         …where are you going? (a trip begins here)
 *   /trips/new                            …the new-trip form
 *   /trips/<id>                           …one trip
 *   /trips/<id>/places                    …on one of its tabs
 *   /trips/<id>/chat                      …the group's conversation
 *   /trips/<id>/travel                    …getting there: flights, trains, the drive
 *   /trips/<id>/share                     …who is coming, and the link
 *   /trips/<id>/stop/<ref>                …one stop, and its Ask thread
 *   /trips/<id>/day/<dayId>               …on one day of it
 *   /household                         the family
 *   /household/<memberId>                 …one person
 *   /settings, /settings/providers     settings, and its two halves
 *   /prototypes, /prototypes/trips     the mock-ups, filed by part of the app
 *   /admin/<screen>                    the back office
 *   /join/<token>                      somebody else's door into a group trip
 *   /shared/<token>                    somebody else's door into one trip
 *
 * The query string is never the page — it is how the page is set: which filter,
 * which sort, which drawer is open over it. That split is what keeps one page
 * from having a dozen spellings.
 */

import type { MoodKey } from './api';

// ---------------------------------------------------------------------------
// Addresses, as strings
// ---------------------------------------------------------------------------
// Pure, and here rather than in router.tsx, so that what an address means can
// be tested without a React tree behind it (test/routes.test.ts).

/** "/a/b?x=1" → "/a/b", ["a","b"], {x:1}. Segments come back decoded. */
export function splitHref(href: string): { path: string; segments: string[]; query: URLSearchParams } {
  const cut = href.indexOf('?');
  const path = cut === -1 ? href : href.slice(0, cut);
  const query = new URLSearchParams(cut === -1 ? '' : href.slice(cut + 1));
  const segments = path.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  return { path, segments, query };
}

/** ["places","GB","Lake District"] + {kind:"eat"} → "/places/GB/Lake%20District?kind=eat". */
export function buildHref(segments: (string | null | undefined)[], query?: URLSearchParams | Record<string, string | null | undefined>): string {
  const path = `/${segments.filter((s): s is string => !!s).map((s) => encodeURIComponent(s)).join('/')}`;
  const q = query instanceof URLSearchParams ? query : toParams(query ?? {});
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * One address changed in part: "/places/home?kind=eat" + {type: null} keeps the
 * kind and drops the type. An empty or missing value means "not in the address"
 * — the default is never written down — and the path is left alone unless
 * `base` says otherwise, which is what the taps that move *and* set a filter
 * need ("/places/GB/London?kind=eat" from a chip on another page).
 *
 * It composes, which is the point: a handler that changes two things is two
 * calls, and the second must start from what the first wrote.
 */
export function withQuery(href: string, patch: Record<string, string | null | undefined>, base?: string): string {
  const { path, query } = splitHref(href);
  const q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') q.delete(k); else q.set(k, v);
  }
  const rest = q.toString();
  const on = base ?? path;
  return rest ? `${on}?${rest}` : on;
}

function toParams(o: Record<string, string | null | undefined>): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') q.set(k, v);
  return q;
}


export type Tab = 'inspire' | 'plan' | 'places' | 'trips' | 'household' | 'settings' | 'prototypes';

export const MOODS: MoodKey[] = ['fun', 'food', 'culture', 'sport', 'activity', 'adrenaline', 'relaxing', 'outdoors'];

/**
 * Inspire has two halves now (Inspire rework, 7 Sep 2026): what there is to do,
 * and what there is to eat. Food used to be a chip that took you to Places; it
 * is a mode of this screen instead, with its own strip and its own body.
 */
export type InspireMode = 'activities' | 'food';

/**
 * The category strip, per mode. Activities are moods; Food's are kinds of
 * place. `all` is not in either list — it is the absence of a pick, and so it
 * is the bare `/inspire` and `/inspire/food` rather than a word in the path.
 *
 * The handoff names five, but that list is illustrative — the categories are a
 * table the back office writes (migration 053), and the screen builds its strip
 * from whatever the pool actually answered with. Hardcoding the five here lost
 * Outdoors and Relaxing, which have twenty and ten places near Sunningdale
 * (owner, 7 Sep 2026: "there are some other categories that we had, like walks,
 * etc… you seem to be missing those").
 *
 * So this is only the *address* guard: every mood but Food may be a page here,
 * and which of them are offered is decided by what is near you.
 */
export const ACTIVITY_CATEGORIES: MoodKey[] = MOODS.filter((m) => m !== 'food');
/**
 * The kinds of place the Food & Drink half offers, in the order the strip draws
 * them (owner, 8 Sep 2026: "Restaurants, Bars, Bakeries, whatever different
 * places we have"). Bars are their own word now rather than folded into pubs,
 * and a bakery is not a café.
 *
 * The strip only ever offers what is actually near, so a category with nothing
 * behind it is not drawn — this is the vocabulary, not the menu.
 */
export const FOOD_CATEGORIES = ['restaurants', 'pubs', 'bars', 'cafes', 'bakeries', 'takeaway'] as const;

/**
 * A trip's tabs. The first three are the ones on the segmented control
 * (handover, 5 Sep 2026: "Itinerary | Places · n | Map"); the rest are the
 * working surfaces, which moved into the ⋯ menu rather than being taken away.
 */
export type TripSection =
  | 'itinerary' | 'places' | 'map'
  /**
   * The three the trip rebuild adds (7 Sep 2026). Each is a layer inside the
   * trip rather than a screen of its own, and each has an address, because
   * "2 layers in, I should be able to share a URL" is the rule.
   *
   *   chat    the group's conversation, with the map collapsed behind it (5e)
   *   travel  getting there: flights, trains, the drive, the crossing (5d)
   *   share   who is coming and the link (3b)
   */
  | 'chat' | 'travel' | 'share'
  /** One stop's Ask thread — `/trips/<id>/stop/<ref>` (3d). */
  | 'stop'
  | 'find' | 'shortlist' | 'day' | 'stay' | 'group' | 'data';
export const TRIP_SECTIONS: TripSection[] = [
  'itinerary', 'places', 'map', 'chat', 'travel', 'share', 'stop',
  'find', 'shortlist', 'day', 'stay', 'group', 'data',
];
/**
 * The tabs the segmented control draws; the others are reached from the ⋯ menu.
 *
 * Group is one of them (owner, 5 Sep 2026: "We've lost the group tab… can you
 * please add group into the boxes at the top?"). It is not a working surface
 * like Find or the shortlist — it is other people, waiting on you — so putting
 * it behind a menu made it something you had to remember to go and look at.
 */
export const TRIP_TABS: TripSection[] = ['itinerary', 'places', 'map', 'group'];

export type SettingsSection = 'preferences' | 'providers';
export const SETTINGS_SECTIONS: SettingsSection[] = ['preferences', 'providers'];

export type PrototypeSection = 'plan' | 'places' | 'trips' | 'household' | 'settings';
export const PROTOTYPE_SECTIONS: PrototypeSection[] = ['plan', 'places', 'trips', 'household', 'settings'];

export type AdminScreen =
  | 'overview' | 'accounts' | 'households' | 'activity' | 'reporting'
  | 'coverage' | 'places' | 'library' | 'shelves' | 'scout' | 'roles' | 'plans' | 'audit' | 'how';
export const ADMIN_SCREENS: AdminScreen[] = [
  'overview', 'accounts', 'households', 'activity', 'reporting', 'coverage', 'places', 'library', 'shelves', 'scout', 'roles', 'plans', 'audit', 'how',
];

/**
 * Where the atlas is pointed: nowhere yet, close to home, one country, or one
 * area inside it. A country is a page now — its areas and its trips (handover,
 * 5 Sep 2026) — so it has an address of its own.
 */
export type PlacesScope = null | { home: true } | { country: string; city: string | null };

export type Route =
  /**
   * `pick` is whatever the strip or the body opened: a mood in Activities, and
   * in Food either one of its four kinds or a cuisine from the list. One slot,
   * because the two are alternatives — you cannot be in Italian *and* Pubs —
   * and two would let the address say something the screen cannot draw.
   */
  | { name: 'inspire'; searching: boolean; mode: InspireMode; pick: string | null }
  | { name: 'plan' }
  | { name: 'places'; scope: PlacesScope }
  /**
   * `stopRef` is the source-qualified identifier of the stop whose Ask thread is
   * open — one more layer inside a trip, and one more address (3d).
   */
  | { name: 'trips'; searching: boolean; creating: boolean; tripId: string | null; section: TripSection | null; dayId: string | null; stopRef: string | null }
  | { name: 'household'; memberId: string | null }
  | { name: 'settings'; section: SettingsSection }
  | { name: 'prototypes'; section: PrototypeSection | null }
  | { name: 'admin'; screen: AdminScreen }
  | { name: 'join'; token: string }
  /**
   * A trip somebody was sent (trip rebuild, 3b): "anyone with the link sees the
   * plan, people and chat as a guest — no account needed". Outside the app, like
   * the waiter's order page: no tab, no wordmark band, no sign-in.
   */
  | { name: 'shared'; token: string }
  /**
   * What the waiter's camera opens (owner, 7 Sep 2026: "maybe there could be a
   * QR code that the waiter could scan to then see what I've ordered"). Its own
   * address, outside the app: no tab, no chrome, no sign-in.
   */
  | { name: 'order'; token: string }
  | { name: 'unknown'; path: string };

const oneOf = <T extends string>(all: readonly T[], v: string | undefined): T | null =>
  (v != null && (all as readonly string[]).includes(v) ? (v as T) : null);

/**
 * An address, read.
 *
 * Unknown paths come back as `unknown` rather than quietly becoming the home
 * screen: a mistyped or dead link should say so, not pretend it worked.
 */
export function parseRoute(path: string): Route {
  const { segments } = splitHref(path);
  const [head, a, b, c] = segments;

  if (!head) return { name: 'inspire', searching: false, mode: 'activities', pick: null };

  switch (head) {
    case 'inspire': {
      if (!a) return { name: 'inspire', searching: false, mode: 'activities', pick: null };
      if (a === 'search') return { name: 'inspire', searching: true, mode: 'activities', pick: null };
      if (a === 'food') {
        // A cuisine is open ended — the list comes from what is actually near —
        // so anything in the slot is taken as one rather than checked against a
        // table the bundle would have to carry.
        if (b && c) return { name: 'unknown', path };
        return { name: 'inspire', searching: false, mode: 'food', pick: b ?? null };
      }
      const category = oneOf(ACTIVITY_CATEGORIES, a);
      return category && !b
        ? { name: 'inspire', searching: false, mode: 'activities', pick: category }
        : { name: 'unknown', path };
    }

    case 'plan':
      return a ? { name: 'unknown', path } : { name: 'plan' };

    case 'places': {
      if (!a) return { name: 'places', scope: null };
      if (a === 'home') return { name: 'places', scope: { home: true } };
      // A country is a page: the areas in it, and the trips that went there.
      if (!b) return { name: 'places', scope: { country: a.toUpperCase(), city: null } };
      return { name: 'places', scope: { country: a.toUpperCase(), city: b } };
    }

    case 'trips': {
      const list = { name: 'trips', searching: false, creating: false, tripId: null, section: null, dayId: null, stopRef: null } as const;
      if (!a) return { ...list };
      /**
       * "Where are you going?" — the same question Inspire's search bar asks,
       * asked here because this is the tab somebody opens when they want a
       * trip (owner, 7 Sep 2026: "when I go to trips, I should be able to just
       * create a new trip from here, in the same way that I can when I click
       * on the search box on the Inspire tab").
       */
      if (a === 'search') return { ...list, searching: true };
      if (a === 'new') return { ...list, creating: true };
      const section = oneOf(TRIP_SECTIONS, b);
      if (b && !section) return { name: 'unknown', path };
      // A stop's Ask thread names the stop; a day names the day. Both are the
      // third segment, and which it is depends on the second.
      return {
        ...list, tripId: a, section,
        dayId: section === 'day' ? c ?? null : null,
        stopRef: section === 'stop' ? c ?? null : null,
      };
    }

    case 'household':
      return { name: 'household', memberId: a ?? null };

    case 'settings': {
      if (!a) return { name: 'settings', section: 'preferences' };
      const section = oneOf(SETTINGS_SECTIONS, a);
      return section ? { name: 'settings', section } : { name: 'unknown', path };
    }

    case 'prototypes': {
      if (!a) return { name: 'prototypes', section: null };
      const section = oneOf(PROTOTYPE_SECTIONS, a);
      return section ? { name: 'prototypes', section } : { name: 'unknown', path };
    }

    case 'admin': {
      const screen = oneOf(ADMIN_SCREENS, a ?? 'overview');
      return screen ? { name: 'admin', screen } : { name: 'unknown', path };
    }

    case 'join':
      return a ? { name: 'join', token: a } : { name: 'unknown', path };

    case 'shared':
      return a ? { name: 'shared', token: a } : { name: 'unknown', path };

    case 'order':
      return a ? { name: 'order', token: a } : { name: 'unknown', path };

    default:
      return { name: 'unknown', path };
  }
}

/** A route, written. The inverse of `parseRoute`, and the only place hrefs are spelled. */
export function hrefOf(route: Route): string {
  switch (route.name) {
    case 'inspire': {
      if (route.searching) return '/inspire/search';
      const parts = route.mode === 'food' ? ['inspire', 'food'] : ['inspire'];
      if (route.pick) parts.push(route.pick);
      return buildHref(parts);
    }
    case 'plan': return '/plan';
    case 'places':
      return route.scope == null ? '/places'
        : 'home' in route.scope ? '/places/home'
          : buildHref(['places', route.scope.country, route.scope.city]);
    case 'trips':
      return route.searching ? '/trips/search'
        : route.creating ? '/trips/new'
          : route.tripId == null ? '/trips'
            : buildHref(['trips', route.tripId, route.section,
              route.section === 'day' ? route.dayId : route.section === 'stop' ? route.stopRef : null]);
    case 'household': return buildHref(['household', route.memberId]);
    case 'settings': return route.section === 'preferences' ? '/settings' : buildHref(['settings', route.section]);
    case 'prototypes': return buildHref(['prototypes', route.section]);
    case 'admin': return buildHref(['admin', route.screen]);
    case 'join': return buildHref(['join', route.token]);
    case 'shared': return buildHref(['shared', route.token]);
    case 'order': return buildHref(['order', route.token]);
    case 'unknown': return route.path;
  }
}

/** The addresses screens link to, spelled once. */
export const paths = {
  inspire: () => '/inspire',
  inspireSearch: () => '/inspire/search',
  /** One category of Activities, opened out as a list. */
  inspireShelf: (mood: MoodKey) => buildHref(['inspire', mood]),
  /** The other mode, and one cuisine or kind of place inside it. */
  inspireFood: (pick?: string | null) => buildHref(pick ? ['inspire', 'food', pick] : ['inspire', 'food']),
  inspireMode: (mode: InspireMode, pick?: string | null) =>
    (mode === 'food' ? buildHref(pick ? ['inspire', 'food', pick] : ['inspire', 'food']) : buildHref(pick ? ['inspire', pick] : ['inspire'])),
  plan: () => '/plan',
  places: () => '/places',
  placesHome: () => '/places/home',
  placesCountry: (country: string) => buildHref(['places', country]),
  placesCity: (country: string, city: string) => buildHref(['places', country, city]),
  trips: () => '/trips',
  tripsSearch: () => '/trips/search',
  newTrip: () => '/trips/new',
  trip: (id: string, section?: TripSection | null, dayId?: string | null) =>
    buildHref(['trips', id, section, section === 'day' ? dayId : null]),
  /** The three layers the trip rebuild adds, and the Ask thread on one stop. */
  tripChat: (id: string) => buildHref(['trips', id, 'chat']),
  tripTravel: (id: string) => buildHref(['trips', id, 'travel']),
  tripShare: (id: string) => buildHref(['trips', id, 'share']),
  tripStop: (id: string, venueRef: string) => buildHref(['trips', id, 'stop', venueRef]),
  household: (memberId?: string | null) => buildHref(['household', memberId]),
  settings: (section?: SettingsSection) => (section && section !== 'preferences' ? buildHref(['settings', section]) : '/settings'),
  prototypes: (section?: PrototypeSection | null) => buildHref(['prototypes', section]),
  admin: (screen: AdminScreen) => buildHref(['admin', screen]),
  join: (token: string) => buildHref(['join', token]),
  /** Somebody else's door into one trip. */
  shared: (token: string) => buildHref(['shared', token]),
  order: (token: string) => buildHref(['order', token]),
};

/**
 * Screens where the shell draws no chrome of its own.
 *
 * The trip is a map now (design handoff, 6 Sep 2026), and a map with a lime
 * band and a wordmark above it is not a map that fills the screen — the owner,
 * 6 Sep 2026: "The map is supposed to take up the entire top of the screen,
 * literally everything. There should be no Epic icon or logo. It should take up
 * the entire screen, all the way to the edge of the screen, including the
 * little pill in the middle of the iPhone."
 *
 * So on these the header is not drawn at all and the tab bar floats over the
 * map rather than sitting under it. The trip's working surfaces — Find, the
 * shortlist, Stay — are ordinary pages and keep the chrome.
 */
export function isFullBleed(route: Route): boolean {
  if (route.name !== 'trips' || route.creating || route.tripId == null) return false;
  // The chat is the same screen with the map collapsed to a strip (5e), so it
  // draws to every edge too; it is not in TRIP_TABS because it is not a tab.
  return route.section == null || route.section === 'chat' || TRIP_TABS.includes(route.section);
}

/**
 * Screens that draw their own head, so the shell must not draw one over it.
 *
 * Inspire's header is not a title bar — it is the wordmark, where you are
 * looking, which half of the app you are in and which category (Inspire rework,
 * 7 Sep 2026, screens 8a/8b/8d). The shell's lime band above that would be a
 * second wordmark on the same screen. Unlike a full-bleed screen this one keeps
 * the tab bar under it, because it is still a tab.
 */
export function ownsHeader(route: Route): boolean {
  if (route.name === 'inspire') return !route.searching;
  /**
   * Places draws its own too (handover v8, §3): the wordmark over a lime band
   * at the root, and over cream at every level below it, so the lime switch
   * inside a place list keeps its selected state. The shell's band would be a
   * second wordmark, and it would be lime at every level.
   */
  if (route.name === 'places') return true;
  /**
   * The Trips list draws the same head (trip rebuild, 1a): the wordmark on the
   * left and "+ New trip" on the right, then the Day trips / Holidays switch
   * and the Upcoming · Past · Ideas strip on one 2px ink rule. The shell's lime
   * band above that would be a second wordmark on the same screen.
   */
  if (route.name === 'trips') {
    /**
     * The list draws it (1a), and so does every screen the rebuild pushes on
     * top of it: the new-trip search (3a), the create screen (5a/5b), Getting
     * there (5d), a stop's Ask (3d) and the share sheet's page. Each of those
     * is drawn to the top of the phone with its own title and its own ×, and
     * the shell's lime band over it would be a heading nobody asked for.
     *
     * They keep the tab bar, unlike a full-bleed screen: they are still Trips.
     */
    if (!route.tripId) return true;
    return route.section === 'travel' || route.section === 'stop' || route.section === 'share';
  }
  return false;
}

/**
 * Screens that take the phone whole: no tab bar either.
 *
 * The group is a form — five steps, a dozen fields, an event to write — and on
 * a phone a form under a keyboard has no room to spare (owner, 6 Sep 2026:
 * "You've got the menu in the bottom: Inspire, Places, and Trips, that make it
 * almost impossible to view anything, and I've got a tiny window to do
 * anything"). The way out is the header's own Back, which is on screen the
 * whole time; the tabs come back the moment the group is left.
 */
/**
 * A browse is immersive too (trips V2, 8 Sep 2026): "the bottom tab bar hides
 * for the whole browse, and in place views; it returns on back to the trip".
 *
 * The reason is the same as the group's. A browse is the map, a sheet you drag
 * and a list you scroll, and the tab bar was seventy pixels of somewhere else
 * pinned under all three. Which browse is open is in the query rather than the
 * path — the page is still the trip's map — so the query is what answers it.
 */
export function isImmersive(route: Route, query?: URLSearchParams): boolean {
  if (route.name !== 'trips' || route.creating || route.tripId == null) return false;
  if (route.section === 'group') return true;
  // The bare `/trips/<id>` is the map, and parses with no section at all.
  const onTheMap = route.section == null || route.section === 'map' || route.section === 'itinerary';
  // "Hidden during any trip browse, place view or full view" (handover v8,
  // §1): a place open over the map is a place view whether or not a browse
  // is under it.
  return onTheMap && Boolean(query?.get('pill') || query?.get('place'));
}

/** Which tab in the shell a route belongs under, so the rail can light up. */
export function tabOf(route: Route): Tab | null {
  switch (route.name) {
    case 'inspire': return 'inspire';
    case 'plan': return 'plan';
    case 'places': return 'places';
    case 'trips': return 'trips';
    case 'household': return 'household';
    case 'settings': return 'settings';
    case 'prototypes': return 'prototypes';
    default: return null;
  }
}

/**
 * Whether a tab may be left pointing at this address.
 *
 * A tab remembers how a *list* was set — which filters, which city — and never
 * which record was open inside it. Tapping Trips has to be arriving at the
 * trips (owner, 7 Sep 2026: "when I go to trips, I should be able to just
 * create a new trip from here… Currently, it takes me into the last trip"),
 * with the trip one tap away in the list where it has always been.
 *
 * This does not undo what the memory is for (owner, 4 Sep 2026: "I come back
 * 10 minutes later after navigating off that tab, everything's disappeared").
 * The Holidays / Past / who filter he set is still waiting for him; it is the
 * one trip he happened to have open that no longer swallows the tab. It is the
 * same rule the shell already applies to an open drawer — something you were
 * reading rather than somewhere you were.
 */
export function isTabHome(route: Route): boolean {
  if (route.name === 'trips') return !route.tripId && !route.creating && !route.searching;
  return true;
}

/** One layer up, for a Back that has no history behind it (a link somebody was sent). */
export function parentOf(route: Route): string {
  switch (route.name) {
    // Up from a cuisine is the Food list; up from a category or the search is
    // the mode's own home.
    case 'inspire': return route.pick && route.mode === 'food' ? '/inspire/food' : '/inspire';
    case 'places':
      if (!route.scope) return '/inspire';
      if ('home' in route.scope) return '/places';
      return route.scope.city ? paths.placesCountry(route.scope.country) : '/places';
    case 'trips':
      if (route.dayId) return paths.trip(route.tripId!, 'day');
      // Up from a stop's Ask, or from Getting there, is the trip itself.
      if (route.section) return paths.trip(route.tripId!);
      if (route.tripId || route.creating || route.searching) return '/trips';
      return '/inspire';
    case 'household': return route.memberId ? '/household' : '/inspire';
    case 'admin': return route.screen === 'overview' ? '/inspire' : '/admin/overview';
    default: return '/inspire';
  }
}

/**
 * What the browser tab says. A window full of Epic tabs is otherwise seven
 * identical ones, and the address is only half of being able to find your way
 * back to a page.
 */
export function titleOf(route: Route): string {
  const epic = (s?: string) => (s ? `${s} · Epic` : 'Epic');
  switch (route.name) {
    case 'inspire': {
      if (route.searching) return epic('Where should we go?');
      const named = route.pick ? `${route.pick[0].toUpperCase()}${route.pick.slice(1).replace(/-/g, ' ')}` : null;
      return epic(named ?? (route.mode === 'food' ? 'Food' : 'Inspire'));
    }
    case 'plan': return epic('Plan');
    case 'places':
      return epic(route.scope == null ? 'Places' : 'home' in route.scope ? 'Close to home' : route.scope.city ?? route.scope.country);
    case 'trips': {
      if (route.searching) return epic('Where are you going?');
      if (route.creating) return epic('A new trip');
      if (!route.tripId) return epic('Trips');
      const layer = route.section === 'chat' ? 'Chat'
        : route.section === 'travel' ? 'Getting there'
          : route.section === 'share' ? 'Share trip'
            : route.section === 'stop' ? 'A stop' : null;
      return epic(layer ? `Trip — ${layer}` : 'Trip');
    }
    case 'household': return epic('Household');
    case 'settings': return epic('Settings');
    case 'prototypes': return epic('Prototypes');
    case 'admin': return epic(`Back office — ${route.screen}`);
    case 'join': return epic('Your trip');
    case 'shared': return epic('A trip you have been sent');
    case 'order': return epic('The order');
    case 'unknown': return epic('Not a page');
  }
}

/**
 * The addresses Epic used to have (`?tab=trips&trip=…&section=…`, `?join=…`),
 * turned into the ones it has now.
 *
 * The owner keeps these on his phone and group invites went out to people who
 * have never heard of Epic, so an old link has to keep working — it is answered
 * once, with a replace, and the new address is what stays in the bar.
 */
export function legacyHref(path: string, query: URLSearchParams): string | null {
  if (path !== '/' && path !== '') return null;
  const join = query.get('join');
  if (join) return paths.join(join);
  const tab = query.get('tab');
  if (!tab) return null;
  const keep = new URLSearchParams();
  // A magic link is redeemed by the Gate before any of this and is taken out of
  // the bar there, so it travels across the redirect rather than being dropped.
  const signin = query.get('signin');
  if (signin) keep.set('signin', signin);
  const q = keep.toString();
  const withQuery = (href: string) => (q ? `${href}${href.includes('?') ? '&' : '?'}${q}` : href);

  if (tab === 'trips') {
    const trip = query.get('trip');
    const section = oneOf(TRIP_SECTIONS, query.get('section') ?? undefined);
    return withQuery(trip ? paths.trip(trip, section) : paths.trips());
  }
  const known: Record<string, string> = {
    inspire: paths.inspire(), plan: paths.plan(), places: paths.places(),
    household: paths.household(), settings: paths.settings(), prototypes: paths.prototypes(),
  };
  return known[tab] ? withQuery(known[tab]) : null;
}
