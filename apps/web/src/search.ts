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

/**
 * A search answered: remember its id, and where each result sat.
 *
 * A new set of results with **no** id forgets the old one rather than keeping
 * it. The planner publishes fresh ideas while it is still placing them and
 * writes the search down afterwards, so for a second or two the poll calls this
 * with the new ideas and no id — and holding the previous id meant a quick tap
 * was recorded against the *previous* search (Codex, 17 Sep 2026). Attributing
 * it to nothing is a gap; attributing it to the wrong search is a wrong number.
 */
export function heldSearch(surface: Surface, queryId: string | null | undefined, refs: (string | null | undefined)[] = []) {
  if (!queryId) { current.delete(surface); return; }
  current.set(surface, queryId);
  refs.forEach((ref, i) => { if (ref) positions.set(`${queryId}:${ref}`, i + 1); });
}

/** The places each search has already had an `open` counted for. */
const openedOnce = new Set<string>();
/** And the ones whose open is still in the air, so a double tap is one open. */
const openingNow = new Set<string>();

/** What the household did to one of the results. */
export function noteSearchEvent(surface: Surface, kind: Kind, venueRef?: string | null) {
  const queryId = current.get(surface);
  if (!queryId) return;
  const key = `${queryId}:${venueRef ?? ''}`;
  // An open is counted once per place per search.
  //
  // The screen reports one each time the address names a place, and closing the
  // drawer clears the address — so going back to the same card counted a second
  // open, and the replay's "opened" figure grew every time somebody changed
  // their mind (Codex, 17 Sep 2026). The dwell on the later look is still
  // measured; it is the count that must not double.
  if (kind === 'open') {
    if (openedOnce.has(key) || openingNow.has(key)) { opened.set(key, Date.now()); return; }
    // Two states, and both are needed.
    //
    // `openedOnce` is only set once the post has actually landed: it went in
    // before the post, the post is fire-and-forget, and this endpoint is
    // deliberately not in the offline policy — so an open made on a train was
    // dropped and could never be sent again, and the search read as one nobody
    // clicked. `openingNow` covers the other end of it: a double tap, or an
    // effect that fires twice, wrote two opens while the first was still in the
    // air (Codex, 18 Sep 2026, two rounds).
    openingNow.add(key);
  }
  // How long they stayed on the place before leaving — the dwell on a replay.
  let dwellMs: number | null = null;
  if (kind === 'open') opened.set(key, Date.now());
  else if (opened.has(key)) { dwellMs = Date.now() - (opened.get(key) as number); opened.delete(key); }
  void api.searchEvent({
    queryId, kind, venueRef: venueRef ?? null,
    position: positions.get(key) ?? null,
    dwellMs,
  }).then(() => { if (kind === 'open') openedOnce.add(key); })
    .catch(() => null)
    .finally(() => { if (kind === 'open') openingNow.delete(key); });
}

/** What each surface last told the log it had drawn, so it is said once. */
const drawn = new Map<Surface, string>();

/**
 * What the screen actually drew.
 *
 * The answer to an Inspire is a pool: the screen drops the other mode, applies
 * the filters and draws twelve to a shelf. Only the screen knows what came out
 * of that, so it says so — otherwise the log counts forty shown where the
 * household saw nine, and where the filters left nothing it counts forty shown
 * against an empty screen, which is the wrong one of the three faults (Codex,
 * 18 Sep 2026).
 */
export function noteDrawn(surface: Surface, refs: (string | null | undefined)[]) {
  const queryId = current.get(surface);
  if (!queryId) return;
  const kept = refs.filter(Boolean) as string[];
  const key = `${queryId}:${kept.length}:${kept.slice(0, 40).join(',')}`;
  if (drawn.get(surface) === key) return;
  drawn.set(surface, key);
  void api.searchDrawn({ queryId, refs: kept }).catch(() => null);
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
let pending: { surface: Surface; ref: string | null; at: number } | null = null;

/**
 * How long an unconverted intent stands.
 *
 * Closing the form clears it, but somebody can also walk away with the back
 * button or the app switcher, and a value that outlives the flow would attach
 * itself to whatever trip they made next week (Codex, 17 Sep 2026). A few
 * minutes is longer than making a trip takes and shorter than doing anything
 * else.
 */
const PENDING_FOR_MS = 5 * 60_000;

export function holdConversion(surface: Surface, venueRef?: string | null) {
  pending = { surface, ref: venueRef ?? null, at: Date.now() };
}

/** The trip exists. Now it counts. */
export function conversionHappened() {
  const held = pending;
  pending = null;
  if (!held) return;
  // Too old to be this trip: the household went somewhere else and came back.
  if (Date.now() - held.at > PENDING_FOR_MS) return;
  noteSearchEvent(held.surface, 'add_to_trip', held.ref);
}

/** They closed the form, or left it. Nothing was made, so nothing is counted. */
export function conversionAbandoned() {
  pending = null;
}
