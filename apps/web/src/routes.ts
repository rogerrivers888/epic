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
 *   /plans                             the plans: day trips, holidays and events
 *   /plans/search                         …where are you going? (a trip begins here)
 *   /plans/new                            …the new-trip form
 *   /plans/<id>                           …one trip
 *   /plans/<id>/places                    …on one of its tabs
 *   /plans/<id>/chat                      …the group's questions and notices
 *   /plans/<id>/chat/<topicId>              …one question, open
 *   /plans/<id>/chat/ask                    …asking one
 *   /plans/<id>/chat/bell                   …what you get told about here
 *   /plans/<id>/travel                    …getting there: flights, trains, the drive
 *   /plans/<id>/share                     …who is coming, and the link
 *   /plans/<id>/stop/<ref>                …one stop, and its Ask thread
 *   /plans/<id>/day/<dayId>               …on one day of it
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
 *   /inspire/collections               every collection this household can heart (the prototype's "Rows" phone)
 *   /household/<memberId>                 …one person
 *   /household/<memberId>/tell               …telling Epic about them, by voice (D3)
 *   /household/<memberId>/review             …the card of what was heard (D4)
 *   /say                               just say it — the mic (C1; ?for=trip is Trips' New trip, R1; ?for=inspire the ask row, R5)
 *   /say/steps                            …one question at a time, three pages (B1–B3; ?page=)
 *   /say/<intakeId>                       …here's what we heard, the fact card (C3 / B4 / R3)
 *   /say/<intakeId>/ask                   …a gap question (C4; ?n=)
 *   /welcome                           first run, two doors (C0)
 *   /opening                           the opening: postcards + four intro screens (1h; ?step=0..4)
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
export type Tab = 'inspire' | 'plan' | 'places' | 'trips' | 'host' | 'settings' | 'prototypes' | 'messages';

/**
 * The Host tab's pages (13 Sep 2026). `home` is the tab: the learn layer for
 * somebody who is not a host, the dashboard for somebody who is. `shape`,
 * `examples`, `example` and `who` are the learn layer, which asks for nothing.
 * `param` carries the shape or the example's key.
 */
export type HostPage = 'home' | 'shape' | 'examples' | 'example' | 'who' | 'profile' | 'start' | 'new' | 'offer' | 'edit' | 'video' | 'questions'
  // Four ways to host (hosting v7, 2 Oct 2026): the four lanes (4e), one lane's screen, step 1 before a
  // draft exists, a draft's set-up (?step=), its publish checklist (?sheet=) and the ending.
  | 'lanes' | 'lane' | 'compose' | 'setup' | 'publish' | 'done'
  // Hosting v4, existing hosts (E1–E13): Messages, automatic messages, To do, At risk, All events, one
  // event, Earnings, Fees, Reviews, Insights, Profile and settings. Home (E1) is /host itself.
  | 'messages' | 'auto' | 'todo' | 'risk' | 'events' | 'event' | 'earnings' | 'fees' | 'reviews' | 'insights' | 'me'
  // A host's offers and drafts (the existing dashboard), until host management has its own design.
  | 'manage';

/** The four lanes, by how often the thing runs (hosting v7). */
export const HOST_LANES = ['oneoff', 'weekly', 'course', 'onrequest'] as const;
export type HostLane = typeof HOST_LANES[number];

/**
 * The chat module's layers (Chat screens, 13 Sep 2026), the same four wherever
 * a conversation is mounted — a trip's, a booking's, a host's own offer:
 *
 *   …/chat               the list of questions (D3)
 *   …/chat/ask           asking one (D6–D8)
 *   …/chat/bell          what you get told about here (C9)
 *   …/chat/<topicId>     one question, open (E1)
 *
 * `ask` and `bell` are reserved words in the last segment; a topic id is a
 * uuid and can never collide with them.
 */
export type ChatLayer = { page: 'list' } | { page: 'ask' } | { page: 'bell' } | { page: 'topic'; topicId: string };
export function chatLayerOf(segment: string | undefined): ChatLayer {
  if (!segment) return { page: 'list' };
  if (segment === 'ask' || segment === 'bell') return { page: segment };
  return { page: 'topic', topicId: segment };
}
const chatSegment = (layer: ChatLayer | null | undefined): string | null =>
  (!layer || layer.page === 'list' ? null : layer.page === 'topic' ? layer.topicId : layer.page);

// Educational is the ninth (the axes brief, 25 Sep 2026): distinct from
// Culture, and an address of its own so a strip item for it can be opened.
export const MOODS: MoodKey[] = ['fun', 'food', 'culture', 'educational', 'sport', 'activity', 'adrenaline', 'relaxing', 'outdoors'];

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
  /** One stop's Ask thread — `/plans/<id>/stop/<ref>` (3d). */
  | 'stop'
  /**
   * The trip redesign (owner, 29 Sep 2026). `ideas` is the image-led feed the
   * X-ray search hands over to — `/plans/<id>/ideas/activities` and
   * `/plans/<id>/ideas/food`, one address per tab so the back button and a
   * shared link land on the right one. `shortlist` is the reworked shortlist,
   * kept at its old address so links do not break. `find` and `map` are the
   * retired pin-search sections: they still parse (an old link resolves) and
   * `legacyHref` redirects them to their new homes.
   */
  | 'ideas'
  // `stays` is the trip's fourth tab (nav 6a–6c, 30 Sep 2026): places to stay
  // along the trip. Distinct from the ⋯-menu `stay` panel it is folding in.
  | 'find' | 'shortlist' | 'stays' | 'day' | 'stay' | 'group' | 'data';
export const TRIP_SECTIONS: TripSection[] = [
  'itinerary', 'places', 'map', 'chat', 'travel', 'share', 'stop',
  'ideas', 'find', 'shortlist', 'stays', 'day', 'stay', 'group', 'data',
];
/** The feed's two tabs, each its own address under `…/ideas/`. */
export const IDEAS_TABS = ['activities', 'food'] as const;
export type IdeasTab = typeof IDEAS_TABS[number];
/**
 * The tabs the segmented control draws; the others are reached from the ⋯ menu.
 *
 * Group is one of them (owner, 5 Sep 2026: "We've lost the group tab… can you
 * please add group into the boxes at the top?"). It is not a working surface
 * like Find or the shortlist — it is other people, waiting on you — so putting
 * it behind a menu made it something you had to remember to go and look at.
 */
export const TRIP_TABS: TripSection[] = ['itinerary', 'places', 'map', 'group'];

export type SettingsSection = 'preferences' | 'providers' | 'notifications' | 'devices' | 'payments';
export const SETTINGS_SECTIONS: SettingsSection[] = ['preferences', 'providers', 'notifications', 'devices', 'payments'];

export type PrototypeSection = 'plan' | 'places' | 'trips' | 'household' | 'settings';
export const PROTOTYPE_SECTIONS: PrototypeSection[] = ['plan', 'places', 'trips', 'household', 'settings'];

/**
 * The back office's screens.
 *
 * `runs`, `demand` and `queue` arrived on 17 Sep 2026 with the place index: five
 * screens that were each bound to a different table became three bound to three
 * questions, plus a monitor for the long jobs.
 *
 * `coverage`, `lookup`, `library` and `scout` are the four that dissolved into
 * Places. They are **kept resolvable on purpose**: the owner's rule is that a
 * control he has questioned is a thing to make clear rather than to delete, and
 * any address anybody has kept still lands somewhere rather than on a 404. They
 * are no longer in the rail.
 */
export type AdminScreen =
  /**
   * The owner's approvals queue (G11). At the top of the rail, above the
   * reporting folder, because it is the one back-office screen that is about an
   * action waiting on a person rather than a number to read.
   */
  | 'approvals'
  | 'overview' | 'accounts' | 'households' | 'activity' | 'reporting'
  /**
   * The reporting suite (handoff "Reporting & overview", 20 Sep 2026): six
   * sections over one estate model. `reporting` is its Overview — the address
   * every link to the old engagement/revenue/usage screen already points at,
   * now landing on the richer thing — and `engagement` is where that screen
   * moved to. It is still resolvable and no longer in the rail, which is the
   * same treatment `coverage`, `lookup`, `library` and `scout` got.
   */
  | 'money' | 'subscriptions' | 'customers' | 'waitlist' | 'suppliers' | 'behaviour' | 'engagement'
  | 'places' | 'demand' | 'runs' | 'queue' | 'review'
  /**
   * The filing desk (back-office handover, 28 Sep 2026): seven tabs over one
   * taxonomy — Overview, Categories, Facts, Mapping, Collections, Fact
   * automations, Changes. One address with the tab and everything inside it
   * as query state, so `/admin/filing?tab=categories&sub=golf` opens on that
   * drawer for whoever it is sent to. The tab's spellings are `FILING_TABS`.
   */
  | 'filing'
  | 'lookup' | 'coverage' | 'library' | 'shelves' | 'scout' | 'sources' | 'categories' | 'voice' | 'hosting' | 'skills' | 'staff' | 'roles' | 'mail' | 'plans' | 'audit' | 'how';
/**
 * The filing desk's tabs, as the address spells them.
 *
 * The handover of 28 Sep 2026: Defaults and Ideas are gone — defaults live on
 * each subcategory's page, and Ideas are Collections everywhere — and Fact
 * automations and Changes are new. Runs is a place you can be without being a
 * tab. Every old spelling still opens the screen that took its job over — a
 * link somebody was sent last week is still a link — but nothing writes them.
 */
export const FILING_TABS = ['overview', 'categories', 'facts', 'mapping', 'collections', 'automations', 'changes', 'markets', 'runs'] as const;
export type FilingTab = typeof FILING_TABS[number];
/**
 * The records inside the back office's Hosting screen, each the query key that
 * opens it and the sub-tab it opens on: `/admin/hosting?tab=money&booking=<id>`.
 * Host and event were already addressed this way; booking, payout and complaint
 * joined them so every row of a hosting table opens something (K15 §3).
 */
export const HOSTING_RECORDS = { host: 'hosts', event: 'events', booking: 'money', payout: 'money', complaint: 'safety' } as const;
export type HostingRecord = keyof typeof HOSTING_RECORDS;
const FILING_TAB_WAS: Record<string, FilingTab> = {
  labels: 'facts', rules: 'categories', defaults: 'categories', rows: 'collections', ideas: 'collections',
};
/** `?tab=` read: the new spelling, an old one mapped across, or null. */
export const filingTabOf = (raw: string | null | undefined): FilingTab | null => {
  if (raw == null) return null;
  if ((FILING_TABS as readonly string[]).includes(raw)) return raw as FilingTab;
  return FILING_TAB_WAS[raw] ?? null;
};

/**
 * Where a link into How it works lands: `?at=` is the section and the page
 * scrolls to it. The sections are those of "Epic — How It Works" v2 (owner,
 * 28 Sep 2026), updated for Collections and the fact pipeline. The old
 * anchors still land on the section that took their place.
 */
export const HOW_ANCHORS = [
  'layers', 'categories', 'mapping', 'place', 'facts', 'where', 'pipeline', 'collections', 'journey', 'counting', 'state',
] as const;
export type HowAnchor = typeof HOW_ANCHORS[number];
const HOW_ANCHOR_WAS: Record<string, HowAnchor> = {
  mechanics: 'layers', sheets: 'facts', defaults: 'where', ideas: 'collections', rows: 'collections', eights: 'categories', harvest: 'pipeline',
};
export const howAnchorOf = (raw: string | null | undefined): HowAnchor | null => {
  if (raw == null) return null;
  if ((HOW_ANCHORS as readonly string[]).includes(raw)) return raw as HowAnchor;
  return HOW_ANCHOR_WAS[raw] ?? null;
};

export const ADMIN_SCREENS: AdminScreen[] = [
  'approvals',
  'overview', 'accounts', 'households', 'activity', 'reporting',
  'money', 'subscriptions', 'customers', 'waitlist', 'suppliers', 'behaviour', 'engagement',
  'places', 'demand', 'runs', 'queue', 'review',
  'filing',
  'lookup', 'coverage', 'library', 'shelves', 'scout', 'sources', 'categories', 'voice', 'hosting', 'skills', 'staff', 'roles', 'mail', 'plans', 'audit', 'how',
];

/**
 * Where the atlas is pointed: nowhere yet, close to home, one country, or one
 * area inside it. A country is a page now — its areas and its trips (handover,
 * 5 Sep 2026) — so it has an address of its own.
 */
// ---------------------------------------------------------------------------
// The public website (Website & Registration v2, signed off 1 Oct 2026)
// ---------------------------------------------------------------------------

/**
 * Locale in the path from day one (Decisions J1): `{language}-{country}`. Only a
 * live locale has pages, links, a sitemap and hreflang; a built-but-off locale is
 * a 404 (J2). `en-us` is built — its own strings, spelling, dates and $ — but off.
 */
export const SITE_LOCALES = ['en-gb', 'en-us'] as const;
export type SiteLocale = typeof SITE_LOCALES[number];
export const LIVE_SITE_LOCALES: readonly SiteLocale[] = ['en-gb'];
export const isSiteLocale = (v: string | null | undefined): v is SiteLocale => (SITE_LOCALES as readonly string[]).includes(String(v));
export const isLiveLocale = (l: SiteLocale) => LIVE_SITE_LOCALES.includes(l);

/** The six homepage directions (W1–W6): one is the homepage, the rest noindex landing pages at /{locale}/go/{name} (J10). */
export const HOME_DESIGNS = ['postcards', 'sorted', 'story', 'phone', 'poster', 'crew'] as const;
export type HomeDesign = typeof HOME_DESIGNS[number];

/** The public pages under a locale, beside the homepage (`/{locale}/`) and the landing pages. */
export const SITE_PAGES = ['host', 'privacy', 'terms', 'cookies', 'accessibility', 'contact'] as const;
export type SitePageName = typeof SITE_PAGES[number];
export type SitePage = 'home' | 'go' | SitePageName;

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
  | { name: 'trips'; searching: boolean; creating: boolean; tripId: string | null; section: TripSection | null; dayId: string | null; stopRef: string | null; chat?: ChatLayer; ideasTab?: IdeasTab | null }
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
  | { name: 'host'; page: HostPage; offerId: string | null; param?: string | null; chat?: ChatLayer }
  /** An invitation to a private offer (13 Sep 2026): outside the app, the token is the credential. */
  | { name: 'invited'; token: string }
  /** The host's own invitation link, passed round (lanes A and B, C2): /i/<token> opens the offer it names. */
  | { name: 'invitedLink'; token: string }
  /**
   * "Just say what you are up for" (Casual meet ups, O1–O14): the intake, the
   * card it saves, who you would rather meet, and one introduction at a time.
   * `trip` scopes the intake to a trip; without it, it is standing.
   */
  | { name: 'open'; page: 'fork' | 'say' | 'heard' | 'saved' | 'who' | 'trip' | 'card'; tripId: string | null; matchId: string | null; chat: ChatLayer | null }
  /** A host's public profile, and the trust ladder over it. Works logged-out. */
  | { name: 'hostProfile'; hostId: string; layer: 'trust' | null }
  /** One experience, and the two layers over it: the booking sheet and the formats. */
  /** `ask` is asking the host something before booking (C7); it needs a session like `book` does. */
  | { name: 'experience'; id: string; layer: 'book' | 'where' | 'ask' | null }
  /** A booking of ours — held, booked or past — and rating the host after. */
  | { name: 'booking'; id: string; rate: boolean; chat?: ChatLayer }
  /** Messages (guest handoff G31): every thread with a host — one per booking, and the questions asked before booking. */
  | { name: 'messages' }
  /** Every event near you (guest handoff G1c): Inspire's See all on Events near you; its filters are the query. */
  | { name: 'events' }
  /** Passion-led discovery: the people near a trip who do what you love (`?trip=`, `?love=`). */
  | { name: 'people' }
  | { name: 'collections' }
  /**
   * A tag's own page (Host Skills, S14–S15): every host in Britain listed for
   * it. Public and logged-out, because "fossil hunting Jurassic Coast" is a
   * search people actually make and the long tail is built out of exactly these
   * pages. `?where=` narrows it to where the guest is going.
   */
  | { name: 'tag'; key: string; vocab: 'tag' | 'facet' }
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
  /**
   * Log in at epic.day/login (Supporting docs › EPIC staff management, L1/L2).
   * One screen for customers and staff: enter an email, get a single-use link.
   * Public — reachable before any session exists.
   */
  /**
   * The public website: a locale's homepage, its host page, the legal pages, and
   * the five campaign landing pages (`go`). Outside the app — no tab, no session —
   * and indexable, except a landing page, which is noindex (J10).
   */
  | { name: 'site'; locale: SiteLocale; page: SitePage; landing: HomeDesign | null }
  /**
   * Epic Events on the web (3 Oct 2026): a public event at /en-gb/event/{slug}-{code}, a host at
   * /en-gb/hosts/{slug}-{code}, and the short share link /e/{code}. The code is permanent; the slug
   * follows the title, and the web server 301s an old one before the app ever sees it.
   */
  | { name: 'publicEvent'; locale: SiteLocale; slug: string; code: string }
  | { name: 'publicHost'; locale: SiteLocale; slug: string; code: string }
  | { name: 'shortEvent'; code: string }
  | { name: 'login' }
  /**
   * Set your credentials (L4), epic.day/in/<token>: where a staff invitation and
   * a password reset land. Public and noindex; the single-use token in the path
   * is the credential, so nothing else is written to the address.
   */
  | { name: 'in'; token: string }
  /**
   * A customer's own account page (L3), where a magic link lands a household
   * customer. Behind the session; staff land in the back office instead.
   */
  | { name: 'account' }
  /** First run: two doors (C0). */
  | { name: 'welcome' }
  /**
   * The opening (Welcome screens handoff, 1h). The postcards opener and the four
   * intro screens — day or trip, your crew, book an expert, host it — shown once
   * after sign-up and before crew set-up. Which of the five is on is `?step=0..4`,
   * a filter the screen reads rather than a layer in the path: the page is the
   * opening, and a step is how it is set (the same shape `/setup` uses).
   */
  | { name: 'opening' }
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
      if (a === 'collections') return b ? { name: 'unknown', path } : { name: 'collections' };
      if (a === 'events') return b ? { name: 'unknown', path } : { name: 'events' };
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

    case 'plans': {
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
      const parsed = {
        ...list, tripId: a, section,
        dayId: section === 'day' ? c ?? null : null,
        stopRef: section === 'stop' ? c ?? null : null,
      };
      // The chat's layers: the list, asking, the bell, one question (Chat screens, 13 Sep 2026).
      if (section === 'chat') return segments[4] ? { name: 'unknown', path } : { ...parsed, chat: chatLayerOf(c) };
      // The feed's tab is a path segment (owner, 29 Sep 2026: one URL per tab).
      // The bare `/plans/<id>/ideas` is an alias that normalises to Activities.
      if (section === 'ideas') {
        if (segments[4]) return { name: 'unknown', path };
        const tab = oneOf(IDEAS_TABS, c);
        if (c && !tab) return { name: 'unknown', path };
        return { ...parsed, ideasTab: tab ?? 'activities' };
      }
      return parsed;
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
      // Four ways to host: /host/new (the four), /host/new/<lane> (its screen), /host/new/<lane>/what (step 1, nothing saved yet).
      if (a === 'new') {
        if (!b) return { name: 'host', page: 'lanes', offerId: null };
        const lane = oneOf(HOST_LANES, b);
        if (!lane || (c && c !== 'what') || segments[4]) return { name: 'unknown', path };
        return { name: 'host', page: c ? 'compose' : 'lane', offerId: null, param: lane };
      }
      if (a === 'offers' && !b) return { name: 'host', page: 'manage', offerId: null };
      if (a === 'offers' && b && b !== 'new' && (c === 'setup' || c === 'publish' || c === 'done') && !segments[4]) return { name: 'host', page: c, offerId: b };
      if (a === 'offers' && b === 'new') return c ? { name: 'unknown', path } : { name: 'host', page: 'new', offerId: null };
      if (a === 'offers' && b && !c) return { name: 'host', page: 'offer', offerId: b };
      if (a === 'offers' && b && c === 'edit') return { name: 'host', page: 'edit', offerId: b };
      // The conversation on one of the host's offers, and its layers.
      if (a === 'offers' && b && c === 'chat') return segments[5] ? { name: 'unknown', path } : { name: 'host', page: 'offer', offerId: b, chat: chatLayerOf(segments[4]) };
      // Hosting v4, existing hosts: one address per screen; each screen's tabs, filters and sheets are query state.
      if (a === 'messages') return b === 'auto' && !c ? { name: 'host', page: 'auto', offerId: null } : b ? { name: 'unknown', path } : { name: 'host', page: 'messages', offerId: null };
      if (a === 'events') return c ? { name: 'unknown', path } : b ? { name: 'host', page: 'event', offerId: b } : { name: 'host', page: 'events', offerId: null };
      const desk = ({ todo: 'todo', 'at-risk': 'risk', earnings: 'earnings', fees: 'fees', reviews: 'reviews', insights: 'insights', me: 'me' } as const)[a as 'todo'];
      if (desk) return b ? { name: 'unknown', path } : { name: 'host', page: desk, offerId: null };
      // The host inbox: every question across every offer, waiting first (C5).
      if (a === 'questions') return b ? { name: 'unknown', path } : { name: 'host', page: 'questions', offerId: null };
      return { name: 'unknown', path };
    }

    case 'hosts': {
      if (!a) return { name: 'unknown', path };
      if (b === 'trust') return c ? { name: 'unknown', path } : { name: 'hostProfile', hostId: a, layer: 'trust' };
      return b ? { name: 'unknown', path } : { name: 'hostProfile', hostId: a, layer: null };
    }

    case 'experiences': {
      if (!a) return { name: 'unknown', path };
      if (b === 'book' || b === 'where' || b === 'ask') return c ? { name: 'unknown', path } : { name: 'experience', id: a, layer: b };
      return b ? { name: 'unknown', path } : { name: 'experience', id: a, layer: null };
    }

    case 'messages':
      return a ? { name: 'unknown', path } : { name: 'messages' };

    case 'bookings': {
      if (!a) return { name: 'unknown', path };
      if (b === 'rate') return c ? { name: 'unknown', path } : { name: 'booking', id: a, rate: true };
      // A hosted date's conversation (C8), and its layers.
      if (b === 'chat') return segments[4] ? { name: 'unknown', path } : { name: 'booking', id: a, rate: false, chat: chatLayerOf(c) };
      return b ? { name: 'unknown', path } : { name: 'booking', id: a, rate: false };
    }

    case 'say': {
      if (!a) return { name: 'say', intakeId: null, steps: false, ask: false };
      if (a === 'steps') return b ? { name: 'unknown', path } : { name: 'say', intakeId: null, steps: true, ask: false };
      if (b === 'ask') return { name: 'say', intakeId: a, steps: false, ask: true };
      if (b) return { name: 'unknown', path };
      return { name: 'say', intakeId: a, steps: false, ask: false };
    }

    case 'en-gb':
    case 'en-us': {
      // A built-but-off locale answers 404, exactly like an address with no page (J2).
      const locale = head as SiteLocale;
      if (!isLiveLocale(locale)) return { name: 'unknown', path };
      if (!a) return { name: 'site', locale, page: 'home', landing: null };
      if (a === 'go') {
        return b && !c && (HOME_DESIGNS as readonly string[]).includes(b)
          ? { name: 'site', locale, page: 'go', landing: b as HomeDesign }
          : { name: 'unknown', path };
      }
      if ((a === 'event' || a === 'hosts') && b && !c) {
        const m = /^(.+)-([a-z0-9]{6})$/.exec(b);
        if (!m) return { name: 'unknown', path };
        return a === 'event' ? { name: 'publicEvent', locale, slug: m[1], code: m[2] } : { name: 'publicHost', locale, slug: m[1], code: m[2] };
      }
      return !b && (SITE_PAGES as readonly string[]).includes(a)
        ? { name: 'site', locale, page: a as SitePageName, landing: null }
        : { name: 'unknown', path };
    }

    case 'e':
      return a && !b && /^[a-z0-9]{6}$/.test(a) ? { name: 'shortEvent', code: a } : { name: 'unknown', path };

    case 'login':
      return a ? { name: 'unknown', path } : { name: 'login' };

    case 'in':
      return a && !b ? { name: 'in', token: a } : { name: 'unknown', path };

    case 'account':
      return a ? { name: 'unknown', path } : { name: 'account' };

    case 'welcome':
      return a ? { name: 'unknown', path } : { name: 'welcome' };

    case 'opening':
      return a ? { name: 'unknown', path } : { name: 'opening' };

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
      // Bare `/admin` is the suite's Overview. It used to be the estate-at-a-
      // glance screen, which left the rail on 20 Sep 2026 — its address still
      // resolves, but it is no longer where the back office opens.
      const screen = oneOf(ADMIN_SCREENS, a ?? 'reporting');
      return screen ? { name: 'admin', screen } : { name: 'unknown', path };
    }

    /**
     * A tag's page, and a facet's. Two heads rather than one with a query,
     * because the path is the page: `/tags/fossil-hunting` and
     * `/places-known/jurassic-coast` are different pages, not one page set two
     * ways, and both are addresses somebody shares.
     */
    case 'tags':
      return a && !b ? { name: 'tag', key: a, vocab: 'tag' } : { name: 'unknown', path };
    case 'places-known':
      return a && !b ? { name: 'tag', key: a, vocab: 'facet' } : { name: 'unknown', path };

    case 'join':
      return a ? { name: 'join', token: a } : { name: 'unknown', path };

    case 'invited':
      return a && !b ? { name: 'invited', token: a } : { name: 'unknown', path };
    case 'i':
      return a && !b ? { name: 'invitedLink', token: a } : { name: 'unknown', path };

    /**
     * What somebody is up for. `/open` is the fork, `/open/say` the listening,
     * `/open/heard` the chips, `/open/saved` the card and `/open/who` who you
     * would rather meet — all of them standing.
     *
     * The same four steps scoped to a trip are their own addresses under
     * `/open/trip/<id>`: `…/say`, `…/heard`, `…/who` and `…/card`, with the
     * bare `/open/trip/<id>` the intake. Which trip is part of the page, so it
     * belongs in the path — a query would be dropped by this parser and the
     * step would silently save a standing entry instead (Codex, 13 Sep 2026).
     */
    case 'open': {
      if (!a) return { name: 'open', page: 'fork', tripId: null, matchId: null, chat: null };
      if (a === 'matches') {
        if (!b) return { name: 'unknown', path };
        // Chat is a layer inside an introduction, the way it is inside a trip
        // and a hosted offer — the same component, a fourth door.
        if (c === 'chat') return segments.length > 5 ? { name: 'unknown', path } : { name: 'open', page: 'fork', tripId: null, matchId: b, chat: chatLayerOf(segments[4]) };
        return !c ? { name: 'open', page: 'fork', tripId: null, matchId: b, chat: null } : { name: 'unknown', path };
      }
      if (a === 'trip') {
        if (!b || segments.length > 4) return { name: 'unknown', path };
        if (!c) return { name: 'open', page: 'trip', tripId: b, matchId: null, chat: null };
        return ['say', 'heard', 'who', 'card'].includes(c) ? { name: 'open', page: c as 'card', tripId: b, matchId: null, chat: null } : { name: 'unknown', path };
      }
      if (['say', 'heard', 'saved', 'who'].includes(a) && !b) return { name: 'open', page: a as 'say', tripId: null, matchId: null, chat: null };
      return { name: 'unknown', path };
    }

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
      return route.searching ? '/plans/search'
        : route.creating ? '/plans/new'
          : route.tripId == null ? '/plans'
            : buildHref(['plans', route.tripId, route.section,
              route.section === 'day' ? route.dayId : route.section === 'stop' ? route.stopRef : route.section === 'chat' ? chatSegment(route.chat) : route.section === 'ideas' ? (route.ideasTab ?? 'activities') : null]);
    case 'household': return buildHref(['household', route.memberId, route.memberId ? route.voice : null]);
    case 'host':
      return route.page === 'home' ? '/host'
        : route.page === 'questions' ? '/host/questions'
        : route.page === 'messages' ? '/host/messages'
        : route.page === 'auto' ? '/host/messages/auto'
        : route.page === 'events' ? '/host/events'
        : route.page === 'event' ? buildHref(['host', 'events', route.offerId])
        : route.page === 'risk' ? '/host/at-risk'
        : route.page === 'todo' || route.page === 'earnings' || route.page === 'fees' || route.page === 'reviews' || route.page === 'insights' || route.page === 'me' ? `/host/${route.page}`
        : route.page === 'offer' && route.chat ? buildHref(['host', 'offers', route.offerId, 'chat', chatSegment(route.chat)])
        : route.page === 'shape' ? buildHref(['host', 'learn', route.param])
          : route.page === 'examples' ? '/host/learn/examples'
            : route.page === 'example' ? buildHref(['host', 'learn', 'examples', route.param])
              : route.page === 'who' ? '/host/learn/who'
                : route.page === 'profile' ? '/host/profile'
                  : route.page === 'start' ? '/host/start'
                    : route.page === 'video' ? '/host/video'
                      : route.page === 'lanes' ? '/host/new'
                      : route.page === 'manage' ? '/host/offers'
                      : route.page === 'lane' ? buildHref(['host', 'new', route.param])
                      : route.page === 'compose' ? buildHref(['host', 'new', route.param, 'what'])
                      : route.page === 'setup' || route.page === 'publish' || route.page === 'done' ? buildHref(['host', 'offers', route.offerId, route.page])
                      : route.page === 'new' ? '/host/offers/new'
                        : buildHref(['host', 'offers', route.offerId, route.page === 'edit' ? 'edit' : null]);
    case 'invited': return buildHref(['invited', route.token]);
    case 'invitedLink': return buildHref(['i', route.token]);
    case 'open':
      if (route.matchId) return buildHref(['open', 'matches', route.matchId, route.chat ? 'chat' : null, route.chat ? chatSegment(route.chat) : null]);
      if (route.tripId) return buildHref(['open', 'trip', route.tripId, route.page === 'trip' ? null : route.page]);
      return buildHref(['open', route.page === 'fork' ? null : route.page]);
    case 'hostProfile': return buildHref(['hosts', route.hostId, route.layer]);
    case 'messages': return '/messages';
    case 'events': return '/inspire/events';
    case 'experience': return buildHref(['experiences', route.id, route.layer]);
    case 'booking': return route.chat ? buildHref(['bookings', route.id, 'chat', chatSegment(route.chat)]) : buildHref(['bookings', route.id, route.rate ? 'rate' : null]);
    case 'people': return '/inspire/people';
    case 'collections': return '/inspire/collections';
    case 'tag': return route.vocab === 'facet' ? buildHref(['places-known', route.key]) : buildHref(['tags', route.key]);
    case 'say':
      return route.steps ? '/say/steps'
        : route.intakeId ? buildHref(['say', route.intakeId, route.ask ? 'ask' : null])
          : '/say';
    case 'site':
      return route.page === 'home' ? paths.siteHome(route.locale)
        : route.page === 'go' ? paths.siteLanding(route.landing!, route.locale)
          : buildHref([route.locale, route.page]);
    case 'publicEvent': return `/${route.locale}/event/${route.slug}-${route.code}`;
    case 'publicHost': return `/${route.locale}/hosts/${route.slug}-${route.code}`;
    case 'shortEvent': return buildHref(['e', route.code]);
    case 'login': return '/login';
    case 'in': return buildHref(['in', route.token]);
    case 'account': return '/account';
    case 'welcome': return '/welcome';
    case 'opening': return '/opening';
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
  trips: () => '/plans',
  tripsSearch: () => '/plans/search',
  newTrip: () => '/plans/new',
  trip: (id: string, section?: TripSection | null, dayId?: string | null) =>
    buildHref(['plans', id, section, section === 'day' ? dayId : null]),
  /**
   * The trip redesign's three addresses (owner, 29 Sep 2026). The feed carries
   * its tab in the path; `?detour=` (10/15/30, default 15) is how it is set and
   * travels as the query. The shortlist keeps its old address.
   */
  tripIdeas: (id: string, tab: IdeasTab = 'activities', detour?: number | null) =>
    buildHref(['plans', id, 'ideas', tab], detour && detour !== 15 ? { detour: String(detour) } : undefined),
  tripShortlist: (id: string) => buildHref(['plans', id, 'shortlist']),
  /** The three layers the trip rebuild adds, and the Ask thread on one stop. */
  tripChat: (id: string) => buildHref(['plans', id, 'chat']),
  /**
   * The chat module's layers (13 Sep 2026): one question open, asking, the
   * bell. `tag` on Ask is how the composer is set — `stop:<ref>` from a stop's
   * own Ask tab — and is the query, not the page.
   */
  tripChatTopic: (id: string, topicId: string) => buildHref(['plans', id, 'chat', topicId]),
  tripChatAsk: (id: string, tag?: string | null) => buildHref(['plans', id, 'chat', 'ask'], { tag }),
  tripChatBell: (id: string) => buildHref(['plans', id, 'chat', 'bell']),
  /** The same four on a hosted date — a booking of ours (C8) — and on the host's own offer. */
  bookingChat: (id: string) => buildHref(['bookings', id, 'chat']),
  bookingChatTopic: (id: string, topicId: string) => buildHref(['bookings', id, 'chat', topicId]),
  bookingChatAsk: (id: string, tag?: string | null) => buildHref(['bookings', id, 'chat', 'ask'], { tag }),
  bookingChatBell: (id: string) => buildHref(['bookings', id, 'chat', 'bell']),
  hostOfferChat: (id: string) => buildHref(['host', 'offers', id, 'chat']),
  hostOfferChatTopic: (id: string, topicId: string) => buildHref(['host', 'offers', id, 'chat', topicId]),
  hostOfferChatAsk: (id: string, tag?: string | null) => buildHref(['host', 'offers', id, 'chat', 'ask'], { tag }),
  hostOfferChatBell: (id: string) => buildHref(['host', 'offers', id, 'chat', 'bell']),
  /** The host inbox (C5). */
  hostQuestions: () => '/host/questions',
  /** Asking the host something from the listing, before booking (C7). */
  experienceAsk: (id: string) => buildHref(['experiences', id, 'ask']),
  /** Every trip and hosted date in one list, plus the digest time and quiet hours (E5). */
  settingsNotifications: () => '/settings/notifications',
  tripTravel: (id: string) => buildHref(['plans', id, 'travel']),
  tripShare: (id: string) => buildHref(['plans', id, 'share']),
  tripStop: (id: string, venueRef: string) => buildHref(['plans', id, 'stop', venueRef]),
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
  invitedLink: (token: string) => buildHref(['i', token]),
  /** What you are up for: the fork, and each step of the intake. `trip` scopes it to a trip. */
  open: () => '/open',
  openSay: (tripId?: string | null) => (tripId ? buildHref(['open', 'trip', tripId, 'say']) : '/open/say'),
  openHeard: (tripId?: string | null) => (tripId ? buildHref(['open', 'trip', tripId, 'heard']) : '/open/heard'),
  openSaved: () => '/open/saved',
  openWho: (tripId?: string | null) => (tripId ? buildHref(['open', 'trip', tripId, 'who']) : '/open/who'),
  openTrip: (tripId: string) => buildHref(['open', 'trip', tripId]),
  openTripCard: (tripId: string) => buildHref(['open', 'trip', tripId, 'card']),
  openMatch: (id: string) => buildHref(['open', 'matches', id]),
  /** The four chat layers inside an introduction, once both ID checks have cleared. */
  openMatchChat: (id: string) => buildHref(['open', 'matches', id, 'chat']),
  openMatchChatTopic: (id: string, topicId: string) => buildHref(['open', 'matches', id, 'chat', topicId]),
  openMatchChatAsk: (id: string, tag?: string | null) => buildHref(['open', 'matches', id, 'chat', 'ask'], { tag }),
  openMatchChatBell: (id: string) => buildHref(['open', 'matches', id, 'chat', 'bell']),
  /** Four ways to host: the four lanes, one lane, step 1 of a new one, a draft's set-up, its checklist, its ending. */
  hostLanes: () => '/host/new',
  /** A host's offers and drafts. */
  hostManage: () => '/host/offers',
  // Hosting v4, existing hosts (E1–E13).
  hostMessages: (filter?: 'bookings' | 'everyone' | 'questions' | null) => buildHref(['host', 'messages'], { filter: filter ?? null }),
  hostAutoMessages: () => '/host/messages/auto',
  hostTodo: () => '/host/todo',
  hostAtRisk: () => '/host/at-risk',
  hostEvents: (f: { vis?: 'private' | 'public' | null; kind?: HostLane | null } = {}) => buildHref(['host', 'events'], { vis: f.vis ?? null, kind: f.kind ?? null }),
  hostEvent: (id: string, q: { session?: string | null; tab?: 'waitlist' | 'money' | null; sheet?: 'share' | 'dates' | 'edit' | 'more' | 'cancel' | null } = {}) =>
    buildHref(['host', 'events', id], { session: q.session ?? null, tab: q.tab ?? null, sheet: q.sheet ?? null }),
  hostEarnings: (q: { tab?: 'payouts' | 'statements' | null; month?: string | null } = {}) => buildHref(['host', 'earnings'], { tab: q.tab ?? null, month: q.month ?? null }),
  hostFees: () => '/host/fees',
  hostReviews: (q: { tab?: 'reply' | 'tips' | null; stars?: number | null } = {}) => buildHref(['host', 'reviews'], { tab: q.tab ?? null, stars: q.stars ? String(q.stars) : null }),
  hostInsights: () => '/host/insights',
  hostSettings: (tab?: 'checks' | 'settings' | 'help' | null) => buildHref(['host', 'me'], { tab: tab ?? null }),
  hostLane: (lane: HostLane) => buildHref(['host', 'new', lane]),
  hostCompose: (lane: HostLane, mode?: 'say' | 'upload' | null) => buildHref(['host', 'new', lane, 'what'], { mode: mode ?? null }),
  hostSetup: (id: string, step?: string | null, mode?: string | null) => buildHref(['host', 'offers', id, 'setup'], { step: step && step !== 'what' ? step : null, mode: mode ?? null }),
  hostPublish: (id: string, sheet?: string | null) => buildHref(['host', 'offers', id, 'publish'], { sheet: sheet ?? null }),
  hostDone: (id: string) => buildHref(['host', 'offers', id, 'done']),
  hostNewOffer: (shape?: string | null) => (shape ? `/host/offers/new?shape=${shape}` : '/host/offers/new'),
  hostOffer: (id: string) => buildHref(['host', 'offers', id]),
  /** A step is named, not numbered: the sequence differs by shape, visibility and money. */
  hostOfferEdit: (id: string, step?: string | number | null) => `${buildHref(['host', 'offers', id, 'edit'])}${step && step !== 'plan' && step !== 1 ? `?step=${step}` : ''}`,
  hostVideo: (offerId?: string | null) => (offerId ? `/host/video?offer=${encodeURIComponent(offerId)}` : '/host/video'),
  hostProfile: (hostId: string) => buildHref(['hosts', hostId]),
  hostTrust: (hostId: string) => buildHref(['hosts', hostId, 'trust']),
  // `l` is the host's own link token: a booking that arrives with it is the
  // host's own (the 5% host-link fee), so the host's share carries it.
  experience: (id: string, opts?: { l?: string | null }) => buildHref(['experiences', id], { l: opts?.l ?? null }),
  experienceBook: (id: string) => buildHref(['experiences', id, 'book']),
  experienceWhere: (id: string) => buildHref(['experiences', id, 'where']),
  booking: (id: string) => buildHref(['bookings', id]),
  messages: () => '/messages',
  inspireEvents: () => '/inspire/events',
  bookingRate: (id: string) => buildHref(['bookings', id, 'rate']),
  /** Every collection this household can heart. */
  collections: () => '/inspire/collections',
  /** Who near a trip does what you love (F2). */
  people: (opts?: { trip?: string | null; love?: string | null }) => {
    const q = new URLSearchParams();
    if (opts?.trip) q.set('trip', opts.trip);
    if (opts?.love) q.set('love', opts.love);
    const qs = q.toString();
    return qs ? `/inspire/people?${qs}` : '/inspire/people';
  },
  /** A tag's page: everyone on Epic listed for it (S14). A facet has its own word in the path. */
  tag: (key: string, vocab: 'tag' | 'facet' = 'tag') => buildHref([vocab === 'facet' ? 'places-known' : 'tags', key]),
  /** Trips › Booked with hosts. */
  bookings: () => '/plans?span=events',
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
  login: () => '/login',
  credentials: (token: string) => buildHref(['in', token]),
  /**
   * The public website. The homepage keeps its trailing slash (`/en-gb/`) — the
   * one URL that does (Technical Foundations › URL conventions).
   */
  siteHome: (locale: SiteLocale = 'en-gb') => `/${locale}/`,
  siteHost: (locale: SiteLocale = 'en-gb') => `/${locale}/host`,
  sitePage: (page: SitePageName, locale: SiteLocale = 'en-gb') => `/${locale}/${page}`,
  siteLanding: (design: HomeDesign, locale: SiteLocale = 'en-gb') => `/${locale}/go/${design}`,
  account: () => '/account',
  welcome: () => '/welcome',
  /**
   * The opening sequence, at a given screen. Step 0 (the opener) is the default
   * and is not written down. `replay` marks a launch from Settings, so the
   * opening returns there on exit rather than marking a household welcomed and
   * taking it into the app the way first-run does.
   */
  opening: (step?: number, replay?: boolean) => {
    const q = new URLSearchParams();
    if (step && step > 0) q.set('step', String(step));
    if (replay) q.set('replay', '1');
    const qs = q.toString();
    return qs ? `/opening?${qs}` : '/opening';
  },
  setup: (step?: number) => (step && step > 1 ? `/setup?step=${step}` : '/setup'),
  settings: (section?: SettingsSection) => (section && section !== 'preferences' ? buildHref(['settings', section]) : '/settings'),
  prototypes: (section?: PrototypeSection | null) => buildHref(['prototypes', section]),
  admin: (screen: AdminScreen) => buildHref(['admin', screen]),
  /** How it works, at one section — or the top when none is named. */
  /**
   * How it works, at a section of Business mechanics, or on its second
   * document ("The decisions behind the rest of Epic", `doc=decisions`).
   */
  how: (at?: HowAnchor | null, doc?: 'decisions' | null) =>
    buildHref(['admin', 'how'], at || doc ? { ...(doc ? { doc } : {}), ...(at ? { at } : {}) } : undefined),
  /** The filing desk on one tab. Overview is the default and is not written down. */
  filing: (tab?: FilingTab | null, query?: Record<string, string | null | undefined>) =>
    buildHref(['admin', 'filing'], { ...(query ?? {}), tab: tab && tab !== 'overview' ? tab : null }),
  /**
   * Hosting in the back office, at one sub-tab and whatever is open inside it.
   * Review is the default and is not written down.
   */
  hosting: (tab?: string | null, query?: Record<string, string | null | undefined>) =>
    buildHref(['admin', 'hosting'], { tab: tab && tab !== 'review' ? tab : null, ...(query ?? {}) }),
  /**
   * One hosting record, opened as query state on its own sub-tab (K15 §3, Roger,
   * 3 Oct 2026: "every table is clickable"): a host, an event, a booking, a
   * payout or a complaint. `HOSTING_RECORDS` says which tab each opens on and
   * is the only spelling of the query keys.
   */
  hostingRecord: (kind: HostingRecord, id: string) => paths.hosting(HOSTING_RECORDS[kind], { [kind]: id }),
  /** One household's record in the back office's Customers. */
  customer: (householdId: string) => buildHref(['admin', 'customers'], { household: householdId }),
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
  // The opening runs to every edge (Welcome screens, 1h): the postcards fill the
  // screen behind the band, and the intro screens are a cream ground that meets
  // all four sides. So the shell adds no insets of its own — the opening takes
  // the notch and the home indicator into its own padding, the way a trip does.
  if (route.name === 'opening') return true;
  if (route.name !== 'trips' || route.creating || route.tripId == null) return false;
  // The rebuilt trip is not full-bleed (nav, 30 Sep 2026): its compact band is
  // the header and the map sits below it, not to every edge. Only the retired
  // map-pin screen's sections (places/map/group) keep the full-bleed layout.
  return route.section === 'places' || route.section === 'map' || route.section === 'group';
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
  // The opening draws every pixel itself — a full-bleed opener and four intro
  // screens, each with its own head — so the shell's band over it would be a
  // second heading (Welcome screens, 1h).
  if (route.name === 'opening') return true;
  if (route.name === 'household' && route.voice) return true;
  /**
   * The Host tab draws the same head as Trips — the wordmark and one control
   * — and every page inside it (onboarding, the wizard, the recorder, an
   * offer's dashboard) is drawn to the top of the phone with its own title and
   * its own back (Hosts and Events, H1–H4, W1–W5, D1).
   */
  if (route.name === 'host' || route.name === 'people' || route.name === 'booking' || route.name === 'collections') return true;
  // Settings revised v2: Settings draws its own title band + Household/My Account
  // tab bar, and its sub-screens their own back band; the person profile draws a
  // back band with the household's name. The shell's wordmark header over either
  // would be a second heading.
  if (route.name === 'settings') return true;
  if (route.name === 'household') return true;
  // Saying what you are up for is a form, and an introduction is one thing: each draws its own head.
  if (route.name === 'open') return true;
  // The booking sheet draws its own "Book this" head; the shell's band above it would be a second one.
  if (route.name === 'experience') return true;
  if (route.name === 'messages') return true;
  if (route.name === 'invited') return true;
  if (route.name === 'events') return true;
  // A host's profile opens on its photo (guest handoff G25).
  if (route.name === 'hostProfile') return true;
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
    // The rebuilt trip draws its own compact lime band for all its tab states —
    // 6a (nothing selected), Activities/Food/Stays and Shortlist — so the shell
    // draws none over it (nav, 30 Sep 2026).
    if (route.section == null || route.section === 'itinerary' || route.section === 'ideas' || route.section === 'shortlist' || route.section === 'stays') return true;
    return route.section === 'travel' || route.section === 'stop' || route.section === 'share' || route.section === 'chat';
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
/** The existing-host screens (E2–E13): each keeps the tab bar, as the prototype draws them. */
export const HOST_DESK_PAGES: HostPage[] = ['messages', 'auto', 'todo', 'risk', 'events', 'event', 'earnings', 'fees', 'reviews', 'insights', 'me'];

export function isImmersive(route: Route, query?: URLSearchParams): boolean {
  // The voice intake's screens are one thing each — a mic, a card, a question —
  // drawn to the handoff's boards, which have no tab bar (8 Sep 2026).
  if (route.name === 'say' || route.name === 'welcome' || route.name === 'setup') return true;
  // The opening is one thing at a time, drawn to the edges: no tab bar (1h).
  if (route.name === 'opening') return true;
  if (route.name === 'household' && route.voice) return true;
  // Becoming a host, the offer wizard and the recorder are forms; an offer's
  // dashboard and a booking are one thing each. The tab itself keeps the bar.
  // The learn layer keeps the bar (it is still the tab); the set-up, the
  // profile and the recorder take the phone whole.
  if (route.name === 'host') return !['home', 'shape', 'examples', 'example', 'who', 'lanes', 'manage', ...HOST_DESK_PAGES].includes(route.page);
  if (route.name === 'open') return true;
  // A booking page and the Book screen keep the tab bar (guest handoff, G6–G19: drawn with it); its message
  // thread is a conversation under a keyboard, and so is asking the host something.
  if (route.name === 'booking') return Boolean(route.chat);
  if (route.name === 'experience') return route.layer === 'ask';
  if (route.name !== 'trips' || route.creating || route.tripId == null) return false;
  if (route.section === 'group') return true;
  // A question open, asking one, the bell: each has a keyboard or is one thing
  // (Chat screens, 13 Sep 2026). The list keeps the bar — it is still Trips.
  if (route.section === 'chat') return Boolean(route.chat && route.chat.page !== 'list');
  // The redesign's feed and shortlist keep the tab bar (owner, 29 Sep 2026:
  // the trip experience lives in Trips, and its bottom bar is the five tabs).
  // A place drawer opening over either is a place view, and hides the bar the
  // way it does over the map.
  // The trip's browse tabs take the phone whole (nav 6b, 30 Sep 2026: "the tab
  // bar hides while you browse"). 6a — nothing selected — keeps it.
  if (route.section === 'ideas' || route.section === 'shortlist' || route.section === 'stays') return true;
  // The bare `/plans/<id>` is the map, and parses with no section at all.
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
    // Saying what you are up for belongs to hosting; a trip's intake belongs to that trip.
    case 'open': return route.tripId ? 'trips' : 'host';
    case 'people': return 'inspire';
    case 'collections': return 'inspire';
    case 'tag': return 'inspire';
    case 'booking': return 'trips';
    // Members reach Messages from the icon in the Plans header (guest handoff G31).
    case 'messages': return 'trips';
    // An invitation is answered under Plans (guest handoff G13), where it then lives.
    case 'invited': return 'trips';
    case 'events': return 'inspire';
    // Events are found in Inspire (guest handoff G1): an event page and a host's profile light that tab.
    case 'experience': return 'inspire';
    case 'hostProfile': return 'inspire';
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
  if (route.name === 'host') return ['home', 'shape', 'examples', 'example', 'who', 'lanes', 'manage'].includes(route.page);
  if (route.name === 'booking' || route.name === 'people' || route.name === 'collections') return false;
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
      // Up from a question, from asking or from the bell is the list of questions.
      if (route.section === 'chat' && route.chat && route.chat.page !== 'list') return paths.tripChat(route.tripId!);
      // Up from the shortlist is the feed; up from the feed is the trip
      // (owner, 29 Sep 2026: the shortlist's back arrow goes to the feed).
      if (route.section === 'shortlist') return paths.tripIdeas(route.tripId!);
      if (route.section === 'ideas') return paths.trip(route.tripId!);
      // Up from a stop's Ask, or from Getting there, is the trip itself.
      if (route.section) return paths.trip(route.tripId!);
      if (route.tripId || route.creating || route.searching) return '/plans';
      return '/inspire';
    case 'household': return route.voice ? paths.household(route.memberId) : '/settings';
    // A settings sub-screen (devices, providers, notifications) goes back to Settings.
    case 'settings': return route.section === 'preferences' ? '/inspire' : '/settings';
    case 'host':
      if (route.page === 'edit' && route.offerId) return paths.hostOffer(route.offerId);
      // Four ways to host: a lane goes back to the four; a draft's set-up, checklist and ending to the Host tab.
      if (route.page === 'lane') return paths.hostLanes();
      if (route.page === 'compose' && route.param) return paths.hostLane(route.param as HostLane);
      if (route.page === 'publish' && route.offerId) return paths.hostSetup(route.offerId, 'who');
      if (route.page === 'offer' && route.chat && route.offerId) return route.chat.page === 'list' ? paths.hostOffer(route.offerId) : paths.hostOfferChat(route.offerId);
      if (route.page === 'questions') return '/host';
      if (route.page === 'auto') return '/host/messages';
      if (route.page === 'event') return '/host/events';
      if (route.page === 'insights') return '/host/events';
      if (route.page === 'example') return paths.hostExamples();
      return route.page === 'home' ? '/inspire' : '/host';
    case 'invited': return '/inspire';
    case 'hostProfile': return route.layer ? paths.hostProfile(route.hostId) : '/inspire';
    case 'experience': return route.layer ? paths.experience(route.id) : '/inspire';
    case 'messages': return paths.trips();
    case 'events': return paths.inspire();
    case 'booking': return route.chat ? (route.chat.page === 'list' ? paths.booking(route.id) : paths.bookingChat(route.id)) : route.rate ? paths.booking(route.id) : paths.bookings();
    case 'people': return '/inspire';
    case 'collections': return '/inspire';
    case 'tag': return '/inspire/people';
    // Up from the questions is the card; up from the card or the wizard is the mic; up from the mic is home.
    case 'say': return route.ask ? paths.heard(route.intakeId!) : route.intakeId || route.steps ? '/say' : '/inspire';
    case 'site': return paths.siteHome(route.locale);
    case 'login': return '/inspire';
    case 'in': return '/login';
    case 'account': return '/inspire';
    case 'welcome': return '/inspire';
    case 'opening': return '/inspire';
    case 'setup': return '/welcome';
    case 'admin': return route.screen === 'reporting' ? '/inspire' : '/admin/reporting';
    default: return '/inspire';
  }
}

/**
 * What the browser tab says. A window full of Epic tabs is otherwise seven
 * identical ones, and the address is only half of being able to find your way
 * back to a page.
 */
const DESK_TITLE = { messages: 'Messages', auto: 'Automatic messages', todo: 'To do', risk: 'At risk', events: 'All events', event: 'Your event', earnings: 'Earnings', fees: 'Fees', reviews: 'Reviews', insights: 'Insights', me: 'Profile and settings' } as const;

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
      if (!route.tripId) return epic('Plans');
      const layer = route.section === 'chat' ? (route.chat?.page === 'topic' ? 'A question' : route.chat?.page === 'ask' ? 'Ask something' : route.chat?.page === 'bell' ? 'What you get told about' : 'Chat')
        : route.section === 'ideas' ? 'Ideas'
          : route.section === 'shortlist' ? 'Shortlist'
            : route.section === 'travel' ? 'Getting there'
              : route.section === 'share' ? 'Share trip'
                : route.section === 'stop' ? 'A stop' : null;
      return epic(layer ? `Trip — ${layer}` : 'Trip');
    }
    case 'household': return epic(route.voice === 'tell' ? 'Tell Epic about them' : route.voice === 'review' ? 'What we heard' : 'You and yours');
    case 'say': return epic(route.ask ? 'One more thing' : route.intakeId ? 'Here’s what we heard' : route.steps ? 'One at a time' : 'Just say it');
    case 'site': return siteTitleOf(route);
    // The page's own title is written by the web server and set again by the page once it has loaded.
    case 'publicEvent': case 'shortEvent': return 'Epic Events';
    case 'publicHost': return 'Epic Hosts';
    case 'login': return epic('Log in');
    case 'in': return epic('Set up your login');
    case 'account': return epic('Your account');
    case 'welcome': return epic('Plan less. Live more.');
    case 'opening': return epic('Welcome to Epic');
    case 'setup': return epic('Set up your family');
    case 'settings': return epic(route.section === 'notifications' ? 'Notifications' : route.section === 'devices' ? 'Signed-in devices' : route.section === 'providers' ? 'Providers' : route.section === 'payments' ? 'Payments' : 'Settings');
    case 'host': return epic(route.page in DESK_TITLE ? DESK_TITLE[route.page as keyof typeof DESK_TITLE] : route.page === 'questions' ? 'Questions' : route.chat ? (route.chat.page === 'topic' ? 'A question' : route.chat.page === 'ask' ? 'Say something' : route.chat.page === 'bell' ? 'What you get told about' : 'Chat') : route.page === 'start' || route.page === 'profile' ? 'Host on Epic' : route.page === 'new' || route.page === 'edit' || route.page === 'setup' || route.page === 'compose' ? 'Your offer' : route.page === 'lanes' || route.page === 'lane' ? 'Host it' : route.page === 'publish' ? 'Before it goes' : route.page === 'done' ? 'Sent' : route.page === 'video' ? 'Your video' : route.page === 'offer' ? 'Your experience' : route.page === 'shape' ? 'How it works' : route.page === 'examples' || route.page === 'example' ? 'What people host' : route.page === 'who' ? 'Who can come' : 'Host');
    case 'invited': return epic('You are invited');
    case 'invitedLink': return epic('You are invited');
    case 'open': return epic(route.matchId ? 'An introduction' : route.page === 'who' ? 'Who you would rather meet' : 'What you are up for');
    case 'hostProfile': return epic(route.layer === 'trust' ? 'How Epic checks hosts' : 'A host');
    case 'experience': return epic(route.layer === 'book' ? 'Book this' : route.layer === 'where' ? 'Where it happens' : route.layer === 'ask' ? 'Ask the host' : 'An experience');
    case 'messages': return epic('Messages');
    case 'events': return epic('Events near you');
    case 'booking': return epic(route.chat ? (route.chat.page === 'topic' ? 'A question' : route.chat.page === 'ask' ? 'Ask something' : route.chat.page === 'bell' ? 'What you get told about' : 'Chat') : route.rate ? 'How was it?' : 'Your booking');
    case 'people': return epic('Who does what you love?');
    case 'collections': return epic('Collections');
    case 'tag': return epic(route.key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
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
  /**
   * The trip redesign retires the pin-search sections (owner, 29 Sep 2026:
   * "point each old find/map URL at its nearest new home with a permanent
   * redirect"). Find becomes the ideas feed — an old `?cat=food` link lands on
   * the Food tab — and the map view becomes the trip itself. Map redirects to
   * the explicit `itinerary`, not the bare trip: the bare trip restores the
   * last-seen section, which for someone whose last section was `map` would
   * bounce straight back here in a loop (Codex).
   */
  const retired = path.match(/^\/(?:trips|plans)\/([^/]+)\/(find|map)\/?$/);
  if (retired) {
    if (retired[2] === 'map') {
      // A map link could carry a place drawer over it; keep it (the trip stage reads ?place).
      const on = paths.trip(retired[1], 'itinerary');
      const place = query.get('place');
      return place ? `${on}?place=${encodeURIComponent(place)}` : on;
    }
    return paths.tripIdeas(retired[1], query.get('cat') === 'food' ? 'food' : 'activities');
  }
  /**
   * Trips is Plans (guest handoff, 3 Oct 2026): every `/trips…` address — on
   * phones, in old notifications and shared links — lands on its `/plans…` twin,
   * query and all.
   */
  const trips = path.match(/^\/trips(\/.*)?$/);
  if (trips) { const q = query.toString(); return `/plans${trips[1] ?? ''}${q ? `?${q}` : ''}`; }
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

/**
 * A public page's title: brand first (J7), ≤ 60 characters, unique per page. The
 * web server writes the same into the HTML it serves (server.mjs), so the title
 * a crawler reads is never left to JavaScript; this keeps the tab in step.
 */
export function siteTitleOf(route: Extract<Route, { name: 'site' }>): string {
  switch (route.page) {
    case 'host': return 'Epic Hosting – Events, weekly clubs, courses and bookings';
    case 'privacy': return 'Epic – Privacy notice';
    case 'terms': return 'Epic – Terms';
    case 'cookies': return 'Epic – Cookies';
    case 'accessibility': return 'Epic – Accessibility';
    case 'contact': return 'Epic – Contact';
    default: return 'Epic – Days out and trips away, planned around your crew';
  }
}
