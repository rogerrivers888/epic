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
import { onSessionChange } from '../session';

type Entry<T> = {
  data?: T;
  error?: unknown;
  /** When the current `data` landed. 0 means never loaded. */
  fetchedAt: number;
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

/** The cache key for a home-screen search. Home vs a searched town differ, and
 * how far / how you travel change the pool, so all of it is in the key. */
export function inspireNearKey(p: { lat: number; lng: number; mode: string; minutes: number; from?: string | null }): string {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return `inspire:near:${r(p.lat)},${r(p.lng)}:${p.mode}:${p.minutes}:${p.from ? 'from' : 'home'}`;
}

function entryFor(key: string): Entry<unknown> {
  let e = store.get(key);
  if (!e) { e = { fetchedAt: 0, listeners: new Set() }; store.set(key, e); }
  return e;
}

function emit(e: Entry<unknown>) { e.listeners.forEach((l) => l()); }

/**
 * Run `fetcher` for `key` now, keeping one request in flight at a time. On
 * success the rows and their timestamp replace what was there; on failure the
 * error is recorded but any previous rows are kept, so a background refresh that
 * fails never blanks a page the family is already reading.
 */
export function runFetch<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const e = entryFor(key);
  if (e.promise) return e.promise;
  const p = fetcher().then(
    (data) => { e.data = data; e.error = undefined; e.fetchedAt = Date.now(); },
    (err) => { e.error = err; },
  ).finally(() => { e.promise = undefined; emit(e); });
  e.promise = p;
  emit(e);
  return p;
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
export function peekCache<T>(key: string): { data: T | undefined; fetchedAt: number } | undefined {
  const e = store.get(key);
  return e ? { data: e.data as T | undefined, fetchedAt: e.fetchedAt } : undefined;
}

/** Mark a key stale so the next read refreshes it. */
export function invalidate(key: string) { const e = store.get(key); if (e) e.fetchedAt = 0; }

/** Drop everything. Called on any session change, and available to tests. */
export function clearResourceCache() {
  store.clear();
  scrollStore.clear();
}

// A change of session — out, timed out, or a different person in — must not let
// the last session's rented content survive in memory (see the header).
onSessionChange(() => { clearResourceCache(); });

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
    const listener = () => bump();
    e.listeners.add(listener);
    const age = e.fetchedAt ? Date.now() - e.fetchedAt : Infinity;
    if (!e.promise && (e.data === undefined || age > staleMs)) {
      void runFetch(key, () => fetcherRef.current());
    }
    return () => { e.listeners.delete(listener); };
  }, [key, enabled, staleMs]);

  const e = enabled && key ? store.get(key) : undefined;
  const refresh = useCallback(async () => {
    if (!key) return;
    invalidate(key);
    await runFetch(key, () => fetcherRef.current());
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
    if (y > 0) {
      const raf = requestAnimationFrame(() => ref.current?.scrollTo({ y, animated: false }));
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [key, ready]);

  // A new key is a new page: allow its restore to run.
  useEffect(() => { restored.current = null; }, [key]);

  return {
    ref,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => saveScroll(key, e.nativeEvent.contentOffset.y),
    scrollEventThrottle: 16,
  };
}
