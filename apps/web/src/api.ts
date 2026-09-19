// The web app talks to the Epic API over HTTP and nothing else. No provider
// key ever reaches this bundle (Technical Constraints §13.7).

import { forgetCopy, recall, remember, servingSaved, warm, warmQuietly } from './offline/cache';
import { flush as flushOutbox, queue as queueWrite, refreshOutbox } from './offline/outbox';
import { copyHolder, deviceLabel, holderOf, sessionExpired, sessionToken, setCopyHolder, setSessionToken } from './session';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * The bytes of a picture we own, at a width. One builder, because a household's
 * own photograph carries a signature that has to go on the URL, and a card
 * that forgot it would draw a 404 (api/sources/photoLinks.js).
 */
export const ownedImageUrl = (image: { id: string; sig?: string; exp?: number }, width: number) =>
  `${API_URL}/api/images/${image.id}/${width}` + (image.sig && image.exp ? `?s=${encodeURIComponent(image.sig)}&e=${image.exp}` : '');

export class ApiError extends Error {
  status: number;
  code: string;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message || body?.error || `HTTP ${status}`);
    this.status = status;
    this.code = body?.error || 'http_error';
    this.body = body;
  }
}

/**
 * Thrown when there is no signal and nothing saved for this page. Told apart
 * from an ApiError so a screen can say "you are offline and we have not been
 * here before" rather than showing a network message nobody can act on.
 */
export class OfflineError extends Error {
  code = 'offline';
  constructor(public path: string) { super('No signal, and this page is not saved on your device yet.'); }
}

/**
 * Thrown when a write could not be sent but has been kept on the device and
 * will go on its own (offline/outbox.ts).
 *
 * It is an error because it is not done yet — a screen must not tell anybody
 * their booking is confirmed when it is sitting in a queue — but it is a
 * different one from a failure, so the message can say "saved, and it will send
 * itself" rather than "something went wrong".
 */
export class QueuedError extends Error {
  code = 'queued';
  queued = true;
  constructor(public path: string) { super("No signal — saved on this device and it will send itself when you're back."); }
}

/**
 * Every request goes through here, and so does the device's copy of it
 * (offline/cache.ts). A GET that succeeds is saved if its licence allows
 * (offline/policy.ts); a GET that cannot reach the API is answered from what
 * was saved, and the app is told it is showing an older copy.
 *
 * A write is never answered from the copy — the household has to know whether
 * their booking status actually reached the server — but a write that cannot be
 * sent is no longer thrown away either: if it is one that still means the same
 * thing later (offline/policy.ts `queueable`) it is kept and sent when there is
 * signal, and the caller is told which of the two happened.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const readOnly = method === 'GET';
  const token = sessionToken();
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      // `include` so the sign-in response can set the cookie that photographs
      // are loaded with; every other request is authorised by the header.
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    });
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Signed out, or the token has run out. Drop it so the app shows the
      // passcode screen; anything waiting in the outbox stays waiting.
      if (res.status === 401 && path !== '/api/session') sessionExpired();
      // The API answering "no" is an answer; only an API that cannot answer at
      // all falls back to the copy.
      if (readOnly && [502, 503, 504].includes(res.status)) {
        const saved = await recall<T>(path);
        if (saved) { servingSaved(true); return saved.body; }
      }
      throw new ApiError(res.status, body);
    }
    servingSaved(false);
    if (readOnly) void remember(path, body);
    return body as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (!readOnly) {
      // The API could not be reached at all. Keep the write rather than lose it.
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (await queueWrite(method, path, body)) throw new QueuedError(path);
      throw err;
    }
    const saved = await recall<T>(path);
    if (saved) { servingSaved(true); return saved.body; }
    throw new OfflineError(path);
  }
}

/**
 * Replay the outbox. Given to `flush` so a write made an hour ago goes out the
 * same door as a live one — same header, same handling of a 401.
 */
const sendQueued = (method: string, path: string, body: unknown) =>
  request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T,>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T,>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T,>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined });
const qs = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConstraintKind = 'allergen' | 'diet' | 'dislike' | 'like';
export type Constraint = { id: string; kind: ConstraintKind; value: string; conceptKey: string | null; conceptKind: string | null; maxMinutes?: number | null; favourite?: boolean };

/**
 * Whether one person in the household can sign in to Epic, and what happened to
 * the last link they were sent (`/api/household`, migration 056).
 *
 * `status: 'none'` is somebody who has never been invited. `blocked` is the one
 * sentence saying why they cannot be — today only "this profile is under
 * thirteen and is looked after by an adult".
 */
export type MemberAccess = {
  email: string | null;
  mobile: string | null;
  canSignIn: boolean;
  status: 'none' | 'invited' | 'active' | 'suspended';
  blocked: string | null;
  accountId?: string;
  invitedAt?: string | null;
  activatedAt?: string | null;
  lastSeenAt?: string | null;
  signInCount?: number;
  isLead?: boolean;
  lastInvite?: {
    at: string; expiresAt: string; usedAt: string | null;
    channel: string | null; delivery: string | null; error: string | null;
  } | null;
};

/**
 * What came back from inviting somebody who already lives in this household.
 *
 * Distinct from `Invitation` further down, which the admin module uses for a
 * friend being given an Epic of their own: that one goes out by e-mail only and
 * reports one `delivery`, this one can go by two channels at once and reports
 * what happened to each.
 */
export type HouseholdInvitation = {
  url: string;
  expiresAt: string;
  sent: boolean;
  message: string;
  channels: { channel: 'sms' | 'email'; sent: boolean; message: string | null }[];
};

/**
 * Whether a link can be delivered at all, and if not, what the owner adds.
 *
 * Three lengths on purpose: `short` sits beside the box on a phone and says
 * what will happen instead, `setup` names what to add and is shown once, and
 * `message` is the full form the back office has always shown.
 */
export type SenderStatus = { configured: boolean; reason?: string; short?: string; setup?: string; message?: string; from?: string; signingWith?: string; caution?: string | null };

export type Member = {
  id: string;
  name: string;
  /** Present on `/api/household`; absent on the row a POST/PATCH hands back. */
  access?: MemberAccess | null;
  email?: string | null;
  mobile?: string | null;
  isMinor: boolean;
  age: number | null;
  birthYear: number | null;
  birthDate: string | null;
  relationship: string | null;
  avatarUrl: string | null;
  typicalVisitMinutes: number | null;
  maxTravelMinutes: number | null;
  allergens: Constraint[];
  diets: Constraint[];
  dislikes: Constraint[];
  likes: Constraint[];
};

export type Place = {
  /** The source's own identifier for it, when the map had one: lets an idea open a drawer. */
  ref?: string; label: string;
  /**
   * What the map calls the thing itself — "Hilton Rome Eur La Lama" — where it
   * is a named place rather than an address. A hotel row leads with this;
   * `formatted` is the street, which is the right answer for a home address and
   * the wrong one for a hotel.
   */
  name?: string | null;
  lat: number; lng: number; country?: string | null; countryCode?: string | null; locality?: string | null; displayName?: string; formatted?: string; address?: { line1: string | null; area: string | null; town: string | null; region: string | null; postcode: string | null; country: string | null }; matchedBy?: string; approximate?: boolean;
  /** Areas only: which one this is ("Somerset · England · United Kingdom") and what kind ("city"). */
  where?: string; kindWord?: string | null };

/** A bed from the open map, with how it sits against what the household means to do. */
/**
 * What a room costs on the nights of this trip: the cheapest thing the hotel
 * will sell, and the terms it comes on. LiteAPI's, fetched for this screen and
 * never written down — the number on screen has an expiry measured in minutes.
 */
export type StayOffer = {
  total: number; currency: string; perNight: number | null;
  roomName: string | null;
  /** "Room only", "Breakfast included" — the difference between two prices that look the same. */
  board: string | null;
  refundable: boolean | null;
  /** When free cancellation runs out, where the rate has any. */
  freeUntil: string | null;
  offerId: string | null;
};

export type Stay = Venue & {
  stayKind: string | null;
  stars: number | null;
  rooms: number | null;
  /** How far from the middle of the plans (or the city, before there are any). */
  distanceKm: number | null;
  /** How many shortlisted places are within a walk of the front door. */
  plansNear: number;
  plansTotal: number;
  /** The middle leg: what a typical day's journey from here looks like. */
  typicalMinutes: number | null;
  nearest: { label: string; minutes: number; km: number } | null;
  farthest: { label: string; minutes: number; km: number } | null;
  /** Null where the price source has no room here, or was not asked. */
  offer?: StayOffer | null;
  /** The price source's own id for this bed, where it is a different one from the row's. */
  bookRef?: string | null;
  /** Where it came in the ranking, drawn as the badge on the row and on the pin. */
  rank?: number;
  /** The green line on the row: why this one, in the terms the placement was chosen on. */
  fit?: string;
  /** Set only under the station placement: the platform, and the walk to it. */
  station?: { name: string; lat: number; lng: number; kind: string; km: number; walkMinutes: number } | null;
  typicalTrainMinutes?: number | null;
  reviewCount?: number | null;
};

/** What the Stay tab asked the price source for, and what came back. */
export type StayPricing = {
  on: boolean; priced: boolean;
  /** A sandbox key answers with invented hotels at invented prices. Always shown. */
  sandbox: boolean; environment: 'sandbox' | 'production' | 'unknown' | null;
  currency: string | null; nights: number;
  checkIn: string | null; checkOut: string | null;
  rooms: number; adults: number; childAges: number[];
  /** Whose age we had to take a view on, so the screen can offer to fix it. */
  assumedAges: string[];
  withPrice: number;
  reason: 'no_key' | 'switched_off' | 'no_dates' | null;
  degraded: { source: string; error: string }[];
};

export type BrowseDefaults = {
  food: { type?: string | null; cuisine?: string | null };
  things: { type?: string | null };
};
/** A change to one of them: a field left out is left alone, null clears it. */
export type BrowseDefaultsPatch = Partial<{
  food: Partial<BrowseDefaults['food']>;
  things: Partial<BrowseDefaults['things']>;
}>;

export type Household = {
  id: string;
  name: string;
  defaultVisitMinutes: number;
  maxTravelMinutes: number;
  /** How they usually travel on a day out (set-up step 2); null until said. */
  travelMode?: 'driving' | 'transit' | 'walking' | 'cycling' | null;
  defaultIntensity: 'relaxed' | 'balanced' | 'packed';
  home: Place | null;
  /** How far "close to home" reaches, in miles (Settings › Home). */
  homeRadiusMiles?: number;
  /** A picture of the house, taken by the household and held as a data URI (Household › Home). */
  homePhotoUrl?: string | null;
  pace: Pace;
  timezone?: string;
  /**
   * What this household always wants when it goes looking — the standing
   * answer the browse filters open on (owner, 6 Sep 2026: "I never search for
   * pubs or bakeries. I just want to find restaurants").
   */
  browse?: BrowseDefaults;
};

export type PaceKind = { typicalMinutes: number; maxMinutes: number; maxTravelMinutes: number; maxTravelIfSpecialMinutes: number };
export type Pace = { food: PaceKind; activity: PaceKind };

export type Learned = {
  memberId: string; name: string; conceptKey: string; label: string; conceptKind: string | null;
  kind: 'like' | 'dislike'; count: number; confirmed: boolean; threshold: number; net: number; lastOn: string;
};

export type HouseholdResponse = {
  household: Household;
  members: Member[];
  learned: Learned[];
  vocabulary: { allergens: string[]; relationships: string[] };
  /** Why an invitation could not be texted or e-mailed, on the screen that sends it. */
  senders?: { sms: SenderStatus; email: SenderStatus };
};

export type Suggestion = { key: string; label: string; kind: string; score: number };

export type Reason = { kind: string; member?: string; value?: string; text: string };

export type Budget = {
  totalMinutes: number; travelMinutes: number; dwellMinutes: number; allocatedMinutes: number; remainingMinutes: number;
  targetFill: number; targetMinutes: number; fillRatio: number;
  legs: { from: string; to: string; minutes: number }[];
  overrun: boolean; overrunStop: { id: string; name: string; position: number } | null;
  exceedsMaxTravel: boolean; maxTravelMinutes: number | null; estimated: boolean;
};

export type Review = { text: string; rating: number | null; author: string | null; authorUri?: string | null; when: string | null };

/** A licensed photo: a reference the API proxies, plus the author credit the licence requires on screen. */
/**
 * A provider's photograph, as a reference rather than bytes.
 *
 * `sig` and `exp` are the link's own key (api/sources/photoLinks.js): an `<img>`
 * cannot send a header, and the session cookie is third-party between the site
 * and the API, so the signature is what gets the picture through the door in a
 * browser that blocks those. Neither is ever stored — `offline/policy.ts` takes
 * the whole photo off before anything reaches a device.
 */
export type VenuePhotoRef = { ref?: string; url?: string; attribution?: string; sig?: string; exp?: number };

export type Venue = {
  /** Set when this place sits inside another's grounds — a ride in a theme park. It belongs in that place's drawer, not beside it in a list. */
  insideRef?: string | null; insideName?: string | null;
  venueRef: string; source: string; sourcePlaceId: string; name: string; category: string; contributingSources?: string[];
  cuisines: string[]; experiences: string[]; allergens: string[]; dietaryOptions?: string[];
  priceLevel: number | null; rating: number | null; ratingCount?: number | null; goodForChildren: boolean | null; menuForChildren?: boolean | null; lat: number; lng: number;
  dishes: { concept: string; name: string; comment?: string; veg?: boolean }[];
  website?: string | null; phone?: string | null; openingHours?: string | null; address?: string | null; attribution?: string;
  /** Whether it is open at this moment, decided by the source in the place's own timezone; null when the source does not say. */
  openNow?: boolean | null;
  /** Today's hours where the place is — "12:00 – 11:00 PM", or "Closed". */
  hoursToday?: string | null; hoursDay?: string | null; closesAt?: string | null; opensAt?: string | null;
  summary?: string | null; mapsUrl?: string | null; externalUrl?: string | null; reviews?: Review[]; chain?: boolean; brand?: string | null;
  /** What the source said about how the food is served: `fast-food`, `takeaway`. */
  styles?: string[];
  /** Where the taxonomy files it — the same answer the home screen and the back office give. */
  shelf?: MoodKey | null; subcategory?: string | null; subcategoryLabel?: string | null;
  distanceKm?: number;
  photos?: VenuePhotoRef[];
  household?: { visits?: number; lastOn?: string; loved?: number; notForMe?: number; ledger?: string } | null;
};

/**
 * Where a place publishes its menu, found by following its website when the
 * drawer opens. `url` is null when there is nothing to follow, and `why` says
 * so in words worth showing.
 */
/**
 * What Epic owns about a place: the research done when the household
 * shortlisted, saved or visited it, from OpenStreetMap, the venue's own
 * published details and the open encyclopedias. None of it expires, so it is
 * the part that is on the device when there is no signal.
 *
 * `provenance` says which source each field came from, and `attribution` is the
 * credit those licences require on screen.
 */
export type OwnedRecord = {
  venueRef: string;
  name: string | null; category: string | null; lat: number | null; lng: number | null;
  address: string | null; postcode: string | null;
  website: string | null; phone: string | null; email: string | null;
  bookingUrl: string | null; menuUrl: string | null; menuLabel: string | null;
  openingHours: string | null; priceRange: string | null;
  cuisines: string[]; experiences: string[]; dietaryOptions: string[];
  accessibility: { wheelchair?: string | null; wheelchairToilet?: string | null; stepFree?: string | null };
  socials: Record<string, string>;
  goodForChildren: boolean | null;
  summary: string | null; summarySource: string | null; imageUrl: string | null;
  osmRef: string | null; wikidataId: string | null; wikipediaUrl: string | null;
  attribution: string[];
  matched: Record<string, any>;
  provenance: Record<string, string>;
  researchedAt: string | null;
  state: 'pending' | 'done' | 'partial' | 'failed';
  why: string | null;
  updatedAt: string | null;
};

export type MenuLink = { url: string | null; label: string | null; how: string | null; why?: string | null; checkedAt: string; cached?: boolean };


/** A menu read into dishes from the restaurant's own page (owner, 4 Sep 2026). */
export type MenuItem = {
  id: string; name: string; description: string | null; price: number | null; priceText: string | null;
  kcal: number | null; allergens: string | null; vegetarian: boolean | null;
};
export type MenuSection = { title: string; note: string | null; items: MenuItem[] };
export type ReadMenu = {
  id: string; venueRef: string; venueLabel: string | null; sourceUrl: string; sourceKind: 'html' | 'pdf' | 'json' | 'rendered' | 'claude' | 'photo';
  how: string[]; currency: string | null; note: string | null; fetchedAt: string;
  ageDays: number; stale: boolean; staleAfterDays: number; items: number; sections: MenuSection[];
};
/** Epic's own line about a dish, for a menu that gives only a name. */
export type DishNote = { name: string; known: boolean; what: string; origin: string | null };
export type MenuOpeners = { html: boolean; pdf: boolean; rendered: boolean; browser: string | null; claude: boolean; staleAfterDays: number };
/**
 * Somebody else at the table tonight (owner, 7 Sep 2026). A guest belongs to
 * the order, not to the household: `ref` is this phone's own id for them, which
 * is what keeps their dishes attached when the order is saved again.
 */
export type OrderGuest = { id: string; ref: string; name: string };
export type OrderItem = {
  id: string; menuItemId: string | null; memberId: string | null; member: string | null;
  guestId: string | null; guestRef: string | null; guest: string | null; section: string | null;
  name: string; price: number | null; priceText: string | null; note: string | null;
  ratings: { memberId: string; score: number | null; take: Take; comment: string | null }[];
  concept: { key: string; label: string } | null;
  conceptSuggestion: { key: string; label: string; score: number } | null;
};
export type Order = {
  id: string; clientId: string | null; venueRef: string; venueLabel: string | null; menuId: string | null;
  visitId: string | null; createdAt: string; updatedAt: string; items: OrderItem[]; total: number;
  /** The code the waiter scans. It comes with the order, so it draws with no signal. */
  shareToken: string | null;
  guests: OrderGuest[];
};

/** What the code on the table opens, for whoever scans it (public: no session). */
export type OrderTicket = {
  venue: string | null; placedAt: string; guests: string[];
  items: { name: string; note: string | null; priceText: string | null; section: string | null; who: string | null; kind: 'member' | 'guest' | 'table' }[];
  total: number; allergens: string[]; diets: string[];
};

export type Take = 'loved' | 'fine' | 'not_for_me';
export type VisitTake = { id?: string; memberId: string; member?: string; subject: string; take: Take; comment: string | null; conceptKey?: string | null; concept?: string | null; /** Out of 5, in halves (owner, 3 Sep 2026). */ score?: number | null };

/**
 * What the app sends when somebody rates something — which is not the same
 * shape as what comes back.
 *
 * A stored take always has a word. What is *sent* may have only stars, and the
 * API works the word out from them (routes/places.js): the rule lives there
 * rather than in two places that can drift apart.
 */
export type VisitTakeInput = { memberId: string; subject: string; take: Take | null; comment: string | null; conceptKey?: string | null; score?: number | null };
export type Visit = {
  id: string; venueRef: string; venueLabel: string; category: string | null; lat: number | null; lng: number | null;
  visitedOn: string; note: string | null; country: string | null; countryCode: string | null; locality: string | null;
  tripId: string | null; stopId?: string | null;
  attendees: { id: string; name: string }[] | string[];
  takes?: VisitTake[];
  visitTakes?: { member: string; memberId: string; take: Take; comment: string | null; score?: number | null }[];
  itemTakes?: number;
};

export type PricePoint = 'any' | 'affordable' | 'mid' | 'upmarket';

export type OptionStop = {
  id: string; position: number; venueRef: string; name: string; category: string; lat: number; lng: number;
  dwellMinutes: number; waitMinutes?: number; travelFromPrevMinutes: number; arriveAt?: string; leaveAt?: string;
  reasons: Reason[]; justification: string | null; startsAt: string | null; endsAt: string | null; pinned: boolean; fixed?: boolean; uniqueToThisOption?: boolean;
  // What kind of place, how rated and by whom, what it costs, how far — so a card can be judged.
  source?: string; cuisines?: string[]; experiences?: string[];
  rating?: number | null; ratingCount?: number | null; ratingSource?: string | null; priceLevel?: number | null;
  chain?: boolean; brand?: string | null; goodForChildren?: boolean | null; menuForChildren?: boolean | null;
  address?: string | null; website?: string | null; summary?: string | null; openingHours?: string | null;
  distanceKm?: number | null; travelFromBaseMinutes?: number | null; attribution?: string | null; reservable?: boolean | null; mapsUrl?: string | null;
  photos?: VenuePhotoRef[];
};

/** One thing inside a place with grounds — a ride, an animal house, a café. Ours: OSM, Wikidata, Wikipedia. */
export type PlaceInsideItem = {
  itemRef: string; name: string; kind: string; kindLabel: string; lat: number | null; lng: number | null;
  facts: {
    heightM?: number; lengthM?: number; speedKph?: number; opened?: string; builtBy?: string;
    coasterType?: string; operator?: string; note?: string; extraCharge?: boolean; capacity?: number;
    // Who may ride, from the park's own published restrictions.
    minHeightM?: number; maxHeightM?: number; minAge?: number; supervision?: string; thrill?: string;
    /** The day the park's own pages were read, so a ride with no restriction is not asked about again. */
    restrictionsChecked?: string;
  };
  summary: string | null; summarySource: string | null; website: string | null; wikipediaUrl: string | null; attribution: string[];
};

export type BrowseItem = Omit<OptionStop, 'position' | 'travelFromPrevMinutes' | 'pinned'> & {
  pinned: boolean; ticketed?: boolean; venueName?: string | null; externalUrl?: string | null;
  shortlisted?: boolean; score?: number | null; contributingSources?: string[];
  /**
   * A picture Epic owns, travelling as itself rather than folded into `photos`.
   * It has to stay separate because the two are not interchangeable: a rented
   * photo is fetched now and dropped, ours is stored; and a logo among them must
   * be drawn contained rather than stretched across a hero.
   */
  image?: OwnedImage | null;
};

/**
 * A place on the way, with what it costs to stop there. The corridor is a bias
 * and not a restriction — neither the source nor the estimate guarantees a
 * place sits on the road — so the detour is always shown (Requirements §4).
 */
export type RouteStop = BrowseItem & {
  leg: 'out' | 'back';
  meal: string | null;
  /** Why it is here at all: "Lunch on the way", "Worth stopping for on the way". */
  why: string;
  /** What marks it out; null when nothing does, and then it is offered, not proposed. */
  standout: string | null;
  /** Set on the ones not proposed: the reason they were not. */
  notProposed: string | null;
  detourMinutes: number;
  detourEstimated: boolean;
  dwellMinutes: number;
  alongFraction: number;
  intoJourneyMinutes: number;
  chosen: boolean;
  arriveAt: string | null;
  leaveAt: string | null;
};

export type PlanRoute = {
  from: string; to: string; mode: string; minutes: number; estimated: boolean; limitMinutes: number;
  /** The day is the same length whatever is stopped for; the time at the far end is what pays. */
  leaveHomeAt: string; arriveThereAt: string; leaveThereAt: string; backHomeAt: string;
  minutesThere: number; minutesThereWithout: number;
  addedOutMinutes: number; addedBackMinutes: number; addedMinutes: number;
  stops: RouteStop[];
};

export type TripOption = {
  id: string; title: string; basis: string; stops: OptionStop[]; budget: Budget;
  counts: { activities: number; food: number }; shortfall: { activities: number; food: number };
};

export type TripKind = 'outing' | 'trip';
export type DayStop = { id: string; position: number; venueRef: string; name: string; lat: number | null; lng: number | null; dwellMinutes: number; startTime: string | null; visit: Visit | null; bookingStatus?: ShortlistStatus | null; bookingRef?: string | null; legMode?: LegMode | null };
export type TripDay = { id: string; date: string; intensity: 'relaxed' | 'balanced' | 'packed'; travelMode: 'walking' | 'cycling' | 'driving' | 'transit'; startTime: string; endTime: string; notes: string | null;
  /** The journey there, worked out for this day's own mode. */
  journey?: { minutes: number; mode: string; estimated: boolean } | null; slots: { slot: 'morning' | 'afternoon' | 'evening'; stops: DayStop[] }[]; budget: Budget };
export type ShortlistStatus = 'to_call' | 'booked' | 'no_booking' | 'full' | 'set_aside';
export type LegMode = 'walking' | 'transit' | 'driving' | 'taxi';
export type ShortlistItem = {
  id: string; venueRef: string; name: string; kind: 'food' | 'activity' | 'other'; category: string | null; lat: number | null; lng: number | null; venue: Partial<Venue> | null; note: string | null; mustDo: boolean; preferredDayId: string | null; scheduled: boolean;
  // The working state: booking status, order, length, way of travelling to it (owner, 3 Sep 2026).
  status: ShortlistStatus; bookedTime: string | null; partySize: string | null; bookingRef: string | null; statusNote: string | null; statusOn: string | null; position: number | null; dwellMinutes: number | null; legMode: LegMode | null; dayId: string | null;
};
export type JourneyLeg = { from: { label: string; lat: number; lng: number }; mode: LegMode; minutes: number; estimated: boolean; leaveBy: string; options: Partial<Record<LegMode, { minutes: number; estimated: boolean }>> };
export type JourneyStop = {
  id: string; venueRef: string; name: string; category: string | null; kind: string | null; lat: number | null; lng: number | null; venue: Partial<Venue> | null;
  status: ShortlistStatus; bookedTime: string | null; partySize: string | null; bookingRef: string | null; note: string | null; mustDo: boolean; position: number; dwellMinutes: number; dwellDefault: boolean;
  fixed: boolean; fixedAt: string | null; arriveAt: string; leaveAt: string; spareBefore: number | null; lateBy: number | null; mustLeaveBy: string; windowMinutes: number;
  legIn: JourneyLeg; legModeChosen: LegMode | null;
};
export type JourneyBlocker = { kind: 'to_call' | 'clash' | 'late' | 'over'; text: string; ids: string[] };
export type Endpoint = { label: string; lat: number; lng: number; kind: 'home' | 'base' | 'custom' };
export type Journey = {
  source: 'shortlist' | 'day'; dayId: string; date: string; hasCar: boolean; timezone: string; startAt: string; endAt: string; home: { label: string; lat: number; lng: number }; homeAt: string;
  start: Endpoint; end: Endpoint; choices: { home: Endpoint | null; base: Endpoint | null };
  stops: JourneyStop[]; legHome: JourneyLeg | null; fits: boolean; spareMinutes: number; overBy: number; tipping: { id: string; name: string } | null;
  blockers: JourneyBlocker[]; canSave: boolean; estimated: boolean; routing: string; lookups: number;
  others?: { id: string; name: string; category: string | null; status: ShortlistStatus; statusNote: string | null; statusOn: string | null }[];
};
export type DirectionStep = { text: string; minutes: number; meters: number | null; travelMode: string; transit: { line: string | null; agency: string | null; vehicle: string | null; color: string | null; textColor: string | null; headsign: string | null; stopCount: number | null; from: string | null; to: string | null; departs: string | null; arrives: string | null } | null };
export type Directions = { mode: LegMode; minutes: number; meters: number | null; encodedPolyline: string | null; steps: DirectionStep[]; estimated: boolean; source: string };
/** A trip in the two words a row has room for: which one, and when. */
export type TripBrief = { id: string; label: string | null; startsOn: string | null; endsOn: string | null; on: string | null };
export type AtlasCity = {
  name: string; places: number; been: number; special: number; trips: number; lastSeen: string | null;
  lat: number | null; lng: number | null; created: boolean;
  /** The three lists an area is divided into. Hotels decides whether that tab is drawn at all. */
  activities: number; food: number; hotels: number;
  /**
   * Whether this area gets a Hotels tab: somewhere to stay is kept here, or the
   * household has slept a night here (routes/atlas.js). A day-trip area — Bath,
   * Reading & around — shows Activities and Food & drink only.
   */
  holiday: boolean;
  image: OwnedImage | null; lastTrip: TripBrief | null; nextTrip: TripBrief | null;
};
/** Everything within the household's radius of the front door: a standing view, not a city. */
export type AtlasHome = { label: string | null; lat: number; lng: number; radiusMiles: number; places: number; been: number; special: number; image: OwnedImage | null; countryCode: string | null };
export type AtlasCountry = {
  code: string; name: string; places: number; been: number; cities: AtlasCity[];
  areas: number; trips: number; lastTrip: TripBrief | null; nextTrip: TripBrief | null;
};
/** The map a search is drawn on while it runs (SearchSketch). Open data, in Mercator units. */
export type SketchArea = { ref: string; name: string; d: string; cx: number; cy: number };
export type SketchMap = {
  centre: { lat: number; lng: number }; radiusKm: number;
  place: string | null; areas: SketchArea[]; complete: boolean;
  country: { code: string; name: string; d: string; box: [number, number, number, number] } | null;
  attribution: string;
};

/**
 * What a search says while it runs. Each one is something that happened: a
 * source asked, a source answering with a count, a source giving up. Nothing
 * here is a timer, which is the only reason the screen may show it.
 */
export type SketchEvent =
  | { type: 'asking'; sources: { key: string; label: string }[] }
  | { type: 'answered'; source: string; label: string; count: number; points: [number, number][] }
  | { type: 'failed'; source: string; label: string; error: string }
  | { type: 'cached'; count: number }
  /** This search is riding on one already running, and is waiting for its answer. */
  | { type: 'joining' }
  | { type: 'waiting'; at: number };

export type SearchParams = { q?: string; categories?: string; radiusKm?: number; near?: string; sources?: string; refresh?: '1' };
export type SearchAnswer = { near: Place; radiusKm: number; results: (Venue & { onShortlist: boolean; stored?: boolean })[]; degradedSources: { source: string; error: string; slow?: boolean }[]; sourcesQueried?: string[];
  /** The search's own id, so what the household does with these results can be counted against it. */ queryId?: string | null;
  /** How many of the results are the household's own records, served because they cannot go down. */ storedCount?: number;
  cached?: boolean; fetchedAt?: string; tookMs?: number };

export type AtlasPlace = { venueRef: string; name: string; unnamed?: boolean; kind: 'food' | 'activity' | 'other' | null; category: string | null; lat: number | null; lng: number | null; country: string | null; countryCode: string | null; locality: string | null; venue: Partial<Venue> | null; note: string | null; visits: number; lastOn: string | null; takes: { member: string; take: Take; comment: string | null; on: string }[]; ledger: string | null; onTrips: { id: string; title: string | null; on: string | null }[]; status: 'been' | 'saved' | 'special'; special: boolean; loved: number; notForMe: number;
  /** Each person's latest score out of 5 here. */ scores: { memberId: string; member: string; score: number; on: string }[];
  /** Where it is at a glance: postcode district and the nearest station with its lines; null until looked up. */ postcode: string | null; station: string | null; stationLines: string[]; stationKind: string | null; stationDistanceM: number | null; whereChecked: string | null;
  /** The picture Epic owns for this place, if the ladder found one. */ image?: OwnedImage | null;
  /** Rented: the provider's photographs, sent only where we own none, fetched at display and never stored. */ photos?: VenuePhotoRef[] | null;
  /** What a day here is like, over the closed set of six (domain/moods.js) — the Mood filter's vocabulary. */ moods?: MoodKey[];
  /** The drawer this place is filed in ("theme-parks") and its label ("Theme parks & rides") — what a row says it is, instead of repeating "Attraction". */
  subcategory?: string | null; subcategoryLabel?: string | null;
  /** The cabinet's label ("Outdoors", "Culture") — the fallback when nothing has named a drawer for this place yet. */
  categoryLabel?: string | null;
  /** Rented: what the crowd made of it, sent only where nobody here has scored it, fetched at display and never stored. */
  rating?: number | null; ratingCount?: number | null };

/**
 * One place you could stop along the way (the map-first Browse mode).
 *
 * `detourMinutes` is the number the whole design turns on — how much longer the
 * day gets if you stop here, rather than how far it is from home — and
 * `estimated` is always true on it: it is worked out from the distance so that
 * a browse costs nothing (owner, 6 Sep 2026). The real number is fetched for
 * the one place somebody actually adds.
 */
/**
 * Where you want to be, when Epic is finding you somewhere to stay (design
 * handoff, 6 Sep 2026, screen 16). Three genuinely different questions, not
 * three sorts of one list.
 */
export type StayPlacement = 'plans' | 'town' | 'station';

export type TripAlongPlace = {
  venueRef: string; source: string; name: string; category: string | null;
  lat: number; lng: number;
  cuisines: string[]; experiences: string[];
  /** The shelf it sits on (one, the same reading Inspire draws), and its drawer. Absent on an older answer. */
  moods?: MoodKey[]; subcategory?: string | null;
  rating: number | null; ratingCount: number | null; priceLevel: number | null;
  openingHours: string | null; phone: string | null; website: string | null; address: string | null;
  /** A sentence about the place, and whether it is open — the browse card's two other lines. */
  summary: string | null; openNow: boolean | null; closesAt: string | null; opensAt: string | null;
  goodForChildren: boolean | null;
  photos: VenuePhotoRef[]; attribution: string | null;
  detourMinutes: number | null; detourMiles: number;
  estimated: boolean; onShortlist: boolean; onDay: boolean;
};

export type Trip = {
  kind?: TripKind; place?: { label: string } | null; startDate?: string | null; endDate?: string | null; dayStart?: string; dayEnd?: string;
  base?: (Place & { kind?: string | null; checkIn?: string | null; checkOut?: string | null }) | null; hasCar?: boolean;
  /** Place sources this trip's searches and plans may use; null = default set. */
  sources?: string[] | null;
  id: string; title: string | null; notes?: string | null;
  origin: Place; destination: Place | null;
  departAt: string; returnAt: string;
  travelMode: 'walking' | 'cycling' | 'driving' | 'transit'; intensity: 'relaxed' | 'balanced' | 'packed';
  /** How long the journey there is, from where the day starts to where it is for. Null when there is no journey to make. */
  journey?: { minutes: number; mode: string; estimated: boolean } | null;
  country?: string | null; countryCode?: string | null; locality?: string | null;
  /**
   * Whether the dates mean anything yet (trip rebuild, 7 Sep 2026). False is an
   * idea — the third strip on the Trips list — and the row says "Date not fixed"
   * rather than a day nobody has agreed to.
   */
  datesFixed?: boolean;
  /** Whether this trip has ever been shared. The link itself is fetched, never listed. */
  shared?: boolean;
};

export type TripSummary = Trip & {
  dayCount: number; stopCount: number; shortlistCount: number; visitCount: number; ratingCount: number;
  placeCount: number; unratedCount: number;
  attendees: { id: string; name: string }[]; isPast: boolean;
  /** Nights away. Zero is a day out, whatever the trip calls itself — the line Day trips | Holidays is drawn on. */
  nights: number;
  /** Dates, and nowhere to sleep. The one thing on the Trips list allowed to be red. */
  needsStay: boolean;
  image: OwnedImage | null;
};

/**
 * One place a trip touched, however it got there: booked onto a day, kept on
 * the shortlist, visited, or slept in (handover, 5 Sep 2026).
 */
export type TripPlace = {
  venueRef: string; name: string | null; category: string | null;
  /** Which of the three lists it belongs in: something to do, somewhere to eat, somewhere to stay. */
  group: 'do' | 'eat' | 'stay';
  lat: number | null; lng: number | null; firstOn: string | null; lastOn: string | null;
  /** The day it happened, in the words a row shows: "Sun 10". */ day: string | null;
  dwellMinutes: number | null; visited: boolean; scheduled: boolean; shortlisted: boolean;
  bookingStatus: string | null;
  scores: { memberId: string; member: string; score: number }[];
  /** The household's own mark out of five, or null where nobody has said — which is what the Rate nudge is for. */
  score: number | null;
  image: OwnedImage | null;
  /**
   * A provider's photograph, for the rows the library has none of yet. Shown
   * live and never written down — `offline/policy.ts` strips it on the way to
   * the device, and `VenueThumb` prefers `image` whenever there is one.
   */
  photos?: VenuePhotoRef[] | null;
  /** The number to ring ahead on, from the owned record — null where we have none. */
  phone?: string | null;
};

export type TripStop = { id: string; position: number; venueRef: string; name: string; lat: number | null; lng: number | null; dwellMinutes: number; visit: Visit | null };

export type TripDetail = { trip: Trip; attendees: { id: string; name: string; isMinor: boolean; avatarUrl?: string | null }[]; days: TripDay[]; shortlist: ShortlistItem[]; stops: TripStop[]; budget: Budget };

// --- the trip rebuild (7 Sep 2026) -----------------------------------------

/** "Where are you going?" — countries, then cities and towns, each pre-labelled. */
export type TripSearchAnswer = {
  home: string | null;
  countries: { code: string; name: string; kind: 'holiday'; says: string }[];
  places: (Place & { kind: 'day' | 'holiday'; says: string; minutes: number | null; by: 'driving' | 'flying' | null })[];
  rule: string;
};

/** Ferry was removed on 7 Sep 2026. */
export type TravelMode2 = 'fly' | 'train' | 'drive';
export type TransferMode = 'train' | 'taxi' | 'hire';

/** One leg of getting there, with the lines that are worked out rather than typed. */
export type TravelLeg = {
  id: string; direction: 'outbound' | 'return'; mode: TravelMode2; onDate: string | null;
  from: { code: string | null; label: string | null; point: Terminal | null };
  to: { code: string | null; label: string | null };
  departAt: string | null; arriveAt: string | null;
  carrier: string | null; serviceNo: string | null; terminal: string | null;
  durationMinutes: number | null; bookingRef: string | null; note: string | null; source: string;
  accessMinutes: number | null; accessEstimated: boolean;
  /** "Leave home by 05:20 · 40 min drive" — departure minus two hours minus the drive. */
  leaveHome: { time: string; dayBefore: boolean; minutes: number; estimated: boolean } | null;
  resolved: boolean;
};

export type Terminal = {
  code: string; kind: 'airport' | 'station' | 'port'; name: string; locality: string | null;
  country: string | null; countryCode: string | null; lat: number | null; lng: number | null; attribution: string;
};

export type TripTransfer = {
  id: string; mode: TransferMode; label: string | null; detail: string | null; minutes: number | null;
  estCost: string | null; estCostPence: number | null; currency: string; chosen: boolean;
};

export type TripTravel = {
  legs: TravelLeg[]; transfers: TripTransfer[]; party: number; from: string | null;
  /** Why there are no transfer cells, when there are none. */
  transferNote?: string | null;
  /** Which tabs the mode strip should draw — only the ones that mean something here. */
  modes?: TravelMode2[];
  /** Whether Epic can look a journey up at all. */
  canRoute?: boolean;
  /** What Epic can fill in and what it cannot, in the words the screen says. */
  lookup: { schedules: boolean; says: string };
};

/** What a flight number resolved to, before anything is saved. */
export type FlightLookup = {
  ok: boolean; message: string;
  serviceNo?: string; carrier?: string | null; carrierKnown?: boolean;
  from?: Terminal | null; to?: Terminal | null; scheduled?: boolean; asks?: string[];
};

// --- the chat module (13 Sep 2026, "Supporting docs/Chat screens") --------
// A topic is a question or a notice, tagged to one thing and visible to one
// audience; replies are flat inside it; the host or organiser marks one reply
// as the answer. One component, two contexts: a trip and a hosted offer.

export type ChatContextType = 'trip' | 'offer' | 'meet';
export type ChatTagKind = 'stop' | 'day' | 'trip' | 'offer_aspect';
export type ChatAudience = 'everyone' | 'host_only';
export type ChatState = 'open' | 'answered' | 'notice';
/** The Showing dropdown (D4): one enum. `waiting` and `answered` narrow `questions`. */
export type ChatShowing = 'all' | 'questions' | 'waiting' | 'answered' | 'notices' | 'mine' | 'replies_to_me' | 'private';
export type ChatTag = { kind: ChatTagKind; ref: string | null; label: string | null; date: string | null };
/** An anchor a question can be tagged to: a trip-level one, a day, a stop, an aspect of an offer. */
export type ChatAnchor = { key: string; kind: ChatTagKind; ref: string; label: string; date?: string | null; sub?: string | null; dayId?: string | null; /** How many people this anchor reaches, by the roster where there is one. */ people?: number };
export type ChatPerson = { name: string; guest: boolean; initial: string; memberId: string | null; guestId: string | null; avatarUrl: string | null; isHost: boolean };
export type ChatReaction = { emoji: string; count: number; mine: boolean };
export type ChatTopic = {
  id: string; title: string; body: string | null; tag: ChatTag; audience: ChatAudience; occurrence: string | null;
  state: ChatState; pinned: boolean; author: ChatPerson; at: string; lastAt: string;
  replyCount: number; seenBy: number; audienceCount: number;
  answer: { replyId: string; by: string; at: string } | null;
  mine: boolean; following: boolean; opened: boolean; unreadReplies: number;
  reactions: ChatReaction[];
  /** Which Showing values this topic passes — the rules live on the API, once. */
  flags: Record<ChatShowing, boolean>;
};
export type ChatReply = {
  id: string; body: string; at: string; isAnswer: boolean; author: ChatPerson; mine: boolean; seenBy: number;
  /** An inline reply: a rendered quote, never a nested node. */
  quotes: { id: string; by: string; body: string } | null;
  reactions: ChatReaction[];
  publishRequest: { id: string; destination: 'faq' | 'group'; decision: 'anonymous' | 'named' | 'declined' | null; decidedAt: string | null } | null;
};
export type ChatMe = { memberId: string | null; guestId: string | null; name: string; isHost: boolean; guest: boolean; booked: boolean; occurrences: string[] };
export type ChatContext = {
  type: ChatContextType; id: string; name: string; subtitle: string | null; sub: string; dates: { start: string; end: string } | null;
  /** Whether "the people on that day" is real here — a group trip's roster — or everyone on the trip. */
  roster: boolean;
  host: { name: string; role: 'organiser' | 'host'; memberId: string | null } | null;
  me: ChatMe | null;
  can: { ask: boolean; private: boolean; notice: boolean; answer: boolean };
  people: { count: number; members: { id: string; name: string; avatarUrl: string | null; isHost: boolean }[]; guests: { id: string; name: string }[] };
  anchors: { level: ChatAnchor[]; days: ChatAnchor[]; stops: ChatAnchor[] };
};
/** What you get told about (C9). The defaults are the design. */
export type ChatPrefs = { started: boolean; anchors: boolean; from_host: boolean; every_topic: boolean; mentions: boolean; digest: boolean };
export type ChatList = {
  context: ChatContext; topics: ChatTopic[]; prefs: ChatPrefs; unread: number;
  /** Trips: how many questions sit on each stop, by venue ref (the Ask tab's count). */
  askCounts?: Record<string, number>;
  organiser?: { id: string; name: string } | null;
  /** Offers: "three answers came with this booking" (C8), and how many the FAQ holds. */
  faqFromEarlier?: number; faqCount?: number;
  /** The old `/asks/<ref>` address says which stop it was filtered to. */
  about?: string;
};
export type ChatMenuGroup = { title: string; items: { key: string; label: string; hint?: string }[] };
export type ChatTopicView = {
  context: ChatContext; topic: ChatTopic; replies: ChatReply[];
  /** The asker's decision to make (D2), shown exactly as it would be published. */
  publishRequests: { id: string; replyId: string; destination: 'faq' | 'group'; forMe: boolean; askedBy: string | null; preview: { question: string; answer: string } }[];
  menu: ChatMenuGroup[];
  /** For the host: how many times this has been asked across the offer's dates. */
  askCount: number | null; suggestPublishAt: number;
  picker: { quick: string[]; mostUsed: string[]; yours: boolean };
  faq?: { id: string } | null;
  /**
   * Their own question, waiting to be read again.
   *
   * A question whose words changed after somebody had already decided about
   * them goes back in front of a person, and is out of sight while it waits —
   * to its author, who can still see it, the screen says so.
   */
  waiting?: boolean;
};
export type ChatInbox = {
  host: { id: string; name: string } | null;
  offers: { id: string; title: string | null; shape: string; state: string; startsOn: string | null; topics: ChatInboxItem[] }[];
  counts: { waiting: number; answered: number; private: number; all: number };
  suggestPublishAt: number;
};
export type ChatInboxItem = {
  id: string; offerId: string; title: string; tag: { kind: ChatTagKind; ref: string | null; label: string | null }; audience: ChatAudience; state: ChatState;
  at: string; lastAt: string; author: { name: string; initial: string }; askedTimes: number; suggestPublish: boolean; replyCount: number; seenBy: number;
  flags: { waiting: boolean; answered: boolean; private: boolean };
};
export type ChatSettings = {
  digestAt: string; quietFrom: string | null; quietTo: string | null;
  contexts: { type: ChatContextType; id: string; name: string; when: string; prefs: ChatPrefs }[];
  defaults: ChatPrefs;
};
/** An answered question that outlives the booking (C7). */
export type FaqEntry = { id: string; question: string; answer: string; askCount: number; askedBy: string | null; publishedAt: string };

export type ChatAskBody = { title: string; body?: string | null; tag: { kind: ChatTagKind; ref: string }; audience: ChatAudience; notice?: boolean; occurrence?: string | null };

export type TripPeople = {
  members: { id: string; name: string; isMinor: boolean; avatarUrl: string | null }[];
  guests: { id: string; name: string; contact: string | null; contactKind: string | null; status: string; joinedAt: string | null }[];
  count: number;
};

export type TripShare = {
  household: { id: string; name: string; isMinor: boolean; avatarUrl: string | null; going: boolean; organiser: boolean; status: string }[];
  guests: { id: string; name: string; contact: string | null; contactKind: string | null; status: string; says: string; link: string | null }[];
  link: string;
  /** Whether an invite can actually be sent from here — neither sender is Epic's to switch on. */
  canSend: { sms: boolean; email: boolean };
};

/** The trip as somebody with the link sees it: the plan, the people, and nothing else. */
export type SharedTrip = {
  trip: { id: string; title: string; where: string | null; startDate: string | null; endDate: string | null; datesFixed: boolean; nights: number; dates: string | null; from: string | null };
  days: { id: string; date: string; label: string | null; stops: { id: string; venueRef: string; name: string; startTime: string | null; dwellMinutes: number }[] }[];
  travel: { direction: string; mode: string; onDate: string | null; from: string | null; to: string | null; departAt: string | null; arriveAt: string | null; carrier: string | null; serviceNo: string | null }[];
  people: { members: { name: string; initial: string }[]; guests: { name: string; initial: string }[] };
  you: { id: string; name: string; joined: boolean } | null;
  canSend?: { sms: boolean; email: boolean };
};

// --- group trips -----------------------------------------------------------
// A group hangs off a trip: one organiser, a checklist of the things the trip
// already contains, and the people who have to do them. The organiser's screen
// leads with what is outstanding; Epic does the chasing on a schedule.

export type GroupItemKind = 'stay' | 'activity' | 'fee';
export type GroupStatus = 'booked' | 'declared' | 'paid' | 'in' | 'out';
export type GroupItemState = { status: GroupStatus; bookingRef: string | null; whereBooked: string | null; startsOn: string | null; endsOn: string | null; amountPence: number | null; note: string | null; markedBy: 'participant' | 'organiser' | 'epic'; on: string };
export type GroupPricing = 'fixed' | 'variable' | null;
export type GroupItemState2 = 'open' | 'closed' | 'cancelled';
/**
 * The money on an item, worked out by the API and never by a screen: the share
 * now, the ceiling (what it costs at the minimum — the promise), and what it
 * will probably come out at. Nothing is owed until `billed`.
 */
export type GroupMoney = {
  shares: number; expected: number | null; minimum: number | null; closesOn: string | null;
  perSharePence: number | null; ceilingPence: number | null; likelyPence: number | null;
  billed: boolean; paidPence: number | null; duePence: number | null; collectedPence: number | null;
};
export type GroupItem = {
  id: string; kind: GroupItemKind; required: boolean; label: string; detail: string | null; venueRef: string | null; stopId: string | null;
  amountPence: number | null; refundRule: string | null; refundUntil: string | null; position: number;
  applies: 'everyone' | 'extra'; pricing: GroupPricing; totalPence: number | null; perHead: boolean;
  expectedCount: number | null; minimumCount: number | null; capacity: number | null;
  closesOn: string | null; lateJoiners: 'capacity' | 'no' | 'ask'; state: GroupItemState2;
  startsOn: string | null; startsAt: string | null; endsAt: string | null;
  bookWhere: 'epic' | 'yourself' | 'there' | null; externalUrl: string | null; guestNote: string | null;
  /** Who takes the money for this one. Null follows the group's own setting. */
  paymentMode: 'direct' | 'epic' | null;
  /** Where everybody meets, searched for rather than typed into a note. */
  meet: { label: string; lat: number | null; lng: number | null } | null;
  settledPence: number | null; settledHeads: number | null; settledAt: string | null; dueOn: string | null; cancelledNote: string | null;
  done: number; declared: number; confirmed: number; coming: number; notComing: number; heads: number;
  outstanding: number; outstandingNames: string[]; money: GroupMoney | null; paidPence: number | null; duePence: number | null;
};
export type GroupParticipant = {
  id: string; name: string; contact: string | null; contactKind: 'mobile' | 'email' | null; heads: number; brings: string | null;
  memberId: string | null; note: string | null; invitedAt: string | null; joinedAt: string | null; withdrawnAt: string | null; withdrawnNote: string | null;
  states: Record<string, GroupItemState>; outstanding: { id: string; label: string; kind: GroupItemKind }[];
  reminders: { on: string; kind: string; status: string; body: string }[]; lastRemindedAt: string | null;
};
export type GroupReminders = {
  on: boolean; cadence: string; cadences: { key: string; label: string; runs: number }[]; channelReady: boolean;
  schedule: { date: string; daysBefore: number; at: string; done: boolean }[];
  next: { date: string; daysBefore: number; at: string; recipients: number } | null;
  written: number; undelivered: number; preview: string;
  recent: { id: string; on: string; runOn: string | null; kind: string; status: string; reason: string | null; who: string | null; body: string }[];
};
export type GroupItemInput = {
  kind: GroupItemKind; label: string; detail?: string; required?: boolean; venueRef?: string | null;
  amountPence?: number | null; refundRule?: string | null; refundUntil?: string | null;
  pricing?: GroupPricing; totalPence?: number | null; perHead?: boolean;
  expectedCount?: number | null; minimumCount?: number | null; capacity?: number | null;
  closesOn?: string | null; lateJoiners?: 'capacity' | 'no' | 'ask';
  startsOn?: string | null; startsAt?: string | null; endsAt?: string | null;
  bookWhere?: 'epic' | 'yourself' | 'there' | null; externalUrl?: string | null; guestNote?: string | null;
  paymentMode?: 'direct' | 'epic' | null;
  meet?: { label: string; lat?: number | null; lng?: number | null } | null;
};
/** One of the household's groups, as the Who's coming row and the Trips filter both need it. */
export type GroupSummary = {
  id: string; tripId: string; name: string | null; inviteToken: string; organiser: string | null;
  setupDone: boolean; closed: boolean; cancelled: boolean;
  expectedCount: number | null; minimumCount: number | null; maximumCount: number | null; wantedBy: string | null;
  invited: number; joined: number; heads: number; outstanding: number;
  trip: { id: string; title: string | null; place: string | null; startDate: string | null; endDate: string | null };
};
export type TripGroup = {
  group: { id: string; tripId: string; name: string | null; expectedCount: number | null; minimumCount: number | null; maximumCount: number | null; wantedBy: string | null; inviteToken: string; closed: boolean; remindersOn: boolean; cadence: string; setupDone: boolean; firstReminderOn: string | null; cancelledAt: string | null; cancelledNote: string | null;
    paymentMode: 'direct' | 'epic';
    invite: { coverKind: 'banner' | 'full'; coverUrl: string | null; coverSource: string | null; title: string | null; summary: string | null; howItWorks: string[] } };
  trip: { id: string; title: string | null; place: string | null; startDate: string | null; endDate: string | null; base: { label: string; kind: string | null } | null };
  items: GroupItem[]; participants: GroupParticipant[];
  summary: { expected: number | null; joined: number; notJoined: number; withdrawn: number; heads: number; complete: number; missing: number; waitlist?: number };
  /** Who asked to be told if a place comes up (G24), and whether they have been. */
  waiting?: { id: string; contact: string; kind: string | null; at: string; told: boolean }[];
  reminders: GroupReminders;
  warnings: { kind: string; participantId: string; name: string; itemId: string; item: string; said: string; wanted: string }[];
  wrote?: { participant: string; status: string }[];
};
/** What the invite link opens: the checklist, and nothing about anybody else. */
export type JoinView = {
  group: { name: string | null; wantedBy: string | null; closed: boolean; cancelled: boolean; cancelledNote: string | null; organiser: string | null; expectedCount: number | null; minimumCount: number | null; maximumCount: number | null; joined: number; heads: number; paymentMode: 'direct' | 'epic'; canSendCode: boolean };
  /** The landing page as the organiser wrote it; everything else is drawn from the group. */
  invite: { coverKind: 'banner' | 'full'; coverUrl: string | null; title: string | null; summary: string | null; howItWorks: string[]; placesLeft: number | null };
  trip: { title: string | null; place: string | null; startDate: string | null; endDate: string | null; base: { label: string } | null };
  items: (Omit<GroupItem, 'done' | 'declared' | 'confirmed' | 'coming' | 'notComing' | 'heads' | 'outstanding' | 'outstandingNames' | 'paidPence' | 'duePence' | 'money'> & {
    mine: GroupItemState | null;
    money: (Pick<GroupMoney, 'shares' | 'perSharePence' | 'ceilingPence' | 'likelyPence' | 'minimum' | 'expected' | 'closesOn' | 'billed'> & {
      heads: number; yoursPence: number | null; ceilingYoursPence: number | null; likelyYoursPence: number | null; dueOn: string | null;
    }) | null;
  })[];
  expecting: { id: string; name: string }[];
  you: { id: string; name: string; heads: number; brings: string | null; joinedAt: string | null; outstanding: number } | null;
  participantToken?: string;
};

/** What a guest gets for joining: their own Epic, on trial, signed in on this device. */
export type GuestAccount = {
  id: string; name: string; email: string | null; mobile: string | null;
  householdId: string | null; plan: string | null; trialEndsOn: string | null; returning: boolean;
};
/** What one Confirm and pay agreed to: three sums, and the lines they came from. */
export type GroupBooking = {
  id: string; paidPence: number; laterPence: number; directPence: number;
  lines: { itemId: string; label: string; when: 'now' | 'settles' | 'direct'; pence: number; ceilingPence?: number; on?: string | null }[];
};
export type HouseholdMemberInput = { name: string; child?: boolean; age?: number | null; relationship?: string | null; you?: boolean; coming?: boolean };

export type SuggestedPreference = { member: string | null; kind: 'like' | 'dislike'; value: string };

export type Spend = { session_calls: number; session_cost_usd: number; month_calls: number; month_cost_usd: number; sessionBound: number; householdMonthlyBound: number; trip_calls?: number; trip_cost_usd?: number };

export type PlanResponse = {
  sessionId: string; dayId?: string | null; date?: string | null; reply: string | null;
  journey?: { from: string; to: string; minutes: number; mode: string } | null;
  /** The journey itself as something to plan: what is worth stopping for on the way there and back. */
  route?: PlanRoute | null;
  anchor?: { name: string; start_time: string | null; duration_minutes: number | null; kind: string; place: Place } | null; intent?: Record<string, any>; missing?: string[]; trip?: Trip;
  options: TripOption[];
  selection?: { pinned: string[]; excluded: string[]; chosenOptionId: string | null };
  constraints?: { minActivities: number; minFood: number; includeChains?: boolean; pricePoint?: PricePoint };
  pool?: { size: number; targetFill: number; excludedByAllergen: { name: string; reasons: string[] }[]; hiddenChains?: number };
  suggestedPreferences?: SuggestedPreference[]; spend?: Spend;
  attending?: { id: string; name: string }[]; reach?: { maxTravelMinutes: number; estimated: boolean };
  applied?: any; ambiguous?: string | null; transcript?: { role: 'user' | 'assistant'; text: string }[];
  browse?: BrowseItem[]; eventsSource?: string | null; resumed?: boolean;
  // A question the planner is asking instead of guessing; each choice is tapped or said in the same words.
  question?: PlanQuestion | null;
  // The rows are the screen: everything said so far in its slot; the checks are what the planner is not sure of.
  rows?: PlanRow[] | null;
  checks?: PlanCheck[];
  answered?: { id: string; text: string; answer: string }[];
  ready?: boolean;
  // Plan it runs in the background: poll the session until this clears.
  running?: boolean; failed?: boolean;
  // An overnight stay was set up as a dated trip: open it in Trips.
  handoff?: { tripId: string; title: string; section?: 'find' | 'shortlist' | 'day' } | null;
};

export type PlanQuestion = { kind: 'place' | 'stay' | 'attending' | 'open' | 'duration'; field?: string | null; text: string; choices: { label: string; say: string }[] };
export type PlanCheck = PlanQuestion & { id: string; skippable: boolean };
export type PlanRowKey = 'from' | 'to' | 'when' | 'who' | 'stay' | 'do' | 'eat' | 'budget';
export type PlanRow = { key: PlanRowKey; label: string; value: string | null; detail: string | null; state: 'plain' | 'check' | 'empty' };
// A tapped control lands in the plan exactly as tapped — no interpretation.
export type PlanSet = {
  origin?: Place | null; destination?: Place | null; date?: string | null; end_date?: string | null; nights?: number | null; duration_minutes?: number | null; depart_time?: string | null;
  do?: { kinds: string[]; named: string[]; count: number | null };
  eat?: { meals: Record<string, string | null>; avoid_chains?: boolean | null; special?: boolean | null };
  budget?: { price_point?: 'any' | PricePoint | null; low?: number | null; high?: number | null; per?: 'everyone' | 'person' | null };
};
export type IdeaBudget = 'any' | 'free' | 'cheap' | 'mid' | 'treat';
// The family's table (owner, 4 Sep 2026): one food several of them love, and
// the best places for it within the travel cap.
export type TasteWho = { memberId: string; name: string; favourite: boolean; said?: string };
export type TasteFit = { tone: 'good' | 'warn' | 'fact' | 'allergen'; kind: string; member: string | null; text: string };
export type MenuRead = {
  checked: boolean; menuUrl: string | null; menuDated: string | null;
  dish: { label: string; verdict: 'yes' | 'no' | 'unknown'; named: string | null; price: string | null; note: string | null } | null;
  people: { person: string; need: string; verdict: 'yes' | 'no' | 'unknown'; examples: string[]; note: string | null }[];
  allergens: { person: string; allergen: string; verdict: 'yes' | 'no' | 'unknown'; note: string | null }[];
  kidsMenu: boolean | null; summary: string | null; whyNot: string | null; readAt: string; attribution: string; cached?: boolean;
};
export type TastePlace = {
  venueRef: string; source: string; name: string; category: string; cuisines: string[]; address: string | null;
  rating: number | null; ratingCount: number | null; priceLevel: number | null;
  travelMinutes: number; travelEstimated: boolean; distanceKm: number; lat: number; lng: number;
  website: string | null; mapsUrl: string | null; photos: { ref: string; attribution: string }[]; chain: boolean;
  evidence: { where: 'review' | 'summary' | 'name' | 'cuisine'; text: string | null; matched: string } | null;
  fits: TasteFit[]; attribution: string | null; menu: MenuRead | null;
};
export type Taste = { key: string; label: string; title: string; loved: TasteWho[]; notFor: { memberId: string; name: string; value: string }[]; named: boolean };
export type TasteTable = Taste & { because?: string; searched?: string; radiusKm?: number; travelNote?: string | null; nearest?: { name: string; travelMinutes: number; estimated: boolean } | null; places: TastePlace[]; excluded?: { name: string; reasons: string[] }[]; found?: number; error?: string };
export type TastesResponse = { sessionId: string; running: boolean; tastes: Taste[]; tables: TasteTable[]; note: string | null; error: string | null; capMinutes?: number | null; capFromWords?: boolean };
export type AroundThing = IdeaThing & { why: { memberId: string; name: string; favourite: boolean; label: string; text: string }[] };

/** How far along a run of Inspire me is, for the line that says what is happening. */
export type InspireStage = 'thinking' | 'thinking-again' | 'placing' | 'ready' | 'error';
export type Idea = { id: string; title: string; why: string; placeText: string; place: Place | null; travelMinutes: number | null; distanceKm?: number | null; overnight: boolean; do: string[]; eat: string[]; placing?: boolean };
export type IdeaThing = { venueRef: string; name: string; category: string; kind: 'do' | 'eat' | 'see'; experiences: string[]; rating: number | null; ratingCount: number | null; priceLevel: number | null; photos?: VenuePhotoRef[]; distanceKm: number | null; lat: number | null; lng: number | null; reasons: string[] };
/** The place an idea is about, as its source holds it: the picture, the stars, how far. */
export type IdeaHeadline = { venueRef: string; name: string; category: string; experiences?: string[]; rating: number | null; ratingCount: number | null; priceLevel: number | null; photos: VenuePhotoRef[]; distanceKm: number | null; summary: string | null; attribution: string | null };

// ---------------------------------------------------------------------------
// Inspire — the home screen
// ---------------------------------------------------------------------------

/** What a day is about. The closed set the home screen draws as chips. */
/**
 * A category key. The eight are named so the editor still completes them, and
 * `(string & {})` keeps the union open — the categories live in a table now
 * (migration 053) and the back office may add one without a deploy.
 */
export type MoodKey = 'fun' | 'food' | 'culture' | 'sport' | 'activity' | 'adrenaline' | 'relaxing' | 'outdoors' | (string & {});
export type Mood = {
  key: MoodKey; label: string; count: number;
  /** An `Icon` name, from the table rather than a lookup in the bundle. */
  icon?: string | null;
  /** Food is a chip that navigates into Places rather than a shelf that fills. */
  isDoor?: boolean;
  /** The drawers inside it that actually hold something here, in order. */
  subcategories?: { key: string; label: string; count: number }[];
};

/**
 * One place on the home screen, from the single pool the API retrieved. Every
 * shelf, every filter and every count on that screen is composed from these —
 * changing a chip never asks a provider anything (Requirements: one pool).
 */
/**
 * A photograph Epic owns outright — harvested from Wikimedia Commons under a
 * licence that lets us keep and republish it. `lqip` is a 20px JPEG as a data
 * URI, about 500 bytes, so a card paints before the network is touched.
 *
 * `credit` is not decoration. For everything except CC0 and public domain,
 * showing the picture without the line is the licence broken, so a card that
 * draws the image must draw the credit too.
 */
/** Where a photograph was taken, in words, and the location it would file under. */
export type PhotoFiled = { country: string | null; countryCode: string | null; locality: string | null };
export type PhotoWhere = PhotoFiled & { label: string | null; how: 'known' | 'nearest' | 'new' | 'unknown' };

export type OwnedImage = {
  id: string;
  /**
   * The signed link for a household's own photograph while it waits for the
   * library's look (api/sources/photoLinks.js `stampImage`). Absent on every
   * public picture; present, it must travel on the URL or the bytes are a 404.
   */
  sig?: string; exp?: number;
  /**
   * Which rung of the ladder found it (sources/placePicture.js), because a card
   * must not draw all of them the same way. A photograph fills its tile; a
   * `logo` is a business's mark and is contained on the lime ground with room
   * around it, or it comes out cropped into an abstract smear.
   */
  source: 'wikimedia' | 'logo' | 'kartaview' | 'mapillary' | 'household' | 'upload' | string;
  lqip: string | null; credit: string | null;
  licence: string; licenceUrl: string | null; sourceUrl: string | null;
  creditRequired: boolean;
};

export type InspireItem = {
  venueRef: string; source: string; name: string; category: string;
  /** One category, in a list — the shape the shelves already draw. */
  moods: MoodKey[];
  /** The drawer inside it, or null while nobody has sorted it. */
  subcategory?: string | null;
  /** The drawers of the places inside this one, so a theme park answers for its water park. */
  contains?: string[];
  experiences: string[]; cuisines: string[];
  rating: number | null; ratingCount: number | null; priceLevel: number | null;
  goodForChildren: boolean | null;
  /** What its drawer says (back office › Shelves): indoors or out, and for children. Null is "it depends". */
  indoor?: boolean | null; forKids?: boolean | null;
  photos: VenuePhotoRef[];
  /** The credit the picture and the rating travel with; shown wherever they are. */
  attribution: string[];
  lat: number; lng: number;
  /** From the middle of the search. */
  distanceKm: number;
  /** The journey the family would actually make, from home or from where they are. */
  travelMinutes: number; estimated: boolean;
  /** How long this household would spend there, at their own pace. */
  dwellMinutes: number;
  household: { visits?: number; lastOn?: string; loved?: number; notForMe?: number; ledger?: string } | null;
  /** Set on an atlas place: ours, illustrated, and researched from open sources. */
  image?: OwnedImage | null;
  /**
   * The atlas's own word for the kind of place — heritage, outdoors, museum,
   * arts, animals, family, active, landmark. Deliberately its own field rather
   * than folded into `experiences`, which is a closed vocabulary that voice is
   * interpreted against and must stay closed.
   */
  atlasCategory?: string | null;
  summary?: string | null;
  heritage?: string | null;
  website?: string | null;
  wikipediaUrl?: string | null;
  region?: string | null;
};

export type InspireNear = {
  place: { label: string | null; lat: number; lng: number; locality: string | null };
  from: { label: string | null; lat: number; lng: number; how: 'home' | 'given' | 'centre' };
  mode: string; radiusKm: number;
  moods: Mood[]; items: InspireItem[];
  /**
   * Which pools are in this answer. The home screen reads the atlas alone —
   * ours, illustrated, and answered in milliseconds — and `live` is only true
   * when somebody deliberately asked to look around beyond it.
   */
  pools?: {
    atlas: boolean; live: boolean;
    /** Why the look-around ran: asked for, or because the sweep has not reached this town. */
    why?: 'asked' | 'unswept' | null;
    /** A source refused, so an empty Food tab means "could not look", not "nowhere to eat". */
    failed?: boolean;
  };
  cached: boolean; tookMs: number; attribution: string[];
};

export type PlanAction =
  | { type: 'like' | 'unlike' | 'dislike' | 'restore'; stopId: string }
  /** A stop on the way in or out of the journey; the day at the destination is untouched. */
  | { type: 'route_add' | 'route_drop'; stopId: string }
  | { type: 'choose'; optionId: string | null }
  | { type: 'set'; minActivities?: number; minFood?: number; intensity?: Trip['intensity']; durationMinutes?: number; travelMode?: Trip['travelMode']; includeChains?: boolean; pricePoint?: PricePoint; attendingMemberIds?: string[] };

export type SourceCost = { perSearchUsd: number; note: string };
export type SourcesStatus = { cost?: Record<string, SourceCost>; enabled: { key: string; label: string; attribution: string | null; optIn?: boolean }[]; routing: string;
  /**
   * Whether real travel times are being asked for *right now*, per method. A
   * spent daily quota is not a fault and not permanent, so the back office's
   * "How it works" says which of the two answers a time on screen is at this
   * moment (api/src/sources/routing.js).
   */
  routingNow?: { matrix: { until: string; reason: string; method: string; refusals: number } | null; route: { until: string; reason: string; method: string; refusals: number } | null } | null;
  defaults?: string[]; available: { key: string; label: string; env: string; on: boolean; hasKey?: boolean; off?: boolean; optIn?: boolean }[]; usage?: { tripadvisor?: { searchesAllTime: number; searchesThisMonth: number; locationsAllTime?: number; locationsFree?: number } } };

// Admin: what each source returned for a day of a trip and where the plan lost it.
export type SourceStage = 'catchment' | 'reach' | 'allergen' | 'window' | 'shown';
export type SourceTraceVenue = {
  key: string; venueRef: string; name: string; category: string; source: string; contributingSources: string[]; ratingSource: string | null;
  rating: number | null; ratingCount: number | null; priceLevel: number | null; goodForChildren: boolean | null;
  startsAt: string | null; endsAt: string | null; venueName: string | null; experiences: string[]; cuisines: string[];
  distanceKm: number; travelMinutes: number | null; travelEstimated: boolean; stage: SourceStage; reason: string | null;
  score: number | null; reasons: { kind: string; text: string }[]; chain: boolean; conflicts: { field: string; held: any; heldSource?: string; offered: any; offeredSource?: string }[];
  externalUrl: string | null; address: string | null; justification: string | null; attribution: string | null; photoCount: number; raw: Record<string, any>;
};
export type SourceTrace = {
  trip: { id: string; title: string | null; dayId: string; date: string; base: { label: string; lat: number; lng: number }; window: { from: string; to: string }; mode: string; timezone: string };
  days: { id: string; date: string }[];
  sourcesQueried: string[]; requested: string[]; includeScout: boolean; degraded: { source: string; error: string }[]; radiusKm: number; maxTravelMinutes: number;
  stages: { key: string; label: string; bySource: Record<string, number>; total: number }[];
  venues: SourceTraceVenue[];
  spend?: { units: Record<string, number>; listPriceUsd: number; byProvider: { key: string; units: number; usd: number }[]; actualUsd: number };
};

// Settings › Providers charts: spend by month, per provider line and in total.
export type SpendPoint = { month: string; calls: number; units: number; costUsd: number; paidUsd: number; estimated: boolean };
export type SpendSeries = { months: string[]; lines: Record<string, SpendPoint[]>; total: { month: string; calls: number; costUsd: number; paidUsd: number }[] };

// Settings › Usage: what the household's calls have used and cost, by provider.
export type SpendPeriod = 'month' | 'last-month' | 'all' | 'custom';
export type SpendAllowance = {
  kind: 'monthly' | 'lifetime' | 'daily'; limit: number; used: number; estimated: boolean; resetsAt: string | null;
  beyondUsd?: number | null; basis?: string; label?: string; env?: string;
};
export type SpendLine = {
  key: string; label: string; source: string; on: boolean; unit: string; unitPlural: string; what: string; hardStop: string | null;
  console: { label: string; url: string } | null;
  calls: number; units: number; costUsd: number; paidUsd: number; estimated: boolean;
  allowance: SpendAllowance | null; cap: SpendAllowance | null;
  periods?: Record<'month' | 'last-month' | 'all', { calls: number; units: number; costUsd: number; estimated: boolean }>;
  perSearchUsd?: number | null;
};
export type SpendResponse = {
  period: { key: SpendPeriod; from: string; to: string; label: string };
  totals: { calls: number; costUsd: number; paidUsd: number };
  totalsByPeriod?: Record<'month' | 'last-month' | 'all', { calls: number; costUsd: number }>;
  lines: SpendLine[];
  recent: { id: string; at: string; provider: string; purpose: string | null; cost_usd: number; units: Record<string, number> | null; lines?: string[] }[];
  generatedAt: string;
};

/** A mock-up is 'new' until the owner rules on it. */
export type PrototypeStatus = 'new' | 'approved' | 'rejected' | 'archived';

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * The device's saved copy belongs to one household.
 *
 * Called before the token is set, on every way in. If the person signing in is
 * not who the copy was saved for, it goes — otherwise a friend signing in on a
 * browser somebody else used would be served that household's atlas straight
 * out of IndexedDB, without a request the API could refuse.
 */
async function claimDeviceCopy(account: AccountSummary | null | undefined): Promise<void> {
  const holder = holderOf(account);
  const before = copyHolder();
  if (before && before !== holder) await forgetCopy();
  setCopyHolder(holder);
}

/**
 * What the running API can actually see, and where from — Settings › Providers
 * shows it when a key that is "in Doppler" is not in the process.
 *
 * Names and shapes only. No value, or part of one, crosses this boundary; a
 * `kind` is a published vendor prefix (`sand_`, `prod_`, `sk-ant-`) and nothing
 * that anybody chose.
 */
export type KeyReport = {
  service: { railwayService: string | null; railwayEnvironment: string | null; railwayProject: string | null; commit: string | null; startedAt: string };
  /** Blank on every line means the Doppler sync is not reaching this service at all. */
  doppler: { project: string | null; config: string | null; environment: string | null };
  expected: {
    name: string; set: boolean; length?: number; kind?: string | null;
    /** The three ways a value can be present and still be wrong. */
    quoted?: boolean; padded?: boolean; unresolvedReference?: boolean;
  }[];
  /** Other names on the process that look like credentials — a near miss shows up here. */
  otherSecretNames: string[];
  note: string;
};


// ---------------------------------------------------------------------------
// Places, Runs, Demand and the content queue
// ---------------------------------------------------------------------------
//
// The shapes behind the three screens that replaced five. Nothing here carries a
// provider's content: a place is an identifier, a position, our own shelf and
// our own score, and a name only where we are allowed to keep one. A `google:`
// ref nobody owns comes back with `name: null`, and the nameless row on screen
// is the finding — it means Google is the only source that has ever seen it.

/** Where a level is pointed. Only what differs from the default is written down. */
export type PlaceWhere = { where?: string | null; within?: number | null; by?: string | null };

/** The five numbers every level prints, whatever level it is. */
export type PlaceStats = {
  /**
   * Three kinds of ownership, counted as three.
   *
   * `owned` is "we hold our own research on it"; `claimed` is "a household said
   * it matters and we hold nothing"; `identified` is "somebody returned it and
   * nobody has done either". They add up to `known`. Claimed used to be folded
   * into owned, which made coverage read better than it was (Codex, 17 Sep 2026).
   */
  known: number; owned: number; claimed: number; identified: number;
  readyCount: number; ready: number | null; avgScore: number | null;
};

export type PlaceLevel = {
  /**
   * For a ring: whether we hold travel times for this cell at all.
   *
   * `false` means the matrix has never heard of it — which is a different fact
   * from "nothing is within reach", and the board says which.
   */
  cellKnown?: boolean | null;
  kind: 'area' | 'ring' | 'none';
  slug: string; name: string; areaKind: string;
  /** What a ring was drawn round — a town, a postcode district — or null on a level. */
  fromKind?: string | null;
  minutes: number | null; mode: string | null; cells: number | null;
  trail: ({ slug: string; label: string } & PlaceStats)[];
  stats: PlaceStats;
  refreshedAt?: string | null;
  /** The ring chooser's three steps and three ways. Named apart from the quality lens's score bands. */
  ringBands?: number[]; modes?: string[];
  /**
   * Which of those ways the matrix can actually answer here.
   *
   * A mode nobody has built has no reach rows, so a ring in it comes back
   * empty — and an empty board that looks like an answer is worse than a
   * control that says it is not built yet.
   */
  modesBuilt?: string[];
};

export type PlaceCountry = PlaceStats & {
  slug: string; name: string; countryCode: string;
  cells: number; built: number; searches: number;
  /** Which ways of getting there the matrix can answer here. */
  modes: string[];
  /** Whether this country can answer "within 30 minutes" yet. */
  travel: 'ready' | 'part' | 'none';
};

export type PlaceAreaRow = PlaceStats & {
  slug: string; name: string; kind: string; parent: string | null;
  searches: number; empty: number;
};

/**
 * One drawer on the census board.
 *
 * `surfaced` and `filed` answer different questions and both are shown: how
 * many this question found, against how many are filed here. A cross-check
 * nobody has run is `null` rather than nought, because "nobody has checked" and
 * "there are none" are different facts.
 */
export type PlaceCensusRow = {
  category: string; subcategory: string;
  filed: number; surfaced: number; scored: number; saturated: number;
  osm: number | null; fhrs: number | null; residual: number | null;
  censused_at: string | null; complete: boolean;
};

export type PlaceCoverageRow = {
  slug: string; name: string; kind: string;
  /** An outcode says which towns its own places sit in — the way back across the two ladders. */
  within: string | null;
  known: number; owned: number; ready: number | null;
  picture: number | null; description: number | null; hours: number | null;
  website: number | null; menu: number | null; shelf: number | null;
};

export type FactDef = { key: string; label: string; short: string; explain: string };
export type BarFact = { fact: string; weight: number; required: boolean };

export type PlaceSubcategory = PlaceStats & {
  key: string; label: string; category: string;
  searches: number; empty: number;
  /** What this kind of place is judged on, so the row can say it in words. */
  needs: string[]; barSet: boolean;
};
export type PlaceCategory = PlaceStats & {
  key: string; label: string; searches: number; empty: number;
  subcategories: PlaceSubcategory[];
};

/** BO2c's other half: a provider's own word, and what it points at in ours. */
export type PlaceLabel = PlaceStats & { key: string; label: string; pointsAt: string | null };

export type PlaceSourceDef = {
  key: string; label: string; explain: string; optIn: boolean; paid: boolean;
  /** Whether this source has ever been asked anywhere. */
  asked: boolean;
  /** When it was last asked about a place *here*, which is what the column says. */
  askedHere?: string | null;
};
export type PlaceSourceRow = {
  key: string; label: string; known: number;
  /** `null` where that source has never been asked anywhere — different from nought. */
  counts: Record<string, number | null>;
  oneOnly: number; googleOnly: number;
};

export type PlaceQuality = {
  bands: { band: string; n: number }[];
  unscored: number;
  stale: { key: string; label: string; n: number }[];
  worth: {
    ref: string; name: string | null; subcategory: string | null; outcode: string | null;
    /** The name is the search term that found it, not the place's own (namesFor). */
    standIn?: boolean;
    sources: string[];
    /** A word, never a figure: the rating is banded at the call and the number dropped. */
    rating: string | null; been: string | null; score: number | null;
    /**
     * Why it is on this list: `claimed` means a household said it matters and
     * we hold nothing about it — the shortest route to something worth doing —
     * and `identified` means nobody has and we hold nothing either way.
     */
    ownership: string;
  }[];
};

export type DemandTotals = { searches: number; empty: number; noClick: number; noTrip: number; tripped?: number };
export type DemandRow = {
  subject: string | null; label: string; noSubject?: boolean;
  searches: number; empty: number; noClick: number; noTrip: number; known: number | null;
  fault: string; faultLabel: string; shortFault: string; owner: string | null; act: string | null;
};

export type PlaceRing = {
  rows: { key: string; label: string; known: number; owned: number; ready: number | null; avgScore: number | null; searches: number; nearest: number | null }[];
  ring: {
    cell: string; cellLabel: string | null; cellsInReach: number; cellsTotal: number;
    rowsRead: number; distancesComputed: number; spendPence: number;
    builtAt: string | null; estimated: boolean; edgeMinutes: number;
  };
};

export type PlaceRow = {
  ref: string; name: string | null; nameFrom: string | null;
  /** The name is the search term that found it, not the place's own (namesFor). */
  standIn?: boolean;
  category: string | null; subcategory: string | null; outcode: string | null;
  score: number | null; ready: boolean; ownership: string; oldestFact: string | null;
  /** `yes` held, `no` a hole, `n/a` not judged on it, `yes-uncounted` held but not counted. */
  facts: Record<string, 'yes' | 'no' | 'n/a' | 'yes-uncounted'>;
  missing: number; missingFacts: string[]; barSet: boolean;
  unseenBy: string[]; seenBy: string[];
};

export type PlaceField = {
  key: string; label: string; value: string | null; source: string | null; checked: string | null;
  /** What the column has no room for: it belongs in the row when it is opened. */
  note: string | null;
  /** The exact record and key this came from, printed when the row is opened. */
  reference: string | null;
  counted: boolean | null; notCounted: boolean; editable: boolean; action: string | null;
};

export type PlaceDetail = {
  ref: string; name: string | null; nameFrom: string | null; standIn?: boolean;
  category: string | null; subcategory: string | null; ownership: string;
  score: number | null; ready: boolean; scoreParts: Record<string, any>;
  oldestFact: string | null; seenBy: number; lat: number | null; lng: number | null; cell: string | null;
  have: number; missingCount: number;
  areas: { slug: string; name: string; kind: string }[];
  sources: { source: string; id: string | null; firstSeen: string; lastSeen: string }[];
  unseen: (PlaceSourceDef & { pence: number | null })[];
  unseenFree: number; unseenPaid: number;
  /**
   * What opening "Ours beside theirs" would actually spend, in pence.
   *
   * From the one price table, and counting the calls this place needs — a
   * match only where we hold no identifier. The button used to say £0.014,
   * which was the old figure and roughly a fifth of the real one.
   */
  comparePence: number;
  /** What asking Google about this one place would spend, in pence. */
  askPence: number;
  record: PlaceField[];
  facts: { field: string; source: string; value: unknown; licence: string; retention: string; fetchedAt: string; expiresAt: string | null }[];
  pictures: {
    id: string; source: string; licence: string | null; licenceUrl: string | null; creator: string | null;
    credit: string | null; title: string | null; page: string | null; width: number | null; height: number | null;
    bytes: number | null; fetchedAt: string | null; owned: boolean; role: string | null;
    /** Which place it is attached to, in words — the same column the Pictures board prints. */
    onPlace: string | null;
  }[];
  ids: { key: string; label: string; value: string | null; state: 'held' | 'not-asked' | 'no-match' | 'none' }[];
  atlas: { id: string; state: string; pinned: boolean; note: string | null; rank: number | null; scoreParts: Record<string, unknown> } | null;
};

export type CompareColumn = {
  key: string; label: string; note: string | null; id?: string | null; of?: number; filled?: number;
  /** held · not-asked · no-match · off — four different facts, never one dash. */
  state?: 'held' | 'not-asked' | 'no-match' | 'off';
};
export type CompareRow = {
  key: string; label?: string; keys: Record<string, string | null>; cells: Record<string, unknown>;
  /** Where our version came from, and when it was last checked. Per row. */
  from?: string | null;
  /** Ours, so editable — a provider's column never is. */
  editable?: boolean;
};
export type RawSource = {
  key: string; label: string; explain: string;
  /** matched: we hold their id and nothing else, which is what a rented source is. */
  state: 'held' | 'not-asked' | 'no-match' | 'matched'; id: string | null; lastSeen: string | null;
  /** Rented content is read live; ours is kept somewhere this tab does not read. */
  rented?: boolean;
  fields: { field: string; value: unknown; licence: string; retention: string; fetchedAt: string; expiresAt: string | null }[];
};
export type PlaceHistoryRow = { at: string; what: string; who: string | null; kind: 'edit' | 'call'; usd?: number };

export type PictureIndex = {
  /** How many match, as against how many were sent. */
  matching: number;
  pictures: {
    id: string; source: string; licence: string | null; licenceUrl: string | null;
    creator: string | null; creatorUrl: string | null; credit: string | null;
    title: string | null; caption: string | null; page: string | null;
    width: number | null; height: number | null; bytes: number | null; fetchedAt: string | null;
    /** What it is a picture of, in words — resolved, never `place:osm:123`. */
    onPlace: string | null; onRef: string | null; onKind: string | null;
    role: string | null; fromHousehold: boolean; attribution: boolean;
  }[];
  counts: { owned: number; household: number; needs_attribution: number; noPicture: number };
  facets: { key: string; label: string; n: number }[];
};

export type ReadyBars = {
  facts: FactDef[]; weights: Record<string, number>;
  subcategories: {
    key: string; label: string; category: string; categoryLabel: string;
    places: number; ready: number; set: boolean; facts: BarFact[];
  }[];
  britain: PlaceStats;
};
export type BarEffect = {
  places: number; readyNow: number; readyAfter: number;
  shareNow: number | null; shareAfter: number | null;
  stopBeingReady: number; startBeingReady: number; countiesMoved: number;
  britainNow: number | null; britainAfter: number | null; rescore: number;
};

export type Run = {
  key: string; label: string; explain: string; costs: string; free: boolean; action: string;
  state: 'running' | 'idle' | 'failures' | 'failed';
  where: string; cap: string; lastAt: string | null;
  progress?: number | null; startedAt?: string | null; error?: string | null;
  stranded?: { since: string; why: string } | null;
  spentPence?: number; tried?: number; read?: number; failed?: number; ours?: number;
  calls?: number; capLeft?: number; capOf?: number; done?: number; places?: number;
};
export type RunsList = {
  runs: Run[]; running: number; needsLooking: number;
  spentPence: number; calls: number; ceilingPence: number;
  tripadvisor: { left: number; of: number };
  stranded: { id: string; scope: string; stage: string; started_at: string; touched_at: string; counts: Record<string, unknown> }[];
};
export type RunFailures = {
  /**
   * Which run this is, and whether it keeps a failure list at all.
   *
   * Only the menu reader does. The board used to title itself "Read the menus"
   * whatever it had been opened for.
   */
  runKey?: string; label?: string; keepsAList?: boolean; why?: string | null;
  totals: { tried: number; read: number; failed: number; ours: number; last: string | null };
  ours: { key: string; label: string; n: number; examples: string[] }[];
  theirs: { key: string; label: string; detail: string; fix: string; n: number; examples: string[] }[];
};

export type DemandReport = {
  area: { slug: string; name: string; kind: string } | null;
  /** Set when a town has no cells of its own and is reading its county's figures. */
  figuresFrom: { slug: string; name: string; why: string } | null;
  since: number; totals: DemandTotals; rows: DemandRow[];
  log: {
    id: string; at: string; surface: string; subject: string | null; label: string;
    where: string | null; minutes: number | null; mode: string | null;
    shown: number; empty: boolean; opened: number; tripped: number; outcome: string;
    identified: boolean; asked: Record<string, unknown>;
  }[];
  replayPence: number;
};
export type SearchReplay = {
  id: string; at: string; surface: string; subject: string | null; subjectLabel: string | null; asked: Record<string, unknown>;
  where: string | null; minutes: number | null; mode: string | null;
  identified: boolean; heldAgainst: string;
  shown: number; opened: number; saved: number; tripped: boolean;
  sourcesQueried: string[]; degraded: string[];
  rows: {
    position: number; ref: string | null; name: string | null; subcategory: string | null;
    score: number | null; scoreThen: boolean; did: string; strong: boolean; dwellMs: number | null;
  }[];
  /**
   * What the replay actually asked for and what it cost.
   *
   * `asked` is how many were asked about, `refetched` how many came back with a
   * name, and `refetchedPence` what the ledger says it cost — read from the
   * calls actually made, so a cached answer is not billed and a call that came
   * back empty is not free.
   */
  refetched: number; askedAbout: number; refetchedPence: number;
  /** Rows that are still bare identifiers, and why they still are. */
  /** Rows with no name; `askable` is how many of those are a provider we can ask. */
  nameless: number; askable: number; namelessWhy: string | null;
  /** What asking for the missing names would cost, in pence, from the price table. */
  namelessPence: number;
  /** How many searches the area this one was in has had, for the way back. */
  searchesHere?: number | null;
};


export type ScoreWorkings = {
  ref: string; name: string | null;
  /**
   * The scale the contributions are on: the score times ten, which is the
   * figure the board prints above them. The score itself is 0–10.
   */
  outOf?: number;
  inputs: {
    key: string; label: string; value: unknown; kind: string; held: boolean;
    /** What this input contributed, in the same units the score is printed in. */
    worth: number;
    /** Whether we may keep it for good, or read it and drop it. */
    owned: boolean;
    how: string | null;
  }[];
  chainWeight: number;
  parts: {
    key: string; label: string; points: number | null;
    weightEpic: number | null; weightOwned: number | null;
    intoEpic: number; intoOwned: number; note?: string | null;
    each?: { key: string; points: number }[]; capped?: boolean;
  }[];
  chain: { scale: string; weight: number };
  epicScore: number; ownedScore: number; licensedInput: boolean;
  weights: Record<string, any>;
  stored: { epicScore: number | null; ownedScore: number | null; at: string | null };
  drifted: boolean; area: string | null;
};

export type RejectReason = { key: string; label: string; message: string | null };
export type QueueList = {
  /** `label` is the column word; `said` is the word a sentence uses. */
  kinds: { key: string; label: string; said?: string; batch: boolean }[];
  states: string[];
  counts: { kind: Record<string, number>; state: Record<string, number>; reported: number; oldest: string | null };
  state: string; kind: string; where: string | null;
  rows: {
    id: string; kind: string; subjectType: string; subjectId: string;
    maker: string | null; place: string | null; ref: string | null; area: string | null;
    state: string; reported: boolean; madeAt: string; reason: string | null; told: boolean; batchable: boolean;
    imageId: string | null;
    /** The first words of the thing being decided, so the row shows it (BO5a). */
    preview: string | null;
    /** For a flagged fact, which fact three sources disagree about. */
    field: string | null;
    /**
     * Every id this row stands for.
     *
     * Forty photographs of one beach are one decision and one row (BO5a,
     * "Coral Beach, 12 of them"). `of` is how many, `makers` is who made them.
     * Nothing a person wrote ever groups — a review is read on its own.
     */
    batch: string[]; of: number; makers: string[];
  }[];
};
export type QueueItem = {
  item: {
    id: string; kind: string; subjectType: string; subjectId: string;
    maker: string | null; place: string | null; ref: string | null; area: string | null;
    state: string; reported: boolean; reportReason: string | null; madeAt: string;
    /** Which version of the words this is — handed back when deciding, so nobody approves text they were not shown. */
    version?: string | null;
    reason: string | null; message: string | null; told: boolean;
  };
  detail: Record<string, any> | null;
  picture: { id: string; imageId: string; sig?: string; exp?: number; title: string | null; caption: string | null; licence: string | null; credit_line: string | null; width: number | null; height: number | null; bytes: number | null; fetched_at: string; moderation: string; reward_points: number; creator: string | null } | null;
  made: { name: string; kept: number; points: number } | null;
  /** Whether anything has looked for a face in it. "not looked for" is an answer. */
  faces: string;
  reasons: RejectReason[];
  batchable: boolean;
};

export const api = {
  health: () => request<{ ok: boolean; db: string }>('/health'),
  sources: () => request<SourcesStatus>('/api/sources'),
  setSourceOn: (key: string, on: boolean) => patch<{ key: string; on: boolean; off: string[] }>(`/api/sources/${key}`, { on }),

  // household
  household: () => request<HouseholdResponse>('/api/household'),
  updateHousehold: (body: Partial<Pick<Household, 'name' | 'defaultVisitMinutes' | 'maxTravelMinutes' | 'defaultIntensity' | 'travelMode'>> & { home?: Place; homeText?: string; homeRadiusMiles?: number; homePhotoUrl?: string | null; pace?: { food?: Partial<PaceKind>; activity?: Partial<PaceKind> }; timezone?: string; browse?: BrowseDefaultsPatch }) =>
    patch<{ household: Household }>('/api/household', body),
  addMember: (body: { name: string; relationship?: string | null; birthYear?: number | null; birthDate?: string | null; avatarUrl?: string | null; email?: string | null; mobile?: string | null }) => post<{ member: any }>('/api/household/members', body),

  /**
   * Give somebody already in this household a way in to it, and send it to them
   * (owner, 6 Sep 2026). One link however many channels it goes out by, because
   * a link is spent the first time it is opened.
   *
   * Not the admin module's invitation: that gives a friend a household of their
   * own, this puts a person into the one they already live in.
   */
  inviteMember: (id: string, body: { email?: string | null; mobile?: string | null; channels?: ('sms' | 'email')[] }) =>
    post<{ member: { id: string; name: string }; access: MemberAccess; invitation: HouseholdInvitation }>(`/api/household/members/${id}/invite`, body),

  /** Take the sign-in away and leave the person, their tastes and their ratings. */
  removeMemberAccess: (id: string) => del<{ removed: boolean; access: MemberAccess; message: string }>(`/api/household/members/${id}/invite`),
  updateMember: (id: string, body: { name?: string; relationship?: string | null; birthYear?: number | null; birthDate?: string | null; avatarUrl?: string | null; typicalVisitMinutes?: number; maxTravelMinutes?: number; email?: string | null; mobile?: string | null }) =>
    patch<{ member: any }>(`/api/household/members/${id}`, body),
  deleteMember: (id: string) => del<void>(`/api/household/members/${id}`),
  addConstraint: (memberId: string, body: { kind: ConstraintKind; value: string; conceptKey?: string; maxMinutes?: number | null }) =>
    post<{ constraint: Constraint; resolved: { key: string; label: string; kind: string } | null; suggestions: Suggestion[]; hint: string | null; limited?: boolean }>(`/api/household/members/${memberId}/constraints`, body),
  updateConstraint: (id: string, body: { maxMinutes?: number | null; favourite?: boolean }) => patch<{ constraint: any }>(`/api/household/constraints/${id}`, body),
  deleteConstraint: (id: string) => del<void>(`/api/household/constraints/${id}`),
  learned: () => request<{ learned: Learned[]; threshold: number }>('/api/household/learned'),
  exportUrl: () => `${API_URL}/api/household/export`,

  /**
   * Everything the household has generated, as a file.
   *
   * Fetched rather than opened in a tab: the export is behind the door now, and
   * a new tab carries no session header. So it comes down through the same
   * request path as everything else and is handed to the browser as a download.
   */
  downloadExport: async (): Promise<void> => {
    const token = sessionToken();
    const res = await fetch(`${API_URL}/api/household/export`, {
      credentials: 'include',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
    const blob = await res.blob();
    if (typeof document === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `epic-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  spendSeries: (months = 12) => request<SpendSeries>(`/api/household/spend/series${qs({ months })}`),
  spend: (p: { period: SpendPeriod; from?: string; to?: string }) => request<SpendResponse>(`/api/household/spend${qs(p)}`),
  deleteHousehold: (confirmName: string) => del<{ deleted: boolean }>('/api/household', { confirmName }),

  // prototypes (the owner's design review: approved, rejected, archived)
  prototypeReviews: () => request<{ reviews: Record<string, { status: PrototypeStatus; note: string | null; updatedAt: string | null }> }>('/api/prototypes'),
  reviewPrototype: (file: string, status: PrototypeStatus, note?: string | null) =>
    put<{ review: { file: string; status: PrototypeStatus; note: string | null; updatedAt: string | null } }>(`/api/prototypes/${encodeURIComponent(file)}`, { status, note }),

  // vocabulary
  browse: () => request<{ food: { title: string; hint: string; items: { key: string; label: string; children: { key: string; label: string }[] }[] }[]; activities: { title: string; hint: string; items: { key: string; label: string; children: { key: string; label: string }[] }[] }[]; diets: { key: string; label: string }[] }>('/api/concepts/browse'),
  suggest: (q: string, kinds?: string[], limit = 8) =>
    request<{ suggestions: Suggestion[] }>(`/api/concepts/suggest${qs({ q, kinds: kinds?.join(','), limit })}`),

  // menu, order and stars (the table half of an evening, owner 4 Sep 2026)
  /** What we already hold for this place — and, when we hold nothing, where their menu is. */
  heldMenu: (venueRef: string, website?: string | null) => request<{ menu: ReadMenu | null; link: MenuLink | null }>(`/api/menu${qs({ ref: venueRef, website: website ?? undefined })}`),
  /** Which of the four openers this deployment has: a browser makes a JavaScript menu readable for nothing. */
  menuOpeners: () => request<MenuOpeners>('/api/menu/openers'),
  /** Read their menu now. Slow on purpose: it fetches, may render, and reads. */
  readMenu: (body: { ref: string; url?: string; label?: string; website?: string }) => post<{ menu: ReadMenu }>('/api/menu/read', body),
  /** "What's this?" — written once for a dish and kept, so asking twice is free. */
  dishNote: (name: string, hint?: string) => post<{ dish: DishNote; cached: boolean }>('/api/menu/dish', { name, hint }),
  /** What we ate here before: the orders that became visits, with their stars. */
  orderHistory: (venueRef: string) => request<{ orders: (Order & { visitedOn: string | null })[] }>(`/api/orders/history${qs({ ref: venueRef })}`),
  order: (venueRef: string) => request<{ order: Order | null }>(`/api/orders${qs({ ref: venueRef })}`),
  saveOrder: (body: {
    clientId?: string; ref: string; label?: string; menuId?: string | null;
    guests?: { ref: string; name: string }[];
    items: { menuItemId?: string | null; memberId: string | null; guestRef?: string | null; name: string; priceText?: string | null; note?: string | null }[];
  }) => post<{ order: Order }>('/api/orders', body),
  /** The order behind a scanned code. Answered without a session, on purpose. */
  orderTicket: (token: string) => request<OrderTicket>(`/api/order/${encodeURIComponent(token)}`),
  /** Throw away an order in progress (one that has not become a visit). */
  clearOrder: (id: string) => del<{ deleted: boolean }>(`/api/orders/${id}`),
  orderEaten: (id: string, body: { visitedOn?: string; attendeeIds?: string[] } = {}) => post<{ order: Order; visitId: string }>(`/api/orders/${id}/eaten`, body),
  rateOrder: (id: string, ratings: { orderItemId: string; memberId?: string | null; score?: number | null; notGreat?: boolean; comment?: string | null; conceptKey?: string | null }[]) =>
    post<{ order: Order }>(`/api/orders/${id}/ratings`, { ratings }),

  // places & visits
  /**
   * `bias.near` keeps matches inside that area first (a trip's city); `bias.country` never leaves
   * that country. `bias.kind: 'area'` asks a different index altogether — cities, towns and regions
   * matching a prefix, never a street or a shop — and is cheap enough to run on every keystroke.
   */
  geocode: (q: string, limit = 6, bias?: { near?: Place | null; country?: string | null; kind?: 'lodging' | 'area' | null }) =>
    request<{ results: Place[]; home?: { code: string; name: string | null }; attribution: string }>(`/api/places/geocode${qs({ q, limit, near: bias?.near ? `${bias.near.lat},${bias.near.lng}` : undefined, country: bias?.country ?? undefined, kind: bias?.kind ?? undefined })}`),
  /** Coordinates from the device → the address they sit at. Nothing is stored; the household asked for this one. */
  where: (lat: number, lng: number) => request<{ place: Place; named: boolean; attribution: string }>(`/api/places/where${qs({ at: `${lat},${lng}` })}`),
  /**
   * Somewhere to stay, ranked by how much of the shortlist is on foot from the
   * front door. Open map only — no prices, no availability (those need a
   * booking provider with a key, which is the owner's to add).
   */
  tripStays: (tripId: string, p: { radiusKm?: number; mode?: 'walking' | 'driving'; rooms?: number; adults?: number; children?: string; placement?: StayPlacement; maxAvgMin?: number; maxWalkMin?: number; maxTrainMin?: number; townMin?: number; budgetMin?: number; budgetMax?: number; types?: string; must?: string; nice?: string; townAt?: string } = {}) =>
    request<{
      near: { lat: number; lng: number; label: string };
      radiusKm: number; mode: 'walking' | 'driving'; cached: boolean; attribution: string; attributions: string[];
      anchors: { label: string; lat: number; lng: number }[];
      placement: StayPlacement;
      /** Set when the planned days are so far apart that no one of them is worth being near. */
      spread: { minutes: number; between: [string, string]; places: string[] } | null;
      /**
       * What was asked for, echoed back. `mustUnanswered` names the must-haves
       * nobody around here has mapped — the screen says so rather than
       * pretending it narrowed the list on them.
       */
      criteria: {
        maxAvgMin: number; townMin: number; maxTrainMin: number; maxWalkMin: number;
        budget: [number, number | null]; types: string[]; must: string[]; nice: string[];
        mustUnanswered: string[];
      };
      results: Stay[];
      pricing: StayPricing;
    }>(`/api/trips/${tripId}/stays${qs(p)}`),

  /**
   * This is where we're staying. Not a plain base update: a licensed bed is
   * looked for in the open map first, so what the trip keeps is a place we may
   * keep rather than a provider's record (api/routes/trips.js).
   */
  /** Which keys this process can see, and which Doppler config fed it. Owner only; 404 to anybody else. */
  keys: () => request<KeyReport>('/api/keys'),

  setTripStay: (tripId: string, b: { venueRef: string; label: string; lat: number; lng: number; checkIn?: string; checkOut?: string }) =>
    post<TripDetail & { stay: { named: 'open' | 'household'; how: string | null } }>(`/api/trips/${tripId}/stay`, b),

  /** `sources` is the exact set of sources for this one search (e.g. 'osm,tripadvisor'); omitted = the default set, which never includes opt-in sources. */
  /**
   * `shows` is how many of the answer this screen will actually draw.
   *
   * The answer carries everything in range and each screen draws as much as it
   * has room for — forty on Places, six on the photo one. The search log needs
   * the drawn number, or the replay claims the household saw rows that were
   * never on their screen (Codex, 18 Sep 2026).
   */
  searchPlaces: (p: { q?: string; near?: string; categories?: string; radiusKm?: number; sources?: string; shows?: number }) =>
    request<{ queryId: string | null; near: Place & { how: string }; radiusKm: number; results: Venue[]; sourcesQueried: string[]; degradedSources: { source: string; error: string }[]; attribution: string[] }>(`/api/places/search${qs(p)}`),
  place: (venueRef: string) =>
    request<{ venueRef: string; venue: Venue | null; household: Venue['household']; visits: Visit[]; menu?: MenuLink | null; ours?: OwnedRecord | null;
      /** Why the source could not answer, already in plain words — never a provider's error text (api/src/sources/why.js). */
      sourceError?: string | null;
      /** Opening it started the research that had not been done. The drawer comes back for the answer. */
      researching?: boolean }>(`/api/places/detail${qs({ ref: venueRef })}`),
  /** What Epic owns about these places — no provider is called, and this answer keeps. */
  /**
   * What the crowd made of an atlas place. Matched to Google once and then
   * read; nothing it returns is stored, here or on the device.
   */
  /**
   * The crowd's number for a listful of places. Only what a card draws — the
   * rating and the count — so it buys the cheap field mask, not the full detail.
   */
  placeRatings: (rows: { ref: string; name: string; lat: number; lng: number }[]) =>
    request<{
      ratings: Record<string, { rating: number | null; ratingCount: number | null }>;
      /** Why the answer is short, in plain words, when the source refused. Never a provider's error text. */
      sourceError?: string | null;
    }>(
      `/api/places/ratings${qs({
        refs: rows.map((r) => r.ref).join(','),
        names: rows.map((r) => r.name).join('|'),
        points: rows.map((r) => `${r.lat},${r.lng}`).join('|'),
      })}`),
  placeReviews: (q: { ref: string; name: string; lat: number; lng: number }) =>
    request<{ rating: number | null; ratingCount: number | null; reviews: { text: string; rating: number | null; author: string | null; authorUri: string | null; when: string | null }[]; attribution: string | null; matched: boolean }>(`/api/places/reviews${qs(q)}`),
  placeRecords: (venueRefs: string[]) => request<{ records: Record<string, OwnedRecord>; missing: string[] }>(`/api/places/record${qs({ refs: venueRefs.join(',') })}`),
  /** Research a place again now (Settings, and "look again" in the drawer). */
  researchPlace: (venueRef: string) => post<{ state: string; fields: number; matched: Record<string, any>; problems: string[]; record: OwnedRecord | null }>('/api/places/record', { ref: venueRef }),
  savePlace: (venueRef: string, status: 'saved' | 'dismissed' | 'special' = 'saved', context?: { label?: string; venue?: Partial<Venue>; category?: string | null; lat?: number; lng?: number; note?: string; country?: string | null; countryCode?: string | null; locality?: string | null }) =>
    post<{ venueRef: string; status: string; filed?: PhotoFiled | null }>('/api/places/save', { ref: venueRef, status, ...(context ?? {}) }),
  /** Predictions as you type: one cheap call, nothing fetched until one is chosen. */
  suggestPlaces: (p: { q: string; near?: string; radiusKm?: number; session?: string; kind?: string }) =>
    request<{ suggestions: { placeId: string | null; venueRef: string; name: string; where: string | null; kind: string | null; mine: boolean; types: string[] }[] }>(`/api/places/suggest${qs(p)}`),
  /** Take a place out of the atlas. Somewhere you've been is kept — delete the visit first. */
  deleteAtlasPlace: (venueRef: string) => del<void>('/api/atlas/places', { venueRef }),
  /** A place the atlas held only by its identifier learns its name once the source has been asked. */
  nameAtlasPlace: (venueRef: string, label: string) => patch<{ venueRef: string; label: string }>('/api/atlas/places', { venueRef, label }),
  createAtlasCity: (body: { placeText?: string; place?: Place }) => post<{ city: { name: string; country: string; countryCode: string; lat: number; lng: number } }>('/api/atlas/cities', body),
  deleteAtlasCity: (countryCode: string, locality: string) => del<void>('/api/atlas/cities', { countryCode, locality }),
  createVisit: (body: Omit<Partial<Visit>, 'takes'> & { venueRef: string; venueLabel: string; attendeeIds?: string[]; takes?: VisitTakeInput[]; clientId?: string; venue?: Partial<Venue> }) =>
    post<{ visit: Visit; deduplicated?: boolean; filed?: PhotoFiled | null }>('/api/visits', body),
  visits: (p: { country?: string; q?: string; memberId?: string; take?: Take } = {}) =>
    request<{ visits: Visit[]; countries: { code: string; name: string; visits: number }[] }>(`/api/visits${qs(p)}`),
  visit: (id: string) => request<{ visit: Visit }>(`/api/visits/${id}`),
  updateVisit: (id: string, body: { note?: string; visitedOn?: string; venueLabel?: string }) => patch<{ visit: Visit }>(`/api/visits/${id}`, body),
  setTakes: (id: string, takes: VisitTakeInput[], venue?: Partial<Venue>) => put<{ visit: Visit }>(`/api/visits/${id}/takes`, { takes, venue }),
  deleteVisit: (id: string) => del<void>(`/api/visits/${id}`),

  // group trips
  tripGroup: (tripId: string) => request<TripGroup | { group: null }>(`/api/trips/${tripId}/group`),
  /** The household's own groups: what "Your groups" offers again and what the Who filter lists. */
  groups: () => request<{ groups: GroupSummary[] }>('/api/groups'),
  createTripGroup: (tripId: string, body: { name?: string; expectedCount?: number | null; minimumCount?: number | null; wantedBy?: string | null; cadence?: string; organiserMemberId?: string | null; copyFromGroupId?: string }) => post<TripGroup>(`/api/trips/${tripId}/group`, body),
  updateGroup: (id: string, body: Partial<{
    name: string; expectedCount: number | null; minimumCount: number | null; maximumCount: number | null;
    wantedBy: string | null; remindersOn: boolean; cadence: string; closed: boolean; newLink: boolean;
    setupDone: boolean; firstReminderOn: string | null; paymentMode: 'direct' | 'epic';
    coverKind: 'banner' | 'full'; coverUrl: string | null; coverSource: string | null;
    inviteTitle: string; inviteSummary: string; howItWorks: string[];
  }>) => patch<TripGroup>(`/api/groups/${id}`, body),
  deleteGroup: (id: string) => del<{ deleted: boolean }>(`/api/groups/${id}`),
  addGroupItem: (id: string, body: GroupItemInput) => post<TripGroup>(`/api/groups/${id}/items`, body),
  updateGroupItem: (id: string, itemId: string, body: Partial<GroupItemInput & { position: number; state: GroupItemState2 }>) => patch<TripGroup>(`/api/groups/${id}/items/${itemId}`, body),
  /** The closing day, by hand: close it and bill, give it longer, call it off, or undo. */
  closeGroupItem: (id: string, itemId: string, body: { action: 'close' | 'extend' | 'cancel' | 'reopen'; closesOn?: string; note?: string; anyway?: boolean }) =>
    post<TripGroup>(`/api/groups/${id}/items/${itemId}/close`, body),
  removeGroupItem: (id: string, itemId: string) => del<TripGroup>(`/api/groups/${id}/items/${itemId}`),
  addGroupParticipant: (id: string, body: { name: string; contact?: string; contactKind?: string; heads?: number; brings?: string; note?: string }) => post<TripGroup>(`/api/groups/${id}/participants`, body),
  updateGroupParticipant: (id: string, pid: string, body: Partial<{ name: string; contact: string; contactKind: string; heads: number; brings: string; note: string; withdrawn: boolean; withdrawnNote: string }>) => patch<TripGroup>(`/api/groups/${id}/participants/${pid}`, body),
  removeGroupParticipant: (id: string, pid: string) => del<TripGroup>(`/api/groups/${id}/participants/${pid}`),
  markGroupItem: (id: string, pid: string, itemId: string, body: { status: GroupStatus | 'clear'; bookingRef?: string | null; whereBooked?: string | null; startsOn?: string | null; endsOn?: string | null; note?: string | null }) =>
    post<TripGroup>(`/api/groups/${id}/participants/${pid}/items/${itemId}`, body),
  chaseGroup: (id: string, body: { participantIds?: string[]; itemId?: string } = {}) => post<TripGroup>(`/api/groups/${id}/reminders`, body),

  // the invite link's side: no household, no roster
  joinView: (token: string, participantToken?: string | null) => request<JoinView>(`/api/join/${token}${participantToken ? `?p=${encodeURIComponent(participantToken)}` : ''}`),
  join: (token: string, body: { name: string; contact?: string; contactKind?: string; heads?: number; brings?: string; matchId?: string | null }) => post<JoinView & { participantToken: string }>(`/api/join/${token}`, body),
  /** Joining properly: an account of their own, a household of their own, 30 days of the app. */
  joinAccount: (token: string, body: { name: string; contact: string; matchId?: string | null }) =>
    post<JoinView & {
      participantToken: string;
      /** Null when the address already has an Epic: joining does not prove it is theirs. */
      sessionToken: string | null;
      signInRequired?: boolean;
      message?: string;
      account: GuestAccount | null;
    }>(`/api/join/${token}/account`, body),
  joinHousehold: (token: string, body: { participantToken: string; members: HouseholdMemberInput[] }) =>
    post<JoinView>(`/api/join/${token}/household`, body),
  /** Book your itinerary, confirmed: the picks go up, the money comes back worked out. */
  joinBook: (token: string, body: { participantToken: string; picks: Record<string, 'in' | 'out' | 'booked' | 'declared' | null> }) =>
    post<JoinView & { booking: GroupBooking }>(`/api/join/${token}/book`, body),
  setJoinItem: (token: string, itemId: string, body: { participantToken: string; status: 'booked' | 'declared' | 'in' | 'out' | 'clear'; bookingRef?: string | null; whereBooked?: string | null; startsOn?: string | null; endsOn?: string | null; note?: string | null }) =>
    post<JoinView>(`/api/join/${token}/items/${itemId}`, body),

  // trips
  trips: (p: { country?: string; when?: 'upcoming' | 'past'; q?: string; kind?: TripKind } = {}) =>
    request<{ trips: TripSummary[]; countries: { code: string; name: string; trips: number }[] }>(`/api/trips${qs(p)}`),
  // atlas
  atlas: () => request<{ countries: AtlasCountry[]; unplaced: number; home: AtlasHome | null }>('/api/atlas'),
  atlasPlaces: (p: { country?: string; city?: string; kind?: string; status?: string; q?: string; nearHome?: boolean } = {}) => request<{ places: AtlasPlace[]; wherePending?: number }>(`/api/atlas/places${qs(p)}`),
  /** The country, the areas and the ground a search covers. Answers from what the API holds, so it never delays a search. */
  atlasSketch: (p: { lat: number; lng: number; radiusKm?: number; country?: string }) => request<SketchMap>(`/api/atlas/sketch${qs(p)}`),
  // trips v2
  createMultiDayTrip: (body: { title?: string; notes?: string; place?: Place; placeText?: string; startDate: string; endDate: string; base?: Place; baseText?: string; baseKind?: string; checkIn?: string; checkOut?: string; hasCar?: boolean; travelMode?: Trip['travelMode']; intensity?: Trip['intensity']; dayStart?: string; dayEnd?: string; attendingMemberIds?: string[]; seedFromAtlas?: boolean }) =>
    post<TripDetail>('/api/trips', { kind: 'trip', ...body }),
  updateTripV2: (id: string, body: Partial<{ title: string; notes: string; startDate: string; endDate: string; hasCar: boolean; travelMode: Trip['travelMode']; intensity: Trip['intensity']; dayStart: string; dayEnd: string; base: Place; baseText: string; baseKind: string; checkIn: string; checkOut: string; sources: string[] | null }>) => patch<TripDetail>(`/api/trips/${id}`, body),
  updateDay: (tripId: string, dayId: string, body: Partial<{ intensity: Trip['intensity']; travelMode: Trip['travelMode']; startTime: string; endTime: string; notes: string; startPoint: Endpoint | Place | null; endPoint: Endpoint | Place | null }>) => patch<TripDetail>(`/api/trips/${tripId}/days/${dayId}`, body),
  shortlistSearch: (tripId: string, p: SearchParams) => request<SearchAnswer>(`/api/trips/${tripId}/shortlist/search${qs(p)}`),

  /**
   * The same search, said out loud while it runs, so the map drawn over the
   * wait (SearchSketch) can show what has really happened rather than a clock.
   *
   * Server-sent events. Where they are not available — native, or a proxy that
   * will not stream — this falls back to the plain route and the map simply has
   * less to say. A stream that breaks falls back too: the search matters, the
   * commentary does not.
   */
  shortlistSearchStream: async (tripId: string, p: SearchParams, onEvent: (e: SketchEvent) => void): Promise<SearchAnswer> => {
    if (typeof EventSource === 'undefined') return api.shortlistSearch(tripId, p);
    try {
      return await new Promise<SearchAnswer>((resolve, reject) => {
        // `withCredentials` is what carries the session cookie, and the stream
        // is one of only two GETs the API accepts a cookie for (api/src/auth.js)
        // — an EventSource cannot send a header. Deployed, the web app and the
        // API are two origins, so without this every search would 401 on the
        // stream and fall back to the plain request with no map drawn.
        const es = new EventSource(`${API_URL}/api/trips/${tripId}/shortlist/search/stream${qs(p)}`, { withCredentials: true });
        const stop = () => { try { es.close(); } catch { /* already gone */ } };
        // Every event the API can send. A name missing from this list is an
        // event delivered and silently dropped, which looks exactly like a
        // stream that never arrived.
        for (const name of ['asking', 'answered', 'failed', 'cached', 'joining', 'waiting']) {
          es.addEventListener(name, (e) => { try { onEvent(JSON.parse((e as MessageEvent).data)); } catch { /* one unreadable line is not the search */ } });
        }
        es.addEventListener('done', (e) => { stop(); resolve(JSON.parse((e as MessageEvent).data)); });
        es.addEventListener('fault', (e) => { stop(); const b = JSON.parse((e as MessageEvent).data); reject(new ApiError(b.status ?? 500, b)); });
        // The browser reopens a closed stream by itself, which would run the
        // whole search a second time. Closing here is what stops that.
        es.onerror = () => { stop(); reject(new Error('stream closed')); };
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      return api.shortlistSearch(tripId, p);
    }
  },
  /**
   * `queryId` is which search found it, kept with the item so that placing it
   * into a day later — often on another visit — can be counted against that
   * search (migration 177).
   */
  addToShortlist: (tripId: string, body: { venueRef: string; venueLabel: string; kind?: string; category?: string | null; lat?: number | null; lng?: number | null; venue?: Partial<Venue>; note?: string; mustDo?: boolean; preferredDayId?: string | null; queryId?: string | null }) => post<TripDetail>(`/api/trips/${tripId}/shortlist`, body),
  updateShortlist: (tripId: string, itemId: string, body: { note?: string; mustDo?: boolean; preferredDayId?: string | null; kind?: string; status?: ShortlistStatus; bookedTime?: string | null; partySize?: string | null; bookingRef?: string | null; statusNote?: string | null; statusOn?: string | null; dwellMinutes?: number | null; legMode?: LegMode | '' | null; dayId?: string | null }) => patch<TripDetail>(`/api/trips/${tripId}/shortlist/${itemId}`, body),
  reorderShortlist: (tripId: string, itemIds: string[]) => post<TripDetail>(`/api/trips/${tripId}/shortlist/reorder`, { itemIds }),
  journey: (tripId: string, p: { dayId?: string; source?: 'shortlist' | 'day' } = {}) => request<Journey>(`/api/trips/${tripId}/journey${qs(p)}`),
  saveJourney: (tripId: string, dayId: string, force = false) => post<{ saved: number; dayId: string; trip: TripDetail }>(`/api/trips/${tripId}/journey/save`, { dayId, force }),
  directions: (tripId: string, p: { from: string; to: string; mode: LegMode; departAt?: string }) => request<Directions>(`/api/trips/${tripId}/directions${qs(p)}`),
  removeFromShortlist: (tripId: string, itemId: string) => del<TripDetail>(`/api/trips/${tripId}/shortlist/${itemId}`),
  addDayStop: (tripId: string, dayId: string, body: { venueRef?: string; name?: string; lat?: number | null; lng?: number | null; category?: string | null; dwellMinutes?: number; slot?: 'morning' | 'afternoon' | 'evening'; startTime?: string; shortlistId?: string }) => post<TripDetail>(`/api/trips/${tripId}/days/${dayId}/stops`, body),
  updateStop: (tripId: string, stopId: string, body: { dayId?: string; slot?: 'morning' | 'afternoon' | 'evening'; startTime?: string; dwellMinutes?: number; position?: number }) => patch<TripDetail>(`/api/trips/${tripId}/stops/${stopId}`, body),
  planDay: (tripId: string, dayId: string, body: { minActivities?: number; minFood?: number } = {}) => post<PlanResponse>('/api/plan/day', { tripId, dayId, ...body }),
  trip: (id: string) => request<TripDetail>(`/api/trips/${id}`),
  tripPlaces: (id: string) => request<{ places: TripPlace[]; counts: { all: number; do: number; eat: number; stay: number } }>(`/api/trips/${id}/places`),
  /** Everywhere you could stop along the way. Nothing is routed: see TripAlongPlace. */
  tripAlong: (id: string, p: { kind: 'food' | 'things'; maxDetourMin?: number; around?: string; aroundName?: string; q?: string }) =>
    request<{ queryId?: string | null; origin: Place; destination: Place | null; mode: string; kind: string; maxDetourMin: number; hasRoute: boolean; around: { lat: number; lng: number; label: string | null } | null; moods?: { key: string; label: string }[]; places: TripAlongPlace[]; counts: { route: number }; beyond: number; corridorKm: number | null; estimated: boolean; degradedSources: { source: string; error: string }[] }>(`/api/trips/${id}/along${qs(p as any)}`),
  /** Who is coming. Tickets, table sizes and the car all follow this (handoff §12). */
  setTripAttendees: (tripId: string, memberIds: string[]) => put<TripDetail>(`/api/trips/${tripId}/attendees`, { memberIds }),
  /**
   * `shortlistId` where the place is already on the shortlist: the item knows
   * which search found it, and that is how the placement is counted against
   * that search (migration 177).
   */
  addStopToDay: (tripId: string, dayId: string, body: { venueRef: string; name: string; lat?: number | null; lng?: number | null; category?: string | null; startTime?: string | null; slot?: string; dwellMinutes?: number; shortlistId?: string }) =>
    post<TripDetail>(`/api/trips/${tripId}/days/${dayId}/stops`, body),
  createTrip: (body: { title?: string; notes?: string; origin?: Place; originText?: string; destination?: Place; destinationText?: string; departAt: string; returnAt: string; travelMode?: Trip['travelMode']; intensity?: Trip['intensity']; attendingMemberIds?: string[] }) =>
    post<TripDetail>('/api/trips', body),
  updateTrip: (id: string, body: Partial<Pick<Trip, 'title' | 'notes' | 'departAt' | 'returnAt' | 'travelMode' | 'intensity'>>) => patch<TripDetail>(`/api/trips/${id}`, body),
  deleteTrip: (id: string) => del<void>(`/api/trips/${id}`),

  // --- the trip rebuild (7 Sep 2026) ----------------------------------------

  /** "Where are you going?" — countries first, then cities and towns (3a). */
  searchTrips: (q: string, country?: string | null) =>
    request<TripSearchAnswer>(`/api/trips/search${qs({ q, country: country ?? undefined })}`),

  /** The picture at the top of the create screen: ours, from the library, never a provider's. */
  tripPicture: (p: { venueRef?: string | null; country?: string | null; locality?: string | null }) =>
    request<{ image: OwnedImage | null }>(`/api/trips/picture${qs(p as any)}`),

  /** How long it takes to get there from home — Epic's own arithmetic, no route bought. */
  fromHome: (p: { lat: number; lng: number; mode?: Trip['travelMode'] }) =>
    request<{ minutes: number | null; estimated: boolean; home: string | null; mode?: string }>(`/api/trips/from-home${qs(p as any)}`),

  /**
   * The create screen's one call (5a/5b). It never says which kind of trip this
   * is: one date is a day out, a range is a holiday, and the API infers it.
   */
  createTripV3: (body: {
    kind: 'day' | 'holiday';
    title?: string;
    /** A day out: the date, when they want to arrive, and how long to allow. */
    date?: string; arriveAt?: string; allowMinutes?: number;
    /** A holiday: the range. */
    startDate?: string; endDate?: string;
    place?: Place; placeText?: string;
    destination?: Place & { ref?: string }; destinationText?: string;
    base?: Place; baseText?: string; baseKind?: string;
    attendingMemberIds?: string[];
    travelMode?: Trip['travelMode'];
    /** False saves it as an idea: the dates are a placeholder, and the row says "Date not fixed". */
    datesFixed?: boolean;
  }) => post<TripDetail>('/api/trips', body),

  /** The ⋯ menu's two: "Move to Holidays", and marking a trip an idea. */
  setTripFlags: (id: string, body: { datesFixed?: boolean; kind?: 'day' | 'holiday' }) => patch<TripDetail>(`/api/trips/${id}`, body),

  // getting there
  tripTravel: (id: string) => request<TripTravel>(`/api/trips/${id}/travel`),
  saveTravelLeg: (id: string, direction: 'outbound' | 'return', body: {
    mode: TravelMode2; onDate?: string | null; fromCode?: string | null; fromLabel?: string | null;
    toCode?: string | null; toLabel?: string | null; departAt?: string | null; arriveAt?: string | null;
    carrier?: string | null; serviceNo?: string | null; terminal?: string | null; bookingRef?: string | null;
    accessMinutes?: number | null; note?: string | null;
  }) => put<TripTravel>(`/api/trips/${id}/travel/legs/${direction}`, body),
  deleteTravelLeg: (id: string, legId: string) => del<TripTravel>(`/api/trips/${id}/travel/legs/${legId}`),
  lookupFlight: (id: string, no: string, p: { from?: string; to?: string } = {}) =>
    request<FlightLookup>(`/api/trips/${id}/travel/flight${qs({ no, ...p })}`),
  searchTerminals: (id: string, q: string, kind: 'airport' | 'station' | 'port' = 'airport') =>
    request<{ terminals: Terminal[] }>(`/api/trips/${id}/travel/terminals${qs({ q, kind })}`),
  refreshTransfers: (id: string) => post<TripTravel>(`/api/trips/${id}/travel/transfers/refresh`, {}),
  /** The journey Epic can work out for itself: home → where you are going, by train or by road. */
  suggestJourney: (id: string, mode: 'train' | 'drive') =>
    request<{
      ok: boolean; message?: string; mode?: 'train' | 'drive'; minutes?: number;
      legs?: { mode: string; minutes: number; text: string; transit: { line: string | null; agency: string | null; vehicle: string | null; from: string | null; to: string | null; departs: string | null; arrives: string | null; headsign: string | null; stopCount: number | null } | null }[];
      changes?: number; from?: string | null; to?: string | null; departAt?: string | null; arriveAt?: string | null;
      carrier?: string | null; serviceNo?: string | null; says?: string;
    }>(`/api/trips/${id}/travel/suggest${qs({ mode })}`),
  /** Pick one, or tap the chosen one again to take it back off the plan. */
  chooseTransfer: (id: string, mode: TransferMode | null) => post<TripTravel>(`/api/trips/${id}/travel/transfer`, { mode }),

  // the conversation
  // --- the chat module: one component, two contexts -------------------------
  /** The list (D3). `type` is `trip` or `offer`; `id` the trip's or the offer's. */
  chat: (type: ChatContextType, id: string) => request<ChatList>(`/api/chat/${type}/${id}`),
  chatRead: (type: ChatContextType, id: string) => post<{ unread: number }>(`/api/chat/${type}/${id}/read`, {}),
  chatTopic: (type: ChatContextType, id: string, topicId: string) => request<ChatTopicView>(`/api/chat/${type}/${id}/topics/${topicId}`),
  chatAsk: (type: ChatContextType, id: string, body: ChatAskBody) => post<ChatTopicView>(`/api/chat/${type}/${id}/topics`, body),
  chatEdit: (type: ChatContextType, id: string, topicId: string, body: Partial<ChatAskBody> & { pinned?: boolean }) => patch<ChatTopicView>(`/api/chat/${type}/${id}/topics/${topicId}`, body),
  chatReply: (type: ChatContextType, id: string, topicId: string, body: { body: string; quotesReplyId?: string | null; publishRequest?: 'faq' | 'group' | null }) =>
    post<ChatTopicView>(`/api/chat/${type}/${id}/topics/${topicId}/replies`, body),
  chatAnswer: (type: ChatContextType, id: string, topicId: string, body: { replyId: string | null; publish?: 'faq' | null }) => post<ChatTopicView>(`/api/chat/${type}/${id}/topics/${topicId}/answer`, body),
  chatFollow: (type: ChatContextType, id: string, topicId: string, on: boolean) =>
    (on ? post<{ following: boolean }>(`/api/chat/${type}/${id}/topics/${topicId}/follow`, {}) : del<{ following: boolean }>(`/api/chat/${type}/${id}/topics/${topicId}/follow`)),
  chatReact: (type: ChatContextType, id: string, topicId: string, body: { targetType: 'topic' | 'reply'; targetId: string; emoji: string }) =>
    post<{ on: boolean } & ChatTopicView>(`/api/chat/${type}/${id}/topics/${topicId}/react`, body),
  chatDecide: (type: ChatContextType, id: string, topicId: string, requestId: string, decision: 'anonymous' | 'named' | 'declined') =>
    post<{ decision: string; published: { faqId?: string; topicId?: string } | null } & ChatTopicView>(`/api/chat/${type}/${id}/topics/${topicId}/requests/${requestId}/decide`, { decision }),
  chatReport: (type: ChatContextType, id: string, topicId: string, body: { reason?: string | null; replyId?: string | null }) => post<{ ok: true; message: string }>(`/api/chat/${type}/${id}/topics/${topicId}/report`, body),
  chatPrefs: (type: ChatContextType, id: string) => request<{ context: ChatContext; prefs: ChatPrefs; digestAt: string; anchorsOn: string[] }>(`/api/chat/${type}/${id}/prefs`),
  setChatPrefs: (type: ChatContextType, id: string, prefs: Partial<ChatPrefs>) => put<{ prefs: ChatPrefs }>(`/api/chat/${type}/${id}/prefs`, prefs),
  chatSettings: () => request<ChatSettings>('/api/chat/settings'),
  setChatSettings: (body: { digestAt?: string; quietFrom?: string | null; quietTo?: string | null }) => put<{ digestAt: string; quietFrom: string | null; quietTo: string | null }>('/api/chat/settings', body),
  chatInbox: () => request<ChatInbox>('/api/chat/inbox'),
  /** The FAQ on a listing (C7). Public. */
  experienceFaq: (id: string) => request<{ faq: FaqEntry[]; hostName: string | null }>(`/api/experiences/${id}/faq`),
  withdrawFaq: (id: string) => post<{ ok: true }>(`/api/chat/faq/${id}/withdraw`, {}),
  /** The addresses the trip rebuild shipped, still answered — from the topic model now. */
  tripChat: (id: string) => request<ChatList>(`/api/trips/${id}/chat`),
  tripAsks: (id: string, venueRef: string) => request<ChatList>(`/api/trips/${id}/asks/${encodeURIComponent(venueRef)}`),
  sendTripMessage: (id: string, body: { body: string; venueRef?: string | null; venueLabel?: string | null; audience?: ChatAudience; topicId?: string | null }) =>
    post<ChatTopicView>(`/api/trips/${id}/chat`, body),
  readTripChat: (id: string) => post<{ unread: number }>(`/api/trips/${id}/chat/read`, {}),

  // sharing
  tripShare: (id: string) => request<TripShare>(`/api/trips/${id}/share`),
  setTripHousehold: (id: string, memberIds: string[]) => put<TripShare>(`/api/trips/${id}/share/household`, { memberIds }),
  inviteGuest: (id: string, body: { name: string; contact: string }) => post<TripShare>(`/api/trips/${id}/share/guests`, body),
  resendGuest: (id: string, guestId: string) => post<{ sent: string | null } & TripShare>(`/api/trips/${id}/share/guests/${guestId}/resend`, {}),
  removeGuest: (id: string, guestId: string) => del<TripShare>(`/api/trips/${id}/share/guests/${guestId}`),

  // --- the guest's door: public, and resolved from the link, never a session --
  sharedTrip: (token: string, you?: string | null) => request<SharedTrip>(`/api/shared/${token}${qs({ you })}`),
  /** `token` is the guest's own door, kept on their device; `you` in the payload is who they are. */
  sharedEnter: (token: string, body: { name?: string; contact: string }) =>
    post<{ guestId: string; sent: 'sms' | 'email' | null; message?: string; token?: string } & Partial<SharedTrip>>(`/api/shared/${token}/enter`, body),
  sharedVerify: (token: string, body: { guestId: string; code: string }) =>
    post<{ token: string } & SharedTrip>(`/api/shared/${token}/verify`, body),
  /** A group participant's door into the trip's chat (13 Sep 2026): the invite link plus their own token. */
  joinChat: (token: string, p: string) => request<ChatList>(`/api/join/${token}/chat${qs({ p })}`),
  joinTopic: (token: string, p: string, topicId: string) => request<ChatTopicView>(`/api/join/${token}/chat/${topicId}${qs({ p })}`),
  joinSend: (token: string, body: { p: string; body: string; title?: string; tag?: { kind: ChatTagKind; ref: string }; audience?: ChatAudience; topicId?: string | null; quotesReplyId?: string | null }) =>
    post<ChatTopicView>(`/api/join/${token}/chat`, body),
  joinReact: (token: string, p: string, topicId: string, body: { targetType: 'topic' | 'reply'; targetId: string; emoji: string }) =>
    post<{ on: boolean } & ChatTopicView>(`/api/join/${token}/chat/${topicId}/react`, { p, ...body }),
  joinFollow: (token: string, p: string, topicId: string, on: boolean) =>
    (on ? post<{ following: boolean }>(`/api/join/${token}/chat/${topicId}/follow`, { p }) : del<{ following: boolean }>(`/api/join/${token}/chat/${topicId}/follow${qs({ p })}`)),
  joinReport: (token: string, p: string, topicId: string, body: { reason?: string | null; replyId?: string | null }) =>
    post<{ ok: true; message: string }>(`/api/join/${token}/chat/${topicId}/report`, { p, ...body }),
  /** The conversation, as a guest: the same topic model, `everyone` topics only. */
  sharedChat: (token: string, you: string, stop?: string | null) => request<ChatList>(`/api/shared/${token}/chat${qs({ you, stop })}`),
  sharedTopic: (token: string, you: string, topicId: string) => request<ChatTopicView>(`/api/shared/${token}/chat/${topicId}${qs({ you })}`),
  sharedSend: (token: string, body: { you: string; body: string; title?: string; tag?: { kind: ChatTagKind; ref: string }; venueRef?: string | null; topicId?: string | null; quotesReplyId?: string | null }) =>
    post<ChatTopicView>(`/api/shared/${token}/chat`, body),
  sharedReact: (token: string, you: string, topicId: string, body: { targetType: 'topic' | 'reply'; targetId: string; emoji: string }) =>
    post<{ on: boolean } & ChatTopicView>(`/api/shared/${token}/chat/${topicId}/react`, { you, ...body }),
  sharedFollow: (token: string, you: string, topicId: string, on: boolean) =>
    (on ? post<{ following: boolean }>(`/api/shared/${token}/chat/${topicId}/follow`, { you }) : del<{ following: boolean }>(`/api/shared/${token}/chat/${topicId}/follow${qs({ you })}`)),
  sharedReport: (token: string, you: string, topicId: string, body: { reason?: string | null; replyId?: string | null }) =>
    post<{ ok: true; message: string }>(`/api/shared/${token}/chat/${topicId}/report`, { you, ...body }),
  addStop: (tripId: string, body: { venueRef: string; name: string; lat?: number; lng?: number; dwellMinutes?: number }) => post<TripDetail>(`/api/trips/${tripId}/stops`, body),
  removeStop: (tripId: string, stopId: string) => del<TripDetail>(`/api/trips/${tripId}/stops/${stopId}`),
  reorderStops: (tripId: string, stopIds: string[]) => post<TripDetail>(`/api/trips/${tripId}/stops/reorder`, { stopIds }),
  visitStop: (tripId: string, stopId: string, body: { visitedOn?: string; note?: string; venue?: Partial<Venue> } = {}) =>
    post<{ visit: Visit; tripId: string }>(`/api/trips/${tripId}/stops/${stopId}/visit`, body),

  // planner
  planStart: (utterance: string, sessionId?: string | null, sources?: string[] | null, attendingMemberIds?: string[] | null, extra: { field?: PlanRowKey | null; skip?: string | null } = {}) =>
    post<PlanResponse>('/api/plan/start', { utterance, sessionId: sessionId ?? undefined, sources: sources ?? undefined, attendingMemberIds: attendingMemberIds ?? undefined, field: extra.field ?? undefined, skip: extra.skip ?? undefined }),
  planSet: (set: PlanSet, sessionId?: string | null, attendingMemberIds?: string[] | null) => post<PlanResponse>('/api/plan/start', { set, sessionId: sessionId ?? undefined, attendingMemberIds: attendingMemberIds ?? undefined }),
  planPlaces: (q: string) => request<{ places: { label: string; where: string; kind: string; isRoad: boolean; travelMinutes: number | null; place: Place }[] }>(`/api/plan/places${qs({ q })}`),
  planGo: (sessionId: string) => post<PlanResponse>('/api/plan/go', { sessionId }),
  planPreview: (utterance: string, sessionId?: string | null) => post<{ sessionId: string; rows: PlanRow[] }>('/api/plan/preview', { utterance, sessionId: sessionId ?? undefined }),
  /** Inspire me runs in the background: the answer is the session; poll inspireStatus until running is false. */
  inspire: (body: { query: string; moods: string[]; maxTravelMinutes: number | null; budget?: IdeaBudget; attendingMemberIds?: string[] | null }) => post<{ sessionId: string; ref: string; running: boolean; stage: InspireStage }>('/api/plan/inspire', body),
  inspireStatus: (sessionId: string) => request<{ sessionId: string; ref: string; running: boolean; ideas: Idea[] | null; reply: string | null; budget: IdeaBudget; stage: InspireStage | null; placed: number; startedAt: string | null; error: string | null; searchId: string | null }>(`/api/plan/inspire/${sessionId}`),
  /** Five more days out on the same list, without losing the ones already there. */
  inspireMore: (body: { sessionId: string; attendingMemberIds?: string[] | null }) => post<{ sessionId: string; ref: string; running: boolean; stage: InspireStage }>('/api/plan/inspire/more', body),
  /** What is inside a place with grounds: the rides in a theme park, researched once and ours to keep. */
  placeInside: (q: { ref: string; lat?: number; lng?: number; experiences?: string; name?: string; website?: string; refresh?: '1' }) =>
    request<{ ref: string; items: PlaceInsideItem[]; researched: boolean; askingWhoCanRide?: boolean }>(`/api/places/inside${qs(q)}`),
  /** What one run did, by the number shown on screen: what was asked, how long, and every call it made. */
  planRun: (ref: string) => request<{ ref: string; sessionId: string; kind: string; asked: any; startedAt: string; seconds: number; stage: string; running: boolean; error: string | null; answered: { title: string; pinned: boolean }[] | null; calls: { provider: string; purpose: string; units: any; costUsd: number | null; at: string; afterSeconds: number }[] }>(`/api/plan/runs/${ref}`),
  inspireThings: (q: { lat: number; lng: number; label: string; locality?: string }) => request<{ items: IdeaThing[]; headline: IdeaHeadline | null; cached?: boolean; tookMs?: number }>(`/api/plan/inspire/things${qs(q)}`),
  /** Things to do and see: the idea becomes a day out in Trips, what Epic named already shortlisted. */
  inspireTrip: (body: { sessionId: string; ideaId: string; attendingMemberIds?: string[] | null }) => post<{ tripId: string; title: string; date: string; seeded: string[]; reply: string; existing: boolean }>('/api/plan/inspire/trip', body),
  /** The family's table: the best places for the food the people coming love. Runs in the background like Inspire me. */
  tastes: (body: { brief: string; moods: string[]; maxTravelMinutes: number | null; budget?: IdeaBudget; attendingMemberIds?: string[] | null }) => post<TastesResponse>('/api/plan/tastes', body),
  tastesStatus: (sessionId: string) => request<TastesResponse>(`/api/plan/tastes/${sessionId}`),
  tastesAround: (q: { sessionId: string; tasteKey: string; venueRef: string; members?: string }) => request<{ items: AroundThing[]; forUs: AroundThing[]; cached: boolean; radiusKm: number }>(`/api/plan/tastes/around${qs(q)}`),
  /** Reading a menu takes a minute or two, so it runs in the background: start it, then poll tastesMenuStatus. */
  tastesMenu: (body: { sessionId: string; tasteKey: string; venueRef: string; attendingMemberIds?: string[] | null }) => post<{ reading: boolean; menu: MenuRead | null; error: string | null }>('/api/plan/tastes/menu', body),
  tastesMenuStatus: (q: { sessionId: string; tasteKey: string; venueRef: string }) => request<{ reading: boolean; menu: MenuRead | null; error: string | null; usage: { used: number; limit: number } }>(`/api/plan/tastes/menu${qs(q)}`),
  tastesTrip: (body: { sessionId: string; tasteKey: string; venueRef: string; attendingMemberIds?: string[] | null; around?: string[] }) => post<{ tripId: string; title: string; date: string; seeded: string[]; reply: string; existing: boolean }>('/api/plan/tastes/trip', body),
  tripSources: (id: string, p: { dayId?: string; sources?: string; scout?: '1' }) => request<SourceTrace>(`/api/plan/trips/${id}/sources${qs(p)}`),
  tripSpend: (id: string) => request<{ calls: number; costUsd: number; byProvider: { provider: string; calls: number; cost_usd: number }[] }>(`/api/trips/${id}/spend`),
  planRefine: (sessionId: string, utterance: string, viewingOptionId?: string | null) => post<PlanResponse>('/api/plan/refine', { sessionId, utterance, viewingOptionId }),
  planAct: (sessionId: string, action: PlanAction) => post<PlanResponse>('/api/plan/act', { sessionId, action }),
  planCommit: (sessionId: string, optionId: string) => post<{ tripId: string; optionId: string; stops: number }>('/api/plan/commit', { sessionId, optionId }),
  planGet: (sessionId: string) => request<PlanResponse>(`/api/plan/${sessionId}`),
  planLatestForDay: (tripId: string, dayId: string) => request<PlanResponse & { sessionId: string | null }>(`/api/plan/day/latest${qs({ tripId, dayId })}`),

  // offline
  /** What is worth having on the device, and how much of the research Epic owns. */
  offlineManifest: () => request<OfflineManifest>('/api/offline/manifest'),
  /** Every owned record for this household's places, in one request. */
  offlineRecords: () => request<{ records: Record<string, OwnedRecord>; count: number; terms: string; generatedAt: string }>('/api/offline/records'),
  /**
   * Fill the device's copy: fetch every page in the manifest so that the atlas,
   * the trips, the visit history and every owned place record are there before
   * the signal goes. Each page is saved by the same rule as any other answer.
   */
  saveForOffline: (): Promise<void> => warm((path) => request<any>(path)),
  /** The quiet daily fill, on start-up: only what the API answers for free. */
  keepDeviceCopyFresh: (): Promise<void> => warmQuietly((path) => request<any>(path)),

  // --- the door -------------------------------------------------------------

  /** Whether this device is signed in, and whether the API is asking at all. */
  sessionState: () => request<SessionState>('/api/session'),

  // --- hosting (Events & Hosts, 12 Sep 2026) ---------------------------------
  /** The Host tab: the invitation, or the dashboard. */
  hostHome: () => request<HostHome>('/api/host'),
  becomeHost: (body: HostInput) => post<{ host: OwnHost }>('/api/host', body),
  updateHost: (body: Partial<HostInput> & { introVideoId?: string | null; photoId?: string | null; idDocument?: 'passport' | 'driving_licence' | null; insuranceConfirmed?: boolean; taxReference?: string | null; payoutStatus?: 'not_connected' | 'connected' }) =>
    patch<{ host: OwnHost }>('/api/host', body),
  /** Stop hosting: the host, its offers and its videos go, and the Host tab is the invitation again. */
  stopHosting: (force = false) => del<void>(`/api/host${force ? '?force=1' : ''}`),
  /** A video or a photo, as bytes. Not `request`: the body is not JSON and is never queued. */
  /**
   * `purpose` decides whether anybody may read it back, and it is required at
   * both ends. `listing` goes on the public reader because the page it draws
   * on is public; `evidence` does not, because the wizard promises "nothing
   * here is shown to guests".
   *
   * It has no default here on purpose. It had one — `listing` — which meant
   * the server failed safe and this did not, so a future sensitive upload
   * whose caller forgot the argument would have been public (Codex, 13 Sep
   * 2026). Saying it at every call site is the whole point.
   */
  uploadHostMedia: async (blob: Blob, kind: 'video' | 'photo' | 'doc', durationS: number | null, purpose: 'listing' | 'evidence'): Promise<HostMedia> => {
    const token = sessionToken();
    const res = await fetch(`${API_URL}/api/host/media${qs({ kind, duration: durationS ?? undefined, purpose })}`, {
      method: 'POST', credentials: 'include', body: blob,
      headers: { 'content-type': blob.type || (kind === 'video' ? 'video/webm' : kind === 'doc' ? 'application/pdf' : 'image/jpeg'), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body);
    return body.media as HostMedia;
  },
  // --- a place from a photograph (12 Sep 2026) ---------------------------------
  /** The picture and where it was taken. Raw bytes, not `request`: a photograph is neither JSON nor a thing to send later. */
  uploadPlacePhoto: async (blob: Blob, meta: { width: number; height: number; lqip: string | null; lat: number | null; lng: number | null }) => {
    const token = sessionToken();
    const res = await fetch(`${API_URL}/api/places/photo${qs({ lat: meta.lat ?? undefined, lng: meta.lng ?? undefined, w: meta.width || undefined, h: meta.height || undefined })}`, {
      method: 'POST', credentials: 'include', body: blob,
      headers: { 'content-type': blob.type || 'image/jpeg', ...(meta.lqip ? { 'x-lqip': meta.lqip } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body);
    return body as { image: OwnedImage; point: { lat: number; lng: number } | null; where: PhotoWhere | null };
  },
  /** It is this place: keep the photo on it for us, and save the place. */
  attachPlacePhoto: (imageId: string, body: { venueRef: string; label: string; category?: string | null; lat?: number | null; lng?: number | null; venue?: Partial<Venue> }) =>
    post<{ venueRef: string; filed: PhotoFiled | null }>(`/api/places/photo/${imageId}/attach`, body),
  /** Nowhere the sources know: a place of our own, named by us. */
  placeFromPhoto: (imageId: string, body: { name: string; kind: 'do' | 'eat' | 'stay'; lat: number | null; lng: number | null }) =>
    post<{ venueRef: string; filed: PhotoFiled | null }>(`/api/places/photo/${imageId}/place`, body),
  trimHostMedia: (id: string, trimStartS: number, trimEndS: number | null) => patch<{ media: HostMedia }>(`/api/host/media/${id}`, { trimStartS, trimEndS }),
  deleteHostMedia: (id: string) => del<void>(`/api/host/media/${id}`),
  createOffer: (shape: OfferShape, visibility?: Visibility) => post<{ offer: OwnOffer }>('/api/host/offers', { shape, visibility }),
  /** A PDF for guests, read and seeded into the fields; null takes it off again. */
  seedOfferDoc: (id: string, mediaId: string | null) => post<{ offer: OwnOffer; seeded: string[] }>(`/api/host/offers/${id}/doc`, { mediaId }),
  /** The listing written from the video. `force` overwrites what the host typed. */
  extractOffer: (id: string, force = false) => post<{ offer: OwnOffer; seeded: string[]; transcript: string }>(`/api/host/offers/${id}/extract`, { force }),
  addInvites: (id: string, invites: { name: string; contact?: string | null; mobile?: string | null; email?: string | null; heads?: number }[], send = true) => post<{ offer: OwnOffer }>(`/api/host/offers/${id}/invites`, { invites, send }),
  sendInvites: (id: string) => post<{ offer: OwnOffer; told: Told }>(`/api/host/offers/${id}/invites/send`, {}),
  removeInvite: (id: string, inviteId: string) => del<{ offer: OwnOffer }>(`/api/host/offers/${id}/invites/${inviteId}`),
  addEvidence: (body: { kind: CheckKind; offerId?: string | null; fields: Record<string, string | null>; mediaId?: string | null }) => post<{ evidence: Evidence }>('/api/host/evidence', body),
  updateEvidence: (id: string, body: { fields?: Record<string, string | null>; mediaId?: string | null }) => patch<{ evidence: Evidence }>(`/api/host/evidence/${id}`, body),
  removeEvidence: (id: string) => del<void>(`/api/host/evidence/${id}`),
  /** An invitation to a private offer: what it opens, and the answer. Public. */
  invited: (token: string) => request<InvitedView>(`/api/invited/${token}`),
  invitedLink: (token: string) => request<{ offerId: string; title: string | null; visibility: Visibility }>(`/api/invited/link/${encodeURIComponent(token)}`),
  hostContacts: () => request<{ contacts: HostContact[] }>('/api/host/contacts'),
  // What you are up for, and the introductions it leads to. Nothing here lists anybody.
  openHome: () => request<OpenHome>('/api/open'),
  openHeard: (transcript: string) => post<{ heard: OpenHeard; transcript: string }>('/api/open/heard', { transcript }),
  saveOpen: (body: {
    scope: OpenScope; tripId?: string | null; interests: string[]; level?: string[]; when?: string[];
    where?: string | null; miles?: number | null; languages?: OpenLanguage[]; kind?: OpenKind;
    childAgeBands?: string[]; transcript?: string | null;
    /** Who you would rather meet, when it was set on the way through and there was no entry to patch yet. */
    age?: string; company?: string[]; fluency?: string;
  }) => post<{ entry: OpenEntry; introduced: number; ended?: number }>('/api/open', body),
  openWho: (id: string, prefs: { age?: string; company?: string[]; fluency?: string; languages?: OpenLanguage[] }) =>
    request<{ entry: OpenEntry }>(`/api/open/${id}/who`, { method: 'PATCH', body: JSON.stringify(prefs) }),
  endOpen: (id: string) => request<void>(`/api/open/${id}`, { method: 'DELETE' }),
  openMatches: () => request<{ matches: OpenMatch[] }>('/api/open/matches'),
  openMatch: (id: string) => request<{ match: OpenMatch }>(`/api/open/matches/${id}`),
  openHostAnswer: (id: string, body: { answer: 'yes' | 'no'; where?: string | null; note?: string | null }) => post<{ match: OpenMatch }>(`/api/open/matches/${id}/host`, body),
  openGuestAnswer: (id: string, answer: 'yes' | 'no') => post<{ match: OpenMatch }>(`/api/open/matches/${id}/guest`, { answer }),
  openHello: async (id: string, blob: Blob, seconds: number) => {
    const token = sessionToken();
    const res = await fetch(`${API_URL}/api/open/matches/${id}/hello?seconds=${Math.round(seconds)}`, {
      method: 'POST', credentials: 'include', body: blob,
      headers: { 'content-type': blob.type || 'video/webm', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || 'That did not send.');
    return body as { match: OpenMatch };
  },
  /**
   * The bytes of one hello, fetched with the session and held as a blob for as
   * long as the screen is open. A hello is not public the way a listing's
   * video is, so it cannot be a plain `<video src>` on an open address — and
   * nothing about it is written to a cache.
   */
  openHelloBytes: async (path: string) => {
    const token = sessionToken();
    const res = await fetch(`${API_URL}${path}`, {
      credentials: 'include', cache: 'no-store',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('That video is no longer there.');
    return URL.createObjectURL(await res.blob());
  },
  openDecide: (id: string, answer: 'yes' | 'no') => post<{ match: OpenMatch }>(`/api/open/matches/${id}/decide`, { answer }),
  /** One of the two images the ID check asks for. Held only until somebody has looked at it. */
  openIdImage: async (id: string, which: 'doc' | 'selfie', blob: Blob) => {
    const token = sessionToken();
    const res = await fetch(`${API_URL}/api/open/matches/${id}/id/${which}`, {
      method: 'POST', credentials: 'include', body: blob,
      headers: { 'content-type': blob.type || 'image/jpeg', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || 'That did not send.');
    return body as { check: OpenIdCheck };
  },
  /** Send the check. Nobody clears their own: it waits, and Epic answers either way. */
  openVerify: (id: string) => post<{ match: OpenMatch }>(`/api/open/matches/${id}/verify`, {}),
  addHostContact: (c: { name: string; mobile?: string | null; email?: string | null }) => post<{ contact: HostContact }>('/api/host/contacts', c),
  removeHostContact: (id: string) => request<void>(`/api/host/contacts/${id}`, { method: 'DELETE' }),
  answerInvite: (token: string, rsvp: 'yes' | 'no', heads?: number | null) => post<{ invite: OfferInvite }>(`/api/invited/${token}`, { rsvp, heads }),
  hostOffer: (id: string) => request<{ offer: OwnOffer }>(`/api/host/offers/${id}`),
  /** `paused` comes back when an edit took a live listing out of the window, and says what would put it back. */
  updateOffer: (id: string, body: OfferInput) => patch<{ offer: OwnOffer; paused?: string[] }>(`/api/host/offers/${id}`, body),
  deleteOffer: (id: string) => del<void>(`/api/host/offers/${id}`),
  submitOffer: (id: string) => post<{ offer: OwnOffer; inReview: boolean }>(`/api/host/offers/${id}/submit`, {}),
  pauseOffer: (id: string, until: string | null) => post<{ offer: OwnOffer }>(`/api/host/offers/${id}/pause`, { until }),
  resumeOffer: (id: string) => post<{ offer: OwnOffer }>(`/api/host/offers/${id}/resume`, {}),
  cancelOffer: (id: string, note: string | null) => post<{ offer: OwnOffer; told: Told }>(`/api/host/offers/${id}/cancel`, { note }),
  broadcastOffer: (id: string, body: string) => post<{ offer: OwnOffer; told: Told }>(`/api/host/offers/${id}/broadcast`, { body }),
  addOfferDate: (id: string, startsOn: string, startsAt: string | null) => post<{ offer: OwnOffer }>(`/api/host/offers/${id}/dates`, { startsOn, startsAt }),
  /** The guest's side. The page and the profile are public; the rest need a session. */
  experience: (id: string, inviteToken?: string | null, linkToken?: string | null) => request<{ offer: Experience; payments: PaymentsConfig }>(`/api/experiences/${id}${inviteToken ? `?i=${encodeURIComponent(inviteToken)}` : linkToken ? `?l=${encodeURIComponent(linkToken)}` : ''}`),
  experienceMine: (id: string) => request<{ bookings: Booking[]; party: PartyMember[]; you: string | null }>(`/api/experiences/${id}/mine`),
  experiencesNear: (q: { lat: number; lng: number; km?: number; love?: string | null }) => request<ExperiencesNear>(`/api/experiences/near${qs(q)}`),
  bookExperience: (id: string, body: BookingInput) => post<{ booking: Booking; payments: PaymentsConfig }>(`/api/experiences/${id}/book`, body),
  hostProfile: (id: string) => request<HostProfile>(`/api/hosts/${id}`),

  // --- host skills: the open vocabulary both ends of the app share ----------
  /** The tag step's whole answer: the prompt for this host's kind, the lists, the cap. */
  hostSkills: (p: { hostType?: string | null; lat?: number | null; lng?: number | null } = {}) => request<HostSkillsSetup>(`/api/host/skills${qs(p)}`),
  /**
   * The type-ahead, from Epic's own tables and nothing else — no external call
   * sits in a host's typing path. `guest` reads the same rows logged-out; the
   * only difference is that a guest is never offered "add it as it is".
   */
  skillSuggest: (q: string, opts: { vocab?: 'tag' | 'facet'; category?: string | null; guest?: boolean; limit?: number } = {}) =>
    request<{ q: string; vocab: 'tag' | 'facet'; normalised: string; suggestions: SkillSuggestion[] }>(
      `${opts.guest ? '/api/skills/suggest' : '/api/host/skills/suggest'}${qs({ q, vocab: opts.vocab, category: opts.category, limit: opts.limit })}`,
    ),
  /** The detail sheet: the one line, the count, and the near-collision that tells two senses apart. */
  skillDetail: (key: string, opts: { vocab?: 'tag' | 'facet'; guest?: boolean } = {}) =>
    request<{ tag: SkillSuggestion & { note: string | null; externalId: string | null; source: string | null }; near: SkillSuggestion[] }>(
      `${opts.guest ? '/api/skills' : '/api/host/skills'}/tag/${encodeURIComponent(key)}${qs({ vocab: opts.vocab })}`,
    ),
  /** The browse row and the formats. Public. */
  skills: () => request<{ categories: SkillCategory[]; formats: SkillFormat[] }>('/api/skills'),
  /** A tag's own page: every host carrying it, and what sits close to it. Works logged-out. */
  tagPage: (key: string, opts: { vocab?: 'tag' | 'facet'; country?: string | null } = {}) =>
    request<TagPage>(`/api/skills/tag/${encodeURIComponent(key)}/hosts${qs({ vocab: opts.vocab, country: opts.country })}`),
  skillAttribution: () => request<{ sources: { key: string; label: string; attribution: string; url: string | null }[] }>('/api/skills/attribution'),
  /** What a host may claim, and what they have claimed. Evidence, never expertise. */
  hostCredentials: () => request<{ types: { key: string; label: string; note: string | null; evidenceRequired: boolean; gatesCategories: string[] }[]; held: HostCredential[] }>('/api/host/credentials'),
  claimCredential: (body: { typeKey: string; reference?: string | null; detail?: string | null }) =>
    put<{ credential: { id: string; typeKey: string; state: string } }>('/api/host/credentials', body),
  dropCredential: (typeKey: string) => del<{ removed: string }>(`/api/host/credentials/${encodeURIComponent(typeKey)}`),

  // --- the back office -----------------------------------------------------
  adminSkills: () => request<SkillsOverview>('/api/admin/skills/'),
  adminSkillVocabulary: (vocab: 'tag' | 'facet', p: { q?: string | null; all?: boolean; limit?: number } = {}) =>
    request<{ vocab: string; rows: SkillVocabRow[] }>(`/api/admin/skills/vocabulary${qs({ vocab, ...p, all: p.all ? 1 : undefined })}`),
  adminSkillIdentifiers: (p: { exact?: boolean } = {}) =>
    request<{
      counts: { named: number; exact: number; close: number; refused: number; empty: number; nothing: number };
      waiting: { key: string; label: string; proposed_id: string; proposed_label: string | null; proposed_note: string | null; proposed_exact: boolean; seen_count: number }[];
      refused: { key: string; label: string }[];
    }>(`/api/admin/skills/identifiers${qs({ exact: p.exact ? 1 : undefined })}`),
  adminProposeSkillIdentifiers: (body: { limit?: number; again?: boolean } = {}) =>
    post<{ started: number }>('/api/admin/skills/identifiers/propose', body),
  adminSettleSkillIdentifiers: (body: { keys: string[]; take?: boolean; reopen?: boolean }) =>
    put<{ changed: number; counts: { named: number; exact: number; close: number; refused: number; empty: number; nothing: number } }>('/api/admin/skills/identifiers', body),
  adminSaveSkillCategory: (body: { key: string; label?: string; blurb?: string | null; icon?: string | null; position?: number; active?: boolean }) =>
    put<{ category: SkillCategory }>('/api/admin/skills/category', body),
  adminSaveSkillFormat: (body: { key: string; label?: string; blurb?: string | null; icon?: string | null; venueless?: boolean; position?: number; active?: boolean }) =>
    put<{ format: SkillFormat }>('/api/admin/skills/format', body),
  adminRemoveSkillValue: (what: 'category' | 'format', key: string) => del<{ removed: string }>(`/api/admin/skills/${what}/${encodeURIComponent(key)}`),
  adminSaveTag: (body: { key?: string; label?: string; parentKey?: string | null; categoryKey?: string | null; source?: string | null; externalId?: string | null; note?: string | null; active?: boolean }) =>
    put<{ tag: SkillVocabRow; paused?: { offerId: string; title: string | null; host: string; why: string }[]; taken?: string | null }>('/api/admin/skills/tag', body),
  adminSaveFacet: (body: { key?: string; kind?: string; label?: string; parentKey?: string | null; source?: string | null; externalId?: string | null; note?: string | null; active?: boolean }) =>
    put<{ facet: SkillVocabRow; taken?: string | null }>('/api/admin/skills/facet', body),
  /** The queue, ordered by how often each has been typed. Merge is the most-used button on it. */
  adminSkillQueue: (state: 'open' | 'approved' | 'merged' | 'rejected' | 'all' = 'open') =>
    request<{ proposals: SkillProposal[]; n: number; oldest: string | null }>(`/api/admin/skills/queue${qs({ state })}`),
  adminSkillProposal: (id: string) =>
    request<{ proposal: SkillProposal; offers: { id: string; title: string | null; state: string; host_id: string; host_name: string; raw: string; created_at: string }[]; targets: SkillSuggestion[] }>(`/api/admin/skills/queue/${id}`),
  adminDecideProposal: (id: string, body: { decision: 'approve' | 'merge' | 'reject'; targetKey?: string; label?: string; parentKey?: string | null; categoryKey?: string | null; kind?: string; note?: string | null; source?: string | null; externalId?: string | null }) =>
    post<{ proposal: SkillProposal; tag?: SkillVocabRow; target?: SkillVocabRow }>(`/api/admin/skills/queue/${id}`, body),
  /** Wikidata, asked by a person. The description is shown so two senses can be told apart, and is not stored. */
  adminSkillCandidates: (q: string) =>
    request<{ q: string; candidates: { qid: string; label: string; description: string | null; url: string }[] }>(`/api/admin/skills/candidates${qs({ q })}`),
  adminSkillParents: (qid: string) =>
    request<{ qid: string; parents: { qid: string; label: string | null }[]; note: string }>(`/api/admin/skills/parents${qs({ qid })}`),
  adminCredentials: () => request<{ types: CredentialType[]; waiting: CredentialWaiting[] }>('/api/admin/skills/credentials'),
  /** `paused` names the live offers a new condition just took off the window. */
  adminSaveCredentialType: (body: Partial<CredentialType> & { key: string }) =>
    put<{ type: CredentialType; paused: { offerId: string; title: string | null; hostId: string; host: string; why: string }[] }>('/api/admin/skills/credential-type', body),
  adminDecideCredential: (id: string, body: { state: 'confirmed' | 'rejected' | 'pending'; note?: string | null }) =>
    post<{ credential: CredentialWaiting }>(`/api/admin/skills/credentials/${id}`, body),
  adminVocabularySources: () => request<{ sources: VocabularySource[] }>('/api/admin/skills/sources'),
  adminSaveVocabularySource: (body: { key: string } & Record<string, unknown>) => put<{ source: VocabularySource }>('/api/admin/skills/source', body),

  // -------------------------------------------------------------------------
  // Places, Runs, Demand and the content queue (17 Sep 2026)
  // -------------------------------------------------------------------------
  //
  // Five back-office screens that were each bound to a different table became
  // three bound to three questions — what do we know and where, what did people
  // ask for, and what have households sent us — plus Runs, a monitor for the
  // long jobs. Everything below reads `place_index`, which holds identifiers and
  // our own derivations and never a provider's content.

  /** BO2m — every country, and whether its travel times are worked out yet. */
  adminCountries: () => request<{ countries: PlaceCountry[]; refreshedAt: string | null }>('/api/admin/place-index/countries'),
  /** The five numbers, the breadcrumb and the ring's own facts, for any level. */
  adminPlaceArea: (p: PlaceWhere) => request<PlaceLevel>(`/api/admin/place-index/area${qs(p)}`),
  /** BO2a / BO2n — the level cut by county, by city or by postcode district. */
  adminPlaceBreakdown: (p: PlaceWhere & { by?: string; sort?: string; desc?: string; since?: number }) =>
    request<{ rows: PlaceAreaRow[]; all: number; totals: PlaceStats }>(`/api/admin/place-index/breakdown${qs(p)}`),
  /**
   * The census board — what exists here, per drawer, for nothing.
   *
   * Free by construction: every figure was written down when the census ran,
   * and a census asks Google only for identifiers. Nothing this endpoint
   * returns can have cost anything, and nothing it offers can spend (data
   * policy, 19 Sep 2026).
   */
  adminPlaceCensus: (p: { where: string; reach?: string }) =>
    request<{
      where: string; reach: string; outcodes: string[]; rows: PlaceCensusRow[];
      censused: number; oldest: string | null; newest: string | null;
      residual: number; checkedOnGoogle: number; free: boolean;
    }>(`/api/admin/place-index/census${qs(p)}`),
  /** BO2b — the coverage grid, towns and outcodes together. */
  adminPlaceCoverage: (p: PlaceWhere) =>
    request<{ rows: PlaceCoverageRow[]; towns: number; outcodes: number; allTowns: number; refreshedAt: string | null }>(`/api/admin/place-index/coverage${qs(p)}`),
  /** BO2c / BO2o / BO2p — the taxonomy with the counts left-joined onto it. */
  /**
   * BO2c / BO2p — the shelves, or the words that fill them.
   *
   * `words` rather than `by`: `by` is the ring's travel mode and is part of
   * `PlaceWhere`, so a second meaning on the same key silently made a walking
   * ring's category ladder count a driving one.
   */
  adminPlaceCategories: (p: PlaceWhere & { cat?: string | null; since?: number; words?: string }) =>
      request<PlaceLevel & { categories: PlaceCategory[]; facts: FactDef[]; subcategories: number; labels: PlaceLabel[] | null }>(`/api/admin/place-index/categories${qs(p)}`),
  /**
   * What a collection would actually do, before it does it.
   *
   * The board used to work its own figures out — every identified place in the
   * county, at its own copy of the per-call rate — while the run took fifty,
   * dropped everything asked inside twelve months, and priced an unmatched
   * place at two calls. Both sides read this now, so they cannot disagree.
   */
  adminCollectQuote: (p: PlaceWhere & { cat?: string | null; sub?: string | null; sources: string[]; limit?: number }) =>
    request<{
      places: number; limit: number; staleMonths: number;
      would: { free: number; google: number; tripadvisor: number };
      fresh: { google: number; tripadvisor: number; free: number };
      spendPence: number; tripadvisorCapped: number; tripadvisorLeft: number;
      leftPence: number; overTheCeiling: boolean;
    }>(`/api/admin/place-index/collect/quote${qs({ ...p, sources: p.sources.join(',') })}`),

  /** BO2d — which providers have ever seen these places. */
  adminPlaceSources: (p: PlaceWhere) =>
    request<PlaceLevel & { sources: PlaceSourceDef[]; rows: PlaceSourceRow[]; subcategories: number }>(`/api/admin/place-index/sources${qs(p)}`),
  /** BO2e — the score distribution, staleness, and what is worth owning next. */
  adminPlaceQuality: (p: PlaceWhere) => request<PlaceLevel & PlaceQuality>(`/api/admin/place-index/quality${qs(p)}`),
  /** BO2f — the gaps ranked by what was actually searched for. */
  adminPlaceDemand: (p: PlaceWhere & { since?: number }) =>
    request<PlaceLevel & {
      since: number; totals: DemandTotals; rows: DemandRow[];
      /**
       * Whose figures these are, where they are not this area's own.
       *
       * A point search is recorded against a county, so a town with no cells of
       * its own reads its county's and says so rather than showing nought.
       */
      figuresFrom: { slug: string; name: string; why: string } | null;
    }>(`/api/admin/place-index/demand${qs(p)}`),
  /** BO2g — a town and its ring, read from the matrix rather than calculated. */
  adminPlaceRing: (p: PlaceWhere) => request<PlaceLevel & PlaceRing>(`/api/admin/place-index/ring${qs(p)}`),
  /** BO2q — the places themselves. */
  adminPlaceList: (p: PlaceWhere & { cat?: string | null; sub?: string | null; show?: string; q?: string; missing?: string; sort?: string; desc?: string }) =>
    request<PlaceLevel & { rows: PlaceRow[]; facts: FactDef[]; bar: BarFact[]; counted: string[]; notReady: number }>(`/api/admin/place-index/places${qs(p)}`),
  /** BO2h / BO2r — one place, every field, and what nobody has asked yet. */
  adminPlace: (ref: string) => request<PlaceDetail>(`/api/admin/place-index/place${qs({ ref })}`),
  /** BO2h — ours beside each provider's. Spends: one detail call per place. */
  adminPlaceCompare: (ref: string, match = false) =>
    request<{ ref: string; name: string | null; columns: CompareColumn[]; rows: CompareRow[]; ours: string[];
      /** What matching it by name and distance costs, in pence, from the API's own price table. */
      matchPence?: number }>(`/api/admin/place-index/place/compare${qs({ ref, match: match ? 1 : undefined })}`),
  /** BO2r — literally the fields each source returned, and which were never asked. */
  adminPlaceRaw: (ref: string) => request<{ ref: string; sources: RawSource[] }>(`/api/admin/place-index/place/raw${qs({ ref })}`),
  /** BO2r's History: which run changed what. */
  adminPlaceHistory: (ref: string) => request<{ rows: PlaceHistoryRow[] }>(`/api/admin/place-index/place/history${qs({ ref })}`),
  /** How far a change to the shelf would travel, before it travels. */
  adminPlaceReach: (ref: string, sub?: string) =>
    request<{ rule: string | null; places: number; counties: number; onlyThis: boolean; to: string | null }>(`/api/admin/place-index/place/reach${qs({ ref, sub })}`),
  /** Edit one of our own values. A provider's column is never editable. */
  adminEditPlace: (body: { ref: string; field: string; value: unknown }) =>
    request<{ ok: true; ref: string; field: string }>('/api/admin/place-index/place', { method: 'PATCH', body: JSON.stringify(body) }),
  /** BO2j — the picture index, with every licence field. */
  adminPictures: (p: { q?: string; facet?: string; limit?: number } = {}) => request<PictureIndex>(`/api/admin/place-index/pictures${qs(p)}`),
  /** BO2k — what counts as ready, per kind of place. */
  adminReadyBars: () => request<ReadyBars>('/api/admin/place-index/bars'),
  adminReadyBarFacts: (sub: string) => request<{ places: number; held: Record<string, number> }>(`/api/admin/place-index/bars/${encodeURIComponent(sub)}/facts`),
  /** What saving this bar would do, stated before it saves. */
  adminReadyBarEffect: (sub: string, facts: BarFact[]) => post<BarEffect>(`/api/admin/place-index/bars/${encodeURIComponent(sub)}/effect`, { facts }),
  adminSaveReadyBar: (sub: string, facts: BarFact[]) => put<{ ok: true; rescored: number }>(`/api/admin/place-index/bars/${encodeURIComponent(sub)}`, { facts }),
  /**
   * Work one place's score out again and write it down. Free — `score()` is pure
   * and recomputes from what we already hold; asking a provider for a fresh
   * rating is a collection run and happens on Places, where the spend is said.
   */
  adminRescoreOne: (ref: string) => post<{ ref: string; epicScore: number; ownedScore: number; spentPence: number; at: string }>('/api/admin/score', { ref }),
  /** The travel-time matrix: stamp the places with a cell, then work the times out. */
  adminReachState: () => request<{ cells: number; withPlaces: number; places: number; needsRebuild?: string[] }>('/api/admin/reach'),
  adminBuildReach: (mode = 'driving') => post<{ started?: boolean; cells?: number; pairs?: number }>('/api/admin/reach/refresh', { mode }),
  /** Write these places up ourselves — their own page, the encyclopedias, OSM. Free. */
  adminCuratePlaces: (refs: string[]) =>
    post<{ started: number; refused: { ref: string; why: string }[]; spentPence: number }>('/api/admin/place-index/curate', { refs }),
  /**
   * Ask the paid sources about these places. Says what it cost.
   *
   * `names` is for this screen and no longer: a provider's name is rented, so it
   * is handed back so a row stops being a bare identifier and is never written
   * down. What is kept is the band and the identifier, which are ours.
   */
  adminAskAboutPlaces: (refs: string[]) =>
    post<{ asked: number; refused: { ref: string; why: string }[]; names: { ref: string; name: string }[]; spentPence: number }>('/api/admin/place-index/ask', { refs }),
  /**
   * Collect here — go and get what is missing for the area you are standing in.
   *
   * Carries its own scope, and the chosen sources decide what is asked. A run
   * that would cross the month's ceiling is refused with what is left, rather
   * than half-done.
   */
  adminCollect: (p: PlaceWhere & { cat?: string | null; sub?: string | null; sources: string[]; limit?: number }) =>
    post<{
      started: true; places: number; sources: string[]; free: number; paid: number;
      /** Per provider, because the two paid sources are not interchangeable:
       *  Google's ceiling is money and Tripadvisor's is a count of calls. */
      google: number; tripadvisor: number; tripadvisorCapped: number; tripadvisorLeft: number;
      /** Places a source has already seen inside the staleness window, so not asked again. */
      fresh: { google: number; tripadvisor: number; free: number }; staleMonths: number;
      spendPence: number; leftPence: number;
    }>('/api/admin/place-index/collect', p),
  /** Look for a picture we may keep, and put it in the library if there is one. */
  adminFindPictures: (refs: string[]) =>
    post<{ found: number; results: { ref: string; state: string; rung?: string }[]; spentPence: number }>('/api/admin/place-index/pictures/find', { refs }),
  /** Keeping it current. All three are free and spend nothing. */
  adminReindexPlaces: (wait = false) => post<{ started?: boolean; places?: number; rescored?: number; ms?: number }>('/api/admin/place-index/reindex', { wait }),
  adminRefreshPlaceCounts: () => post<{ n: number; at: string }>('/api/admin/place-index/refresh', {}),
  adminRescorePlaces: (subcategory?: string) => post<{ rescored: number }>('/api/admin/place-index/rescore', { subcategory }),
  /** The area search box: a county, a town or a postcode. */
  adminPlaceSearch: (q: string) =>
    request<{
      /** `known` is how many places it holds, so two areas of the same name can be told apart. */
      areas: { slug: string; name: string; kind: string; parent: string | null; known?: number }[];
      /** Places called that — names that are ours to hold, never a provider's. */
      places?: { ref: string; name: string; where: string | null }[];
      postcode: { sector: string; cell: string; label: string; bands: number[]; modes: string[] } | null;
    }>(`/api/admin/place-index/search${qs({ q })}`),


  /**
   * BO2i — one place's Epic score with its working shown: what went in, what
   * each part was worth, and the two numbers out. `ownedScore` is the same
   * ranking with the licensed input removed, which is what proves the ordering
   * survives a provider going dark.
   */
  /**
   * One place's score and how it got there.
   *
   * A place we hold nothing to score comes back with `scored: false` and the
   * words to print — a 200, not a 404, because "never swept" is an ordinary
   * state rather than a failure.
   */
  adminScore: (ref: string) =>
    request<ScoreWorkings & { scored?: boolean; why?: string }>(`/api/admin/score${qs({ ref })}`),
  adminScoreWeights: () => request<{ weights: Record<string, any> }>('/api/admin/score/weights'),

  /** BO3a / BO3c — the runs that spend, and which of them need looking at. */
  adminRuns: () => request<RunsList>('/api/admin/runs'),
  /** BO3b — one run's failures, ours kept separate from theirs. */
  adminRunFailures: (key: string) => request<RunFailures>(`/api/admin/runs/${key}/failures`),
  adminRunFailing: (key: string, p: { cause: string; ours?: string }) =>
    request<{ rows: { venue_ref: string; label: string; why: string; menu_url: string | null; read_at: string; attempts: number }[] }>(`/api/admin/runs/${key}/failing${qs(p)}`),
  adminRunHistory: (key: string) => request<{ rows: Record<string, unknown>[] }>(`/api/admin/runs/${key}/history`),
  adminSetCollectCeiling: (pence: number) => put<{ pence: number }>('/api/admin/runs/ceiling', { pence }),

  /** BO4a — three numbers, never one rate. */
  adminDemand: (p: { where?: string | null; since?: number } = {}) => request<DemandReport>(`/api/admin/demand${qs(p)}`),
  /** BO4b — one search, replayed exactly as they saw it. */
  /**
   * One search, replayed.
   *
   * `names: true` asks the provider for the names of the rows we hold none of.
   * That is a paid call each and needs Manage the library, so it is opt-in and
   * the cost is on the button — not something a page load does forty times.
   */
  adminDemandSearch: (id: string, names = false) =>
    request<SearchReplay>(`/api/admin/demand/search${qs({ id, names: names ? '1' : undefined })}`),
  adminDemandSize: () => request<{ rows: string; oldest: string | null }>('/api/admin/demand/size'),

  /** BO5a — one queue with a filter, not a queue per kind. */
  adminQueue: (p: { kind?: string; state?: string; where?: string | null } = {}) => request<QueueList>(`/api/admin/queue${qs(p)}`),
  adminQueueItem: (id: string) => request<QueueItem>(`/api/admin/queue/${id}`),
  /**
   * `stale` is what was *not* approved: a household rewrote it after the row
   * was raised, so nobody has read those words and it is still waiting.
   */
  /**
   * `seen` is id → the version of the words the screen drew, so a decision is
   * about what somebody actually read. Without it nothing is held back.
   */
  adminQueueApprove: (ids: string[], seen?: Record<string, string | null>) =>
    post<{ approved: number; ids: string[]; stale?: string[]; why?: string }>('/api/admin/queue/approve', { ids, ...(seen ? { seen } : {}) }),
  /** BO5b — the rejection, beside the message it sends. */
  /**
   * `seen` is the version of the words the screen drew, as approving carries —
   * a rejection is a decision about words too, and one made after a rewrite
   * suppresses text nobody read.
   */
  adminQueueReject: (id: string, body: { reason: string; message?: string | null; tell?: boolean; seen?: string | null }) =>
    post<{ ok: true; id: string; reason: string; told: boolean; message: string | null; why: string | null; stale?: boolean }>(`/api/admin/queue/${id}/reject`, body),
  /**
   * Somebody has flagged this. Reported content jumps the queue and has a lane
   * of its own; nothing in the app could put anything in it, so the lane was
   * permanently empty (17 Sep 2026, the verification audit).
   */
  adminQueueReport: (id: string, reason?: string) =>
    post<{ ok: true; id: string }>(`/api/admin/queue/${id}/report`, { reason: reason ?? null }),
  adminQueueReasons: () => request<{ reasons: Record<string, RejectReason[]>; used: { kind: string; reason: string; used: number; last_at: string }[] }>('/api/admin/queue/report/reasons'),

  /** What asking Google about a selection would cost, from the API's own price table. */
  adminAskQuote: (refs: string[]) =>
    request<{ pence: number; refs: number; off?: boolean }>(`/api/admin/place-index/ask/quote${qs({ refs: refs.join(',') })}`),

  /** What the screen actually drew, which is not the whole of what came back. */
  searchDrawn: (body: { queryId: string; refs: string[] }) => post<{ ok: boolean }>('/api/discover/drawn', body),

  /** What the household did to one of the results — the click stream Demand counts. */
  searchEvent: (body: { queryId: string; kind: 'open' | 'dismiss' | 'save' | 'shortlist' | 'add_to_trip' | 'refine' | 'close'; venueRef?: string | null; position?: number | null; dwellMs?: number | null }) =>
    // `ok` is whether the event was *written*, not whether the request landed:
    // the client only stops retrying an open on a true (Codex, 18 Sep 2026).
    post<{ ok: boolean }>('/api/discover/event', body),

  reportHost: (id: string, reason: string, offerId?: string | null) => post<{ ok: true; message: string }>(`/api/hosts/${id}/report`, { reason, offerId }),
  bookings: () => request<{ bookings: Booking[] }>('/api/bookings'),
  booking: (id: string) => request<{ booking: Booking; payments: PaymentsConfig }>(`/api/bookings/${id}`),
  cancelBooking: (id: string) => post<{ booking: Booking; refunded: boolean }>(`/api/bookings/${id}/cancel`, {}),
  reviewHost: (bookingId: string, body: { stars: number; chips: string[]; text?: string | null; photoId?: string | null }) =>
    post<{ review: { id: string; stars: number; chips: string[]; text: string | null; publishOn: string }; booking: Booking }>(`/api/bookings/${bookingId}/review`, body),
  /** The back office: pitch review and the ladder. */
  adminHosting: () => request<AdminHosting>('/api/admin/hosting'),
  /** The one ID check in Casual meet ups (O9): the queue, and the decision. Nobody clears their own. */
  adminOpenChecks: () => request<{ checks: AdminIdCheck[] }>('/api/admin/open/checks'),
  /**
   * One of the two images, as a blob held only while the reviewer is looking.
   * Never a URL opened in a tab: a passport does not belong in a browser's
   * history, and this address is no-store for the same reason.
   */
  idCheckImage: async (path: string) => {
    const token = sessionToken();
    const res = await fetch(`${API_URL}${path}`, {
      credentials: 'include', cache: 'no-store',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('That image is no longer there.');
    return URL.createObjectURL(await res.blob());
  },
  decideIdCheck: (id: string, decision: 'pass' | 'fail', note: string | null) =>
    post<{ check: OpenIdCheck; stage: string | null }>(`/api/admin/open/checks/${id}/decide`, { decision, note }),
  adminMail: (days: number, status?: string | null) => request<AdminMail>(`/api/admin/mail?days=${days}${status ? `&status=${encodeURIComponent(status)}` : ''}`),
  decideOffer: (id: string, decision: 'live' | 'changes', note: string | null, checklist?: Record<string, string>) => post<{ offer: Experience }>(`/api/admin/hosting/offers/${id}/decide`, { decision, note, checklist }),
  setHostTrust: (id: string, body: { trust?: TrustLevel; checks?: 'running' | 'passed' }) => patch<{ host: OwnHost }>(`/api/admin/hosting/hosts/${id}`, body),
  resolveHostReport: (id: string) => post<void>(`/api/admin/hosting/reports/${id}/resolve`, {}),
  /** The six-digit code on an invite (G20), and the waiting list on a full group (G24). */
  joinCode: (token: string, participantToken: string, code: string) => post<GuestJoinResult>(`/api/join/${token}/code`, { participantToken, code }),
  joinCodeAgain: (token: string, participantToken: string) => post<{ codeSent: boolean; contact: string; expiresInMinutes: number; message: string }>(`/api/join/${token}/code/again`, { participantToken }),
  joinWaitlist: (token: string, contact: string) => post<{ ok: true; message: string }>(`/api/join/${token}/waitlist`, { contact }),

  /**
   * The passcode, once. The token is kept on the device from here on; the
   * cookie the API also sets exists only so an `<img>` can load a photograph.
   */
  signIn: async (passcode: string): Promise<SessionState> => {
    const r = await post<{ token: string; session: SessionSummary; account?: AccountSummary | null }>('/api/session', { passcode, label: deviceLabel() });
    await claimDeviceCopy(r.account);
    setSessionToken(r.token);
    // Anything written while they were signed out goes now.
    void api.sendWaitingWrites();
    // The passcode is the owner's own way in, whether or not he has claimed an
    // account row yet (api/src/auth.js `requireOwner`).
    return { signedIn: true, configured: true, session: r.session, account: r.account ?? null, isOwner: true };
  },

  /**
   * Sign out. The device's saved copy is deliberately *not* thrown away here —
   * it is the same household's data and they will sign back in — but anything
   * still waiting to be sent is reported first, so nobody signs out on top of
   * unsent ratings without being told.
   */
  signOut: async ({ everywhere = false } = {}): Promise<void> => {
    try { await del<void>(`/api/session${everywhere ? '?all=1' : ''}`); } catch { /* leaving is not something the server can refuse */ }
    setSessionToken(null);
  },

  /** The devices signed in, for Settings. Their own, never the whole estate's. */
  devices: () => request<{ sessions: (SessionSummary & { lastSeen: string })[] }>('/api/sessions'),

  /**
   * A magic link, exchanged for a session.
   *
   * The token is in the address the person opened (`?signin=…`). It works once,
   * so this is called exactly once and the address is cleaned immediately
   * afterwards — a link left in the URL bar is a link that gets bookmarked,
   * shared and pasted into a chat.
   */
  signInWithLink: async (token: string): Promise<SessionState> => {
    const r = await post<{ token: string; session: SessionSummary; account: AccountSummary }>(
      '/api/session/link', { token, label: deviceLabel() },
    );
    await claimDeviceCopy(r.account);
    setSessionToken(r.token);
    void api.sendWaitingWrites();
    return { signedIn: true, configured: true, session: r.session, account: r.account, isOwner: r.account?.role === 'owner' };
  },

  /**
   * "E-mail me a link." Answers the same whether or not the address has an
   * account, so it cannot be used to find out who else uses Epic.
   */
  requestSignInLink: (email: string) => post<{ sent: boolean; message: string }>('/api/session/request-link', { email }),

  // --- voice: the two stages (routes/voice.js) -------------------------------
  // The recording itself goes through `voice/client.ts`, not here: it is the
  // one body in the app that is not JSON and must never be cached or queued.
  voiceConfig: () => request<VoiceConfig>('/api/voice/config'),
  voiceLiveToken: (body: { language?: string | null; sessionId?: string | null }) => post<VoiceLiveToken>('/api/voice/live-token', body),
  voiceLiveUsed: (body: { seconds: number; sessionId?: string | null; model?: string | null }) => post<{ recorded: boolean }>('/api/voice/live-used', body),
  voicePlan: (body: { transcript: string; language?: string | null; sessionId?: string | null; context?: Record<string, unknown> | null }) => post<VoicePlanResponse>('/api/voice/plan', body),
  // The intake: words → facts → chips (voice intake handoff, 8 Sep 2026).
  voiceIntake: (body: { transcript: string; flow?: IntakeFlow; mode?: IntakeMode; page?: number | null; intakeId?: string | null; language?: string | null; sessionId?: string | null }) =>
    post<{ intake: Intake }>('/api/voice/intake', body),
  voiceIntakeGet: (id: string) => request<{ intake: Intake }>(`/api/voice/intake/${id}`),
  voiceIntakeForTrip: (tripId: string) => request<{ intake: Intake | null }>(`/api/voice/intake/for-trip/${tripId}`),
  voiceIntakePatch: (id: string, body: { set?: Record<string, unknown>; answer?: Record<string, unknown>; tripId?: string | null; harvested?: boolean }) =>
    patch<{ intake: Intake }>(`/api/voice/intake/${id}`, body),
  voiceIntakeRemember: (id: string) => post<{ written: { memberId: string; kind: string; value: unknown }[]; intake: Intake }>(`/api/voice/intake/${id}/remember`, {}),
  // The household, spoken (set-up row O; Option D).
  voiceHouseholdWho: (body: { transcript: string; sessionId?: string | null }) => post<{ people: SpokenPerson[] }>('/api/voice/household/who', body),
  voiceHouseholdWhoApply: (body: { people: SpokenPerson[] }) => post<{ members: Member[]; written: { id: string; name: string; updated: boolean }[] }>('/api/voice/household/who/apply', body),
  voiceHouseholdFood: (body: { transcript: string; memberId?: string | null; sessionId?: string | null }) => post<{ items: SpokenFood[] }>('/api/voice/household/food', body),
  voiceHouseholdLikes: (body: { transcript: string; memberId?: string | null; sessionId?: string | null }) => post<{ items: SpokenLike[]; mobility: string | null }>('/api/voice/household/likes', body),
  voiceHouseholdApply: (body: { memberId?: string | null; food?: SpokenFood[]; likes?: SpokenLike[] }) => post<{ written: unknown[]; members: Member[] }>('/api/voice/household/apply', body),
  // The lab (back office): the sentences to read, the runs, the tally.
  voiceLab: () => request<VoiceLabInfo>('/api/admin/voice/utterances'),
  voiceProbe: () => request<VoiceProbe>('/api/admin/voice/probe'),
  voiceRuns: (limit = 100) => request<VoiceRuns>(`/api/admin/voice/runs?limit=${limit}`),
  voiceRecordRun: (body: VoiceRunInput) => post<{ run: VoiceRun }>('/api/admin/voice/runs', body),
  voiceDeleteRun: (id: string) => del<{ removed: boolean }>(`/api/admin/voice/runs/${id}`),

  // --- the admin module: only the owner's API answers any of these ----------

  /** Everybody who has Epic, with what they are on and what they have spent. */
  accounts: () => request<AccountsResponse>('/api/accounts'),
  /** One of them, with the sign-ins behind the count. */
  account: (id: string) => request<{ account: Account; signIns: { id: string; method: string; label: string | null; at: string }[]; lastInvite: AccountInvite | null }>(`/api/accounts/${id}`),
  /** Add a person: a household of their own, and an invitation unless told not to. */
  addAccount: (body: { email: string; name?: string; plan?: string; trialEndsOn?: string | null; monthlyCallBound?: number | null; note?: string; invite?: boolean }) =>
    post<{ account: Account; invitation: Invitation | null }>('/api/accounts', body),
  /** The owner's own account, on the household he already has. */
  claimOwnerAccount: (body: { email: string; name?: string }) => post<{ account: Account }>('/api/accounts/owner', body),
  /** Plan, status, ceiling, note. */
  updateAccount: (id: string, body: Partial<{ name: string; plan: string; status: string; trialEndsOn: string | null; monthlyCallBound: number | null; note: string }>) =>
    patch<{ account: Account }>(`/api/accounts/${id}`, body),
  /** A fresh link — sent if there is a sender, and shown either way so it can be sent by hand. */
  inviteAccount: (id: string) => post<{ account: Account; invitation: Invitation }>(`/api/accounts/${id}/invite`, {}),
  /** Sign every device that account is on out. */
  signOutAccount: (id: string) => post<{ account: Account; signedOut: boolean }>(`/api/accounts/${id}/sign-out`, {}),
  /** Remove the account. Their household's data only goes with it when asked. */
  removeAccount: (id: string, { withHousehold = false } = {}) =>
    del<{ removed: boolean; withHousehold: boolean; message: string }>(`/api/accounts/${id}${withHousehold ? '?withHousehold=1' : ''}`),


  // --- the back office ------------------------------------------------------
  //
  // Every one of these answers 404 to a session without the admin door, so the
  // app drawing them at all is a courtesy rather than the security boundary.

  adminOverview: (days = 30) => request<AdminOverview>(`/api/admin/overview?days=${days}`),
  /** Data › Sources: the catalogue of providers and fields, joined to what we hold. */
  adminSources: () => request<SourcesReport>('/api/admin/data/sources'),
  /** The correctness bench: runs so far, and what one can ask. */
  sourceBenchRuns: () => request<SourceBenchIndex>('/api/admin/data/sources/bench'),
  /** Run one: a sample of owned places checked against Google, field by field. Their values come back here and are not kept. */
  runSourceBench: (body: { provider: string; fields: string[]; sample: number }) => post<SourceBenchResult>('/api/admin/data/sources/bench', body),
  sourceBenchDecide: (id: string, index: number, decision: SourceBenchDecision | null) => patch<{ run: SourceBenchRun }>(`/api/admin/data/sources/bench/${id}`, { index, decision }),
  adminPeople: (days = 30) => request<AdminPeople>(`/api/admin/people?days=${days}`),
  adminPerson: (id: string, days = 30) => request<PersonRecord>(`/api/admin/people/${id}?days=${days}`),
  adminSetRole: (id: string, roleId: string | null) => patch<{ account: { id: string; role: any } }>(`/api/admin/people/${id}/role`, { roleId }),
  adminActivity: (days = 30) => request<{ window: { days: number }; feed: FeedRow[]; screens: ScreenRow[]; daily: DailyRow[]; active: Engagement['active'] }>(`/api/admin/activity?days=${days}`),
  adminEngagement: (days = 30) => request<Engagement>(`/api/admin/reporting/engagement?days=${days}`),
  adminRevenue: () => request<RevenueReport>('/api/admin/reporting/revenue'),
  adminUsage: (days = 30) => request<UsageReport>(`/api/admin/reporting/usage?days=${days}`),
  adminRoles: () => request<{ roles: Role[]; capabilities: Capability[]; doors: string[] }>('/api/admin/roles'),
  adminCreateRole: (body: { key: string; label: string; description?: string; doors: string[]; capabilities: string[] }) =>
    post<{ role: Role }>('/api/admin/roles', body),
  adminUpdateRole: (id: string, body: Partial<{ label: string; description: string; doors: string[]; capabilities: string[] }>) =>
    patch<{ role: Role }>(`/api/admin/roles/${id}`, body),
  adminDeleteRole: (id: string) => del<{ removed: boolean }>(`/api/admin/roles/${id}`),
  adminPlans: () => request<{ plans: SubscriptionPlan[] }>('/api/admin/plans'),
  adminUpdatePlan: (key: string, body: Partial<{ label: string; note: string; pricePence: number | null; callBound: number | null; active: boolean }>) =>
    patch<{ plan: SubscriptionPlan }>(`/api/admin/plans/${key}`, body),
  adminAudit: (limit = 200) => request<{ audit: AuditRow[] }>(`/api/admin/audit?limit=${limit}`),

  // --- the atlas library: attractions, and the pictures we own ---------------
  // Owner, 4 Sep 2026: "the top 15 to 20 attractions in each county and the top
  // 100 or so in London… images that we can hold in a database… some form of
  // index, a proper form of indexing, so we can search and find the images that
  // we own."
  scoutAreas: () => request<{ areas: ScoutArea[] }>('/api/admin/scout/'),
  scoutAddArea: (body: { code: string; label?: string; radiusKm?: number; keep?: number }) =>
    post<{ area: ScoutArea }>('/api/admin/scout/areas', body),
  scoutSweep: (code: string) => post<Record<string, unknown>>(`/api/admin/scout/areas/${code}/sweep`, {}),
  scoutRescore: (code: string) => post<{ code: string; rescored: number }>(`/api/admin/scout/areas/${code}/rescore`, {}),
  scoutFillMenus: (limit = 5) => post<Record<string, unknown>>('/api/admin/scout/menus/fill', { limit }),
  /**
   * Read the menus.
   *
   * `ref` reads one place's and waits for it, which is what the Read button on
   * a place's own record needs; without it the whole board did the batch or
   * nothing.
   */
  scoutReadMenus: (limit = 10, ref?: string) =>
    post<{ started?: number; read?: number }>('/api/admin/scout/menus/read', ref ? { ref, wait: true } : { limit }),
  scoutRetryMenus: () => post<{ requeued: number }>('/api/admin/scout/menus/retry', {}),
  scoutMisses: () => request<{ misses: ScoutMenuMiss[] }>('/api/admin/scout/menus/missing'),
  /** The backlog grouped by what would fix it — "seventeen places, one fix". */
  scoutCauses: () => request<{ causes: MenuCause[] }>('/api/admin/scout/menus/causes'),
  scoutClassify: () => post<{ looked: number; classified: number }>('/api/admin/scout/menus/classify', {}),
  scoutRetryCause: (cause: string) =>
    post<{ requeued: number }>(`/api/admin/scout/menus/causes/${encodeURIComponent(cause)}/retry`, {}),
  /** Every verdict recorded for one area — the trend, which is what the table is for. */
  benchRuns: (code: string) => request<{ runs: BenchRun[] }>(`/api/admin/scout/bench/${encodeURIComponent(code)}`),
  /** Run one. Spends about twenty pence and keeps only the verdict. */
  runBench: (code: string) => post<BenchResult>(`/api/admin/scout/bench/${encodeURIComponent(code)}`, {}),
  scoutPlaces: (code: string, limit = 25) =>
    request<{ area: { code: string; label: string | null; sweptAt: string | null }; places: ScoutPlace[] }>(`/api/places/area/${code}?limit=${limit}`),
  // --- places you can point at (routes/localities.js) ---
  placeTree: () => request<PlaceTree>('/api/admin/places/'),
  placeSearch: (q: string) => request<{ places: Locality[] }>(`/api/admin/places/search${qs({ q })}`),
  /** No argument is the estate; a county is that county and everything under and across it. */
  placeCoverage: (p: { county?: string | null; slugs?: string[] } = {}) =>
    request<{ rows: CoverageRow[]; facts: FactKey[] }>(
      `/api/admin/places/coverage${qs({ county: p.county ?? undefined, slugs: p.slugs?.length ? p.slugs.join(',') : undefined })}`),
  locality: (slug: string, p: { kind?: 'go' | 'eat'; missing?: FactKey; limit?: number } = {}) =>
    request<LocalityPage>(`/api/admin/places/${encodeURIComponent(slug)}${qs(p)}`),
  /** `region` fills one county rather than scattering names across the country. */
  placePass: (which: 'postal' | 'naming', p: { limit?: number; region?: string | null } = {}) =>
    post<{ started: string; limit: number; region: string | null }>('/api/admin/places/pass', { which, ...p }),
  placeRecount: () => post<{ ok: boolean }>('/api/admin/places/recount', {}),

  // --- lookup: one place, one travel time, and what every source has inside it (routes/lookup.js) ---
  lookup: (p: { q: string; minutes: number; mode: string }) => request<LookupResult>(`/api/admin/lookup${qs(p)}`),
  /** One place opened: each provider's record as it arrived, and the row Epic resolved from them. */
  lookupPlace: (p: { q: string; minutes: number; mode: string; ref: string }) => request<LookupOpened>(`/api/admin/lookup/place${qs(p)}`),
  /** Ours beside Google's and Tripadvisor's, field by field — one detail call each, held in memory a few hours. */
  lookupCompare: (p: { q: string; minutes: number; mode: string; ref: string }) => request<LookupCompare>(`/api/admin/lookup/compare${qs(p)}`),
  /** Google's rating and count for the not-owned places that have none, a page at a time. */
  lookupRate: (p: { q: string; minutes: number; mode: string; kind: 'activities' | 'food'; limit?: number }) => post<LookupRun>('/api/admin/lookup/rate', p),
  /** Join the not-owned places to Tripadvisor by name, best first, under the month's cap. */
  lookupTripadvisor: (p: { q: string; minutes: number; mode: string; kind: 'activities' | 'food'; limit?: number }) => post<LookupRun>('/api/admin/lookup/tripadvisor', p),
  /** Claim, research, read the place's own pages and write our account of it; keep the crowd as bands. */
  lookupCurate: (p: { q: string; minutes: number; mode: string; ref: string }) => post<LookupCurated>('/api/admin/lookup/curate', p),

  // --- correcting a category where the mistake is (routes/library.js) ---
  categoryRead: (id: string, said: string) =>
    post<{ proposal: CategoryProposal }>(`/api/admin/library/attractions/${id}/category/read`, { said }),
  categorySave: (id: string, body: { scope: 'place' | 'kind' | 'category'; subject: string; category: string; reason?: string; weights?: ShelfWeights | null }) =>
    post<{ moved: number; rule: ShelfRule | null }>(`/api/admin/library/attractions/${id}/category`, body),

  libraryOverview: () => request<LibraryOverview>('/api/admin/library'),
  libraryRegions: () => request<{ regions: LibraryRegion[] }>('/api/admin/library/regions'),
  librarySetTarget: (slug: string, targetCount: number) =>
    patch<{ region: LibraryRegion }>(`/api/admin/library/regions/${slug}`, { targetCount }),
  libraryRank: (slug: string) => post<{ region: LibraryRegion }>(`/api/admin/library/regions/${slug}/rank`, {}),
  libraryTypes: (p: { region?: string; state?: string } = {}) =>
    request<{ types: LibraryType[] }>(`/api/admin/library/types${qs(p)}`),
  libraryAttractions: (p: { region?: string; state?: string; q?: string; category?: string; kind?: string; limit?: number }) =>
    request<{ attractions: LibraryAttraction[] }>(`/api/admin/library/attractions${qs(p)}`),

  /**
   * Who can be visited, who cannot, and who nobody has established.
   *
   * The third of those is the one worth a screen: a place is only shown when
   * something says the public may come, so an unestablished place is invisible
   * — and an invisible place with no list to appear on is indistinguishable
   * from a bug (owner, 7 Sep 2026).
   */
  libraryVisiting: (p: { limit?: number } = {}) =>
    request<LibraryVisiting>(`/api/admin/library/visiting${qs(p)}`),
  libraryVisitingImpact: () => request<LibraryVisitingImpact>('/api/admin/library/visiting/impact'),
  libraryVisitingGather: (body: { region?: string | null; limit?: number } = {}) =>
    post<{ counts: { looked: number; withOsm: number; withCategories: number } }>('/api/admin/library/visiting/gather', body),
  libraryVisitingRejudge: (body: { region?: string | null } = {}) =>
    post<{ counts: { looked: number; yes: number; no: number; unknown: number; changed: number } }>('/api/admin/library/visiting/rejudge', body),
  libraryCurate: (id: string, body: { state?: string; pinned?: boolean; note?: string; visiting?: 'yes' | 'no' | null; visitingBecause?: string }) =>
    patch<{ attraction: LibraryAttraction }>(`/api/admin/library/attractions/${id}`, body),
  libraryImages: (p: { q?: string; source?: string; licence?: string; region?: string; category?: string; subjectType?: string; subjectId?: string; moderation?: string; unlinked?: boolean; credit?: boolean; limit?: number; offset?: number }) =>
    request<{ images: LibraryImage[]; total: number }>(`/api/admin/library/images${qs(p)}`),
  libraryImage: (id: string) => request<{ image: LibraryImage & { variants: { width: number; actualWidth: number; bytes: number }[] }; links: any[] }>(`/api/admin/library/images/${id}`),
  libraryModerate: (id: string, body: { moderation?: string; note?: string; points?: number }) =>
    patch<{ image: LibraryImage }>(`/api/admin/library/images/${id}`, body),
  libraryDeleteImage: (id: string) => del<{ ok: boolean }>(`/api/admin/library/images/${id}`),
  libraryKinds: (p: { q?: string; admit?: boolean; limit?: number } = {}) => request<{ kinds: LibraryKind[] }>(`/api/admin/library/kinds${qs(p)}`),
  librarySetKind: (qid: string, body: { admit?: boolean; category?: string }) =>
    patch<{ kind: LibraryKind }>(`/api/admin/library/kinds/${qid}`, body),
  libraryContributors: () => request<LibraryContributor[]>('/api/admin/library/contributors').then((r: any) => r.contributors ?? r),
  // --- reading a place, and being taught what we got wrong ------------------
  libraryAttraction: (id: string) =>
    request<{ attraction: LibraryAttractionDetail; facts: AttractionFactsRow | null; contents: PlaceContent[]; lessons: ExtractionLesson[] }>(`/api/admin/library/attractions/${id}`),
  libraryFetchDetail: (id: string, force = false) =>
    post<{ state: string; sections: number; contentsCount: number; attraction: LibraryAttractionDetail }>(`/api/admin/library/attractions/${id}/detail`, { force }),
  libraryRead: (id: string, effort?: string) =>
    post<{ facts: AttractionFactsRow; lessons: ExtractionLesson[]; examples: number }>(`/api/admin/library/attractions/${id}/read`, { effort }),
  libraryReview: (id: string, body: { review: 'approved' | 'corrected' | 'rejected'; note?: string; wrongFields?: string[]; lesson?: { scope?: string; subject?: string | null; subjectLabel?: string | null; rule: string; field?: string | null; said?: string | null } }) =>
    post<{ facts: AttractionFactsRow; lesson: ExtractionLesson | null }>(`/api/admin/library/attractions/${id}/review`, body),
  libraryLessons: (p: { scope?: string; region?: string } = {}) =>
    request<{ lessons: ExtractionLesson[]; stats: ReadingStats }>(`/api/admin/library/lessons${qs(p)}`),
  librarySetLesson: (id: string, body: { active?: boolean; rule?: string; field?: string | null }) =>
    patch<{ lesson: ExtractionLesson }>(`/api/admin/library/lessons/${id}`, body),
  libraryRegionDetail: (slug: string, limit = 50, force = false) =>
    post<{ counts: Record<string, number> }>(`/api/admin/library/regions/${slug}/detail`, { limit, force }),
  libraryRegionRead: (slug: string, limit = 25, anyway = false) =>
    post<{ read: number; failed: number; errors: string[] }>(`/api/admin/library/regions/${slug}/read`, { limit, anyway }),
  // --- the shelves: teaching what the home screen calls a place -------------
  shelfVocabulary: () => request<ShelfVocabulary>('/api/admin/shelves/'),
  shelfContents: (p: { mood: MoodKey; subcategory?: string; lat?: number; lng?: number; km?: number }) =>
    request<{
      mood: MoodKey; subcategory: string | null;
      place: { lat: number; lng: number; label: string | null }; km: number;
      items: ShelfPlace[]; nearly: ShelfPlace[]; pool: number;
      /** How this shelf divides up, `key: null` being the unsorted pile. */
      drawers: { key: string | null; label: string; category_key: MoodKey; count: number }[];
    }>(`/api/admin/shelves/shelf${qs(p)}`),
  shelfFindPlaces: (q: string) => request<{ places: ShelfPlace[] }>(`/api/admin/shelves/places${qs({ q })}`),
  /**
   * Somewhere to eat, as the Places tab sees it. Costs a provider call unless
   * the same corner was looked at recently, so it runs on a press.
   */
  shelfFoodPlaces: (p: { q?: string; km?: number; lat?: number; lng?: number } = {}) =>
    request<{
      place: { lat: number; lng: number; label: string | null }; km: number; q: string | null;
      items: ShelfPlace[];
      drawers: { key: string | null; label: string; count: number }[];
      cached: boolean; sources: string[]; degraded?: string[];
    }>(`/api/admin/shelves/food${qs(p)}`),
  shelfTeach: (body: { scope: ShelfRule['scope']; subject: string; subjectLabel?: string | null; weights: ShelfWeights; subcategory?: string | null; reason?: string | null }) =>
    put<{ rule: ShelfRule }>('/api/admin/shelves/rules', body),
  /**
   * The fast one: move this place, now. Naming a subcategory is enough — the
   * category comes with it, because a drawer belongs to exactly one cabinet.
   */
  shelfMovePlace: (body: { ref: string; label?: string | null; category?: MoodKey | null; subcategory?: string | null; reason?: string | null }) =>
    put<{ rule: ShelfRule; category: MoodKey; subcategory: string | null }>('/api/admin/shelves/place', body),
  shelfSaveCategory: (body: { key?: string; label?: string; blurb?: string | null; icon?: string | null; position?: number; isDoor?: boolean; active?: boolean }) =>
    put<{ category: ShelfCategory }>('/api/admin/shelves/categories', body),
  shelfDeleteCategory: (key: string) => del<{ removed: boolean }>(`/api/admin/shelves/categories/${key}`),
  shelfSaveSubcategory: (body: { id?: string; key?: string; categoryKey?: MoodKey; label?: string; blurb?: string | null; position?: number; active?: boolean; indoor?: boolean | 'unset'; forKids?: boolean | 'unset'; alsoIn?: MoodKey[] }) =>
    put<{ subcategory: ShelfSubcategory }>('/api/admin/shelves/subcategories', body),
  shelfDeleteSubcategory: (id: string) => del<{ removed: boolean }>(`/api/admin/shelves/subcategories/${id}`),
  shelfForget: (id: string) => del<{ removed: boolean; rule: ShelfRule }>(`/api/admin/shelves/rules/${id}`),
  shelfRead: (body: { said: string; subject?: string | null; subjectLabel?: string | null; scope?: ShelfRule['scope'] | null; current?: ShelfWeights | null }) =>
    post<{ proposal: ShelfProposal }>('/api/admin/shelves/read', body),
  shelfNameKinds: (limit = 400) => post<{ named: number; asked: number; remaining: number }>('/api/admin/shelves/kinds/name', { limit }),
  // --- the taxonomy: categories, every provider's words, and the rules between --
  taxonomy: () => request<Taxonomy>('/api/admin/taxonomy/'),
  taxonomyLabels: (p: { namespace?: string | null; q?: string; all?: boolean; limit?: number; offset?: number } = {}) =>
    request<{ namespace: string | null; labels: TaxonomyLabel[]; offset: number; more: boolean; secondary: SecondaryLabel[] }>(`/api/admin/taxonomy/labels${qs({ ...p, all: p.all ? 1 : undefined })}`),
  taxonomySetCarries: (body: { label: string; attribute: string; value: AttributeValue | null }) =>
    put<{ label: string; attribute: string; value: AttributeValue | null }>('/api/admin/taxonomy/labels/carries', body),
  taxonomyMatrix: (all = false) => request<TaxonomyMatrix>(`/api/admin/taxonomy/matrix${qs({ all: all ? 1 : undefined })}`),
  taxonomyRules: (subcategory: string) => request<{ subcategory: string; rules: TaxonomyRule[] }>(`/api/admin/taxonomy/rules${qs({ subcategory })}`),
  /** These labels → this subcategory. One type/atlas/experience label is written at that level; anything else is a labels rule. */
  taxonomySaveRule: (body: { labels: string[]; subcategory?: string | null; weights?: ShelfWeights; reason?: string | null }) =>
    put<{ rule: TaxonomyRule }>('/api/admin/taxonomy/rules', body),
  /** A group's suggestions approved in one press: rules and set-asides together. */
  taxonomyBatch: (items: {
    labels: string[]; subcategory?: string | null;
    aside?: boolean; nearby?: boolean; travel?: boolean; generic?: boolean; unanswered?: boolean;
    /** What the word also says, applied with the answer so the two cannot part company. */
    carries?: { attribute: string; value: AttributeValue | null }[];
    reason?: string | null;
  }[]) =>
    post<{
      done: { labels: string[]; subcategory?: string; aside?: boolean; nearby?: boolean; travel?: boolean; generic?: boolean }[];
      failed: { labels: string[]; error: string }[];
      /** Hand this back to `taxonomyUndo` to put everything this call changed back. */
      undo: string | null;
    }>('/api/admin/taxonomy/rules/batch', { items }),
  /** Put back exactly what one batch changed — once. */
  taxonomyUndo: (id: string) =>
    post<{ undone: true; rules: number; back: number; words: number }>('/api/admin/taxonomy/rules/undo', { id }),
  /** The specific words seen on the same places as a generic one, commonest first. */
  taxonomyPairs: (label: string) => request<TaxonomyPairs>(`/api/admin/taxonomy/pairs${qs({ label })}`),
  /** Our own secondary labels, with what every drawer is taken to be. */
  taxonomyAttributes: () => request<TaxonomyAttributes>('/api/admin/taxonomy/attributes'),
  /** Name a secondary label, or change one. */
  taxonomySaveAttribute: (body: { key?: string; label?: string; kind?: 'yesno' | 'range' | 'oneof'; blurb?: string | null; options?: string[]; rangeMin?: number; rangeMax?: number; unit?: string; position?: number; active?: boolean }) =>
    put<{ attribute: PlaceAttribute }>('/api/admin/taxonomy/attributes', body),
  /**
   * One place, secondary label by secondary label, with `setAt` saying whether
   * the answer is the place's own, its drawer's, one its own words carried, or
   * one another label brought.
   */
  taxonomyPlaceLabels: (p: { ref: string; subcategory?: string | null; words?: string[] }) =>
    request<{
      ref: string; subcategory: string | null; attributes: PlaceAttribute[];
      values: Record<string, AttributeValue>;
      /** What it would be with nothing set on the place — what clearing restores. */
      inherited: Record<string, AttributeValue>;
    }>(
      `/api/admin/taxonomy/attributes/place${qs({ ref: p.ref, subcategory: p.subcategory ?? undefined, words: p.words?.length ? p.words.join(',') : undefined })}`),
  /** Say something about one place, with the reason it differs from what it inherited. */
  taxonomySetPlaceLabel: (body: { ref: string; attribute: string; value: AttributeValue | null; reason?: string | null }) =>
    put<{ ref: string; attribute: string; value: AttributeValue | null }>('/api/admin/taxonomy/attributes/place', body),
  /** What is inside a place, or everything waiting to be confirmed. */
  taxonomyParts: (parent?: string) =>
    request<{ parent?: string; children?: PlacePart[]; proposed: PlacePart[]; told?: PlacePart[] }>(`/api/admin/taxonomy/parts${qs({ parent })}`),
  /** Say a place is inside another, or that it stands alone. */
  taxonomySetPart: (body: { child: string; parent: string | null; note?: string | null }) =>
    post<{ part: PlacePart | null }>('/api/admin/taxonomy/parts', body),
  /** The places the labels could not settle, with the last few runs. */
  taxonomyNotSure: (state?: string) =>
    request<{ places: NotSurePlace[]; counts: Record<string, number>; runs: NotSureRun[]; subcategories: ShelfSubcategory[]; categories: ShelfCategory[] }>(
      `/api/admin/taxonomy/not-sure${qs({ state })}`),
  /** Send a batch to be looked up. Nothing is applied by it. */
  /**
   * What one of a provider's words means, read off the real places that carry
   * it. Costs no provider call — the sample is the one already on screen.
   */
  taxonomyWordMeans: (body: { label: string; places: { id: string; name: string | null; address: string | null; website: string | null; types: string[] }[] }) =>
    post<{
      label: string;
      said: { primary: string | null; secondary: { key: string; label: string; choice: string | null }[]; because: string; source: string } | null;
    }>('/api/admin/taxonomy/word', body),
  /** Every place the labels file into one drawer, with its secondary labels. */
  /**
   * What a rule would move, before it exists: our own places, resolved twice.
   * Nothing written, no provider call.
   */
  taxonomyWould: (add: string, subcategory: string, state?: 'published' | 'all') =>
    request<{
      add: string; subcategory: string; already: number; count: number;
      /** How many held places carry any word of this label's source. */
      carriers: number; of: number;
      moving: { ref: string; name: string; region: string | null; from: string | null; fromLabel: string | null }[];
    }>(`/api/admin/taxonomy/would${qs({ add, subcategory, state })}`),
  /** A drawer's places, or the places carrying one provider word. */
  taxonomyDrawer: (subcategory: string, state?: 'published' | 'candidate' | 'all', word?: string) =>
    request<{
      subcategory: string; state: string; word?: string | null;
      attributes: PlaceAttribute[];
      places: {
        ref: string; name: string; region: string | null; website: string | null;
        values: Record<string, AttributeValue>;
        /** Where the row came from, and what we may keep of it. */
        source: string | null; rented: boolean; named: boolean;
        state: string | null; outcode: string | null;
        attribution: { source?: string; licence?: string; url?: string }[];
        wikipedia: string | null; osm: string | null; wikidata: string | null;
        seen: string | null;
        /** The provider words it was filed by. */
        words: string[];
      }[];
    }>(`/api/admin/taxonomy/drawer${qs({ subcategory, state, word })}`),
  /** One secondary label, set on many places at once. */
  /** One label on many places, or several labels together in one act. */
  taxonomySetMany: (body: {
    refs: string[]; reason?: string | null;
    attribute?: string; value?: AttributeValue | null;
    set?: { attribute: string; value: AttributeValue | null }[];
  }) => put<{ changed: number; set: string[] }>('/api/admin/taxonomy/drawer', body),
  /** Put places already on screen on the not-sure list, with no provider call. */
  taxonomyQueueNotSure: (body: { subcategory: string | null; places: { ref: string; name: string | null; address: string | null; words: string[]; reason?: string }[] }) =>
    post<{ queued: number }>('/api/admin/taxonomy/not-sure/queue', body),
  /** `cap` is the ceiling for *this* run and nothing else; leave it out for 250. */
  taxonomyResearch: (refs: string[], cap?: number) =>
    post<{ run: NotSureRun; started: number; cap: number; stoppedAt: { asked: number; doing: number } | null }>(
      '/api/admin/taxonomy/not-sure/run', { refs, ...(cap ? { cap } : {}) }),
  /** Your decision: one of our labels, or null to drop it from the list. */
  taxonomySettle: (ref: string, as: string | null) =>
    put<{ place: NotSurePlace }>('/api/admin/taxonomy/not-sure', { ref, as }),
  /** What one of our labels brings with it, and as what. A null value forgets it. */
  taxonomySetBrings: (body: { attribute: string; brings: string; value: AttributeValue | null }) =>
    put<{ attribute: string; brings: string; value: AttributeValue | null }>('/api/admin/taxonomy/attributes/brings', body),
  /** What every place in a drawer is taken to be. A null value clears it. */
  taxonomySetDefault: (body: { subcategory: string; attribute: string; value: AttributeValue | null }) =>
    put<{ subcategory: string; attribute: string; value: AttributeValue | null }>('/api/admin/taxonomy/attributes/default', body),
  /**
   * Real places carrying a Google word — one live provider call, so only on a
   * press. `queue` puts the ones the labels could not settle on the not-sure
   * list rather than leaving them to be filed wrong.
   */
  taxonomyExamples: (label: string, queue = false) =>
    request<TaxonomyExamples>(`/api/admin/taxonomy/examples${qs({ label, queue: queue ? 1 : undefined })}`),
  /** Google's own word becomes a subcategory of ours under this category, and the word is mapped to it — one transaction. */
  taxonomyAdopt: (body: { label: string; categoryKey: string; name?: string; alsoIn?: string[] }) =>
    post<{ subcategory: ShelfSubcategory; rule: TaxonomyRule; created: boolean }>('/api/admin/taxonomy/adopt', body),
  /** Where a set of labels would land right now, without saving anything. */
  taxonomyTry: (labels: string[]) => post<TaxonomyTry>('/api/admin/taxonomy/try', { labels }),
  taxonomySaveLabel: (body: { namespace: string; key: string; label?: string | null; active?: boolean }) =>
    put<{ label: TaxonomyLabel }>('/api/admin/taxonomy/labels', body),

  libraryHarvest: (body: { scope?: 'all' | 'never' | 'failed'; regions?: string[]; withImages?: boolean; refreshTypes?: boolean }) =>
    post<{ run: HarvestRun }>('/api/admin/library/harvest', body),
  libraryRun: (id: string) => request<{ run: HarvestRun }>(`/api/admin/library/harvest/${id}`),
  libraryCancel: (id: string) => post<{ run: HarvestRun }>(`/api/admin/library/harvest/${id}/cancel`, {}),

  /**
   * Where the bytes are. Not a `request()` — this goes straight into an `<Image
   * src>`, is outside the session door on purpose (routes/library.js) and is
   * cached immutably for a year, so the second view of any card never reaches
   * the API at all.
   */
  /**
   * The home screen's one read: everything around a point, already sorted into
   * the six moods, with the journey and the stay worked out per place.
   */
  /**
   * `count: 1` for a caller that only wants the number and will draw none of
   * it — the voice set-up's "about 240 places". It keeps the request out of the
   * search log, where it would read as a search that showed everything and led
   * to nothing (Codex, 18 Sep 2026).
   */
  inspireNear: (q: { lat?: number; lng?: number; label?: string; locality?: string | null; from?: string | null; mode?: string; km?: number; live?: 1; refresh?: 1; count?: 1 }) =>
    request<InspireNear>(`/api/inspire/near${qs(q)}`),

  /** A library picture's bytes. Given the row rather than the id, a pending household upload's signed link comes with it. */
  imageUrl: (image: string | { id: string; sig?: string; exp?: number }, width = 500) =>
    ownedImageUrl(typeof image === 'string' ? { id: image } : image, width),

  /** The household app's read: one county, instantly, off one table. */
  regionAttractions: (slug: string) => request<RegionAttractions>(`/api/atlas/regions/${slug}`),
  atlasRegions: () => request<{ regions: { slug: string; name: string; nation: string; kind: string; lat: number | null; lng: number | null; count: number; images: number }[] }>('/api/atlas/regions'),

  /**
   * Telemetry: which screen, and still here. Fire-and-forget by design — a
   * household must never notice that reporting failed.
   */
  reportActivity: (events: { kind: string; screen?: string; subject?: string; seconds?: number; at?: string }[]) =>
    post<{ recorded: number }>('/api/activity', { events }).catch(() => ({ recorded: 0 })),

  // --- writes that have not gone yet ----------------------------------------

  /** Send everything waiting in the outbox. Safe to call at any time. */
  sendWaitingWrites: (): Promise<void> => flushOutbox(sendQueued),
  /** Count what is waiting, without sending it. */
  countWaitingWrites: (): Promise<void> => refreshOutbox(),
};

export type SessionSummary = { id: string; label: string | null; since: string; until: string };
export type AccountSummary = { id: string; email: string; name: string | null; role: 'owner' | 'customer'; plan: string };
export type SessionState = {
  signedIn: boolean;
  configured: boolean;
  session?: SessionSummary | null;
  message?: string;
  /** Who is signed in, when they are on an account rather than the shared passcode. */
  account?: AccountSummary | null;
  /** Whether the admin module is theirs to see. The API decides this, not the app. */
  isOwner?: boolean;
  /** Their account was suspended while they were signed in. */
  suspended?: boolean;
  /** Which applications this session may enter, and what it may do in them. */
  access?: Access | null;
};

// --- the atlas library ------------------------------------------------------

export type LibraryRegion = {
  slug: string; name: string; nation: string; kind: string;
  wikidata_id: string | null; lat: number | null; lng: number | null;
  target_count: number; harvest_state: 'never' | 'queued' | 'running' | 'done' | 'failed';
  harvest_error: string | null; harvested_at: string | null;
  candidate_count: number; published_count: number; image_count: number;
};

export type LibraryAttraction = {
  id: string; region_slug: string; region_name: string; nation: string;
  wikidata_id: string; name: string; slug: string; summary: string | null;
  category: string | null; lat: number | null; lng: number | null;
  wikipedia_url: string | null; website: string | null; heritage: string | null;
  sitelinks: number; pageviews_year: number | null; score: number; rank: number | null;
  score_parts: Record<string, any>;
  state: 'candidate' | 'published' | 'hidden'; pinned: boolean; note: string | null;
  image_count: string | number; hero_id: string | null; hero_lqip: string | null;
};

/**
 * One picture, and everything anybody could be asked to produce about it: where
 * it came from, whose it is, what the licence says, and the page that states
 * both. `source_page_url` is the attribution URL.
 */
/**
 * The form we fill in about a place (migration 045). Every field is present —
 * empty string or empty list where the sources were silent — because a missing
 * field and an unanswerable one must not look the same on the review screen.
 */
export type AttractionFacts = {
  whyGo: string;
  history: string; historyQuote: string;
  highlights: { name: string; why: string; source: string; quote: string }[];
  dwell: 'under an hour' | 'an hour or two' | 'half a day' | 'a full day' | 'more than a day';
  dwellWhy: string;
  cover: 'indoors' | 'mostly indoors' | 'both' | 'mostly outdoors' | 'outdoors';
  /** All four bands, in order, with what there is for each. */
  forAges: { band: 'under 4' | '4 to 7' | '8 to 11' | '12 and over'; what: string;
             howMuch: 'most of it' | 'a good part of it' | 'some of it' | 'very little' | 'nothing' }[];
  alsoSuits: string[]; wouldBore: string;
  bestTime: string; seasonal: string;
  booking: 'not needed' | 'advised' | 'required' | 'the sources do not say';
  missing: string[];
  confidence: 'high' | 'medium' | 'low';
};

export type AttractionFactsRow = {
  attraction_id: string;
  facts: AttractionFacts;
  evidence: Record<string, { quote: string; source: string; of?: string; why?: string }>;
  missing: string[]; confidence: string | null;
  lessons_used: string[]; model: string | null; prompt_hash: string | null; cost_usd: number | null;
  review: 'pending' | 'approved' | 'corrected' | 'rejected';
  review_note: string | null; wrong_fields: string[];
  reviewed_by: string | null; reviewed_at: string | null; read_at: string;
};

/** A Wikidata type present in a region, and how many places carry it. */
export type LibraryType = { qid: string; label: string; category: string | null; places: number };

/** A correction, in his words, scoped to a kind of place so it travels. */
export type ExtractionLesson = {
  id: string;
  scope: 'all' | 'kind' | 'place';
  subject: string | null; subject_label: string | null;
  rule: string; field: string | null; said: string | null;
  from_attraction: string | null; from_name?: string | null;
  active: boolean; used_count: number; approved_after: number;
  created_by: string | null; created_at: string;
};

export type ReadingStats = {
  published: string | number; read: string | number; pending: string | number;
  approved: string | number; corrected: string | number; rejected: string | number;
  spent: string | number; lessons: { active: string | number; total: string | number };
};

/** One thing inside a place — a ride, an animal house, a tearoom. */
export type PlaceContent = {
  itemRef: string; name: string; kind: string | null; kindLabel: string | null;
  facts: Record<string, any>; summary: string | null; website: string | null;
};

/** An attraction with everything migration 041 fetched about it attached. */
export type LibraryAttractionDetail = LibraryAttraction & {
  kinds: string[];
  accolades: { key: string; label: string; source: string }[];
  acclaim: number; band: string | null; epic_score: number;
  sections: { heading: string | null; level: number; text: string; doing: boolean }[] | null;
  highlights: { name: string; kind: string; note: string | null; price: string | null; hours: string | null; sourceUrl: string }[] | null;
  admission: Record<string, any> | null;
  visit: Record<string, any> | null;
  contents_ref: string | null; contents_count: number;
  detail_attribution: { source: string; licence: string; url: string | null; note?: string }[] | null;
  provenance: Record<string, string> | null;
  detail_research_state: string | null; detail_error: string | null; researched_at: string | null;
  images: { id: string; title: string | null; lqip: string | null; credit_line: string | null; role: string }[];
};

export type LibraryImage = {
  id: string; source: string; source_ref: string | null; source_page_url: string | null;
  licence: string; licence_url: string | null; attribution_required: boolean;
  creator: string | null; creator_url: string | null; credit_line: string | null;
  title: string | null; caption: string | null; tags: string[];
  width: number | null; height: number | null; bytes: number | null;
  lqip: string | null; moderation: 'approved' | 'pending' | 'rejected'; moderation_note: string | null;
  reward_points: number; fetched_at: string; contributor_account_id: string | null;
  widths: number[] | null; held_bytes: string | number;
  /** What Epic files the place under: heritage, outdoors, family, museum, arts, animals, active, landmark. */
  categories: string | null;
  links: { type: string; id: string; role: string; label: string | null }[] | null;
  relevance?: number;
};

export type LibraryKind = {
  qid: string; label: string | null; root_qid: string | null; category: string | null;
  admit: boolean; overridden: boolean; overridden_by: string | null; seen_count: number;
};

// ---------------------------------------------------------------------------
// the shelves: what the home screen calls a place, and how it is taught
// ---------------------------------------------------------------------------

/**
 * A weight per shelf. A shelf that is absent is a shelf the place is not on at
 * all; a shelf below the floor is true but not worth a card.
 */
// ---------------------------------------------------------------------------
// places you can point at
// ---------------------------------------------------------------------------

/**
 * A county, a town or a postcode district. One shape for all three, because the
 * owner asked to "look at each one of those through the same lens" (5 Sep 2026)
 * and the back office has no reason to know which it is holding.
 */
export type Locality = {
  slug: string;
  name: string;
  kind: 'county' | 'town' | 'postcode';
  nation: string | null;
  parent_slug: string | null;
  parent_name?: string | null;
  council?: string | null;
  lat?: number | null;
  lng?: number | null;
  to_go_count: number;
  to_eat_count: number;
  image_count: number;
};

/** The six facts the back office tracks, per place. */
export type FactKey = 'picture' | 'description' | 'hours' | 'website' | 'menu' | 'shelf';

export type FactCoverage = { held: number; of: number; pc: number | null };

export type PlaceCoverage = {
  toGo: number;
  toEat: number;
  facts: Record<FactKey, FactCoverage>;
};

/** One row on a place page: an attraction or a restaurant, told the same way. */
export type LocalityRow = {
  id: string;
  name: string;
  slug: string | null;
  side: 'go' | 'eat';
  type: string | null;
  score: number | null;
  owned_score?: number | null;
  rank: number | null;
  state: string | null;
  website: string | null;
  outcode: string | null;
  locality_slug: string | null;
  region_slug: string | null;
  hero_id: string | null;
  image_count: number;
  has_picture: boolean;
  has_description: boolean;
  has_hours: boolean;
  has_website: boolean;
  has_menu: boolean | null;
  has_shelf: boolean;
};

export type LocalityPage = {
  place: Locality;
  coverage: PlaceCoverage;
  contents: LocalityRow[];
  breakdown: { category: string; n: number }[];
  siblings: Locality[];
};

export type PlaceTree = {
  nations: string[];
  counties: (Locality & { towns: Locality[] })[];
  orphanTowns: Locality[];
  postcodes: Locality[];
  remaining: number;
  running: { since: string } | null;
  /** What the last pass did. A pass is fire-and-forget, so this is how a failure is seen at all. */
  lastPass: {
    which: 'postal' | 'naming'; region: string | null; at: string; ok: boolean;
    looked?: number; named?: number; placed?: number; requests?: number; error?: string;
  } | null;
};

export type CoverageRow = {
  slug: string; name: string; kind: Locality['kind'];
  toGo: number; toEat: number; facts: Record<FactKey, FactCoverage>;
};

/**
 * The back office's Lookup (12 Sep 2026): one place, one travel time, and
 * what every source has inside it. The screen makes every number from
 * `items`; `sources` says what was asked, what each answered with, and what
 * failed — in plain words and, this being the back office, the raw error too.
 */
export type LookupCounts = { activities: number; food: number; all: number };
export type LookupSource = {
  key: string; label: string; layer: 'rented' | 'owned'; note: string | null;
  /** Listed but not asked: an opt-in source that bills per place, which is the owner's to switch on. */
  asked: boolean;
  /** How far this source was actually asked to look; `capped` when its own limit is inside the ring. */
  reachKm: number | null; capped: boolean;
  /** Places carrying this source: everything it handed back, and what is inside the travel time. */
  returned: LookupCounts; kept: LookupCounts;
  failed: { why: string; error: string; slow: boolean } | null;
};
export type LookupPlace = { label: string; where: string | null; kind: string | null; lat: number; lng: number; how: 'point' | 'area' | 'address' };
export type LookupItem = {
  ref: string; name: string; kind: 'activities' | 'food'; category: string;
  shelf: string | null; subcategory: string | null; sources: string[];
  lat: number; lng: number; rating: number | null; ratingCount: number | null; website: string | null;
  distanceKm: number; travelMinutes: number; recordCount: number;
  /** Carries the atlas, the sweep or an owned record. */
  owned: boolean;
  /** Our own account of it has been written. */
  curated: boolean;
  /** Reviews × (rating ÷ 5)²: the crowd first, the stars second. Nought when nobody has counted. */
  priority: number;
};
export type LookupResult = {
  place: LookupPlace; mode: string; minutes: number; radiusKm: number; estimated: boolean;
  /** The minutes reach further than any source will answer, so the ring was cut to what they will. */
  capped: boolean;
  /** The owner's ceiling for Tripadvisor lookups from this screen, and how much of it this month has used. */
  tripadvisor: { cap: number; used: number };
  /** Distinct places, before and inside the fence — the "Everything" row, which is not the sum of the sources. */
  totals: { returned: LookupCounts; kept: LookupCounts };
  sources: LookupSource[];
  taxonomy: { categories: { key: string; label: string }[]; subcategories: { key: string; label: string; category: string }[] };
  items: LookupItem[];
  cached: boolean; fetchedAt: string | null; tookMs: number;
};
export type LookupRecord = { source: string; label: string; fields: Record<string, unknown> };
export type LookupOpened = {
  place: LookupPlace; mode: string; minutes: number;
  item: Omit<LookupItem, 'recordCount'>;
  records: LookupRecord[];
  resolved: Record<string, unknown> | null;
};
export type LookupCompareColumn = {
  key: 'ours' | 'google' | 'tripadvisor'; label: string; note: string | null;
  fields: Record<string, unknown> | null; of: number; filled: number; id?: string | null; how?: string | null;
};
/** One field across the columns: which key each column knows it by, and what each holds. A column absent from `keys` does not have the field at all. */
export type LookupCompareRow = { key: string; keys: Partial<Record<LookupCompareColumn['key'], string | null>>; cells: Partial<Record<LookupCompareColumn['key'], unknown>> };
export type LookupCompare = {
  place: LookupPlace; mode: string; minutes: number;
  item: Omit<LookupItem, 'recordCount'>;
  columns: LookupCompareColumn[];
  rows: LookupCompareRow[];
};
/** One page of a ranking run. `remaining` above nought means call again. */
export type LookupRun = {
  kind: 'activities' | 'food'; looked: number; matched: number; missed: number; remaining: number;
  rated?: number; failed?: number; used?: number; cap?: number; stopped?: boolean;
};
export type LookupCuration = { what: string; who: string; why: string; practical: string; kinds: string[]; confidence: 'high' | 'medium' | 'low'; pagesUsed: string[] };
export type LookupCurated = {
  ref: string;
  curation: { curation: LookupCuration; from: string[]; model: string; costUsd: number | null } | null;
  banded: boolean;
  record: Record<string, unknown> | null;
  /** Why no account was written: the budget, no website, an unreadable site. */
  why: string | null;
  detail: string | null;
};

/**
 * What Epic proposes when you say why a category is wrong.
 *
 * It proposes and never writes — the same rule the shelf teaching already
 * holds to, because a categorisation nobody read is the silent guessing the
 * teaching screens exist to end.
 */
export type CategoryProposal = {
  category: string;
  reason: string;
  scope: 'place' | 'kind' | 'category';
  suggestedScope: 'place' | 'kind' | 'category';
  /** Every scope that could carry this change, and how far each one travels. */
  options: { scope: 'place' | 'kind' | 'category'; subject: string; label: string; affects: number; regions: number }[];
  weights: ShelfWeights;
};

/**
 * One reason a batch of menus could not be read, and what would fix all of them.
 *
 * The sentence on a single row says what to do about that restaurant; this is
 * what makes a hundred of them a number that moves (domain/menuCauses.js).
 */
export type MenuCause = {
  key: string;
  label: string;
  detail: string;
  fix: string;
  n: number;
  /** How many have been tried four times and will not be tried again on their own. */
  exhausted: number;
  oldest: string | null;
  examples: string[];
};

/**
 * One place, our order against theirs.
 *
 * There is no rating on this type and there is not meant to be: the figures are
 * spent on an ordering inside `sources/google.js` and never leave it. What a
 * comparison needs is whether the two lists agree, not what their decimal was.
 */
export type BenchRow = {
  venueRef: string;
  name: string | null;
  epicScore: number | null;
  ownedScore: number | null;
  ourRank: number | null;
  theirRank: number | null;
  delta: number | null;
  crowdBand?: string | null;
  countBand?: string | null;
  /** Set when only one of the two lists holds this place at all. */
  only: 'ours' | 'theirs' | null;
};

export type BenchVerdict = {
  compared: number;
  onlyOurs: number;
  onlyTheirs: number;
  /** Spearman's ρ: 1 is the same order, 0 unrelated, −1 upside down. */
  agreement: number | null;
  /** The same between our composite and our owned score — what survives the key dying. */
  ownedAgreement: number | null;
  disputes: number;
  disputeThreshold: number;
  /** Set when every place bands the same word, which means the band says nothing. */
  bandSaturated: string | null;
  bandsSeen: string[];
};

export type BenchRun = {
  id: string; area_code: string; compared: number; only_ours: number; only_theirs: number;
  agreement: number | null; owned_agreement: number | null; disputes: number;
  disputed: { name: string | null; ourRank: number; theirRank: number; delta: number }[];
  band_saturated: string | null; calls: number; cost_cents: number; ran_by: string | null; ran_at: string;
};

export type BenchResult = {
  area: { code: string; label: string | null };
  rows: BenchRow[];
  verdict: BenchVerdict;
  run: BenchRun;
  problems: string[];
};

export type ShelfWeights = Partial<Record<MoodKey, number>>;

export type ShelfRule = {
  id: string;
  /** `labels` fires only when a place carries every label in `labels` (migration 077). */
  /** 'ours' is a rule written in our own labels, which is where they are going. */
  scope: 'place' | 'ours' | 'labels' | 'kind' | 'category' | 'experience';
  subject: string;
  labels?: string[] | null;
  subject_label: string | null;
  weights: ShelfWeights;
  /** The drawer this rule files things in, if it names one. */
  subcategory: string | null;
  reason: string | null;
  taught_by: string | null;
  seeded: boolean;
  created_at: string;
  updated_at: string;
};

/** Why a place is where it is: the rules that decided it, narrowest first. */
export type ShelfBecause = {
  scope: string;
  subject: string | null;
  subject_label: string | null;
  weights: ShelfWeights;
  reason: string | null;
};

export type ShelfPlace = {
  ref: string;
  id: string;
  name: string;
  /** The one category it is filed under, and the drawer inside it. */
  shelf?: MoodKey | null;
  subcategory?: string | null;
  /** Whether anybody would defend the answer, or it landed there by default. */
  confident?: boolean;
  /** What the source called it, for a row with no Wikidata types to show. */
  tags?: string[];
  region: string | null;
  category: string | null;
  summary: string | null;
  score: number | null;
  lat: number | null;
  lng: number | null;
  imageId: string | null;
  shelves: MoodKey[];
  weights: ShelfWeights;
  because: ShelfBecause[];
  kinds: { qid: string; label: string | null; category: string | null; rule: ShelfRule | null }[];
  rule: ShelfRule | null;
  distanceKm?: number;
};

/** A category, as the settings page edits it. */
export type ShelfCategory = {
  key: MoodKey; label: string; blurb: string | null; icon: string | null;
  position: number; is_door: boolean; active: boolean; seeded: boolean;
  subcategories?: ShelfSubcategory[];
};

/**
 * A drawer. `key` is unique across the whole table, which is the no-duplication
 * rule: a subcategory belongs to exactly one category and the database says so.
 */
export type ShelfSubcategory = {
  id: string; category_key: MoodKey; key: string; label: string; blurb: string | null;
  position: number; active: boolean; seeded: boolean;
  /** Indoors or out, and for children: true, false, or null for "it depends" (migration 076). */
  indoor?: boolean | null; for_kids?: boolean | null;
  /**
   * The extra categories this drawer is *listed* in, beside its home
   * `category_key` (migration 103). A place still has one home; this is only
   * which cabinets show the drawer.
   */
  also_in?: MoodKey[];
  /** How many rules point at it, so the settings page is not a guess. */
  rules?: number;
};

export type ShelfVocabulary = {
  shelves: ShelfCategory[];
  subcategories: ShelfSubcategory[];
  floor: number;
  maxShelves: number;
  defaults: { category: Record<string, ShelfWeights>; experience: Record<string, ShelfWeights> };
  rules: ShelfRule[];
  counts: Record<string, number>;
};

/** A source of labels, with how much of its vocabulary Epic has seen and taught. */
export type TaxonomyNamespace = {
  key: string; label: string; provider: string; own: boolean; what: string;
  total: number; seen: number; taught: number;
};

/** Where one label lands today, and what decided it. */
export type TaxonomyLanding = {
  category: MoodKey | null;
  subcategory: string | null;
  how: 'taught' | 'default' | 'fallback' | 'none';
  via: { id: string | null; scope: string; subject: string | null; subject_label: string | null; labels: string[] | null; by?: string | null } | null;
  /** What Epic read the word into on the way: the experience, the venue category, the styles. */
  derived: string[];
};

export type TaxonomyLabel = {
  namespace: string; key: string; label: string | null; note: string | null;
  seen_count: number; active: boolean; seeded: boolean;
  /** When a sweep first saw this word, so a queue can be read oldest first. */
  first_seen?: string | null;
  /** Which of our labels this provider's word means, or null while it means nothing. */
  points_at?: string | null;
  /**
   * Excluded from Epic, travel (getting there, parking), useful beside a day
   * out, or generic — a label the source puts on places all over Epic, which
   * therefore never decides where one lands. Null while undecided.
   */
  decision?: 'aside' | 'nearby' | 'travel' | 'generic' | null;
  landing: TaxonomyLanding;
  /** Why this one is a judgement call rather than an oversight, where it is one. */
  why?: string | null;
  /** How many specific words this one is seen beside — what it catches. */
  catches?: number;
  /** For a Google type: where it could go, for the owner to approve or change. */
  suggestion?: { subcategory?: string; aside?: boolean; nearby?: boolean; travel?: boolean; generic?: boolean; cuisine?: string; why: string } | null;
  /**
   * What else the word says, besides where it sends a place. `italian_restaurant`
   * still sends a place to Restaurants; it also says Cuisine · Italian.
   */
  carries?: { key: string; label: string; kind: 'yesno' | 'range' | 'oneof'; value: AttributeValue }[];
};

/** A secondary label a word can be given, and the shape of its control. */
export type SecondaryLabel = {
  key: string; label: string; kind: 'yesno' | 'range' | 'oneof';
  options: string[]; range_min: number | null; range_max: number | null; unit: string | null;
  /** The categories this label is a question about; empty means all of them. */
  only_in?: string[];
};

/** A handful of real places carrying one Google word, read live and never stored. */
export type TaxonomyExamples = {
  label: string;
  /** The area the search was fenced to — the household's home, or London. */
  near: string;
  places: {
    id: string; name: string | null; address: string | null; primaryType: string | null;
    types: string[]; mapsUrl: string | null; website: string | null;
    /** Where the whole set of its words lands it today, or null if nothing does. */
    landsIn: string | null;
    /** The bigger place this is inside, by name — which is why it never settles alone. */
    partOf?: string | null;
    /** Which of our labels its words mean, from the whole vocabulary rather than a sample. */
    ours?: string[];
  }[];
  /** Every other Google word on those places, commonest first, with where each lands. */
  alsoCalled: { key: string; on: number; label: string | null; decision: string | null; landing: TaxonomyLanding }[];
  /** False where Google would not fence the search by this word, so it was matched on words and then checked. */
  fenced: boolean;
  /** How many of those places carry no other word we have mapped, so this word is all we would know. */
  alone: number;
  /** The places grouped by the set of words they carry: the biggest is the rule worth writing. */
  shapes: { words: string[]; on: number; names: (string | null)[] }[];
  /** How often each word travels with the one asked about, and where it points. */
  travels: { key: string; on: number; label: string | null; points_at: string | null }[];
  /** The words that sit on everything, said once rather than in every row. */
  everywhere: { key: string; on: number }[];
  calls: number;
  problem: string | null;
  subcategories: ShelfSubcategory[];
  categories: ShelfCategory[];
};

/** A place that sits inside another, and how that was decided. */
export type PlacePart = {
  child_ref: string; parent_ref: string; how: 'told' | 'proposed';
  note: string | null; set_by: string | null;
  /** Names, because `google:ChIJ…` on screen is not a place anybody can read. */
  child_name?: string | null; parent_name?: string | null;
  /** Exactly what the parent gains: the child's primary label and its secondary ones, with values. */
  goes_up?: { primary: string | null; secondary: { key: string; label: string; value: AttributeValue }[] };
};

/** A place the labels could not settle, and what a run came back with. */
export type NotSurePlace = {
  venue_ref: string; name: string | null; address: string | null; words: string[]; would_be: string | null;
  /** Its words said in ours, dropping the ones that mean nothing of ours. */
  our_words?: string[];
  /** A larger place a run thought this sits inside, as a name. */
  part_of_name: string | null;
  reason: string; state: 'waiting' | 'answered' | 'settled' | 'dropped';
  said: string | null; because: string | null; source: string | null;
  looked_at: string | null; settled_as: string | null; settled_by: string | null;
};

export type NotSureRun = {
  id: string; asked_for: number; looked_at: number; answered: number;
  cost_pence: number | null; note: string | null; by: string | null;
  started_at: string; finished_at: string | null;
};

/** One of our secondary labels: something true about a place, not what it is. */
export type PlaceAttribute = {
  key: string; label: string; kind: 'yesno' | 'range' | 'oneof'; blurb: string | null;
  options: string[]; range_min: number | null; range_max: number | null; unit: string | null;
  position: number; active: boolean; seeded: boolean;
  /** Other labels of ours that always arrive with this one, and as what. Never a provider's word. */
  brings: { key: string; value: AttributeValue }[];
};

/** A value one carries: a yes or no, a range, or one of a list. */
export type AttributeValue = {
  yesno?: boolean; from?: number | null; to?: number | null; choice?: string;
  /**
   * Where the answer came from. `came` means another label brought it and
   * `word` means one of the place's own provider words said it, so both are
   * drawn in lime: nobody typed them.
   */
  setAt?: 'place' | 'subcategory' | 'came' | 'word';
  /** Which label brought it, where `setAt` is `came`. */
  came?: string;
  reason?: string | null;
};

export type TaxonomyAttributes = {
  attributes: PlaceAttribute[];
  /** Drawer key → what every place in it is taken to be. */
  defaults: Record<string, Record<string, AttributeValue>>;
  /**
   * How many places say this on their own. A different unit from the coverage
   * beside it, and absent where a label is only ever a drawer default.
   */
  places: Record<string, number>;
  subcategories: ShelfSubcategory[];
  categories: ShelfCategory[];
};

/** What a generic word was actually seen on: the source's own specific words. */
export type TaxonomyPairs = {
  label: string;
  words: TaxonomyLabel[];
  subcategories: ShelfSubcategory[];
  categories: ShelfCategory[];
};

/** A rule as the Categories screen draws it: every rule as the labels it is about. */
export type TaxonomyRule = ShelfRule & {
  labelList: {
    label: string; name: string | null;
    /** Which of ours this means. Null where the provider's word means nothing of ours yet. */
    pointsAt: string | null;
  }[];
};

export type Taxonomy = {
  categories: (ShelfCategory & { subcategories: ShelfSubcategory[] })[];
  subcategories: ShelfSubcategory[];
  namespaces: TaxonomyNamespace[];
  rules: TaxonomyRule[];
  floor: number;
};

export type TaxonomyMatrixEntry = { key: string; label: string | null; seen: number; how: TaxonomyLanding['how'] };
export type TaxonomyMatrix = {
  namespaces: string[];
  categories: (ShelfCategory & { subcategories: ShelfSubcategory[] })[];
  /** subcategory key → namespace → the words that land there. */
  cells: Record<string, Record<string, TaxonomyMatrixEntry[]>>;
  /** category key → namespace → words filed in the category with no drawer. */
  unfiled: Record<string, Record<string, TaxonomyMatrixEntry[]>>;
  /** category key → namespace → words nothing knows, fallen to the broadest shelf. */
  nowhere: Record<string, Record<string, TaxonomyMatrixEntry[]>>;
  all: boolean;
};

export type TaxonomyTry = {
  labels: string[]; category: MoodKey | null; subcategory: string | null;
  weights: ShelfWeights; because: ShelfBecause[]; confident: boolean;
};

export type ShelfProposal = {
  scope: ShelfRule['scope'];
  suggestedScope: ShelfRule['scope'];
  reason: string;
  weights: ShelfWeights;
};

export type LibraryContributor = {
  id: string; email: string; household: string | null;
  accepted: string; waiting: string; points: string;
};

export type HarvestRun = {
  id: string; scope: string; stage: string | null;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  counts: Record<string, number>; log?: { at: string; line: string }[];
  error: string | null; started_by: string | null; started_at: string; finished_at: string | null;
};

/** The postcode areas Epic has swept, and how well each went (migration 035). */
export type ScoutArea = {
  code: string;
  label: string | null;
  state: string;
  swept_at: string | null;
  next_sweep_at: string | null;
  seen: number;
  chains: number;
  kept: number;
  sweeps: number;
  places: number;
  researched: number;
  menus: number;
  menus_failed: number;
  dishes: number;
};

/** One place in an area's selection, as the household API answers it. */
export type ScoutPlace = {
  venueRef: string;
  name: string | null;
  rank: number;
  score: number | null;
  // Our own words for the crowd, never their figure: 'top' | 'high' | 'good' | 'mixed'.
  standing: string | null;
  howMany: string | null;
  accolades: string[];
  cuisines: string[];
  /** Kept and weighted, never dropped: 'independent' | 'small' | 'regional' | 'national'. */
  chain: boolean;
  chainScale: string;
  sites: number;
  address: string | null;
  postcode: string | null;
  openingHours: string | null;
  summary: string | null;
  website: string | null;
  menuUrl: string | null;
  lat: number | null;
  lng: number | null;
  menu: { items: number; readAt: string } | null;
  researched: boolean;
};

/** A menu Epic could not read, and the reason — the work list, not an empty tab. */
export type ScoutMenuMiss = {
  venue_ref: string;
  venue_label: string | null;
  state: string;
  why: string | null;
  /** Which of the closed causes this sentence was read as (domain/menuCauses.js). */
  cause: string | null;
  menu_url: string | null;
  attempts: number;
  read_at: string | null;
  website: string | null;
};

export type VisitingPlace = {
  id: string; name: string; region_slug: string; category: string | null;
  score: number | null; website: string | null; summary: string | null;
  visiting_because?: string | null; visiting_by?: string | null;
};

export type LibraryVisiting = {
  counts: { visiting: 'yes' | 'no' | null; visiting_by: string | null; n: number }[];
  swept: { total: number; considered: number };
  closed: VisitingPlace[];
  unsettled: VisitingPlace[];
};

export type LibraryVisitingImpact = {
  total: { published: number; shown: number; refused: number; unestablished: number; asked: number };
  regions: { region_slug: string; published: number; shown: number; refused: number; unestablished: number; asked: number }[];
};

export type LibraryOverview = {
  totals: Record<string, string | number>;
  bySource: { source: string; n: number; bytes: string }[];
  byLicence: { licence: string; attribution_required: boolean; n: number }[];
  coverage: LibraryRegion[];
  pendingUploads: number;
  runs: HarvestRun[];
  running: HarvestRun | null;
  widths: { hero: number[]; gallery: number[] };
};

export type RegionAttractions = {
  region: { slug: string; name: string; nation: string; kind: string; lat: number | null; lng: number | null };
  attractions: {
    id: string; name: string; slug: string; rank: number | null; category: string | null;
    summary: string | null; lat: number | null; lng: number | null;
    website: string | null; wikipediaUrl: string | null; osmRef: string | null;
    heritage: string | null; venueRef: string | null; attribution: any[];
    image: { id: string; lqip: string | null; credit: string | null; licence: string;
             licenceUrl: string | null; sourceUrl: string | null; creditRequired: boolean } | null;
  }[];
};

// --- the admin module -------------------------------------------------------

export type AccountPlan = { key: string; label: string; note: string };
export type AccountInvite = { at: string; expiresAt: string; usedAt: string | null; delivery: string | null; error: string | null };
export type Account = {
  id: string;
  householdId: string;
  householdName: string | null;
  email: string;
  name: string | null;
  role: 'owner' | 'customer';
  status: 'invited' | 'active' | 'suspended';
  plan: string;
  trialEndsOn: string | null;
  note: string | null;
  createdAt: string;
  invitedAt: string | null;
  activatedAt: string | null;
  lastSeenAt: string | null;
  signInCount: number;
  liveDevices: number;
  members: number;
  trips: number;
  usage: { callsMonth: number; costMonth: number; callsEver: number; costEver: number; bound: number; boundIsOwn: boolean };
  lastInvite?: AccountInvite | null;
};
export type Invitation = { url: string; expiresAt: string; delivery: string; message: string | null };
export type AccountsResponse = {
  accounts: Account[];
  plans: AccountPlan[];
  mail: { configured: boolean; reason?: string; message?: string; from?: string };
  defaults: { monthlyCallBound: number; guestMonthlyCallBound: number };
  ownerClaimed: boolean;
  foundingHousehold: { id: string; name: string } | null;
  totals: { costMonth: number; costEver: number; callsMonth: number };
};


// --- the back office --------------------------------------------------------

export type Access = { doors: string[]; capabilities: string[]; role: { key: string; label: string } | null };

export type EstateTotals = {
  households: number; accounts: number; active_accounts: number; invited: number; suspended: number;
  joined_this_month: number; people: number; places: number; trips: number; visits: number; ratings: number;
  live_devices: number; cost_month_usd: number; cost_ever_usd: number; calls_month: number;
};
export type DailyRow = { day: string; households: number; seconds: number; views: number; places: number; trips: number; visits: number };
export type ScreenRow = { screen: string; views: number; households?: number; seconds: number };
export type FeedRow = { kind: string; at: string; title: string; detail: string; household_id?: string; household_name?: string; account_email?: string | null };
/** A subscription plan (`plans` table). Not to be confused with `PlanRow`, which is a row on the Plan screen. */
export type SubscriptionPlan = { key: string; label: string; note: string | null; price_pence: number | null; call_bound: number | null; active: boolean; people?: number };
export type MoneyBlock = {
  mrrPence: number;
  byPlan: { key: string; label: string; price_pence: number | null; households: number; mrr_pence: number; unpriced: number }[];
  revenue: { month: string; households: number; revenue_pence: number; paying: number }[];
  cost: { month: string; calls: number; cost_usd: number }[];
  costMonthUsd: number;
  basis: string;
};
/** The ownership tag: keep for good, keep the identifier only, keep nothing. */
export type Keep = 'own' | 'id' | 'none';
export type SourceCell = { status: 'used' | 'offered'; path: string };
export type SourceField = {
  key: string; domain: string; label: string; note: string | null;
  cells: Record<string, SourceCell>; used: boolean; keep: Keep | null; providers: number;
};
export type SourceCalls = { all: number; days30: number; last: string | null };
export type SourceProvider = {
  key: string; label: string; short: string; keep: Keep; licence: string; retention: string; attribution: string;
  cost: string | null; envKey: string | null; file: string; docs: string | null; console: { label: string; url: string } | null;
  lands: string; note: string | null; hasKey: boolean; switchedOff: boolean; usedCount: number; offeredCount: number; calls: SourceCalls;
  owned: { records: number; facts: number; fields: number; oldest: string | null; images: { n: number; storable: number; oldest: string | null } | null } | null;
};
export type SourceService = {
  key: string; label: string; what: string; unit: string; envKey: string | null; file: string;
  console: { label: string; url: string } | null; hasKey: boolean; calls: SourceCalls;
};
export type OwnedFact = { provider: string; field: string; held: number; facts: number; confidence: number | null; oldest: string; newest: string; of: number; coverage: number | null };
export type SourceBenchDecision = 'ours' | 'theirs' | 'both';
export type SourceBenchVerdict = 'agree' | 'differ' | 'unknown' | 'ours_missing' | 'theirs_missing';
export type SourceBenchRow = { venueRef: string; name: string; field: string; ours: string | null; theirs?: string | null; verdict: SourceBenchVerdict; note: string; decision: SourceBenchDecision | null };
export type SourceBenchRun = {
  id: string; provider: string; against: string; fields: string[]; sample: number; compared: number; agreed: number; differed: number; unknown: number;
  rows: SourceBenchRow[]; calls: number; costCents: number; ranBy: string | null; ranAt: string;
};
export type SourceBenchIndex = { runs: SourceBenchRun[]; fields: string[]; providers: string[]; max: number; centsPerCall: number; canRun: boolean };
export type SourceBenchTally = { compared: number; agreed: number; differed: number; unknown: number; oursMissing: number; theirsMissing: number };
export type SourceBenchResult = { run: SourceBenchRun; rows: SourceBenchRow[]; tally: SourceBenchTally; problems: string[]; asked: number; found: number };
export type SourcesReport = {
  checkedOn: string;
  domains: { key: string; label: string; what: string }[];
  fields: SourceField[];
  providers: SourceProvider[];
  services: SourceService[];
  owned: {
    places: number; done: number; facts: OwnedFact[];
    library: {
      attractions: { source: string; n: number; with_summary: number; with_website: number }[];
      images: Record<string, { n: number; storable: number; oldest: string | null }>;
      localities: Record<string, number>;
      transitStops: { n: number; networks: number };
      householdPlaces: { n: number; with_station: number; with_postcode: number };
    };
  };
  searchable: Record<string, boolean>;
};

export type AdminOverview = {
  window: { days: number };
  totals: EstateTotals;
  active: { dau: number; wau: number; mau: number; seconds_30d: number; stickiness: number };
  daily: DailyRow[];
  screens: ScreenRow[];
  feed: FeedRow[];
  /** Epic is an installable web app, not a store listing: added, and opened from a home screen. */
  installs: { added_ever: number; added_window: number; households_standalone: number; opens_window: number };
  money: MoneyBlock | null;
  withheld: string[];
};
export type AdminPerson = {
  id: string; householdId: string; householdName: string | null; email: string; name: string | null;
  status: string; plan: string; role: { id: string; key?: string; label?: string } | null;
  createdAt: string; lastSeenAt: string | null; signInCount: number; liveDevices: number; members: number; trips: number;
  activity: { seconds: number; views: number; daysActive: number; lastActive: string | null };
  usage: { calls: number; costUsd: number; bound: number | null } | null;
};
export type AdminPeople = {
  window: { days: number };
  people: AdminPerson[];
  roles: { id: string; key: string; label: string; doors: string[]; isOwner: boolean }[];
  plans: { key: string; label: string; pricePence: number | null }[];
  withheld: string[];
};
export type PersonRecord = {
  account: { id: string; email: string; name: string | null; status: string; plan: string; trialEndsOn: string | null; note: string | null; createdAt: string; activatedAt: string | null; lastSeenAt: string | null; signInCount: number; monthlyCallBound: number | null; role: { id: string; key: string; label: string; doors: string[] } | null };
  household: { id: string; name: string; homeLabel: string | null; timezone: string | null; createdAt: string } | null;
  members: { id: string; name: string; relationship: string | null; isMinor: boolean; allergens: number; dislikes: number }[];
  devices: { id: string; label: string | null; since: string; lastSeen: string; until: string }[];
  signIns: { id: string; method: string; label: string | null; at: string }[];
  audit: AuditRow[];
  behaviour: {
    summary: Record<string, number | string | null>;
    feed: { kind: string; at: string; title: string; detail: string; subject: string | null; weight: number }[];
    screens: ScreenRow[];
    daily: { day: string; seconds: number; views: number }[];
  } | null;
  withheld: string[];
};
export type AuditRow = {
  id: number; actor_id: string | null; actor_label: string | null; action: string;
  subject_type: string | null; subject_id: string | null; subject_label: string | null;
  before: any; after: any; at: string;
};
export type Engagement = {
  window: { days: number };
  daily: DailyRow[];
  active: { dau: number; wau: number; mau: number; seconds_30d: number; stickiness: number };
  screens: ScreenRow[];
  retention: { cohorts: { cohort: string; size: number }[]; cells: { cohort: string; week_no: number; households: number }[] };
  leaders: { accountId: string; email: string | null; name: string | null; seconds: number; views: number; daysActive: number; lastActive: string | null }[];
};
export type RevenueReport = {
  basis: string; missing: string[]; mrrPence: number; arrPence: number; paying: number; free: number; arpuPence: number;
  byPlan: MoneyBlock['byPlan']; revenue: MoneyBlock['revenue']; cost: MoneyBlock['cost']; plans: SubscriptionPlan[]; totals: EstateTotals;
};
export type UsageReport = {
  window: { days: number };
  byProvider: { provider: string; calls: number; cost_usd: number | null; households: number }[];
  households: { accountId: string; email: string; name: string | null; calls: number; costUsd: number | null; bound: number | null; used: number }[];
  withheld: string[];
};
export type Role = {
  id: string; key: string; label: string; description: string | null; doors: string[];
  is_system: boolean; is_owner: boolean; capabilities: string[]; people?: number;
};
export type Capability = { key: string; area: string; label: string; note: string; manages?: boolean };

export type OfflineManifest = {
  generatedAt: string;
  paths: string[];
  /** The subset that costs nothing to fetch; the automatic fill uses only these. */
  free: string[];
  owned: { claimed: number; researched: number; inOpenMap: number; described: number; waiting: number; failed: number; lastChange: string | null };
};

// --- voice ------------------------------------------------------------------

export type VoiceConfig = { configured: boolean; maxSeconds: number; minutesMonthly: number; liveSessionsDaily: number };
export type VoiceLiveToken = {
  token: string; expiresAt: string | null; model: string; url: string; sampleRate: number; fellBack?: boolean;
  language: string | null; maxSeconds: number;
};
/** Stage two's answer: only what was said, null for the rest, doubts as questions (domain/voiceIntent.js). */
export type VoiceIntent = {
  language: string | null;
  trip_type: 'multi_day' | 'day_out' | null;
  destination: string | null;
  origin: string | null;
  dates: { start: string | null; end: string | null; duration_days: number | null; as_said: string | null };
  party: { adults: number | null; children: number | null; ages: number[]; as_said: string | null };
  budget: { amount: number | null; currency: string | null; per: string | null; level: string | null };
  interests: string[];
  exclusions: string[];
  accessibility: string[];
  ambiguities: { about: string; question: string; options: string[] }[];
  corrections: { field: string; from: string; to: string }[];
  summary: string;
};
export type VoicePlanResponse = { intent: VoiceIntent; model: string; ms: number };
export type VoiceUtterance = { id: string; language: string; text: string; expect: Record<string, unknown>; note?: string };
export type VoiceLabInfo = {
  utterances: VoiceUtterance[];
  models: { transcribe: string; live: string; plan: string };
  configured: boolean;
  switchedOff: boolean;
  caps: { minutesMonthly: number; liveSessionsDaily: number; maxSeconds: number };
};
/** The lab's connection check: the provider's own words when something refuses, which no household screen shows. */
export type VoiceProbe = {
  configured: boolean; switchedOff: boolean;
  live: { ok: true; model: string; url: string; fellBack?: boolean; dropped?: string[] } | { ok: false; code: string; message: string; detail: string | null } | null;
  transcribe: { ok: true; model: string; fellBack?: boolean; dropped?: string[]; ms: number } | { ok: false; code: string; message: string; detail: string | null } | null;
};
export type VoiceCaptureMode = 'live' | 'batch' | 'stream';
export type VoiceModeResult = { transcript: string | null; ms: number | null; model: string | null; error: string | null };
export type VoiceAccuracy = { wer: number; errors: number; substitutions: number; deletions: number; insertions: number; words: number };
export type VoiceRunInput = {
  utteranceId?: string | null; reference?: string | null; language?: string | null; mode?: string | null;
  results: Partial<Record<VoiceCaptureMode, VoiceModeResult>>;
  edited?: string | null; device?: string | null; sessionId?: string | null; plan?: boolean;
};
export type VoiceRun = {
  id: string; utterance_id: string | null; reference: string | null; language: string | null; mode: string | null;
  results: Partial<Record<VoiceCaptureMode, VoiceModeResult>>;
  accuracy: Partial<Record<VoiceCaptureMode, VoiceAccuracy>>;
  live_vs_batch: number | null;
  plans: Partial<Record<VoiceCaptureMode, { intent?: VoiceIntent; ms?: number; model?: string; expectation?: { ok: boolean; misses: { path: string; want: unknown; got: unknown }[] } | null; error?: string }>>;
  plan_changed: boolean | null;
  plan_diff: { field: string; a: unknown; b: unknown }[];
  edited: string | null; device: string | null; ran_by: string | null; created_at: string;
};
export type VoiceRuns = {
  runs: VoiceRun[];
  tally: Record<VoiceCaptureMode, { runs: number; errors: number; meanWer: number | null; medianMs: number | null; planRight: number | null }>;
  agreement: { compared: number; disagreed: number; disagreementRate: number | null; meanLiveVsBatch: number | null; planJudged: number; planChanged: number; planChangedRate: number | null };
};

// --- the voice intake ---------------------------------------------------------

export type IntakeFlow = 'first' | 'returning' | 'inspire';
export type IntakeMode = 'said' | 'steps' | 'typed';
export type ChipSource = 'said' | 'profile' | 'default' | 'gap';
/** One chip: what it says, where it came from, and the value behind it. */
export type IntakeSlot = { key: string; label: string; icon: string | null; value: unknown; source: ChipSource; count?: number };
export type IntakeQuestion = {
  slot: string; title: string; why: string; skip: string; remember?: string;
  options?: { value: string | number; label: string }[];
  children?: { index: number; name: string | null }[]; bands?: string[];
};
export type TripFacts = {
  language: string | null; trip_type: string | null;
  when: { start: string | null; end: string | null; as_said: string | null };
  time_of_day: string | null; destination: string | null;
  origin: { kind: 'home' | 'current' | 'named' | null; name: string | null };
  travel_mode: string | null; max_minutes: number | null;
  who: { kind: string | null; names: string[]; adults: number | null; children: number | null; kids_mentioned: boolean };
  kids_ages: { name: string | null; age: number | null; band: string | null }[];
  vibe: string | null; vibe_no_preference: boolean; several_things: boolean | null; indoors: boolean | null;
  wants: { name: string; kind: 'place' | 'type'; type: string | null }[];
  food: { diets: string[]; cuisines: string[]; must_haves: string[]; kinds: string[]; avoids: string[]; place: string | null; no_preference: boolean };
  ambiguities: { slot: string; question: string; options: string[] }[];
  corrections: { slot: string; from: string; to: string }[];
};
export type Intake = {
  id: string; flow: IntakeFlow; mode: IntakeMode; language: string | null; asked: string | null; tripId: string | null;
  facts: TripFacts; slots: IntakeSlot[]; questions: IntakeQuestion[]; ambiguities: TripFacts['ambiguities'];
  resolved: {
    tripType: string | null; start: string | null; end: string | null; timeOfDay: string | null; destination: string | null; origin: any; travelMode: string; maxMinutes: number; who: any; vibe: string | null; kidsAges: any; indoors: boolean | null; food: TripFacts['food'];
    /** The things named: places to put on the list, kinds to lead the browse with. */
    wants: { name: string; kind: 'place' | 'type'; type: string | null }[];
    leadKinds: string[];
    leadFoodKinds: string[];
    /** What Inspire's answer list is narrowed by. */
    filter: { indoors: boolean | null; kids: boolean; moods: string[]; wantTypes: string[] };
  };
  tripType: string | null;
  resultsHref: string;
  tripDraft: Parameters<typeof api.createTripV3>[0];
  destinationPoint: (Place & { locality?: string | null }) | null;
  harvest: { text: string; items: { kind: 'diet'; values: string[] }[] | { kind: 'kids'; ages: { name: string | null; age: number }[] }[] | any[] } | null;
  profileComplete: boolean;
  createdAt: string; updatedAt: string;
};
export type SpokenPerson = { name: string; role: 'adult' | 'child' | null; age: number | null; band?: string | null; relationship: string | null; isSpeaker: boolean; existingId?: string | null };
export type SpokenFood = { kind: 'diet' | 'allergy' | 'dislike' | 'favourite'; value: string; who?: string | null; memberId: string | null; memberName?: string | null };
export type SpokenLike = { kind: 'love' | 'avoid'; phrase: string; label?: string | null; category: string | null; subcategory: string | null; who?: string | null; memberId: string | null; memberName?: string | null };

// ---------------------------------------------------------------------------
// Hosting (Events & Hosts, 12 Sep 2026)
// ---------------------------------------------------------------------------

/** The settled kinds (T-REC, 13 Sep 2026): I have a skill · Meetups and mini tours · Expert guide. */
export type HostType = 'skill' | 'meetups' | 'expert';
export type LocalKind = 'family' | 'already_do' | 'night_out' | 'neighbourhood';
/** Who can come. It decides whether identity, a video, evidence and an age gate are needed at all. */
export type Visibility = 'invite' | 'link' | 'public';
/** Whether anyone is paying, and who takes it. Public paid is Epic-collects only. */
export type Money = 'free' | 'direct' | 'epic';
export type RepeatEvery = 'weekly' | 'fortnightly' | 'monthly';
export type CheckKind = 'pub' | 'qual' | 'years' | 'lic';
/** `media` is whether one was uploaded, not where it is: evidence is never drawn, and never public. */
export type Evidence = { id: string; offerId: string | null; kind: CheckKind; fields: Record<string, string | null>; media: boolean };
export type OfferInvite = { id: string; name: string; contact: string | null; contactKind: 'mobile' | 'email' | null; heads: number; rsvp: 'yes' | 'no' | null; rsvpHeads: number | null; sentAt: string | null; answeredAt: string | null; token: string };
/** The sub-kind questionnaire, kept as the host answered it. */
export type SubDetail = {
  family?: { ageBands?: string[]; interests?: string[]; matchAges?: string | null; notes?: string | null };
  night?: { kinds?: string[]; venues?: string | null; minGroup?: number | null; endTime?: string | null };
  already?: { what?: string[]; route?: string | null; difficulty?: string | null; bring?: string | null };
  neighbourhood?: { what?: string[]; route?: string | null; stops?: string | null; gettingAround?: string[]; access?: string | null };
};
export type TrustLevel = 'verified' | 'checked' | 'trusted';
export type OfferShape = 'oneoff' | 'series' | 'anytime';
export type OfferState = 'draft' | 'in_review' | 'live' | 'paused' | 'ended';
export type OfferVenue = 'their_place' | 'your_place' | 'out_about' | 'online';
export type PriceMode = 'free' | 'same_each' | 'by_numbers';
export type RefundRule = '24h' | '7d' | 'none';

export type PaymentsConfig = { provider: string | null; ready: boolean; note: string };
export type Told = { sentTo: number; delivered: number; channel: 'sender' | 'none' };

export type HostMedia = { id: string; url: string; kind: 'video' | 'photo' | 'doc'; mime: string; size: number; durationS: number | null; trimStartS: number | null; trimEndS: number | null; madeBy: 'self' | 'epic' };

/** A host as a guest sees them: the person, then the trust level. */
export type PublicHost = {
  id: string; name: string; type: HostType | null; localKind: LocalKind | null; trust: TrustLevel; checks: 'running' | 'passed';
  introText: string | null; introVideo: string | null; photo: string | null;
  location: string | null; lat: number | null; lng: number | null; countryCode: string | null;
  /** What the host wrote about themselves. A claim, and labelled as one. */
  credentials: string[];
  /** What Epic has seen, or what was stated where no evidence is asked for. Never the reference number. */
  credentialsShown: { label: string; how: 'confirmed' | 'stated'; at: string | null }[];
  languages: string[]; childrenAges: number[];
  rating: number | null; reviewCount: number; guests: number; isNew: boolean; since: string;
  otherOffers?: number; km?: number; liveOffers?: number;
};
export type OwnHost = PublicHost & {
  address: string | null; idDocument: 'passport' | 'driving_licence' | null; insuranceConfirmed: boolean; taxReference: string | null;
  payoutStatus: 'not_connected' | 'connected'; payoutLabel: string | null; dateOfBirth: string | null;
  evidence?: Evidence[];
};
export type HostInput = {
  name: string; type?: HostType | null; localKind?: LocalKind | null; introText?: string | null; address?: string | null;
  locationLabel?: string | null; lat?: number | null; lng?: number | null; countryCode?: string | null;
  credentials?: string[]; languages?: string[]; childrenAges?: number[]; dateOfBirth?: string | null;
};

export type Standing = { heads: number; bookings: number; minimum: number | null; expected: number | null; maximum: number | null; needs: number; minimumMet: boolean; placesLeft: number | null; full: boolean };
export type OfferPrice = { pence: number; each: number; ceilingPence: number | null; likelyPence: number | null; mode: 'free' | 'same_each' | 'by_numbers' | 'drop_in' };
export type RunningOrderRow = { time: string | null; title: string; detail: string | null };
export type FeaturedPerson = { name: string; role: string | null; photo: string | null };
export type Week = { n: number; title: string };
export type Availability = { days?: number[]; parts?: ('morning' | 'afternoon' | 'evening')[] };

/** One experience, as a guest sees it. The exact address arrives only once booked. */
export type Experience = {
  id: string; hostId: string; shape: OfferShape; state: OfferState; pausedUntil: string | null; visibility: Visibility; money: Money;
  title: string | null; summary: string | null; description: string | null; whyYou: string | null; includes: string | null; category: string | null;
  photos: string[]; video: string | null; doc: string | null;
  facts: { key: string; value: string }[]; endsAt: string | null; repeatEvery: RepeatEvery; endDate: string | null; themesDiffer: boolean;
  noticeDays: number | null; subDetail: SubDetail;
  venue: OfferVenue; venueArea: string | null; venueLabel: string | null; venueLat: number | null; venueLng: number | null; venueCountry: string | null;
  venueNotes: string | null; travelRadiusMin: number | null; travelChargePence: number | null; onlinePlatform: string | null;
  durationMin: number | null; minCount: number | null; expectedCount: number | null; maxCount: number | null; partyMax: number | null; ageLimit: number | null;
  priceMode: PriceMode; pricePence: number | null; totalPence: number | null; per: 'person' | 'household'; refundRule: RefundRule;
  startsOn: string | null; startsAt: string | null; runningOrder: RunningOrderRow[]; featuredPeople: FeaturedPerson[];
  weekday: number | null; firstDate: string | null; sessions: number | null; skippedDates: string[]; dates: string[];
  outcome: string | null; arc: string | null; weeks: Week[]; joinMode: 'whole' | 'drop_in' | 'both' | null; dropInPence: number | null; missedNote: string | null;
  availability: Availability; slots: { date: string; times: string[] }[]; slotMin: number | null;
  standing: Standing; price: OfferPrice;
  /** The five fields (Host Skills, 13 Sep 2026). `category` above is the old single word. */
  categoryKey: string | null; formatKey: string | null; tags: OfferSkill[]; facets: OfferSkill[];
  regulated: { country: string; answer: string | null } | null;
  cancelledNote: string | null;
  host: PublicHost | null;
  km?: number;
};
export type ExperienceBooking = {
  id: string; name: string | null; heads: number; party: PartyMember[]; occurrence: string | null; state: BookingState; paymentStatus: 'recorded' | 'paid' | 'refunded';
  amountPence: number; note: string | null; address: string | null; accessNotes: string | null; bookedAt: string;
};
export type PitchChecklist = { what: string; home: string; suits: string; notSuits: string; photos: string };
/** The host's own offer: the guest's view, plus the roster, the money and what stands between it and Publish. */
// ---------------------------------------------------------------------------
// "Just say what you are up for" (Casual meet ups, O1–O14)
// ---------------------------------------------------------------------------

export type OpenScope = 'standing' | 'trip';
export type OpenKind = 'adult' | 'family';
export type OpenLanguage = { name: string; level: 'fluent' | 'some' };
/** What somebody is up for. No date, no price, no cap, no venue and no listing. */
export type OpenEntry = {
  id: string; scope: OpenScope; tripId: string | null; kind: OpenKind;
  interests: string[]; level: string[]; when: string[];
  where: string | null; miles: number | null; languages: OpenLanguage[]; money: string;
  prefs: { age: 'any' | 'similar'; company: string[]; fluency: 'fluent' | 'some' };
  /** Preferences Epic holds nothing to check, so the screen says so rather than implying it filtered. */
  cannotHonour: string[];
  childAgeBands: string[]; transcript: string | null; state: string;
  /** How many people Epic has already asked on this entry's behalf. A count, never a list. */
  asked: number;
  reviewDueAt: string | null; expiresAt: string | null; updatedAt: string;
};
export type OpenHome = {
  entries: OpenEntry[];
  you: { party: string; languages: OpenLanguage[]; home: string | null; miles: number | null };
  config: { helloSeconds: number; company: string[]; agePrefs: string[]; fluency: string[]; listening: boolean };
};
/**
 * The one ID check (O9). `draft` while the two images are being taken,
 * `pending` once it is with Epic, and then passed or sent back with a reason.
 * Nobody sets this themselves.
 */
export type OpenIdCheck = {
  state: 'draft' | 'pending' | 'passed' | 'failed';
  doc: boolean; selfie: boolean;
  submittedAt: string | null; decidedAt: string | null; note: string | null;
};
/** One ID check waiting to be looked at. The images are addresses, and they go the moment it is decided. */
export type AdminIdCheck = {
  id: string; matchId: string; side: 'host' | 'guest'; household: string | null;
  kind: string; interests: string[]; submittedAt: string;
  doc: string | null; selfie: string | null;
};
/** What the listener made of what was said — chips to confirm, never a transcript to proof-read. */
export type OpenHeard = { interests: string[]; level: string[]; when: string[]; languages: string[] };
/** One introduction, at whatever stage it is at, shaped by what this side may know. */
export type OpenMatch = {
  id: string; stage: 'host_asked' | 'guest_asked' | 'videos' | 'both_yes' | 'verified' | 'chat' | 'lapsed' | 'ended';
  kind: OpenKind; side: 'host' | 'guest'; interests: string[];
  waitingOn: 'you' | 'them' | null; lapsesAt: string;
  video: { mine: string | null; theirs: string | null; waiting: boolean; seconds: number; gone: boolean };
  /** Nothing of theirs until both have answered, and a no is never reported at all. */
  verdict: { mine: boolean | null; theirs: boolean | null; settled: boolean; introduced?: boolean };
  verified: { you: boolean; them: boolean };
  /** Your own ID check, and nothing about theirs beyond whether it cleared. */
  check: OpenIdCheck;
  /** The language the two of you share, and how well you speak it. */
  language: { name: string; level: string } | null;
  /** Your own first name and journey — what the screens use to speak to you; never sent the other way. */
  you: { name: string | null; journey: { from: string | null; to: string | null; when: string | null } | null };
  from?: string | null; origin?: string | null; when?: string | null; childAgeBands?: string[]; name?: string | null;
  detail?: { where: string | null; note: string | null };
  introduction?: { name: string; town: string | null; interests: string[]; where: string | null; note: string | null; language: { name: string; level: string } | null };
};

/** One of my Epic contacts: everyone this household has invited (lanes A and B, C2f). */
export type HostContact = { id: string; name: string; mobile: string | null; email: string | null; timesInvited: number; lastInvitedAt: string | null };
export type OwnOffer = Experience & {
  /** The old single word, offered as a starting suggestion on next edit. Never written by a migration. */
  categorySuggestion: string | null;
  blockers: string[]; checklist: PitchChecklist; licenceNumber: string | null; licenceExpiry: string | null;
  /** The steps this offer's set-up walks, derived from its three axes. The progress bar counts these. */
  steps: string[];
  /** What the public lane would ask, so a shared screen can say "2 of 4 · 2 of 10 public". */
  publicSteps: string[];
  linkToken: string; linkUrl: string;
  seeded: string[]; checks: CheckKind[]; rulesAccepted: boolean; transcript: string | null;
  invites: OfferInvite[];
  reviewNote: string | null; reviewChecklist: Record<string, string> | null; reviewedAt: string | null; submittedAt: string | null; publishedAt: string | null;
  takings: { collectedPence: number; recordedPence: number; refundedPence: number; payoutOn: string | null; atMinimum: number | null; atExpected: number | null; fee: { fee: number; net: number; percent: number } };
  bookings: ExperienceBooking[];
  broadcasts: { id: string; body: string; sentTo: number; delivered: number; at: string }[];
};
export type OfferInput = Partial<{
  shape: OfferShape; title: string | null; description: string | null; whyYou: string | null; includes: string | null; category: string | null;
  photoIds: string[]; videoId: string | null;
  venue: OfferVenue; venueLabel: string | null; venueArea: string | null; venueLat: number | null; venueLng: number | null; venueCountry: string | null; venueNotes: string | null;
  travelRadiusMin: number | null; travelChargePence: number | null; onlinePlatform: string | null;
  durationMin: number | null; minCount: number | null; expectedCount: number | null; maxCount: number | null; partyMax: number | null; ageLimit: number | null;
  priceMode: PriceMode; pricePence: number | null; totalPence: number | null; per: 'person' | 'household'; refundRule: RefundRule;
  startsOn: string | null; startsAt: string | null; runningOrder: RunningOrderRow[]; featuredPeople: { name: string; role: string | null; photoId?: string | null }[];
  weekday: number | null; firstDate: string | null; sessions: number | null; skippedDates: string[]; outcome: string | null; arc: string | null; weeks: Week[];
  joinMode: 'whole' | 'drop_in' | 'both' | null; dropInPence: number | null; missedNote: string | null;
  availability: Availability; slotMin: number | null;
  regulatedAnswer: 'no_commentary' | 'licensed' | null; licenceNumber: string | null; licenceExpiry: string | null;
  visibility: Visibility; money: Money; summary: string | null; endsAt: string | null; repeatEvery: RepeatEvery; endDate: string | null;
  themesDiffer: boolean; noticeDays: number | null; subDetail: SubDetail; rulesAccepted: boolean; checks: CheckKind[];
  facts: { key: string; value: string }[]; seeded: string[]; docId: string | null;
  categoryKey: string | null; formatKey: string | null;
  /**
   * Whole-list, in the host's order: the order is the answer, and a partial
   * update cannot express a drag. `asIs` is the host having chosen their own
   * words with the suggestions in front of them, so the server does not go
   * looking for something near enough.
   */
  tags: { key?: string | null; raw: string; asIs?: boolean }[];
  facets: { key?: string | null; raw: string; asIs?: boolean }[];
}>;

export type HostHome = {
  host: OwnHost | null;
  offers: OwnOffer[];
  stats: { live: number; booked: number; toComePence: number; joinedThisWeek: number; nextPayoutOn: string | null } | null;
  nearby: PublicHost[];
  /** What guests wrote when they booked: each one a second offer waiting to be written. */
  asks?: string[];
  config: { payments: PaymentsConfig; passions: { key: string; label: string }[]; regulated: Record<string, string>; videoMaxSeconds: number };
  you?: { name: string | null; email: string | null };
  firstListingRead?: boolean;
};
export type HostProfile = {
  host: PublicHost;
  /** What this person knows across their offers — derived, never stored. Tags belong to the offer, not the person. */
  tags: { key: string; label: string; offers: number }[];
  offers: Experience[];
  reviews: { stars: number; chips: string[]; text: string | null; on: string; title: string | null }[];
};
export type ExperiencesNear = {
  cards: Experience[];
  /** The browse row: sixteen categories, chosen once, with how many hosts near you are in each. */
  browse: { key: string; label: string; icon: string | null; people: number }[];
  passions: { key: string; label: string; people: number }[];
  allPassions: { key: string; label: string }[];
};

// ---------------------------------------------------------------------------
// Host skills (13 Sep 2026): five fields where there was one word
// ---------------------------------------------------------------------------
/**
 * A resolved row in the open vocabulary, exactly as the screens draw it.
 *
 * `breadcrumb` is context in one glance — "Geology and fossils › Palaeontology"
 * — and is never navigation: not tappable, and there is no tree to walk.
 * `hostCount` is null unless it flatters; "0 hosts" reads as an empty shelf.
 */
export type SkillSuggestion = {
  key: string; label: string; breadcrumb: string | null; parent: string | null;
  kind: string | null; categoryKey: string | null; note: string | null;
  hostCount: number | null;
  /** No external identifier yet. Legitimate, and shown as such in the back office only. */
  unmapped: boolean;
};
/** What an offer carries, in the host's own order. The first tag is what shows on the card. */
export type OfferSkill = {
  key: string | null; raw: string; label: string;
  /** Nothing matched: live on the offer, in the queue, drawn dashed — never red. */
  pending: boolean;
  kind?: string | null; categoryKey?: string | null;
};
/** `offers` is the public count on the guest side and every offer on the admin side — two screens, two meanings. */
export type SkillCategory = { key: string; label: string; blurb: string | null; icon: string | null; offers?: number; public_offers?: number };
export type SkillFormat = { key: string; label: string; blurb: string | null; icon: string | null; venueless?: boolean };
export type SkillPrompt = { badge: string; title: string; sub: string; placeholder: string; kicker: string; asideTitle?: string; aside?: string };
export type HostSkillsSetup = {
  householdId: string | null;
  /** "You are in Charmouth — add Jurassic Coast?" Offered, never filled in silently. */
  placeSuggestion: { key: string; label: string; km: number } | null;
  prompt: SkillPrompt;
  prompts: Record<string, SkillPrompt>;
  cap: number; facetCap: number;
  ageBands: { key: string; label: string }[];
  categories: SkillCategory[];
  formats: SkillFormat[];
  starters: SkillSuggestion[];
};
export type TagPage = {
  tag: SkillSuggestion & { note: string | null; hostCount: number };
  hosts: {
    hostId: string; name: string; type: HostType | null; trust: string | null; location: string | null; photoId: string | null;
    offerId: string; title: string | null; shape: OfferShape; state: OfferState; area: string | null; category: string | null;
    priceMode: PriceMode; pricePence: number | null; totalPence: number | null; per: 'person' | 'household';
  }[];
  near: SkillSuggestion[];
};
export type SkillProposal = {
  id: string; vocab: 'tag' | 'facet'; norm: string; raw: string; count: number;
  state: 'open' | 'approved' | 'merged' | 'rejected'; targetKey: string | null;
  note: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string; offers: number;
  targets: SkillSuggestion[];
};
export type SkillVocabRow = {
  key: string; label: string; parent_key: string | null; parent_label: string | null; category_key: string | null;
  kind?: string | null; source: string | null; external_id: string | null; note: string | null;
  seen_count: number; active: boolean; seeded: boolean; offers: number; hosts: number;
};
export type CredentialType = {
  key: string; label: string; note: string | null; host_types: string[]; evidence_required: boolean;
  gates_categories: string[]; expires_months: number | null; position: number; active: boolean; seeded: boolean;
};
export type CredentialWaiting = {
  id: string; host_id: string; host_name: string; host_type: string; type_key: string; label: string;
  reference: string | null; detail: string | null; state: string; created_at: string; evidence_required: boolean;
};
export type VocabularySource = {
  key: string; label: string; what_we_take: string; licence: string; attribution: string | null; may_retain: boolean;
  resolves: string | null; url: string | null; note: string | null; last_refreshed: string | null; active: boolean;
  position: number; tags: number; facets: number;
};
export type SkillsOverview = {
  categories: (SkillCategory & { position: number; active: boolean; seeded: boolean; offers: number })[];
  formats: (SkillFormat & { position: number; active: boolean; seeded: boolean; offers: number })[];
  credentialTypes: CredentialType[];
  sources: VocabularySource[];
  queue: { open: number; oldest: string | null };
  credentialsWaiting: number;
  cap: number;
  facetKinds: string[];
  /** Whether trigram matching is available; without it the resolver matches on prefix and substring only. */
  trigram: boolean;
};
export type HostCredential = {
  id: string; typeKey: string; label: string; reference: string | null; detail: string | null;
  state: 'stated' | 'pending' | 'confirmed' | 'rejected'; confirmedAt: string | null; expiresOn: string | null; expired: boolean; note: string | null;
  shows: { label: string; how: 'confirmed' | 'stated'; at: string | null } | null;
};

export type PartyMember = { id?: string; name: string; age: number | null; child: boolean; avatarUrl?: string | null };
export type BookingState = 'pending' | 'confirmed' | 'waitlisted' | 'cancelled' | 'attended';
/** `inviteToken` / `linkToken`: a private offer is booked only by somebody holding its credential (Codex, 13 Sep 2026). */
export type BookingInput = { party: PartyMember[]; occurrence?: string | null; bookedBy?: string | null; address?: string | null; accessNotes?: string | null; noteToHost?: string | null; inviteToken?: string | null; linkToken?: string | null };
export type Booking = {
  id: string; offerId: string; hostId: string; title: string | null; shape: OfferShape; occurrence: string | null; on: string | null; startsAt: string | null;
  durationMin: number | null; venue: OfferVenue; venueArea: string | null; venueLabel: string | null; venueNotes: string | null; onlinePlatform: string | null; refundRule: RefundRule;
  party: PartyMember[]; heads: number; state: BookingState; paymentStatus: 'recorded' | 'paid' | 'refunded'; amountPence: number;
  paidAt: string | null; refundedAt: string | null; cancelledAt: string | null; cancelledBy: 'guest' | 'host' | 'epic' | null;
  address: string | null; accessNotes: string | null; noteToHost: string | null; decideBy: string | null;
  offerState: OfferState; offerCancelledNote: string | null; minCount: number | null; maxCount: number | null;
  host: { id: string; name: string; type: HostType; trust: TrustLevel | null; photo: string | null; location: string | null };
  isPast: boolean; reviewed: boolean; bookedAt: string;
};
export type InvitedView = { invite: OfferInvite; offer: Experience; going: number; payments: PaymentsConfig };
/** Every e-mail sent and what Postmark said became of it (admin › Mail). */
export type MailRow = { id: string; to_address: string; subject: string; purpose: string; provider_id: string | null; status: 'sending' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'soft_bounced' | 'complained' | 'failed'; bounce_type: string | null; failure: string | null; sent_at: string; delivered_at: string | null; opened_at: string | null; bounced_at: string | null };
export type AdminMail = { counts: Record<string, number>; filters: { delivered: number; not_delivered: number }; rows: MailRow[]; words: Record<string, string>; sender: { configured: boolean; from?: string; provider?: string; stream?: string; events?: boolean; message?: string; setup?: string } };
export type AdminHosting = {
  inReview: (Experience & { hostName: string; hostType: HostType | null; hostTrust: TrustLevel; submittedAt: string | null; checklist: PitchChecklist; commentary: boolean })[];
  hosts: (OwnHost & { liveOffers: number; inReview: number; openReports: number })[];
  reports: { id: string; hostId: string; hostName: string; offerId: string | null; title: string | null; reason: string; at: string }[];
  trustLevels: TrustLevel[];
};
/** What the invite's account step hands back now that a code may be sent (G20). */
export type GuestJoinResult = JoinView & {
  participantToken: string; sessionToken: string | null; account: GuestAccount | null;
  signInRequired?: boolean; codeSent?: boolean; contact?: string; expiresInMinutes?: number; returning?: boolean; message?: string;
};
