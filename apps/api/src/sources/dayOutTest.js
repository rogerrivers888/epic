/**
 * The day-out test, run over the open map (C26).
 *
 * Owned data only. Overpass is asked for the places a drawer is fed from and
 * for the separate objects that are the thing the drawer is named for — a
 * pool, a track, a wall, a court — and each place is judged by
 * `domain/dayOut.js`: its own tags, an object within eighty metres, its
 * owned text if we hold any, and last its name. Nothing here calls Google
 * and nothing here changes a filing: the dry run is a list of names beside
 * verdicts, which is what the owner asked to see before the switch is thrown.
 *
 * One judgement serves three callers, so they cannot disagree (Codex,
 * 26 Sep 2026 — the first draft judged the dry run with adjacency and text
 * and the enrichment path with neither):
 *
 *   dryRun          a box, from Overpass, names beside verdicts
 *   judge           one place, at enrichment — the matched tags, the objects
 *                   around its point, its owned prose — written as a fact of
 *                   ours when the switch is on
 *   dayOutCatchUp   the places already researched before the switch existed,
 *                   judged the same way, a few at a time from the own loop
 */

import { query } from '../db.js';
import { overpassQuery } from './overpass.js';
import * as owned from '../repositories/ownedPlaces.js';
import { ADJACENT_M, DRAWERS, NAMED_FOR, dayOutTestOn, dayOutVerdict } from '../domain/dayOut.js';

/** Metres between two points, near enough for eighty of them. */
export function metres(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** A box as Overpass wants it: south, west, north, east. */
export function boxOf(raw) {
  const n = String(raw ?? '').split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null;
  const [s, w, no, e] = n;
  if (s >= no || w >= e || Math.abs(no - s) > 0.3 || Math.abs(e - w) > 0.4) return null;
  return { s, w, n: no, e };
}

/**
 * The key and values an Overpass selector names, so the same selector that
 * fetched the candidates also picks them out of the answer: `["leisure"=
 * "sports_centre"]` is one value, `["leisure"~"^(sports_centre|track)$"]`
 * is two.
 */
export function selectorParts(selector) {
  const m = String(selector).match(/^\["([^"]+)"[=~]"([^"]+)"\]$/);
  if (!m) return { key: null, values: [] };
  return { key: m[1], values: m[2].replace(/^\^\(?|\)?\$$/g, '').split('|') };
}

/** The Overpass clause for the objects a drawer is named for. */
const OBJECTS = {
  pools: '["leisure"="swimming_pool"]',
  lidos: '["leisure"="swimming_pool"]',
  athletics: '["leisure"="track"]',
  climbing: '["sport"~"climbing|bouldering"]',
  'racquet-clubs': '["sport"~"tennis|squash|badminton|padel"]',
};

const point = (el) => ({ lat: el.lat ?? el.center?.lat, lng: el.lon ?? el.center?.lon });
const withPoint = (el) => ({ ...el, ...point(el), tags: el.tags ?? {} });

/**
 * The prose the test may read: what the venue's page or the encyclopedia say
 * about the place, and nothing else. An address, a URL, a phone number or a
 * name is not evidence of a pool — a Wikipedia title with "Baths" in it was
 * being promoted from the name's provisional keep to a definite one (Codex,
 * 26 Sep 2026).
 */
export const PROSE_FIELDS = new Set(['summary', 'body', 'description']);
export const PROSE_SOURCES = new Set(['site', 'wikipedia', 'wikidata']);

export function proseOf(facts = [], record = null) {
  const bits = [];
  for (const f of facts) {
    if (PROSE_FIELDS.has(f.field) && PROSE_SOURCES.has(f.source) && typeof f.value === 'string') bits.push(f.value);
  }
  if (record?.summary && typeof record.summary === 'string') bits.push(record.summary);
  return bits.join(' ');
}

/** What we hold about a place by its reference, for the dry run's text and the catch-up. */
async function heldFor(venueRef) {
  const [record, facts] = await Promise.all([
    owned.recordFor(venueRef).catch(() => null),
    owned.liveFacts(venueRef, { keepableOnly: true }).catch(() => []),
  ]);
  return { record, facts, text: proseOf(facts, record) };
}

// ---------------------------------------------------------------------------
// the dry run
// ---------------------------------------------------------------------------

function queryFor(drawer, box) {
  const b = `(${box.s},${box.w},${box.n},${box.e})`;
  return `[out:json][timeout:120];(nwr${NAMED_FOR[drawer].selector}${b};nwr${OBJECTS[drawer]}${b};);out center tags;`;
}

/**
 * The dry run: every place the drawer would be fed from inside the box, with
 * its verdict and the evidence beside its name.
 *
 * Owned text is read for a candidate we hold a record for under its OSM
 * reference — the route calls this with nothing else, and the first draft's
 * `textFor` was an argument nobody supplied, so the page evidence the rule
 * advertised was never read (Codex, 26 Sep 2026).
 */
export async function dryRun({ drawer, box, textFor = null, fetch = overpassQuery }) {
  if (!DRAWERS.includes(drawer)) throw Object.assign(new Error(`The day-out test does not know a drawer called ${drawer}.`), { status: 400 });
  const spec = NAMED_FOR[drawer];
  const data = await fetch(queryFor(drawer, box), { timeoutMs: 130_000 });
  const els = (data.elements ?? []).map(withPoint);
  const { key, values } = selectorParts(spec.selector);
  const candidates = els.filter((el) => values.includes(String(el.tags[key] ?? '')));
  const objects = els.filter((el) => spec.object(el.tags));
  const readText = textFor ?? (async (c) => (await heldFor(`osm:${c.type}/${c.id}`)).text);
  const rows = [];
  for (const c of candidates) {
    const nearby = c.lat == null ? [] : objects
      .filter((o) => o !== c && o.lat != null && metres(c, o) <= ADJACENT_M)
      .map((o) => ({ tags: o.tags, name: o.tags.name ?? null, m: Math.round(metres(c, o)) }));
    const text = await readText(c);
    const v = dayOutVerdict(drawer, { tags: c.tags, nearby, text, name: c.tags.name ?? '' });
    rows.push({
      ref: `osm:${c.type}/${c.id}`,
      name: c.tags.name ?? '(unnamed)',
      verdict: v.verdict,
      by: v.by,
      reason: v.reason,
      nearest: nearby.length ? `${nearby[0].name ?? 'a pool'} ${nearby[0].m} m` : null,
      sport: c.tags.sport ?? null,
    });
  }
  const order = { kept: 0, provisional: 1, out: 2 };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.name.localeCompare(b.name));
  return {
    drawer, thing: spec.thing, box, adjacentM: ADJACENT_M,
    on: dayOutTestOn(),
    counts: { candidates: rows.length, kept: rows.filter((r) => r.verdict === 'kept').length, provisional: rows.filter((r) => r.verdict === 'provisional').length, out: rows.filter((r) => r.verdict === 'out').length, objects: objects.length },
    rows,
  };
}

// ---------------------------------------------------------------------------
// one place, judged
// ---------------------------------------------------------------------------

/**
 * The evidence around one point: the objects of the named-for kind within
 * eighty metres. One free call, and the same clause the dry run uses.
 */
async function objectsAround(drawer, { lat, lng }, fetch = overpassQuery) {
  if (lat == null || lng == null) return [];
  const data = await fetch(`[out:json][timeout:30];nwr${OBJECTS[drawer]}(around:${ADJACENT_M},${lat},${lng});out center tags;`, { timeoutMs: 40_000 });
  const spec = NAMED_FOR[drawer];
  return (data.elements ?? []).map(withPoint)
    .filter((o) => spec.object(o.tags))
    .map((o) => ({ tags: o.tags, name: o.tags.name ?? null, m: o.lat != null ? Math.round(metres({ lat, lng }, o)) : null }));
}

/**
 * Judge one place from what the record holds, and write the verdict as a fact
 * of ours.
 *
 * `tags` are the matched open-map tags, handed in by the caller that matched
 * them — enrichment stores the fields it reads off the tags and never the tags
 * themselves, so a lookup for a `tags` fact was always empty and the decisive
 * `sport=swimming` was being missed (Codex, 26 Sep 2026). The objects around
 * the point are fetched here, so adjacency counts at enrichment exactly as it
 * does in the dry run. Off, this returns null and touches nothing.
 *
 * The write is allowed to fail loudly: a verdict that could not be stored is
 * a place to come back to, not a place done (Codex, 26 Sep 2026).
 */
export async function judge(venueRef, { drawer, name = '', lat = null, lng = null, tags = null, text = '', fetch = overpassQuery, write = true } = {}) {
  if (!dayOutTestOn() || !DRAWERS.includes(drawer)) return null;
  const nearby = tags && NAMED_FOR[drawer].tag(tags) ? [] : await objectsAround(drawer, { lat, lng }, fetch);
  const v = dayOutVerdict(drawer, { tags, nearby, text, name });
  if (!v) return null;
  if (write) {
    await owned.putFact(venueRef, {
      field: 'day_out_test', source: 'own', value: { drawer, ...v, checkedAt: new Date().toISOString() },
      licence: 'ours', retention: 'indefinite', confidence: v.verdict === 'provisional' ? 0.5 : 1,
    });
  }
  return v;
}

/**
 * The places researched before the switch existed.
 *
 * `research()` returns early for a place already researched at the current
 * version, so throwing the switch would have judged only new and stale places
 * and left the inventory without the fact (Codex, 26 Sep 2026). This walks
 * the researched places in the five drawers that carry no verdict yet, a few a
 * tick, from what their records hold — the open map is asked only for the
 * objects around each point. Off, it does nothing.
 */
export async function dayOutCatchUp({ limit = 10, fetch = overpassQuery } = {}) {
  if (!dayOutTestOn()) return { judged: 0, skipped: 'switch off' };
  const { rows } = await query(
    `select p.venue_ref, p.subcategory, r.name, coalesce(r.lat, p.lat) as lat, coalesce(r.lng, p.lng) as lng, r.osm_ref, r.summary
       from place_index p
       join place_records r on r.venue_ref = p.venue_ref
      where p.subcategory = any($1)
        and not exists (select 1 from place_facts f where f.venue_ref = p.venue_ref and f.field = 'day_out_test')
      order by p.last_seen desc
      limit $2`,
    [DRAWERS, limit],
  );
  let judged = 0;
  const counts = { kept: 0, provisional: 0, out: 0 };
  for (const r of rows) {
    // The place's own tags, by its open-map reference, when it has one.
    let tags = null;
    if (r.osm_ref && /^(node|way|relation)\/\d+$/.test(r.osm_ref)) {
      const [kind, id] = r.osm_ref.split('/');
      const data = await fetch(`[out:json][timeout:30];${kind}(id:${id});out tags;`, { timeoutMs: 40_000 }).catch(() => ({ elements: [] }));
      tags = data.elements?.[0]?.tags ?? null;
    }
    const held = await heldFor(r.venue_ref);
    const v = await judge(r.venue_ref, { drawer: r.subcategory, name: r.name ?? '', lat: r.lat, lng: r.lng, tags, text: held.text, fetch });
    if (v) { judged += 1; counts[v.verdict] += 1; }
  }
  return { judged, ...counts, remaining: null };
}
