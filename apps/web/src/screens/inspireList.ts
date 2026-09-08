import type { InspireItem } from '../api';

/**
 * How the Inspire pool is narrowed and ordered (handover v8, 8 Sep 2026, §2).
 *
 * Pure, and deliberately without a React import: every chip on the screen is
 * composed from one retrieved pool in memory, and this is the arithmetic that
 * does it — so it can be tested on its own (test/inspireList.test.ts) and the
 * screen can be read for what it draws rather than for what it counts.
 */

export type InspireSort = 'rating' | 'price' | 'distance' | 'type';
export type InspireMode = 'activities' | 'food';

/** What the crowd made of a place, once anybody has been asked. */
export type Crowd = { rating: number | null; ratingCount: number | null; known?: boolean };
export type CrowdOf = (i: InspireItem) => Crowd;

/**
 * The sort popover, per mode: "Activities: Rating (default) · Entry price ·
 * Distance · Activity type. Food: Rating · Price · Distance · Cuisine."
 */
export const SORTS: Record<InspireMode, { key: InspireSort; label: string }[]> = {
  activities: [
    { key: 'rating', label: 'Rating' },
    { key: 'price', label: 'Entry price' },
    { key: 'distance', label: 'Distance' },
    { key: 'type', label: 'Activity type' },
  ],
  food: [
    { key: 'rating', label: 'Rating' },
    { key: 'price', label: 'Price' },
    { key: 'distance', label: 'Distance' },
    { key: 'type', label: 'Cuisine' },
  ],
};
export const SORT_KEYS: InspireSort[] = ['rating', 'price', 'distance', 'type'];

/** "Any · 4.5+ · 4.0+ · 3.5+". Zero is Any. */
export const RATING_FLOORS: { key: number; label: string }[] = [
  { key: 0, label: 'Any' }, { key: 4.5, label: '4.5+' }, { key: 4, label: '4.0+' }, { key: 3.5, label: '3.5+' },
];

/**
 * "Any · £ · ££ · £££ · ££££". The old Free / Under £15 / £15+ scale is gone:
 * "activities now carry a £-band exactly like restaurants".
 */
export const PRICE_BANDS: { key: string; label: string }[] = [
  { key: 'any', label: 'Any' }, { key: '1', label: '£' }, { key: '2', label: '££' }, { key: '3', label: '£££' }, { key: '4', label: '££££' },
];
export const PRICE_KEYS = PRICE_BANDS.map((b) => b.key);

/** The How far boxes. There is no Anywhere in v8: two hours is the ceiling. */
export const HOW_FAR: { minutes: number; label: string; short: string }[] = [
  { minutes: 20, label: '20 minutes', short: '20 min' },
  { minutes: 30, label: '30 minutes', short: '30 min' },
  { minutes: 60, label: '1 hour', short: '1 hr' },
  { minutes: 120, label: '2 hours', short: '2 hr' },
];

/** "1 hr", "20 min" — how the Where control reads a ceiling back. */
export function howFarShort(minutes: number | null): string {
  if (minutes == null) return 'Any distance';
  const known = HOW_FAR.find((h) => h.minutes === minutes);
  if (known) return known.short;
  return minutes >= 60 ? `${Math.round(minutes / 60)} hr` : `${minutes} min`;
}

/**
 * Which £-band a place is in, from a source's 0–4 price level. Free is the
 * cheapest band rather than a band of its own — the v8 scale has no Free box —
 * and a place whose price nobody has said is in no band at all, so it shows
 * under Any and under nothing else: putting it in one would be inventing the
 * price.
 */
export function bandOf(priceLevel: number | null | undefined): number | null {
  if (priceLevel == null) return null;
  return Math.max(1, Math.min(4, Math.round(priceLevel)));
}

/** "££", or "Free" — what the card prints. */
export function priceMarks(priceLevel: number | null | undefined): string | null {
  if (priceLevel == null) return null;
  if (priceLevel === 0) return 'Free';
  return '£'.repeat(bandOf(priceLevel) as number);
}

export type Filters = {
  /** Minutes from the origin, or null for no ceiling. */
  travel: number | null;
  /** The rating floor; 0 is Any. */
  rating: number;
  /** A PRICE_BANDS key; 'any' is Any. */
  price: string;
};

/**
 * Whether one place survives the filters. A rating floor excludes anything
 * whose rating is not yet known: a place cannot be claimed to be 4.0+ before
 * anybody has been asked, and the screen asks about the whole list the moment
 * a floor is set, so the answer fills in rather than staying wrong.
 */
export function keeps(i: InspireItem, f: Filters, crowdOf: CrowdOf): boolean {
  if (f.travel != null && i.travelMinutes > f.travel) return false;
  if (f.price !== 'any' && bandOf(i.priceLevel) !== Number(f.price)) return false;
  if (f.rating > 0) {
    const r = crowdOf(i).rating;
    if (r == null || r < f.rating) return false;
  }
  return true;
}

/** How many filters are set away from their defaults — the "(N)" on the control. */
export function activeCount(f: Filters, pick: string | null): number {
  return (f.rating > 0 ? 1 : 0) + (f.price !== 'any' ? 1 : 0) + (pick ? 1 : 0);
}

/**
 * The pool, in the chosen order. Stable over the answer's own order, so where
 * two places tie — or neither has the number being sorted on — the atlas's own
 * ranking still decides. Unknowns go last: a place with no rating is not a
 * place with a rating of nought.
 */
export function sortItems(items: InspireItem[], sort: InspireSort, crowdOf: CrowdOf, typeOf: (i: InspireItem) => string): InspireItem[] {
  const indexed = items.map((item, at) => ({ item, at }));
  const last = (v: number | null) => (v == null ? Number.POSITIVE_INFINITY : v);
  const by: Record<InspireSort, (a: InspireItem, b: InspireItem) => number> = {
    rating: (a, b) => {
      const ra = crowdOf(a).rating, rb = crowdOf(b).rating;
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return rb - ra || (crowdOf(b).ratingCount ?? 0) - (crowdOf(a).ratingCount ?? 0);
    },
    price: (a, b) => last(bandOf(a.priceLevel)) - last(bandOf(b.priceLevel)),
    distance: (a, b) => a.travelMinutes - b.travelMinutes,
    type: (a, b) => typeOf(a).localeCompare(typeOf(b)),
  };
  const cmp = by[sort];
  indexed.sort((x, y) => {
    const d = cmp(x.item, y.item);
    // Infinity - Infinity is NaN, which a sort must never see; a tie keeps the
    // pool's order. A finite or infinite difference is a real one.
    return Number.isNaN(d) || d === 0 ? x.at - y.at : d;
  });
  return indexed.map((x) => x.item);
}

/** "3.2k" — the handoff's own abbreviation for a review count. */
export const briefly = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
