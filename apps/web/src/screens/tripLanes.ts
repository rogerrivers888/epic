/**
 * The lanes on a trip's Activities tab.
 *
 * What is along the route is drawn as lanes — Fun, Culture, Outdoors… — the
 * same shelves Inspire and Places use, and the one that was asked for by
 * voice comes first (owner, 9 Sep 2026: "If I say I want to do something fun,
 * fun should be the first swim lane. You should still show the other swim
 * lanes, but fun should be the first one").
 *
 * Nothing is hidden: every lane with anything in it is drawn, in the shelves'
 * own order, and only the lane that was asked for moves. Inside a lane the
 * list keeps the order it arrived in, which is the sort the screen chose.
 */
/**
 * The words: the shelves in order, what each is called, and which shelf a
 * spoken mood means. Handed in rather than imported so this stays a pure
 * module the tests can load bare (see `moods.ts` for the app's own).
 */
export type LaneVocab = { order: readonly string[]; label: Record<string, string>; vibeMood: Record<string, string> };

export type Lane<T> = {
  key: string;
  label: string;
  items: T[];
  /** Whether this is the lane that was asked for, and so leads. */
  led: boolean;
};

/** The lane somewhere with no shelf goes in: still a day out, at the end. */
export const OTHER_LANE = 'other';

type Laned = { moods?: string[] | null };

/**
 * Which lane leads: the spoken mood's, when it has anything in it; otherwise
 * the lane holding most of the kinds that were named ("a playground", "a
 * castle"), so what was said is still the first thing on the screen.
 */
export function leadLane<T extends Laned>(
  lanes: Lane<T>[],
  said: { vibe: string | null; kinds: string[] } | null,
  kindOf: (item: T) => string | null,
  vocab: LaneVocab,
): string | null {
  if (!said) return null;
  const mood = vocab.vibeMood[said.vibe ?? ''] ?? null;
  if (mood && lanes.some((l) => l.key === mood && l.items.length)) return mood;
  if (!said.kinds.length) return null;
  const wanted = new Set(said.kinds);
  let best: { key: string; n: number } | null = null;
  for (const l of lanes) {
    const n = l.items.filter((i) => { const k = kindOf(i); return k != null && wanted.has(k); }).length;
    if (n && (!best || n > best.n)) best = { key: l.key, n };
  }
  return best?.key ?? null;
}

/** The lanes, in order, from one already-sorted list. */
export function lanesFor<T extends Laned>(
  items: T[],
  said: { vibe: string | null; kinds: string[] } | null,
  kindOf: (item: T) => string | null,
  vocab: LaneVocab,
): Lane<T>[] {
  const order: string[] = [...vocab.order.filter((m) => m !== 'food'), OTHER_LANE];
  const by = new Map<string, T[]>();
  for (const item of items) {
    const key = (item.moods ?? []).find((m) => m !== 'food') ?? OTHER_LANE;
    if (!order.includes(key)) order.splice(order.length - 1, 0, key);
    by.set(key, [...(by.get(key) ?? []), item]);
  }
  const lanes: Lane<T>[] = order
    .filter((key) => by.get(key)?.length)
    .map((key) => ({ key, label: key === OTHER_LANE ? 'More to do' : vocab.label[key] ?? key, items: by.get(key)!, led: false }));
  const lead = leadLane(lanes, said, kindOf, vocab);
  if (!lead) return lanes;
  return [...lanes.filter((l) => l.key === lead).map((l) => ({ ...l, led: true })), ...lanes.filter((l) => l.key !== lead)];
}
