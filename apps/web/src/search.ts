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
    // Only when the API says it wrote it. A fulfilled request is not the same
    // as a recorded event — the write can fail, or the search can belong to
    // somebody else — and marking it counted on a 200 meant a later tap would
    // never retry (Codex, 18 Sep 2026).
  }).then((r) => { if (kind === 'open' && r?.ok) openedOnce.add(key); })
    .catch(() => null)
    .finally(() => { if (kind === 'open') openingNow.delete(key); });
}

/** What each surface last told the log it had drawn, so it is said once. */
const drawn = new Map<Surface, string>();
/** And what is in the air, so a list that renders twice does not send twice. */
const sending = new Map<Surface, string>();
/** Searches whose positions have been settled by the first list actually drawn. */
const fixed = new Set<string>();

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
  // Every ref, not the first forty: two lists with the same length and the same
  // first forty made the same key, so changing a filter that only moved things
  // past position forty left the log describing the previous list (Codex, 18 Sep
  // 2026). Cheap and stable — the order is the order they were drawn in.
  const key = `${queryId}:${kept.length}:${kept.join(',')}`;
  if (drawn.get(surface) === key) return;
  // Written down only once the API has it.
  //
  // Marked before the post, a failure — a train, a flat server — left the key
  // set, so every later render of the same list returned early and the search
  // kept the *pool* count the API wrote when it was made. A search that drew
  // five cards and is recorded as having shown a hundred and fifty is given the
  // wrong fault on the Demand board (Codex, 18 Sep 2026). `sending` covers the
  // other end: a list that renders twice while the first post is in the air
  // must not send twice.
  if (sending.get(surface) === key) return;
  sending.set(surface, key);
  void api.searchDrawn({ queryId, refs: kept })
    // `ok: false` is a fulfilled request that recorded nothing — a write that
    // fell over, or a search older than the endpoint's half-hour. Marking it
    // recorded on any answer is the same mistake as marking it before the post
    // (Codex, 18 Sep 2026).
    .then((r) => {
      if (!r?.ok) return;
      drawn.set(surface, key);
      // And the positions an event will carry, set from the same list and only
      // once — exactly the rule the API keeps for the rows themselves.
      //
      // `heldSearch` seeds them from the *pool*, which is the answer's order,
      // while what the API writes down is the *screen's*. So a tap carried one
      // number and the row it belongs to carried another, and the replay — which
      // compares an event's position against the rows' to work out how far down
      // somebody read — called rows "Never reached" that they had scrolled
      // straight past (Codex, 18 Sep 2026). A later filter moves nothing: the
      // first list is the one both sides recorded.
      if (!fixed.has(queryId)) {
        fixed.add(queryId);
        kept.forEach((ref, i) => positions.set(`${queryId}:${ref}`, i + 1));
      }
    })
    .catch(() => null)
    .finally(() => { if (sending.get(surface) === key) sending.delete(surface); });
}

/**
 * A surface stops standing on a search.
 *
 * The held id lived for the life of the tab, so remounting Inspire could report
 * an open against the *previous* Inspire search before the new one had been
 * written down — and the photograph picker, which borrows the Places surface,
 * never gave it back (Codex, 18 Sep 2026). A screen that is leaving says so.
 */
export function forgetSearch(surface: Surface) {
  current.delete(surface);
  drawn.delete(surface);
  sending.delete(surface);
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
type Pending = { surface: Surface; queryId: string | null; ref: string | null; at: number };
let pending: Pending | null = null;

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
  // The search itself is held, not the surface it came from.
  //
  // Opening the new-trip form takes the screen down, and a screen that is
  // leaving lets go of its search — so by the time the trip existed there was no
  // held id, and the one outcome the whole board is built around was dropped
  // (Codex, 18 Sep 2026).
  pending = { surface, queryId: current.get(surface) ?? null, ref: venueRef ?? null, at: Date.now() };
}

/** The trip exists. Now it counts. */
export function conversionHappened() {
  const held = pending;
  pending = null;
  if (!held) return;
  // Too old to be this trip: the household went somewhere else and came back.
  if (Date.now() - held.at > PENDING_FOR_MS) return;
  if (!held.queryId) return;
  send(held, 0);
}

/**
 * The conversion, kept until the API says it has it.
 *
 * Every other event here has a later act that would send it again — another
 * tap, another render of the list. This one has none: the trip is made once.
 * So a request that failed on the way, or came back `ok: false` because the
 * write fell over, lost the one outcome the whole board is built around and
 * nothing would ever say so (Codex, 18 Sep 2026). Three goes, backing off, and
 * then it is genuinely gone — there is nothing further to be done about it, and
 * a queue that never empties is its own kind of lie.
 */
const TRIES = 3;
function send(held: Pending, attempt: number) {
  const key = `${held.queryId}:${held.ref ?? ''}`;
  void api.searchEvent({
    queryId: held.queryId as string, kind: 'add_to_trip', venueRef: held.ref ?? null,
    position: positions.get(key) ?? null, dwellMs: null,
  }).then((r) => {
    if (!r?.ok && attempt + 1 < TRIES) setTimeout(() => send(held, attempt + 1), 1500 * (attempt + 1));
  }).catch(() => {
    if (attempt + 1 < TRIES) setTimeout(() => send(held, attempt + 1), 1500 * (attempt + 1));
  });
}

/** They closed the form, or left it. Nothing was made, so nothing is counted. */
export function conversionAbandoned() {
  pending = null;
}
