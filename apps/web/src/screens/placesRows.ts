import type { AtlasPlace, Venue } from '../api';

/**
 * What a Places row says, and how a list of them is ordered (handover v8,
 * 8 Sep 2026, §3). Pure, so test/placesRows.test.ts can hold it to the words.
 */

/** The lime band: "Been · N | Loved · N | Shortlisted · N". */
export type ListKey = 'been' | 'loved' | 'short';
export const LISTS: { key: ListKey; label: string }[] = [
  { key: 'been', label: 'Been' }, { key: 'loved', label: 'Loved' }, { key: 'short', label: 'Shortlisted' },
];
export const LIST_KEYS: ListKey[] = LISTS.map((l) => l.key);

/**
 * The list a place is filed in. Loved is the strongest thing you can say, and
 * it is only sayable about somewhere you have been — so "Been" includes loved
 * places, as the handover says, and a place is only Shortlisted while nobody
 * has been.
 */
export function listOf(p: Pick<AtlasPlace, 'special' | 'visits'>): ListKey {
  if (p.special) return 'loved';
  if (p.visits > 0) return 'been';
  return 'short';
}

export function inList(p: Pick<AtlasPlace, 'special' | 'visits'>, list: ListKey): boolean {
  if (list === 'been') return p.visits > 0 || Boolean(p.special);
  if (list === 'loved') return Boolean(p.special);
  return p.visits === 0 && !p.special;
}

/** What each list says while it is empty. */
export const EMPTY_LIST: Record<ListKey, string> = {
  been: 'Places you visit on a trip land here once the day is done.',
  loved: 'Places you heart after a trip land here.',
  short: 'Heart something while browsing to shortlist it for later.',
};

export type PlaceSort = 'recent' | 'ours' | 'rating' | 'az';
export const PLACE_SORTS: { key: PlaceSort; label: string }[] = [
  { key: 'recent', label: 'Most recent' }, { key: 'ours', label: 'Epic rating' }, { key: 'rating', label: 'Rating' }, { key: 'az', label: 'A to Z' },
];
export const PLACE_SORT_KEYS: PlaceSort[] = PLACE_SORTS.map((s) => s.key);

const firstName = (name: string) => (name ?? '').trim().split(/\s+/)[0] || name;

/**
 * The household's own mark on a place, and whose it is: "Family · 4 ratings",
 * "You", "You & Sam". The score is the mean of everybody's latest, to one
 * decimal; `viewer` is whoever this device is set to (Settings › Ratings
 * shown as), and reads as "You".
 */
export function epicRating(p: Pick<AtlasPlace, 'scores'>, viewer: string | null): { score: number; by: string } | null {
  const scores = p.scores ?? [];
  if (!scores.length) return null;
  const score = Math.round((scores.reduce((n, s) => n + s.score, 0) / scores.length) * 10) / 10;
  if (scores.length >= 3) return { score, by: `Family · ${scores.length} ratings` };
  const names = scores.map((s) => (viewer && s.memberId === viewer ? 'You' : firstName(s.member)));
  // "You" first, whichever order the scores arrived in.
  names.sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : 0));
  return { score, by: names.join(' & ') };
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).replace(/-/g, ' ');
/** In Food & drink the restaurant goes without saying; anything else says what it is. */
const KIND_WORD: Record<string, string> = { pub: 'Pub', bar: 'Bar', cafe: 'Café', bakery: 'Bakery', takeaway: 'Takeaway' };

/**
 * The one word Food & drink uses for a place, on the row and in the Cuisine
 * dropdown: the cuisine of a restaurant ("Italian", "Modern British"), or the
 * kind of place where that is the more telling thing ("Pub", "Café"). One flat
 * list, as the handover draws it — the kind and the cuisine were two dropdowns
 * before, and a pub is not a cuisine.
 */
export function foodType(p: Pick<AtlasPlace, 'category' | 'venue' | 'subcategoryLabel'>): string {
  const kind = KIND_WORD[p.category ?? ''];
  if (kind) return kind;
  const cuisines = (((p.venue ?? {}) as Partial<Venue>).cuisines ?? []).filter(Boolean);
  if (cuisines.length) return cap(cuisines[0]);
  return p.subcategoryLabel ?? 'Restaurant';
}

/** "30 Aug" this year, "Jun 2025" any other — as precise as a row has room for. */
export function whenLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/**
 * The rows in the chosen order. Ties and unknowns fall back to the name, so
 * two places nobody has scored still come in a predictable order.
 */
export function sortPlaces(rows: AtlasPlace[], sort: PlaceSort, viewer: string | null): AtlasPlace[] {
  const ours = (p: AtlasPlace) => epicRating(p, viewer)?.score ?? -1;
  const by: Record<PlaceSort, (a: AtlasPlace, b: AtlasPlace) => number> = {
    az: (a, b) => a.name.localeCompare(b.name),
    ours: (a, b) => ours(b) - ours(a) || a.name.localeCompare(b.name),
    rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.name.localeCompare(b.name),
    recent: (a, b) => (b.lastOn ?? '').localeCompare(a.lastOn ?? '') || a.name.localeCompare(b.name),
  };
  return [...rows].sort(by[sort]);
}
