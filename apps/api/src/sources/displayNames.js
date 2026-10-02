/**
 * The name a place is shown under, resolved at read time (owner, 1 Oct 2026):
 *
 *   a) our own name — a household's typed nickname, our research's name (with
 *      its source), an owned attraction, or the open map on an open reference;
 *   b) else Google's display name, fetched live, held in memory only and never
 *      written down, batched per screen and counted on the ledger;
 *   c) and every place without an owned name is queued for research, so it gets
 *      one and the live fetch for it stops.
 *
 * Never nameless: where even Google cannot be asked (no live session, the
 * budget reached, a network fault) the place shows a neutral word, never a
 * stored provider name — those are being removed.
 */

import { query } from '../db.js';
import { currentSpender } from '../context.js';
import { googleSource } from './google.js';
import * as providerCalls from '../repositories/providerCalls.js';
import { ensureRecord } from '../repositories/ownedPlaces.js';
import { noteLiveName } from './liveNames.js';

const prefixOf = (ref) => String(ref ?? '').split(':')[0];
// Only Google has a live display-name fetcher; a tripadvisor:/liteapi:/other
// rented id is not a Google place id, so asking Google for it is a failed,
// mis-ledgered call. Those refs wait for research instead (Codex, 1 Oct 2026).
const fetchableLive = (ref) => prefixOf(ref) === 'google';

/**
 * The owned name for each of `refs`, with its source. A household's own name
 * wins, then our research's, then an owned attraction, then the open map.
 *
 * `household_places` is per-household, and a `venue_ref` is shared across
 * households, so the household's own branches are fenced to the active
 * household: another household's nickname is theirs, not a name to show here
 * (Codex, 1 Oct 2026).
 */
export async function ownedNamesFor(refs, householdId = null) {
  const out = new Map();
  const list = [...new Set((refs ?? []).filter(Boolean))];
  if (!list.length) return out;
  // The database's own answer (epic_owned_name, migration 340), so a screen
  // drawn here and a list drawn in SQL name a place the same way.
  const { rows } = await query(
    `select r as venue_ref, n.name, n.source
       from unnest($1::text[]) r cross join lateral epic_owned_name(r, $2::uuid) n`, [list, householdId]);
  for (const r of rows) out.set(r.venue_ref, { name: r.name, source: r.source });
  return out;
}

// Google's names live in memory for an hour at most, so a screen opened twice
// is not two calls — and are never written to the database (owner, 1 Oct 2026).
const LIVE_TTL_MS = 60 * 60_000;
const liveCache = new Map(); // ref -> { name, at }
const cachedLive = (ref) => {
  const hit = liveCache.get(ref);
  return hit && Date.now() - hit.at < LIVE_TTL_MS ? hit : undefined;
};

// A fetch already in flight for a ref, so concurrent lookups — a place page
// asking its whole visit history at once, a trip resolving its visits — share
// the one Google call rather than each firing an identical paid request before
// the first has cached (Codex, 1 Oct 2026).
const inflight = new Map(); // ref -> Promise<string|null>

/** Fetch one place's Google display name, ledger the call, cache it. Never throws. */
async function fetchLiveName(ref, purpose) {
  const already = inflight.get(ref);
  if (already) return already;
  const p = (async () => {
    const { householdId, sessionId } = currentSpender();
    const id = ref.slice(prefixOf(ref).length + 1);
    const meter = {};
    let name = null;
    try { name = await googleSource.displayName(id, { meter }); } catch { name = null; }
    // And to the name-check, in memory, against any owned match it should agree with.
    if (name) noteLiveName(ref, name);
    // The call is written down whether it landed or was refused — the fault the
    // gate noted on the meter is part of the record (G7/G8).
    if (householdId) {
      try { await providerCalls.record(householdId, 'google', purpose, meter, sessionId, ref); } catch { /* the ledger must never fail a screen */ }
    }
    liveCache.set(ref, { name, at: Date.now() });
    return name;
  })();
  inflight.set(ref, p);
  try { return await p; } finally { inflight.delete(ref); }
}

// Queued for research recently, so a screen rendered again does not re-queue.
const queuedAt = new Map();
const QUEUE_TTL_MS = 60 * 60_000;
function queueForResearch(refs) {
  for (const ref of refs) {
    // A household's own photograph of a place has no provider to research and no
    // page to read: it is named by the person who took it, never by a sweep.
    if (prefixOf(ref) === 'photo' || !ref.includes(':')) continue;
    const was = queuedAt.get(ref);
    if (was && Date.now() - was < QUEUE_TTL_MS) continue;
    queuedAt.set(ref, Date.now());
    // Fire and forget: a name is given by the background researcher, not here.
    ensureRecord(ref).catch(() => {});
  }
}

/** Which of `refs` are a licensed provider's, by epic_ref_true_source (migration 307). */
async function rentedRefs(refs) {
  if (!refs.length) return new Set();
  const { rows } = await query(
    `select r from unnest($1::text[]) r where coalesce(epic_ref_true_source(r), '') = any(epic_rented_sources())`, [refs]);
  return new Set(rows.map((x) => x.r));
}

/** A neutral word for a place we cannot name at all, so it is never nameless. */
const neutralName = (row) => (row.locality ? `A place in ${row.locality}` : 'A place');

/**
 * Resolve the display name on each row in place: owned name, else a live Google
 * name (capped per screen), else a neutral word; queue every unnamed place for
 * research. `rows` are mutated; nothing is stored.
 */
export async function resolveNames(rows, { refKey = 'ref', nameKey = 'name', live = true, purpose = 'places.displayName', cap = 25, householdId: whose = null } = {}) {
  const refs = [...new Set(rows.map((r) => r[refKey]).filter(Boolean))];
  if (!refs.length) return rows;
  // The household's own names are theirs alone. Owned names are read for the
  // household whose places these are — a guest reading a shared trip sees the
  // trip's household's nickname — but Google is asked only on the signed-in
  // household's account (auth.js wraps every authenticated read in runAsSpender).
  const { householdId } = currentSpender();
  const owned = await ownedNamesFor(refs, whose ?? householdId);
  const unowned = refs.filter((r) => !owned.has(r));
  queueForResearch(unowned);
  // Which references are a provider's, by the database's own reckoning
  // (epic_ref_true_source — an atlas reference to an activity-sweep row is
  // Google's): only those lose the words they were stored with. A place on an
  // open or household reference — the open map, a fixture, a stop somebody
  // typed — keeps its stored name when nothing owned names it better.
  const rented = await rentedRefs(unowned);

  const liveNames = new Map();
  // Google is asked only for a household: the paid gate refuses anything else
  // (paidGate.js), and a page read with no household — a shared trip's public
  // view — shows an owned name or a neutral word.
  if (live && householdId) {
    const toFetch = [];
    for (const ref of unowned) {
      if (!fetchableLive(ref)) continue;
      const hit = cachedLive(ref);
      if (hit) { if (hit.name) liveNames.set(ref, hit.name); continue; }
      if (toFetch.length >= cap) break; // a screen cannot spend without bound
      toFetch.push(ref);
    }
    // In parallel, so a screen of unnamed places is one wait, not a queue of
    // them; the gate still admits one household's count at a time.
    const got = await Promise.all(toFetch.map((ref) => fetchLiveName(ref, purpose)));
    toFetch.forEach((ref, i) => { if (got[i]) liveNames.set(ref, got[i]); });
  }

  for (const row of rows) {
    const ref = row[refKey];
    const o = owned.get(ref);
    if (o) { row[nameKey] = o.name; row.nameSource = o.source; }
    else if (liveNames.has(ref)) { row[nameKey] = liveNames.get(ref); row.nameSource = 'google-live'; }
    else if (!rented.has(ref) && typeof row[nameKey] === 'string' && row[nameKey].trim() && row[nameKey] !== ref) row.nameSource = 'stored';
    else { row[nameKey] = neutralName(row); row.nameSource = 'none'; }
  }
  return rows;
}

/**
 * Resolve names straight into raw rows, across several arrays in one batch:
 * each spec is { rows, refKey, nameKey, localityKey? } — stops by `venue_ref`/`venue_name`,
 * shortlist rows by `venue_ref`/`venue_label`, and so on. One owned lookup and
 * one capped live batch for the lot, and the resolved name written into the
 * row's own column, so everything downstream — a budget's overrun warning, a
 * chat anchor, a plan's anchors — reads the resolved name and never the stored
 * one. `nameSource` goes on each row too, for the offline strip.
 */
export async function resolveInto(specs, opts = {}) {
  const tmp = new Map();
  for (const { rows, refKey, nameKey, localityKey = 'locality' } of specs) {
    for (const r of rows ?? []) {
      const ref = r?.[refKey];
      if (ref && !tmp.has(ref)) tmp.set(ref, { ref, locality: r[localityKey] ?? null, name: r[nameKey] ?? null });
    }
  }
  const list = [...tmp.values()];
  if (!list.length) return;
  await resolveNames(list, { ...opts, refKey: 'ref', nameKey: 'name' });
  const by = new Map(list.map((x) => [x.ref, x]));
  for (const { rows, refKey, nameKey } of specs) {
    for (const r of rows ?? []) {
      const x = by.get(r?.[refKey]);
      if (x) { r[nameKey] = x.name; r.nameSource = x.nameSource; }
    }
  }
}

export default { ownedNamesFor, resolveNames, resolveInto };
