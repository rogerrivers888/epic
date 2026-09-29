/**
 * The ideas feed, as data (trip redesign 8a, owner 29 Sep 2026).
 *
 * The feed is the image-led list the X-ray search hands over to: Activities and
 * Food & drink, each a set of collection rows built for *this* trip. This module
 * turns the flat pool the detour-zone search returns (`GET /api/trips/:id/along`,
 * one call per kind, asked at the widest band so the 10/15/30 filter is a
 * client-side cut) into those rows. It is React-free so the rules — which row a
 * place lands in, when a tab is too thin to draw as rows, the counts beside the
 * filter — are unit-tested without a tree behind them (`test/tripIdeas.test.ts`).
 *
 * The design's fidelity is layout, copy and motion; photos, counts and detour
 * minutes are real, from the places API. Where the API cannot name a semantic
 * the design leans on — a "10-minute walk" from the destination, "coffee" vs
 * "something sweet" — the nearest owned signal stands in: straight-line
 * proximity for the walk, category/cuisine keywords for the food rows.
 */
import type { MoodKey, TripAlongPlace, Trip, VenuePhotoRef } from '../api';

/**
 * The mood words and the £-band, inlined so this module is self-contained and
 * unit-testable under `node --test` without pulling the app's import graph in.
 * They are the same values as `moods.ts` MOOD_LABEL and `inspireList.ts`
 * priceMarks; the feed only ever labels a row or prints a price with them.
 */
const MOOD_LABEL: Record<string, string> = {
  fun: 'Fun', food: 'Food', culture: 'Culture', educational: 'Educational',
  sport: 'Sport', activity: 'Active', adrenaline: 'Adrenaline', relaxing: 'Relaxing', outdoors: 'Outdoors',
};

/** "££", or "Free", or null when nobody has said — what the price tag prints. */
function priceMarks(priceLevel: number | null | undefined): string | null {
  if (priceLevel == null) return null;
  if (priceLevel === 0) return 'Free';
  return '£'.repeat(Math.max(1, Math.min(4, Math.round(priceLevel))));
}

export type IdeasKind = 'activities' | 'food';

/** One card in a row: everything the feed tile draws, plus the place behind it. */
export type FeedCard = {
  ref: string;
  name: string;
  /**
   * The provider's photo reference, kept whole — not flattened to a URL. A Google
   * photo arrives as a `ref` (plus a signed `sig`/`exp`), never a bare `url`, and
   * VenueThumb builds the proxied URL from it; reading `.url` alone dropped every
   * one of them and left the card a grey box (deployed, 29 Sep 2026).
   */
  photos: VenuePhotoRef[];
  /** For the floor icon VenueThumb draws when there is no photo. */
  category: string | null;
  experiences: string[];
  /** Always "+N min detour" in 8a (owner: never "N min walk from…", which wraps). */
  fit: string;
  /** "Museum · ★ 4.7", the card's third line. */
  typeR: string;
  price: string | null;
  kind: IdeasKind;
  onShortlist: boolean;
  onDay: boolean;
  /** A shortlisted item's working status; a rejected one (full/set_aside) cannot be re-added. */
  status?: string | null;
  // Null where no source has placed it — never 0, so a real point on the prime
  // meridian or the equator is not mistaken for "no coordinate".
  lat: number | null;
  lng: number | null;
  place: TripAlongPlace;
};

export type FeedRow = { key: string; title: string; sub: string | null; big: boolean; items: FeedCard[] };

/** When a tab has fewer than five, it becomes a plain list with the widen prompt. */
export type ThinResults = { count: number; widerCount: number; items: FeedCard[] };

export type Feed = { rows: FeedRow[]; thin: ThinResults | null; count: number };

/** A 10-minute walk is about 0.8km as the crow flies — the "Right by" fence. */
export const NEAR_KM = 0.8;
/** How many of the household-ranked pool lead the feed as large "Picked" cards. */
const PICKED = 8;
/** Below this many results in a band, a tab is drawn as a plain list, not rows. */
export const THIN_BELOW = 5;
/** The three detour bands the filter offers; 15 is the default. */
export const DETOUR_BANDS = [10, 15, 30] as const;

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The destination's short name for a row title: "The National Gallery" → "The National Gallery". */
export function destShortName(trip: Trip): string {
  const label = trip.destination?.label ?? trip.locality ?? null;
  if (!label) return 'your destination';
  return label.split(',')[0].trim();
}

/** "Along your drive in" / "walk in" / "train in", to match the trip's own mode. */
export function alongSub(mode: Trip['travelMode']): string {
  const word = mode === 'walking' ? 'walk' : mode === 'cycling' ? 'ride' : mode === 'transit' ? 'train' : 'drive';
  return `Along your ${word} in`;
}

/** How many of the pool are within a band — the number beside each filter option. */
export function bandCount(places: TripAlongPlace[], minutes: number): number {
  return places.filter((p) => p.detourMinutes != null && p.detourMinutes <= minutes).length;
}

/** The card's third line: what it is, then its rating. */
function typeLine(p: TripAlongPlace): string {
  const what = (p.subcategory ? p.subcategory.replace(/-/g, ' ') : null) ?? p.category ?? 'Place';
  const label = what.charAt(0).toUpperCase() + what.slice(1);
  return p.rating != null ? `${label} · ★ ${p.rating.toFixed(1)}` : label;
}

function toCard(p: TripAlongPlace, kind: IdeasKind): FeedCard {
  const mins = p.detourMinutes;
  return {
    ref: p.venueRef,
    name: p.name,
    photos: (p.photos ?? []).slice(0, 1),
    category: p.category,
    experiences: p.experiences ?? [],
    fit: mins != null ? `+${Math.round(mins)} min detour` : 'On your way',
    typeR: typeLine(p),
    price: priceMarks(p.priceLevel),
    kind,
    onShortlist: p.onShortlist,
    onDay: p.onDay,
    lat: p.lat,
    lng: p.lng,
    place: p,
  };
}

const hay = (p: TripAlongPlace): string =>
  [p.category, p.subcategory, ...(p.cuisines ?? []), ...(p.experiences ?? [])].filter(Boolean).join(' ').toLowerCase();

const isCoffee = (p: TripAlongPlace) => /coffee|caf[eé]|espresso/.test(hay(p));
const isSweet = (p: TripAlongPlace) => /bakery|baker|patisserie|dessert|ice.?cream|gelato|chocolat|sweet|cake|donut|doughnut/.test(hay(p));

/** The primary mood a place files under, for the category rows. */
function primaryMood(p: TripAlongPlace): MoodKey | null {
  const m = (p.moods ?? []).find((x) => x !== 'food');
  return m ?? null;
}

/**
 * Build the feed for one tab. `places` is the whole pool the search returned for
 * this kind (asked at the widest band); `minutes` is the chosen detour filter.
 * The "Right by" row is fenced by walking proximity to the destination and so is
 * independent of the filter (owner: always within a 10-minute walk); every other
 * row is inside the band. A place appears in only one of Picked / Right by / On
 * the way; the category rows below may repeat them.
 */
export function buildFeed(opts: { places: TripAlongPlace[]; kind: IdeasKind; trip: Trip; minutes: number; moodLabels?: Record<string, string> }): Feed {
  const { places, kind, trip, minutes } = opts;
  const moodLabel = (k: string) => opts.moodLabels?.[k] ?? MOOD_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

  const band = places.filter((p) => p.detourMinutes != null && p.detourMinutes <= minutes);
  const count = band.length;
  const widerCount = bandCount(places, 30);

  const dest = trip.destination;
  const near = (p: TripAlongPlace): boolean =>
    dest?.lat != null && dest?.lng != null && kmBetween(dest.lat, dest.lng, p.lat, p.lng) <= NEAR_KM;

  // "Right by" is filter-independent: within a 10-minute walk of the destination,
  // whatever the band says. Sorted by how close.
  const nearPlaces = places
    .filter(near)
    .sort((a, b) => kmBetween(dest!.lat!, dest!.lng!, a.lat, a.lng) - kmBetween(dest!.lat!, dest!.lng!, b.lat, b.lng));
  const nearRefs = new Set(nearPlaces.map((p) => p.venueRef));

  // Too thin to draw as rows: say so, show what there is, offer to widen. The
  // "Right by" places still belong here even where their detour tops the band.
  if (count < THIN_BELOW) {
    const seen = new Set<string>();
    const items = [...band, ...nearPlaces].filter((p) => (seen.has(p.venueRef) ? false : seen.add(p.venueRef))).map((p) => toCard(p, kind));
    return { rows: [], count, thin: { count, widerCount, items } };
  }

  const rest = band.filter((p) => !nearRefs.has(p.venueRef));

  const rows: FeedRow[] = [];
  const short = destShortName(trip);

  if (kind === 'food') {
    // No "Picked" row for food: the whole rest splits into the named rows.
    if (nearPlaces.length) rows.push({ key: 'near', title: `Lunch near ${short}`, sub: leaveTimeSub(trip), big: true, items: nearPlaces.map((p) => toCard(p, kind)) });
    const coffee = rest.filter(isCoffee);
    const sweet = rest.filter((p) => !isCoffee(p) && isSweet(p));
    const other = rest.filter((p) => !isCoffee(p) && !isSweet(p));
    if (coffee.length) rows.push({ key: 'coffee', title: 'Coffee on the way in', sub: null, big: false, items: coffee.map((p) => toCard(p, kind)) });
    if (sweet.length) rows.push({ key: 'sweet', title: 'Something sweet', sub: null, big: false, items: sweet.map((p) => toCard(p, kind)) });
    if (other.length) rows.push({ key: 'other', title: nearPlaces.length ? 'More places to eat' : 'Places to eat', sub: null, big: !nearPlaces.length, items: other.map((p) => toCard(p, kind)) });
    return { rows: rows.filter((r) => r.items.length), thin: null, count };
  }

  // Activities: the pool leads with big "Picked" cards, then Right by, then On
  // the way. A place is in only one of the three.
  const picked = rest.slice(0, PICKED);
  const pickedRefs = new Set(picked.map((p) => p.venueRef));
  const wayPlaces = rest
    .filter((p) => !pickedRefs.has(p.venueRef))
    .sort((a, b) => (a.detourMinutes ?? 0) - (b.detourMinutes ?? 0));
  if (picked.length) rows.push({ key: 'pick', title: 'Picked for your household', sub: null, big: true, items: picked.map((p) => toCard(p, kind)) });
  if (nearPlaces.length) rows.push({ key: 'near', title: `Right by ${short}`, sub: 'Within a 10-minute walk', big: false, items: nearPlaces.map((p) => toCard(p, kind)) });
  if (wayPlaces.length) rows.push({ key: 'way', title: 'On the way', sub: alongSub(trip.travelMode), big: false, items: wayPlaces.map((p) => toCard(p, kind)) });

  // Category rows: the same shelves as Inspire, ordered by how many the band has,
  // and free to repeat a place already shown above.
  const byMood = new Map<MoodKey, TripAlongPlace[]>();
  for (const p of band) {
    const m = primaryMood(p);
    if (!m) continue;
    (byMood.get(m) ?? byMood.set(m, []).get(m)!).push(p);
  }
  const moodRows = [...byMood.entries()]
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [m, list] of moodRows) {
    rows.push({ key: `mood:${m}`, title: moodLabel(m), sub: null, big: false, items: list.map((p) => toCard(p, kind)) });
  }

  return { rows: rows.filter((r) => r.items.length), thin: null, count };
}

/** "Around 13:00, when you leave" — the lunch row's subtitle, from the day's own end time. */
function leaveTimeSub(trip: Trip): string | null {
  return trip.dayEnd ? `Around ${trip.dayEnd}, when you leave` : null;
}
