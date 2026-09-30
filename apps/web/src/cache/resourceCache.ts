/**
 * A tiny in-memory, read-through cache shared across the whole app for the life
 * of a signed-in session (owner, "No spinners on Inspire", D13).
 *
 * Why this exists. Every tab in the shell mounts its own screen and every screen
 * held its data in `useState`, so switching to Trips and back unmounted Inspire,
 * threw the pool away and fetched it again — a spinner on a page the family had
 * already seen ten seconds earlier (owner, 4 Sep 2026: "everything's
 * disappeared"). The shell itself never unmounts, and a module lives as long as
 * the shell, so a store kept here outlives every tab switch. A screen reads
 * through it instead of fetching on mount; the second visit is already in memory.
 *
 * Three rules it is built to:
 *  - **Never a spinner once something is known.** A cache hit returns at once
 *    with `loading: false`; a hit that has gone stale returns the old rows *and*
 *    refreshes in the background, swapping the new rows in with no flash and no
 *    jump. A spinner (really: a skeleton) is only ever shown on a first-ever load
 *    with nothing to show yet.
 *  - **Nothing here is ever written to disk.** The Inspire pool carries a
 *    provider's names, photos and ratings, which are rented and must live in
 *    memory only (offline/policy.ts; Technical Constraints §4). This store is
 *    process memory and never touches IndexedDB, so that rule holds by
 *    construction. The separate offline layer (api.ts `request` → `remember`)
 *    still persists the endpoints `offline/policy.ts` allows, and Inspire is not
 *    one of them.
 *  - **One household's copy never reaches another.** The store is cleared the
 *    moment the session token changes — a sign-out, a timeout, or somebody else
 *    signing in on the same browser — so a new person is never handed the last
 *    person's rented content out of memory.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';

type Entry<T> = {
  data?: T;
  error?: unknown;
  /** When the current `data` landed. 0 means never loaded, or invalidated. */
  fetchedAt: number;
  /** Bumped by every invalidation. A fetch that finishes on a generation older
   * than the one it started on cannot mark its (pre-mutation) response fresh. */
  gen: number;
  /** The in-flight fetch, so two mounts of the same key share one request. */
  promise?: Promise<void>;
  listeners: Set<() => void>;
};

const store = new Map<string, Entry<unknown>>();

/** Ten minutes: after this a cached answer is served but refreshed behind it. */
export const TEN_MINUTES = 10 * 60_000;
/** Inspire's "How far" opens on an hour; the prefetch must match the landing. */
export const INSPIRE_DEFAULT_MINUTES = 60;
/** The one Places atlas list, and the one Trips list — shared, no parameters. */
export const ATLAS_KEY = 'places:atlas';
export const TRIPS_KEY = 'trips:list';
/** The rows inside one Places area (home, or a country/city), one key each. */
export const placesRowsKey = (area: string) => `places:rows:${area}`;
const PLACES_ROWS_PREFIX = 'places:rows:';

/** The cache key for a home-screen search. Home vs a searched town differ, and
 * how far / how you travel change the pool, so all of it is in the key. */
export function inspireNearKey(p: { lat: number; lng: number; mode: string; minutes: number; from?: string | null }): string {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return `inspire:near:${r(p.lat)},${r(p.lng)}:${p.mode}:${p.minutes}:${p.from ? 'from' : 'home'}`;
}

function entryFor(key: string): Entry<unknown> {
  let e = store.get(key);
  if (!e) { e = { fetchedAt: 0, gen: 0, listeners: new Set() }; store.set(key, e); }
  return e;
}

function emit(e: Entry<unknown>) { e.listeners.forEach((l) => l()); }

// Start a fetch for `key`, optionally only once `after` has settled. On success
// the rows and their timestamp replace what was there; on failure the error is
// recorded but any previous rows are kept, so a background refresh that fails
// never blanks a page the family is already reading.
function start<T>(key: string, fetcher: () => Promise<T>, after?: Promise<unknown>): Promise<void> {
  const e = entryFor(key);
  // The generation the moment the request begins. For a plain read that is now,
  // synchronously — an invalidate() the caller runs right after must count as
  // "during" this fetch. For a chained refetch the request only begins once
  // `after` has settled, so the generation is re-read at that point. Either way,
  // a write that invalidates the key mid-flight is not undone when the older
  // request lands (Codex, D13).
  let genAtStart = e.gen;
  const p = (after ? after.catch(() => {}).then(() => { genAtStart = e.gen; }) : Promise.resolve())
    .then(() => fetcher())
    .then(
      (data) => {
        e.data = data;
        e.error = undefined;
        // Only mark fresh if nothing invalidated the key mid-flight; otherwise
        // the rows may predate the mutation, so leave them stale to be re-read.
        e.fetchedAt = e.gen === genAtStart ? Date.now() : 0;
      },
      (err) => {
        // Only a failure of the *current* generation is the standing error that
        // stops retries. A failure from a request an invalidation has already
        // superseded must not block the refresh that invalidation asked for —
        // it is a reason for one more current-generation fetch, not a dead end
        // (Codex, D13). Leaving `error` unset lets the emit below trigger it.
        if (e.gen === genAtStart) e.error = err;
      },
    )
    // Only clear the in-flight marker if it is still this run's — a forced
    // refetch may have chained a newer one on top.
    .finally(() => { if (e.promise === p) e.promise = undefined; emit(e); });
  e.promise = p;
  // A new attempt drops the last failure now, not only if this one succeeds, so
  // a "Try again" (or a remount after a failed load) shows the skeleton alone
  // rather than the skeleton beside the old error message (Codex, D13).
  e.error = undefined;
  emit(e);
  return p;
}

/**
 * Read `key`: if a request is already in flight, join it rather than start a
 * second — the shared, deduped path a mount takes.
 */
export function runFetch<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const e = entryFor(key);
  if (e.promise) return e.promise;
  return start(key, fetcher);
}

/**
 * Force a fresh read, whose response is guaranteed to have *begun after this
 * call* — the path a write takes. If a stale-refresh or prefetch is already in
 * flight, this chains a new request after it rather than handing back that older
 * one, so a refresh run right after a mutation never repopulates the cache with
 * pre-write rows and marks them fresh (Codex, D13).
 */
export function refetch<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const e = entryFor(key);
  return start(key, fetcher, e.promise);
}

/**
 * Warm `key` if it is missing or older than `staleMs`, and do nothing if it is
 * fresh or already loading. Fire-and-forget: a prefetch that fails is no worse
 * than not having prefetched, and the screen will try again when it mounts.
 */
export function prefetch<T>(key: string, fetcher: () => Promise<T>, staleMs = TEN_MINUTES): void {
  const e = store.get(key);
  if (e?.promise) return;
  if (e?.fetchedAt && Date.now() - e.fetchedAt < staleMs) return;
  void runFetch(key, fetcher).catch(() => {});
}

/** Read what is in the cache without subscribing or triggering a fetch. */
export function peekCache<T>(key: string): { data: T | undefined; fetchedAt: number; error: unknown } | undefined {
  const e = store.get(key);
  return e ? { data: e.data as T | undefined, fetchedAt: e.fetchedAt, error: e.error } : undefined;
}

// Mark an entry stale, and tell anyone watching. The emit is what makes a
// *mounted* screen react: a write that invalidates the ring it is looking at has
// to make it re-check and refresh in the background, not wait for a remount
// (Codex, D13). `useCachedResource` re-checks freshness on every emit.
function staleEntry(e: Entry<unknown>) { e.fetchedAt = 0; e.gen++; e.error = undefined; emit(e); }

/** Mark a key stale so the next read refreshes it. */
export function invalidate(key: string) { const e = store.get(key); if (e) staleEntry(e); }

/** Mark every key with this prefix stale — e.g. all Inspire rings at once when
 * a place is saved or removed, wherever that happened. */
export function invalidatePrefix(prefix: string) {
  for (const [k, e] of store) if (k.startsWith(prefix)) staleEntry(e);
}

/**
 * The three tab resources a household write can change — the atlas (areas, trip
 * and been counts), the trips list, and every Inspire ring (a place's ledger).
 * A write goes through one door (`api.request`), so invalidating all three there
 * means no screen serves its own data stale after a mutation, wherever the
 * mutation was made — a trip recorded, a visit logged, a place saved — without
 * every call site having to know which caches it touches (Codex, D13). Reads are
 * untouched, so a plain tab switch still makes no request.
 */
export function invalidateTabData() {
  invalidate(ATLAS_KEY);
  invalidate(TRIPS_KEY);
  invalidatePrefix('inspire:near:');
  invalidatePrefix(PLACES_ROWS_PREFIX);
}

/**
 * Whether the household has this place kept, place ref → kept, for the places it
 * has saved or removed this session. A heart tapped on one screen has to still
 * read as kept when you come back from another tab; the screen's own `useState`
 * went with the unmount, and the Inspire ring cannot help — a ring card comes
 * back `household: null` and carries no ledger at all, so it can neither confirm
 * a save nor a removal (Codex, D13). So this is the session's own record of what
 * it has changed, written by every save and removal wherever it is made
 * (`api.savePlace` / `api.deleteAtlasPlace` call `setSavedOverride`), and it is
 * what the heart reads first. Cleared the moment the session ends.
 */
export const savedOverrides = new Map<string, boolean>();

/** Record that this session has kept (or un-kept) a place. Called from the two
 * API operations that change it, so a change made on any screen is seen on the
 * others. */
export function setSavedOverride(ref: string, kept: boolean) { savedOverrides.set(ref, kept); }

/**
 * Drop everything. Wired to `onSessionChange` in App.tsx: a change of session —
 * out, timed out, or a different person in — must not let the last session's
 * rented content survive in memory (see the header).
 */
export function clearResourceCache() {
  store.clear();
  scrollStore.clear();
  savedOverrides.clear();
}

type Resource<T> = {
  data: T | undefined;
  /** Only true on a first-ever load with nothing to show — draw a skeleton. */
  loading: boolean;
  /** A background refresh is running behind rows already on screen. */
  refreshing: boolean;
  error: unknown;
  /** Force a fresh fetch now (bypasses the staleness check). */
  refresh: () => Promise<void>;
};

/**
 * Read `key` through the cache. A hit returns at once; a miss starts a fetch and
 * reports `loading` until it lands; a stale hit returns the old rows and
 * refreshes behind them. Pass `key: null` (e.g. before a location is known) to
 * hold off without a fetch and without a spinner.
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts?: { staleMs?: number; enabled?: boolean },
): Resource<T> {
  const staleMs = opts?.staleMs ?? TEN_MINUTES;
  const enabled = (opts?.enabled ?? true) && key != null;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled || !key) return;
    const e = entryFor(key);
    // Fetch if there is nothing yet or what there is has gone stale — and do it
    // on every emit, not only on mount, so an invalidation while this screen is
    // mounted makes it refresh in the background rather than wait for a remount
    // (Codex, D13). `runFetch` dedupes, so an emit mid-flight starts nothing.
    //
    // `force` is the difference between a reason to try and a reason not to loop.
    // A failed fetch records its error and emits; the listener must NOT treat
    // that emit as a cue to fetch again, or an outage becomes an unbounded
    // request loop (Codex, D13). So the emit path only fetches when there is no
    // standing error — and an invalidation clears the error, which is what makes
    // it count as an explicit retry. A fresh mount forces a try regardless, so
    // coming back to a screen whose load failed does attempt it again.
    const ensure = (force: boolean) => {
      const age = e.fetchedAt ? Date.now() - e.fetchedAt : Infinity;
      if ((force || e.error === undefined) && !e.promise && (e.data === undefined || age > staleMs)) {
        void runFetch(key, () => fetcherRef.current());
      }
    };
    const listener = () => { bump(); ensure(false); };
    e.listeners.add(listener);
    ensure(true);
    // The entry may have moved between this render and this effect — a prefetch
    // resolving in that window emits before the listener above exists, and would
    // otherwise be missed, leaving a screen on its skeleton though the data has
    // arrived (Codex, D13). One bump now re-reads the current state and closes
    // that window; every later change comes through the listener.
    bump();
    return () => { e.listeners.delete(listener); };
  }, [key, enabled, staleMs]);

  const e = enabled && key ? store.get(key) : undefined;
  const refresh = useCallback(async () => {
    if (!key) return;
    // Bind the fetcher for *this* key now, not when a chained refetch later
    // dereferences the ref: if the key changed while the refetch was queued
    // behind an in-flight request, `fetcherRef.current` would be the new key's
    // fetcher and its rows would land under the old key (Codex, D13).
    const fn = fetcherRef.current;
    await refetch(key, fn);
  }, [key]);

  return {
    data: e?.data as T | undefined,
    loading: enabled ? (e?.data === undefined && (!e || !!e.promise)) : false,
    refreshing: !!e?.promise && e?.data !== undefined,
    error: e?.data === undefined ? e?.error : undefined,
    refresh,
  };
}

// --- Scroll memory -------------------------------------------------------------
//
// Keeping the rows is only half of "come back and it is as you left it"; the
// other half is where the page was scrolled to. Keyed by the full address, so a
// category you drilled into and the home list above it each keep their own place,
// and returning from another tab lands exactly where you were.

const scrollStore = new Map<string, number>();

export function saveScroll(key: string, y: number) { scrollStore.set(key, y); }
export function readScroll(key: string): number { return scrollStore.get(key) ?? 0; }

/**
 * A scroll key built from an address with the transient overlay parameters
 * dropped — the open drawer (`?place=`) and the voice reading (`?intake=`) are
 * something open *over* a list, not a different list. Without this, opening a
 * card changes the key, and a fresh key scrolls to its own (zero) position,
 * jumping the list under the drawer to the top on a wide layout (Codex, D13).
 */
export function scrollKey(prefix: string, href: string, drop: string[] = ['place']): string {
  const [path, q = ''] = href.split('?');
  const params = new URLSearchParams(q);
  for (const d of drop) params.delete(d);
  const s = params.toString();
  return `${prefix}:${s ? `${path}?${s}` : path}`;
}

/**
 * Remember and restore a ScrollView's offset for `key`. Returns the props to
 * spread onto the ScrollView; restoration happens once `ready` is true (the rows
 * are in, so the content is tall enough to scroll), on the next frame so it lands
 * after layout rather than before it.
 */
export function useScrollMemory(key: string, ready: boolean) {
  const ref = useRef<{ scrollTo: (o: { y: number; animated: boolean }) => void } | null>(null);
  const restored = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (restored.current === key) return;
    restored.current = key;
    const y = readScroll(key);
    // Always scroll — to 0 as well as to a saved offset. When one ScrollView is
    // reused across keys (an Inspire category, a Places area), skipping the y===0
    // case would leave it at the previous page's offset, opening a fresh page
    // halfway down instead of at its top (Codex, D13).
    const raf = requestAnimationFrame(() => ref.current?.scrollTo({ y, animated: false }));
    return () => cancelAnimationFrame(raf);
  }, [key, ready]);

  // A new key is a new page: allow its restore to run.
  useEffect(() => { restored.current = null; }, [key]);

  return {
    ref,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => saveScroll(key, e.nativeEvent.contentOffset.y),
    scrollEventThrottle: 16,
  };
}
