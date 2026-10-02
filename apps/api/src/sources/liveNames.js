/**
 * Google's names as they go past, held in memory for the name-check
 * (sources/nameCheck.js) and nothing else.
 *
 * Owner, 1 Oct 2026: "when a live Google name is fetched, compare it in memory
 * with the owned name". A name arrives here the moment a Places answer is read
 * (google.js toVenue, the display resolver's live fetch), waits a minute at
 * most for the drain to take it, and is gone: it is never written to the
 * database, a log or a file. The map is bounded, so a sweep reading thousands
 * of places cannot grow it without end — a name that does not fit is simply
 * not checked this time; it will go past again.
 *
 * Kept apart from the check itself so that google.js can note a name without
 * importing the database.
 */

const MAX = 2000;
const queue = new Map(); // ref -> { name, lat, lng }

// What Google answered lately, held in memory for an hour so the display
// resolver need not ask again for a name it has just been told — a plan read
// back minutes after its search, say (sources/displayNames.js). The data
// policy allows a provider's name in memory for hours; never on disk or a device.
const HELD_MS = 60 * 60_000;
const HELD_MAX = 5000;
const held = new Map(); // ref -> { name, at }
/** The name Google gave this place within the hour, or null. */
export function heldName(ref, now = Date.now()) {
  const h = held.get(ref);
  return h && now - h.at < HELD_MS ? h.name : null;
}

/** Note a live name (and the point it came with, if any) for the next drain. */
/**
 * `mayMatch: false` asks only that an existing owned match be judged — never
 * that a new one be made from this sighting. The benchmark keeps nothing but
 * its verdict, so its places must not become owned points (Codex, 2 Oct 2026).
 */
export function noteLiveName(ref, name, point = null, { tries = 0, mayMatch = true } = {}) {
  if (!ref || typeof name !== 'string' || !name.trim()) return;
  // Only Google's references carry a Google name; another provider's id is not checked here.
  if (!String(ref).startsWith('google:')) return;
  held.delete(ref);
  held.set(ref, { name: name.trim(), at: Date.now() });
  if (held.size > HELD_MAX) held.delete(held.keys().next().value);
  if (!queue.has(ref) && queue.size >= MAX) return;
  const had = queue.get(ref);
  const lat = Number(point?.lat), lng = Number(point?.lng);
  const has = Number.isFinite(lat) && Number.isFinite(lng) && point?.lat != null && point?.lng != null;
  // A later sighting that came without a point keeps the point an earlier one
  // brought: the re-match needs it (Codex, 2 Oct 2026).
  queue.set(ref, {
    name: name.trim(),
    lat: has ? lat : had?.lat ?? null,
    lng: has ? lng : had?.lng ?? null,
    tries: Math.max(tries, had?.tries ?? 0),
    // Any sighting that may match lets the place be matched.
    mayMatch: Boolean(mayMatch || had?.mayMatch),
  });
}

/** Take up to `n` noted names off the queue, oldest first. */
export function takeLiveNames(n = 100) {
  const out = [];
  for (const [ref, v] of queue) {
    if (out.length >= n) break;
    out.push({ ref, ...v });
    queue.delete(ref);
  }
  return out;
}

export const pendingLiveNames = () => queue.size;

/** For tests: empty the queue and the hour's memory. */
export function clearLiveNames() { queue.clear(); held.clear(); }
