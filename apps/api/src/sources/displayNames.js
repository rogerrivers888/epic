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
import { OWNED_POINT_NAME } from './ownedPoints.js';

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
  const { rows } = await query(`
    select venue_ref, name, source from (
      select venue_ref, name, source, row_number() over (partition by venue_ref order by pri) as rn from (
        -- a) the household's own typed name wins outright — above even a photo
        -- place's original label, so renaming a photo place takes effect
        select hp.venue_ref, hp.nickname as name, 'household' as source, 0 as pri
          from household_places hp where hp.venue_ref = any($1) and hp.household_id = $2 and hp.nickname is not null
        union all
        -- the label a household gave a photo place when they added it
        select hp.venue_ref, hp.label, 'household', 1
          from household_places hp
         where hp.venue_ref = any($1) and hp.household_id = $2 and hp.venue_ref like 'photo:%' and hp.label is not null and hp.label <> hp.venue_ref
        union all
        -- our research's name, under the source its provenance records
        select r.venue_ref, r.name, coalesce(r.provenance ->> 'name', 'own'), 2
          from place_records r
         where r.venue_ref = any($1) and r.name is not null and (r.provenance ->> 'name') is not null
        union all
        -- an owned attraction, by any of the three references it answers to —
        -- but not an unmatched sweep placeholder (source google, no osm_ref)
        select ref, a.name, case when a.osm_ref is not null then 'osm' else 'atlas' end, 3
          from attractions a
          cross join lateral (select unnest(array[a.venue_ref, a.external_ref, 'atlas:' || a.id::text]) as ref) refs
         where ref = any($1) and a.name is not null and a.display_source is distinct from 'google'
           and not (a.source = 'google' and a.osm_ref is null)
        union all
        -- the name the owned source a point was matched to holds itself — FSA,
        -- Historic England, OS Open Names or the open map, all ours to keep
        select o.venue_ref, ${OWNED_POINT_NAME('o')}, o.source, 4
          from owned_points o
         where o.venue_ref = any($1) and ${OWNED_POINT_NAME('o')} is not null
        union all
        -- the open map's name, on an open reference only
        select s.venue_ref, s.name, 'osm', 5
          from scout_places s
         where s.venue_ref = any($1) and s.name is not null
           and (s.venue_ref like 'osm:%' or s.venue_ref like 'atlas:%' or s.venue_ref like 'wikidata:%' or s.venue_ref like 'own:%')
      ) all_names
    ) ranked where rn = 1`, [list, householdId]);
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

/** A neutral word for a place we cannot name at all, so it is never nameless. */
const neutralName = (row) => (row.locality ? `A place in ${row.locality}` : 'A place');

/**
 * Resolve the display name on each row in place: owned name, else a live Google
 * name (capped per screen), else a neutral word; queue every unnamed place for
 * research. `rows` are mutated; nothing is stored.
 */
export async function resolveNames(rows, { refKey = 'ref', nameKey = 'name', live = true, purpose = 'places.displayName', cap = 25 } = {}) {
  const refs = [...new Set(rows.map((r) => r[refKey]).filter(Boolean))];
  if (!refs.length) return rows;
  // The household's own names are theirs alone; the active household is the
  // request's spender (auth.js wraps every authenticated read in runAsSpender).
  const { householdId } = currentSpender();
  const owned = await ownedNamesFor(refs, householdId);
  const unowned = refs.filter((r) => !owned.has(r));
  queueForResearch(unowned);

  const liveNames = new Map();
  if (live) {
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
    else { row[nameKey] = neutralName(row); row.nameSource = 'none'; }
  }
  return rows;
}

export default { ownedNamesFor, resolveNames };
