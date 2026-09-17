/**
 * The click stream between "shown" and "saved".
 *
 * Until 17 Sep 2026 the search itself was thrown away and there was nothing at
 * all between being shown forty places and adding one to a trip — so two of
 * Demand's three faults could not be told apart from each other or from a search
 * nobody made. The API now writes the search down and hands back its id; this
 * holds that id for the surface it came from and posts what the household did.
 *
 * Three rules, and they are why this is four lines rather than a library:
 *   · it is **never allowed to fail a tap**. Every call is fire-and-forget, and
 *     a search id from before a deploy is answered and ignored;
 *   · it carries **identifiers only** — a ref, a position — never a name, never
 *     anything a provider owns;
 *   · it is held in memory for the session, not written to the device: it is
 *     ours to count, not the household's to keep.
 */

import { api } from './api';

type Surface = 'find' | 'inspire' | 'places' | 'plan' | 'trip';
type Kind = 'open' | 'dismiss' | 'save' | 'shortlist' | 'add_to_trip' | 'refine' | 'close';

const current = new Map<Surface, string>();
/** Where each ref sat in the list it was shown in, so a replay prints the order. */
const positions = new Map<string, number>();
const opened = new Map<string, number>();

/** A search answered: remember its id, and where each result sat. */
export function heldSearch(surface: Surface, queryId: string | null | undefined, refs: (string | null | undefined)[] = []) {
  if (!queryId) return;
  current.set(surface, queryId);
  refs.forEach((ref, i) => { if (ref) positions.set(`${queryId}:${ref}`, i + 1); });
}

/** What the household did to one of the results. */
export function noteSearchEvent(surface: Surface, kind: Kind, venueRef?: string | null) {
  const queryId = current.get(surface);
  if (!queryId) return;
  const key = `${queryId}:${venueRef ?? ''}`;
  // How long they stayed on the place before leaving — the dwell on a replay.
  let dwellMs: number | null = null;
  if (kind === 'open') opened.set(key, Date.now());
  else if (opened.has(key)) { dwellMs = Date.now() - (opened.get(key) as number); opened.delete(key); }
  void api.searchEvent({
    queryId, kind, venueRef: venueRef ?? null,
    position: positions.get(key) ?? null,
    dwellMs,
  }).catch(() => null);
}

/** Which search a surface is standing on, where a screen needs to say so. */
export const searchIdOf = (surface: Surface) => current.get(surface) ?? null;

/**
 * A conversion that has been asked for but has not happened yet.
 *
 * "Add to trip" on Inspire only seeds and opens the new-trip form, which the
 * household can close without making anything. Reporting the conversion there
 * marked every opening of the form as a trip and inflated Demand's third
 * outcome (Codex, 17 Sep 2026). So the intent is held, and it is reported by
 * the path that actually makes the trip — or dropped when the form is closed.
 */
let pending: { surface: Surface; ref: string | null } | null = null;

export function holdConversion(surface: Surface, venueRef?: string | null) {
  pending = { surface, ref: venueRef ?? null };
}

/** The trip exists. Now it counts. */
export function conversionHappened() {
  if (!pending) return;
  const { surface, ref } = pending;
  pending = null;
  noteSearchEvent(surface, 'add_to_trip', ref);
}

/** They closed the form. Nothing was made, so nothing is counted. */
export function conversionAbandoned() {
  pending = null;
}
