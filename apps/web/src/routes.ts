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
 *   /household/<id>                    one person in the household (the list is Settings now)
 *   /host                              hosting: learn (three ways to host), or your dashboard
 *   /host/learn/<shape>                   …how a one-off / series / anytime works, with worked examples
 *   /host/learn/examples                  …what people host
 *   /host/learn/examples/<key>            …one worked example, with the words and the price
 *   /host/learn/who                       …who can come: invite-only, the link, anyone on Epic
 *   /host/profile                         …you: name, town, kind of host, intro video, payouts
 *   /host/offers/new                      …a new offer (?shape=)
 *   /host/offers/<id>                     …one offer's dashboard
 *   /host/offers/<id>/edit                …its set-up, one question per screen (?step=vis)
 *   /host/video                           …record a video (?offer=<id> for one offer's)
 *   /invited/<token>                   an invitation to a private offer: yes or no, and how many
 *   /hosts/<id>                        a host's public profile (works logged-out)
 *   /hosts/<id>/trust                     …the trust ladder, as a guest sees it
 *   /experiences/<id>                  one experience's page (works logged-out)
 *   /experiences/<id>/book                …the booking sheet
 *   /experiences/<id>/where               …the four formats, explained
 *   /bookings/<id>                     a booking: held, booked, or past
 *   /bookings/<id>/rate                   …rate the host
 *   /inspire/people                    who near your trip does what you love
 *   /household/<memberId>                 …one person
 *   /household/<memberId>/tell               …telling Epic about them, by voice (D3)
 *   /household/<memberId>/review             …the card of what was heard (D4)
 *   /say                               just say it — the mic (C1; ?for=trip is Trips' New trip, R1; ?for=inspire the ask row, R5)
 *   /say/steps                            …one question at a time, three pages (B1–B3; ?page=)
 *   /say/<intakeId>                       …here's what we heard, the fact card (C3 / B4 / R3)
 *   /say/<intakeId>/ask                   …a gap question (C4; ?n=)
 *   /welcome                           first run, two doors (C0)
 *   /setup                             set up my family first, five steps (O1–O5; ?step=)
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


/**
 * Five in the bar (owner, 12 Sep 2026, Groups & events NEW): Inspire · Places ·
 * Trips · Host · Settings. Household folded into Settings to make the room, so
 * `household` is no longer a tab — a person's page lights Settings up.
 */
export type Tab = 'inspire' | 'plan' | 'places' | 'trips' | 'host' | 'settings' | 'prototypes';

/**
 * The Host tab's pages (13 Sep 2026). `home` is the tab: the learn layer for
 * somebody who is not a host, the dashboard for somebody who is. `shape`,
 * `examples`, `example` and `who` are the learn layer, which asks for nothing.
 * `param` carries the shape or the example's key.
 */
export type HostPage = 'home' | 'shape' | 'examples' | 'example' | 'who' | 'profile' | 'start' | 'new' | 'offer' | 'edit' | 'video';

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
  | 'lookup' | 'coverage' | 'places' | 'library' | 'shelves' | 'scout' | 'sources' | 'categories' | 'voice' | 'hosting' | 'roles' | 'plans' | 'audit' | 'how';
export const ADMIN_SCREENS: AdminScreen[] = [
  'overview', 'accounts', 'households', 'activity', 'reporting', 'lookup', 'coverage', 'places', 'library', 'shelves', 'scout', 'sources', 'categories', 'voice', 'hosting', 'roles', 'plans', 'audit', 'how',
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
  /**
   * `voice` is the spoken layer over one person (voice intake handoff, Option
   * D): `tell` is the recording, `review` the card of what was heard.
   */
  | { name: 'household'; memberId: string | null; voice: 'tell' | 'review' | null }
  | { name: 'settings'; section: SettingsSection }
  /**
   * Hosting (Events & Hosts, 12 Sep 2026). The tab is hosting only — guests
   * find experiences in Inspire and Places and book them into Trips. `offerId`
   * is set on an offer's dashboard and its wizard; `?step=` is the wizard's
   * page and `?shape=` the fork on a new one.
   */
  | { name: 'host'; page: HostPage; offerId: string | null; param?: string | null }
  /** An invitation to a private offer (13 Sep 2026): outside the app, the token is the credential. */
  | { name: 'invited'; token: string }
  /** A host's public profile, and the trust ladder over it. Works logged-out. */
  | { name: 'hostProfile'; hostId: string; layer: 'trust' | null }
  /** One experience, and the two layers over it: the booking sheet and the formats. */
  | { name: 'experience'; id: string; layer: 'book' | 'where' | null }
  /** A booking of ours — held, booked or past — and rating the host after. */
  | { name: 'booking'; id: string; rate: boolean }
  /** Passion-led discovery: the people near a trip who do what you love (`?trip=`, `?love=`). */
  | { name: 'people' }
  | { name: 'prototypes'; section: PrototypeSection | null }
  | { name: 'admin'; screen: AdminScreen }
  /**
   * Voice intake (handoff, 8 Sep 2026). `/say` is the mic; `/say/steps` the
   * three-page wizard; `/say/<id>` the fact card for one reading; `/say/<id>/ask`
   * its gap questions. How the page is set travels in the query: `?for=trip`
   * (Trips' New trip, Option R) or `?for=inspire` (the ask row); `?type=1` the
   * keyboard; `?page=2` the wizard's page; `?n=2` the second question.
   */
  | { name: 'say'; intakeId: string | null; steps: boolean; ask: boolean }
  /** First run: two doors (C0). */
  | { name: 'welcome' }
  /** "Set up my family first" — five steps, `?step=1..5` (row O). */
  | { name: 'setup' }
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
      if (a === 'people') return b ? { name: 'unknown', path } : { name: 'people' };
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

    case 'household': {
      if (a && b === 'tell') return { name: 'household', memberId: a, voice: 'tell' };
      if (a && b === 'review') return { name: 'household', memberId: a, voice: 'review' };
      if (b) return { name: 'unknown', path };
      // The household list is Settings now ("You and yours", 12 Sep 2026); the
      // bare address is answered by the legacy redirect, and a person keeps
      // their own page.
      return { name: 'household', memberId: a ?? null, voice: null };
    }

    case 'host': {
      if (!a) return { name: 'host', page: 'home', offerId: null };
      if (a === 'learn') {
        if (b === 'examples') return c ? { name: 'host', page: 'example', offerId: null, param: c } : { name: 'host', page: 'examples', offerId: null };
        if (b === 'who') return c ? { name: 'unknown', path } : { name: 'host', page: 'who', offerId: null };
        const shape = oneOf(['oneoff', 'series', 'anytime'] as const, b);
        return shape && !c ? { name: 'host', page: 'shape', offerId: null, param: shape } : { name: 'unknown', path };
      }
      if (a === 'profile') return b ? { name: 'unknown', path } : { name: 'host', page: 'profile', offerId: null };
      if (a === 'start') return b ? { name: 'unknown', path } : { name: 'host', page: 'start', offerId: null };
      if (a === 'video') return b ? { name: 'unknown', path } : { name: 'host', page: 'video', offerId: null };
      if (a === 'offers' && b === 'new') return c ? { name: 'unknown', path } : { name: 'host', page: 'new', offerId: null };
      if (a === 'offers' && b && !c) return { name: 'host', page: 'offer', offerId: b };
      if (a === 'offers' && b && c === 'edit') return { name: 'host', page: 'edit', offerId: b };
      return { name: 'unknown', path };
    }

    case 'hosts': {
      if (!a) return { name: 'unknown', path };
      if (b === 'trust') return c ? { name: 'unknown', path } : { name: 'hostProfile', hostId: a, layer: 'trust' };
      return b ? { name: 'unknown', path } : { name: 'hostProfile', hostId: a, layer: null };
    }

    case 'experiences': {
      if (!a) return { name: 'unknown', path };
      if (b === 'book' || b === 'where') return c ? { name: 'unknown', path } : { name: 'experience', id: a, layer: b };
      return b ? { name: 'unknown', path } : { name: 'experience', id: a, layer: null };
    }

    case 'bookings': {
      if (!a) return { name: 'unknown', path };
      if (b === 'rate') return c ? { name: 'unknown', path } : { name: 'booking', id: a, rate: true };
      return b ? { name: 'unknown', path } : { name: 'booking', id: a, rate: false };
    }

    case 'say': {
      if (!a) return { name: 'say', intakeId: null, steps: false, ask: false };
      if (a === 'steps') return b ? { name: 'unknown', path } : { name: 'say', intakeId: null, steps: true, ask: false };
      if (b === 'ask') return { name: 'say', intakeId: a, steps: false, ask: true };
      if (b) return { name: 'unknown', path };
      return { name: 'say', intakeId: a, steps: false, ask: false };
    }

    case 'welcome':
      return a ? { name: 'unknown', path } : { name: 'welcome' };

    case 'setup':
      return a ? { name: 'unknown', path } : { name: 'setup' };

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

    case 'invited':
      return a && !b ? { name: 'invited', token: a } : { name: 'unknown', path };

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
    case 'household': return buildHref(['household', route.memberId, route.memberId ? route.voice : null]);
    case 'host':
      return route.page === 'home' ? '/host'
        : route.page === 'shape' ? buildHref(['host', 'learn', route.param])
          : route.page === 'examples' ? '/host/learn/examples'
            : route.page === 'example' ? buildHref(['host', 'learn', 'examples', route.param])
              : route.page === 'who' ? '/host/learn/who'
                : route.page === 'profile' ? '/host/profile'
                  : route.page === 'start' ? '/host/start'
                    : route.page === 'video' ? '/host/video'
                      : route.page === 'new' ? '/host/offers/new'
                        : buildHref(['host', 'offers', route.offerId, route.page === 'edit' ? 'edit' : null]);
    case 'invited': return buildHref(['invited', route.token]);
    case 'hostProfile': return buildHref(['hosts', route.hostId, route.layer]);
    case 'experience': return buildHref(['experiences', route.id, route.layer]);
    case 'booking': return buildHref(['bookings', route.id, route.rate ? 'rate' : null]);
    case 'people': return '/inspire/people';
    case 'say':
      return route.steps ? '/say/steps'
        : route.intakeId ? buildHref(['say', route.intakeId, route.ask ? 'ask' : null])
          : '/say';
    case 'welcome': return '/welcome';
    case 'setup': return '/setup';
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
  /** A person's page. The household list itself is Settings now. */
  household: (memberId?: string | null) => (memberId ? buildHref(['household', memberId]) : '/settings'),
  // Hosting.
  host: () => '/host',
  hostStart: (step?: number) => (step && step > 1 ? `/host/start?step=${step}` : '/host/start'),
  /** The learn layer: nothing to fill in. */
  hostLearn: (shape: 'oneoff' | 'series' | 'anytime') => buildHref(['host', 'learn', shape]),
  hostExamples: () => '/host/learn/examples',
  hostExample: (key: string) => buildHref(['host', 'learn', 'examples', key]),
  hostWho: () => '/host/learn/who',
  hostMe: () => '/host/profile',
  invited: (token: string) => buildHref(['invited', token]),
  hostNewOffer: (shape?: string | null) => (shape ? `/host/offers/new?shape=${shape}` : '/host/offers/new'),
  hostOffer: (id: string) => buildHref(['host', 'offers', id]),
  /** A step is named, not numbered: the sequence differs by shape, visibility and money. */
  hostOfferEdit: (id: string, step?: string | number | null) => `${buildHref(['host', 'offers', id, 'edit'])}${step && step !== 'plan' && step !== 1 ? `?step=${step}` : ''}`,
  hostVideo: (offerId?: string | null) => (offerId ? `/host/video?offer=${encodeURIComponent(offerId)}` : '/host/video'),
  hostProfile: (hostId: string) => buildHref(['hosts', hostId]),
  hostTrust: (hostId: string) => buildHref(['hosts', hostId, 'trust']),
  experience: (id: string) => buildHref(['experiences', id]),
  experienceBook: (id: string) => buildHref(['experiences', id, 'book']),
  experienceWhere: (id: string) => buildHref(['experiences', id, 'where']),
  booking: (id: string) => buildHref(['bookings', id]),
  bookingRate: (id: string) => buildHref(['bookings', id, 'rate']),
  /** Who near a trip does what you love (F2). */
  people: (opts?: { trip?: string | null; love?: string | null }) => {
    const q = new URLSearchParams();
    if (opts?.trip) q.set('trip', opts.trip);
    if (opts?.love) q.set('love', opts.love);
    const qs = q.toString();
    return qs ? `/inspire/people?${qs}` : '/inspire/people';
  },
  /** Trips › Booked with hosts. */
  bookings: () => '/trips?when=hosts',
  /** The spoken layer over one person: the recording, then the card of what was heard (D3, D4). */
  householdTell: (memberId: string) => buildHref(['household', memberId, 'tell']),
  householdReview: (memberId: string) => buildHref(['household', memberId, 'review']),
  /** Voice intake: the mic, set for a door (`trip`, `inspire`) or not. */
  say: (opts?: { for?: 'trip' | 'inspire' | null; type?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.for) q.set('for', opts.for);
    if (opts?.type) q.set('type', '1');
    const qs = q.toString();
    return qs ? `/say?${qs}` : '/say';
  },
  saySteps: (page?: number) => (page && page > 1 ? `/say/steps?page=${page}` : '/say/steps'),
  heard: (intakeId: string) => buildHref(['say', intakeId]),
  ask: (intakeId: string, n?: number) => `${buildHref(['say', intakeId, 'ask'])}${n && n > 1 ? `?n=${n}` : ''}`,
  welcome: () => '/welcome',
  setup: (step?: number) => (step && step > 1 ? `/setup?step=${step}` : '/setup'),
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
  // The voice intake's screens draw their own head — a back arrow and a big
  // title, or the wordmark on the two doors (handoff boards, 8 Sep 2026); the
  // shell's lime band above them would be a second header on every one.
  if (route.name === 'say' || route.name === 'welcome' || route.name === 'setup') return true;
  if (route.name === 'household' && route.voice) return true;
  /**
   * The Host tab draws the same head as Trips — the wordmark and one control
   * — and every page inside it (onboarding, the wizard, the recorder, an
   * offer's dashboard) is drawn to the top of the phone with its own title and
   * its own back (Hosts and Events, H1–H4, W1–W5, D1).
   */
  if (route.name === 'host' || route.name === 'people' || route.name === 'booking') return true;
  // The booking sheet draws its own "Book this" head; the shell's band above it would be a second one.
  if (route.name === 'experience') return true;
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
  // The voice intake's screens are one thing each — a mic, a card, a question —
  // drawn to the handoff's boards, which have no tab bar (8 Sep 2026).
  if (route.name === 'say' || route.name === 'welcome' || route.name === 'setup') return true;
  if (route.name === 'household' && route.voice) return true;
  // Becoming a host, the offer wizard and the recorder are forms; an offer's
  // dashboard and a booking are one thing each. The tab itself keeps the bar.
  // The learn layer keeps the bar (it is still the tab); the set-up, the
  // profile and the recorder take the phone whole.
  if (route.name === 'host') return !['home', 'shape', 'examples', 'example', 'who'].includes(route.page);
  if (route.name === 'booking') return true;
  // The booking sheet is a form under a keyboard: it takes the phone whole.
  if (route.name === 'experience') return route.layer === 'book';
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
    // A person's page is a layer of Settings now.
    case 'household': return 'settings';
    case 'settings': return 'settings';
    case 'host': return 'host';
    case 'people': return 'inspire';
    case 'booking': return 'trips';
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
  // A person is a record, not the list: Settings is left pointing at itself.
  if (route.name === 'household') return false;
  if (route.name === 'host') return ['home', 'shape', 'examples', 'example', 'who'].includes(route.page);
  if (route.name === 'booking' || route.name === 'people') return false;
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
    case 'household': return route.voice ? paths.household(route.memberId) : '/settings';
    case 'host':
      if (route.page === 'edit' && route.offerId) return paths.hostOffer(route.offerId);
      if (route.page === 'example') return paths.hostExamples();
      return route.page === 'home' ? '/inspire' : '/host';
    case 'invited': return '/inspire';
    case 'hostProfile': return route.layer ? paths.hostProfile(route.hostId) : '/inspire';
    case 'experience': return route.layer ? paths.experience(route.id) : '/inspire';
    case 'booking': return route.rate ? paths.booking(route.id) : paths.bookings();
    case 'people': return '/inspire';
    // Up from the questions is the card; up from the card or the wizard is the mic; up from the mic is home.
    case 'say': return route.ask ? paths.heard(route.intakeId!) : route.intakeId || route.steps ? '/say' : '/inspire';
    case 'welcome': return '/inspire';
    case 'setup': return '/welcome';
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
    case 'household': return epic(route.voice === 'tell' ? 'Tell Epic about them' : route.voice === 'review' ? 'What we heard' : 'You and yours');
    case 'say': return epic(route.ask ? 'One more thing' : route.intakeId ? 'Here’s what we heard' : route.steps ? 'One at a time' : 'Just say it');
    case 'welcome': return epic('Plan less. Live more.');
    case 'setup': return epic('Set up your family');
    case 'settings': return epic('You and yours');
    case 'host': return epic(route.page === 'start' || route.page === 'profile' ? 'Host on Epic' : route.page === 'new' || route.page === 'edit' ? 'Your offer' : route.page === 'video' ? 'Your video' : route.page === 'offer' ? 'Your experience' : route.page === 'shape' ? 'How it works' : route.page === 'examples' || route.page === 'example' ? 'What people host' : route.page === 'who' ? 'Who can come' : 'Host');
    case 'invited': return epic('You are invited');
    case 'hostProfile': return epic(route.layer === 'trust' ? 'How Epic checks hosts' : 'A host');
    case 'experience': return epic(route.layer === 'book' ? 'Book this' : route.layer === 'where' ? 'Where it happens' : 'An experience');
    case 'booking': return epic(route.rate ? 'How was it?' : 'Your booking');
    case 'people': return epic('Who does what you love?');
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
  // The Household tab is folded into Settings (owner, 12 Sep 2026). The bare
  // address is still on phones and in the old `?tab=` links; both land on
  // "You and yours". A person's page (`/household/<id>`) is unchanged.
  if (path === '/household' || path === '/household/') { const q = query.toString(); return q ? `/settings?${q}` : '/settings'; }
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
    household: paths.settings(), settings: paths.settings(), prototypes: paths.prototypes(), host: paths.host(),
  };
  return known[tab] ? withQuery(known[tab]) : null;
}
