/**
 * Which search a card belongs to.
 *
 * Its own module because it is the rule that would not stay fixed. Four rounds
 * of review moved it back and forth — append against replacement, an id against
 * none — and each fix broke the case the one before it had settled, because
 * nothing held all four at once. There are exactly four, and they are the
 * product of two questions: is this answer *adding* to what is on screen or
 * *replacing* it, and did the log manage to write the search down?
 *
 * It matters because `noteSearchEvent` resolves an event about a place from
 * these mappings alone. A card owned by the wrong search moves that search's
 * outcome, so a search that showed forty places and was ignored reads as one
 * that worked — the opposite of what Demand is for.
 *
 * No imports, deliberately: it is pure bookkeeping over two maps, and that is
 * what lets `test/searchCards.test.ts` hold all four cases at once.
 */

export type Surface = 'find' | 'inspire' | 'places' | 'plan' | 'trip';

/** What each surface is standing on. */
const current = new Map<Surface, string>();
/** `surface:ref` → the search that showed it, where more than one is on screen. */
const came = new Map<string, string>();
/** `queryId:ref` → where it sat in the list it was shown in, so a replay prints the order. */
const positions = new Map<string, number>();

/** Let go of a surface: the search it was standing on and every card on it. */
export function letGo(surface: Surface) {
  current.delete(surface);
  for (const key of [...came.keys()]) if (key.startsWith(`${surface}:`)) came.delete(key);
}

/**
 * An answer arrived on a surface.
 *
 * `append` is for the flows where the cards already on screen stay there — the
 * planner's "show me 5 more" is the only one. Everything else replaces what is
 * on the surface.
 */
export function hold(
  surface: Surface,
  queryId: string | null | undefined,
  refs: (string | null | undefined)[] = [],
  { append = false }: { append?: boolean } = {},
) {
  // No id, and what that means depends on which kind of answer this is.
  //
  // On a **replacement** the surface is let go of entirely — the cards as well
  // as the search. Dropping only the search was almost right, and stopped being
  // right the moment an event about a place was resolved from the cards alone:
  // a search whose logging failed answers with its places and no id, and the
  // previous search's cards were still standing there to claim the next tap.
  // Nothing is the honest answer; the search before it is not.
  //
  // On an **append** the earlier cards are still on screen and still belong to
  // the ask that produced them. "Show me 5 more" publishes the ideas before the
  // search is written down, so it comes through here with no id — and letting go
  // of the surface there wiped the five already there, so when the id did arrive
  // it claimed all ten and opening an older idea was credited to an ask that
  // never produced it. Only the *new* cards go unattributed.
  if (!queryId) { if (append) current.delete(surface); else letGo(surface); return; }
  current.set(surface, queryId);
  if (!append) for (const key of [...came.keys()]) if (key.startsWith(`${surface}:`)) came.delete(key);
  refs.forEach((ref, i) => {
    if (!ref) return;
    positions.set(`${queryId}:${ref}`, i + 1);
    // First claim wins, which is the same rule the positions keep. On a
    // replacement the surface was cleared above, so "first" means first in this
    // answer; on an append it means the ask that actually produced the card.
    if (!came.has(`${surface}:${ref}`)) came.set(`${surface}:${ref}`, queryId);
  });
}

/** Which search a card on a surface came from, or null where nothing showed it. */
export const cameFrom = (surface: Surface, venueRef: string) => came.get(`${surface}:${venueRef}`) ?? null;

/** Which search a surface is standing on, where a screen needs to say so. */
export const standingOn = (surface: Surface) => current.get(surface) ?? null;

/** Where a card sat in the list it was shown in. */
export const positionOf = (queryId: string, venueRef: string) => positions.get(`${queryId}:${venueRef}`) ?? null;

/** The positions a list actually drew, set from that list and only once. */
export function setPositions(queryId: string, refs: string[]) {
  refs.forEach((ref, i) => positions.set(`${queryId}:${ref}`, i + 1));
}
