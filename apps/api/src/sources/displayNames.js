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
import { noteLiveName, heldName } from './liveNames.js';

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
  // A name Google gave in any answer this past hour — a search, a drawer —
  // held in memory by sources/liveNames.js, first: it outranks a lookup of
  // ours that came back empty earlier (Codex, 2 Oct 2026).
  const name = heldName(ref);
  if (name) return { name, at: Date.now() };
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
export async function rentedRefs(refs) {
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
  if (live) {
    const toFetch = [];
    for (const ref of unowned) {
      if (!fetchableLive(ref)) continue;
      // A name already in memory costs nothing, whoever is reading.
      const hit = cachedLive(ref);
      if (hit) { if (hit.name) liveNames.set(ref, hit.name); continue; }
      if (!householdId) continue;
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
      if (!ref) continue;
      // Any row's own words will do for the place, not only the first row's: a
      // stop written before the shortlist with the reference standing in must
      // not hide the shortlist's wording (Codex, 2 Oct 2026).
      const own = r[nameKey];
      const usable = typeof own === 'string' && own.trim() && own !== ref ? own : null;
      const had = tmp.get(ref);
      if (!had) tmp.set(ref, { ref, locality: r[localityKey] ?? null, name: usable });
      else if (!had.name && usable) had.name = usable;
    }
  }
  const list = [...tmp.values()];
  if (!list.length) return;
  await resolveNames(list, { ...opts, refKey: 'ref', nameKey: 'name' });
  const by = new Map(list.map((x) => [x.ref, x]));
  for (const { rows, refKey, nameKey } of specs) {
    for (const r of rows ?? []) {
      const x = by.get(r?.[refKey]);
      if (!x) continue;
      // An owned or live name belongs to the place, so every row of it takes
      // that. A household's own words belong to the row they were written on:
      // a stop "Meet at the north gate" and a shortlist "The Park" on the same
      // open reference each keep their own (Codex, 2 Oct 2026).
      const own = r[nameKey];
      if (x.nameSource === 'stored' && typeof own === 'string' && own.trim() && own !== r[refKey]) { r.nameSource = 'stored'; continue; }
      r[nameKey] = x.name; r.nameSource = x.nameSource;
    }
  }
}

const NAME_KEYS = ['name', 'venueName', 'venueLabel', 'venue_name', 'venue_label'];
// Every reference an object carries, as migration 343 reads them: a fixed stop
// is {source: 'anchor', …, key: 'google:…'}, so no one of them is enough alone.
const refsOfJson = (o) => [
  typeof o.source === 'string' && typeof o.sourcePlaceId === 'string' ? `${o.source}:${o.sourcePlaceId}` : null,
  typeof o.venueRef === 'string' ? o.venueRef : null,
  typeof o.ref === 'string' && /^[a-z]+:/.test(o.ref) ? o.ref : null,
  typeof o.key === 'string' && /^[a-z]+:/.test(o.key) ? o.key : null,
].filter(Boolean);

/**
 * Name the places inside a saved JSON document — a plan session's state —
 * whose names were emptied on the way in (migration 343). Every object that
 * carries a provider's place reference and an emptied name field is named
 * again, in place: our own name first, then a name Google gave within the hour
 * (in memory, free — the search that made the plan, usually), then Google's
 * live (capped), then a neutral word. Nothing here
 * is written back by itself; a save goes through the trigger again.
 */
export async function nameJson(doc, { purpose = 'plan.displayName', householdId = null, cap = 25 } = {}) {
  const tokens = tokensIn(doc);
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
    const refs = refsOfJson(node);
    if (!refs.length) return;
    const keys = NAME_KEYS.filter((k) => k in node && node[k] == null);
    if (keys.length) found.push({ node, refs, keys });
  };
  walk(doc);
  if (!found.length && !tokens.size) return doc;
  // Only a provider's place had its name emptied; any other empty name was
  // empty when it was written and stays so. The provider's reference is the
  // one that names it.
  const rentedSet = await rentedRefs([...new Set(found.flatMap((f) => f.refs))]);
  for (const f of found) f.ref = f.refs.find((r) => rentedSet.has(r)) ?? null;
  found.splice(0, found.length, ...found.filter((f) => f.ref));
  // One capped batch for the places in the words and the places named beside
  // their references, so the cap is spent once and the two agree (Codex, 2 Oct 2026).
  const singles = [...new Set([...found.map((f) => f.ref), ...[...tokens].flatMap((t) => t.split('|'))])];
  if (!singles.length) return doc;
  // The resolver tries what we own, then a name Google gave within the hour
  // (in memory — free), then asks Google, capped, then says "a place".
  const tmp = singles.map((ref) => ({ ref, name: null }));
  await resolveNames(tmp, { refKey: 'ref', nameKey: 'name', purpose, householdId, cap });
  const by = new Map(tmp.map((x) => [x.ref, x]));
  for (const f of found) {
    const x = by.get(f.ref);
    for (const k of f.keys) f.node[k] = x.name;
    f.node.nameSource = x.nameSource;
  }
  untokenise(doc, new Map(tmp.map((x) => [x.ref, x.name])));
  return doc;
}

const TOKEN = /⟦([a-z]+:[^⟧\s]+)⟧/g; // one reference, or several joined by | for a shared name
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A copy of a JSON document ready to be written down (owner, 2 Oct 2026: "no
 * stored provider names anywhere"). Migration 343 empties a provider's name
 * where it sits beside its place's reference; this catches the same name
 * where it was copied into words — an option's title, a reason, the
 * assistant's reply in the transcript — and puts the place's reference there
 * as a token, ⟦google:…⟧, which nameJson turns back into a name on read. The
 * household's own words are theirs and are left exactly as said: their turns
 * in the transcript, and the intent parsed from them. Never mutates `doc`.
 */
// Only words written for people to read — a title, a reply, a reason — are
// tokenised; a website, a photo link or any other value a machine reads is
// left alone, so "Dishoom" never touches https://dishoom.com (Codex, 2 Oct 2026).
const PROSE_KEYS = new Set(['text', 'title', 'subtitle', 'reply', 'summary', 'reason', 'reasons', 'why', 'message',
  'question', 'detail', 'line', 'blurb', 'headline', 'caption', 'description', 'say', 'said']);
const looksLikeLink = (t) => /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^www\./i.test(t);

/** Every place reference in a document — for one batched check across many. */
export function refsInJson(doc) {
  const out = new Set();
  const seek = (node) => {
    if (Array.isArray(node)) { node.forEach(seek); return; }
    if (!node || typeof node !== 'object') return;
    for (const v of Object.values(node)) if (v && typeof v === 'object') seek(v);
    for (const r of refsOfJson(node)) out.add(r);
  };
  seek(doc);
  return out;
}

export async function tokeniseJson(doc, { rented = null } = {}) {
  if (!doc || typeof doc !== 'object') return doc;
  const copy = JSON.parse(JSON.stringify(doc));
  const pairs = [];
  const collect = (node) => {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (!node || typeof node !== 'object') return;
    for (const v of Object.values(node)) if (v && typeof v === 'object') collect(v);
    const refs = refsOfJson(node);
    if (!refs.length) return;
    // Every name, however short ("XO"): whole-name matching keeps it from
    // touching any longer word (Codex, 2 Oct 2026).
    for (const k of NAME_KEYS) if (typeof node[k] === 'string' && node[k].trim()) pairs.push({ name: node[k].trim(), refs });
  };
  collect(copy);
  if (!pairs.length) return copy;
  // A caller scanning many documents passes the providers' references it has
  // already checked in one batch (sources/namePurge.js).
  const rentedSet = rented ?? await rentedRefs([...new Set(pairs.flatMap((p) => p.refs))]);
  // A name held by more than one place (two cafés of one chain) keeps all
  // their references: on read it is shown only if they all come back under
  // the same name, else as "a place" — never pinned to the wrong one (Codex,
  // 2 Oct 2026).
  const refsByName = new Map();
  for (const p of pairs) {
    const ref = p.refs.find((r) => rentedSet.has(r));
    if (!ref) continue;
    const set = refsByName.get(p.name) ?? new Set();
    set.add(ref);
    refsByName.set(p.name, set);
  }
  // Matched whatever the case — a reply may say "the crown" for The Crown — so
  // names that differ only in case are one name here (Codex, 2 Oct 2026).
  const lowered = new Map();
  for (const [n, set] of refsByName) {
    const k = n.toLowerCase();
    const had = lowered.get(k) ?? new Set();
    for (const r of set) had.add(r);
    lowered.set(k, had);
  }
  const byName = new Map([...lowered].map(([n, set]) => [n, [...set].join('|')]));
  if (!byName.size) return copy;
  // Longest first, so "The Crown Inn" is not half-replaced by "The Crown"; and
  // whole names only, so a place called "Spa" leaves "Spanish" alone (Codex,
  // 2 Oct 2026).
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const swap = (text) => text.replace(re, (m) => `⟦${byName.get(m.toLowerCase())}⟧`);
  // The household's own words, left exactly as said: their turns in the
  // transcript, their answers to the planner's questions, the intent and the
  // criteria rows parsed from what they said, and a tastes run's input
  // (Codex, 2 Oct 2026).
  const OWN_KEYS = ['intent', 'input', 'rows', 'answer'];
  const own = (key, node) => OWN_KEYS.includes(key) || (node && node.role === 'user');
  const prose = (key, v) => typeof v === 'string' && PROSE_KEYS.has(key) && !looksLikeLink(v);
  const walk = (node, key = null) => {
    if (Array.isArray(node)) {
      // An array of words under a prose key (reasons: ['…']); anything else is walked.
      node.forEach((v, i) => { if (prose(key, v)) node[i] = swap(v); else if (v && typeof v === 'object') walk(v, key); });
      return;
    }
    if (!node || typeof node !== 'object' || own(null, node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (own(k, null)) continue;
      if (prose(k, v)) node[k] = swap(v);
      else if (v && typeof v === 'object') walk(v, k);
    }
  };
  walk(copy);
  return copy;
}

/** Every ⟦…⟧ token in `doc`'s strings. */
function tokensIn(doc) {
  const out = new Set();
  const seek = (node) => {
    if (typeof node === 'string') { for (const m of node.matchAll(TOKEN)) out.add(m[1]); return; }
    if (Array.isArray(node)) { node.forEach(seek); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(seek);
  };
  seek(doc);
  return out;
}

/** Turn ⟦…⟧ tokens back into names, in place, from names already resolved (`by`: ref → name). */
function untokenise(doc, by) {
  const nameOf = (token) => {
    const named = [...new Set(token.split('|').map((r) => by.get(r) ?? 'a place'))];
    return named.length === 1 ? named[0] : 'a place';
  };
  const swap = (text) => text.replace(TOKEN, (_, token) => nameOf(token));
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach((v, i) => { if (typeof v === 'string') node[i] = swap(v); else walk(v); }); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') node[k] = swap(v);
      else walk(v);
    }
  };
  walk(doc);
}

export default { ownedNamesFor, resolveNames, resolveInto, nameJson, tokeniseJson, refsInJson };
