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

/**
 * About a hundred metres of latitude and longitude at British latitudes, so
 * the objects a candidate is judged by are fetched a little beyond the box
 * the candidates come from. Splitting Bristol into quarters put Easton
 * Leisure Centre's pool, twenty-nine metres away, just over its quarter's
 * edge, and the centre went from kept to provisional for it (owner, 26 Sep
 * 2026: "fetch named-for objects with a ~100 m margin").
 */
export const MARGIN = { lat: 0.001, lng: 0.0016 };

function queryFor(drawer, box) {
  const b = `(${box.s},${box.w},${box.n},${box.e})`;
  const wider = `(${box.s - MARGIN.lat},${box.w - MARGIN.lng},${box.n + MARGIN.lat},${box.e + MARGIN.lng})`;
  return `[out:json][timeout:120];(nwr${NAMED_FOR[drawer].selector}${b};nwr${OBJECTS[drawer]}${wider};);out center tags;`;
}

/** Whether a point lies inside the box the candidates came from, rather than the margin. */
const inBox = (box, p) => p.lat != null && p.lat >= box.s && p.lat <= box.n && p.lng >= box.w && p.lng <= box.e;

/**
 * The dry run: every place the drawer would be fed from inside the box, with
 * its verdict and the evidence beside its name.
 *
 * Owned text is read for a candidate we hold a record for under its OSM
 * reference — the route calls this with nothing else, and the first draft's
 * `textFor` was an argument nobody supplied, so the page evidence the rule
 * advertised was never read (Codex, 26 Sep 2026).
 */
/**
 * Whether an element is a place the drawer would be fed from, rather than
 * one of the objects it is judged by.
 *
 * Lidos and athletics are fed from the object type itself — a mapped pool,
 * a mapped track — and the first dry run counted every one, unnamed garden
 * pools among them (owner, 26 Sep 2026: "name present and access≠private").
 * A centre keeps its place as a candidate whatever its name; an object-type
 * candidate needs a name and must not be private.
 */
export function isCandidate(drawer, el) {
  const spec = NAMED_FOR[drawer];
  const { key, values } = selectorParts(spec.selector);
  if (!values.includes(String(el.tags[key] ?? ''))) return false;
  if (el.tags.leisure === 'sports_centre' || el.tags.leisure === 'stadium') return true;
  return Boolean(el.tags.name) && el.tags.access !== 'private';
}

/**
 * The open-map labels a place carries, in the taxonomy's own form, so the
 * same rules that file a place can say where it goes.
 */
export function labelsOf(tags = {}) {
  const out = [];
  for (const k of ['leisure', 'sport', 'amenity', 'tourism', 'natural', 'historic', 'attraction', 'shop', 'club']) {
    const v = tags[k];
    if (v == null || v === '') continue;
    for (const one of String(v).split(';')) if (one.trim()) out.push(`osm:${k}=${one.trim()}`);
  }
  return out;
}

/** What feeds each tested drawer; taken away when asking where else a place could go. */
const FEEDER = {
  pools: ['osm:leisure=sports_centre', 'osm:leisure=swimming_pool'],
  lidos: ['osm:leisure=sports_centre', 'osm:leisure=swimming_pool'],
  athletics: ['osm:leisure=sports_centre', 'osm:leisure=track', 'osm:leisure=stadium'],
  climbing: ['osm:leisure=sports_centre'],
  'racquet-clubs': ['osm:leisure=sports_centre'],
};

/**
 * Out of Pools is not out of Epic (owner, 26 Sep 2026): "a place leaves Epic
 * only if it passes no drawer at all." So a place that fails the tested
 * drawer is asked where else its own labels would file it — the same rules,
 * with the failed drawer's feeder taken away — and only a place with nowhere
 * left leaves. `land` is the taxonomy's landing, injected so the rule can be
 * tested without a database.
 */
export function otherDrawerFor({ tags, failed, land }) {
  const all = labelsOf(tags);
  const rest = all.filter((l) => !FEEDER[failed]?.includes(l));
  if (!rest.length) return { drawer: null, via: null };
  const filed = land(rest);
  const drawer = filed?.subcategory ?? null;
  if (!drawer || drawer === failed) return { drawer: null, via: null };
  return { drawer, via: rest.join(' ') };
}

/** The taxonomy's landing, loaded once per dry run. */
async function landingFor() {
  const [{ rules }, tax] = await Promise.all([
    import('../repositories/shelfRules.js').then(async (m) => ({ rules: await m.rules() })),
    import('../repositories/shelfTaxonomy.js').then((m) => m.taxonomy()),
  ]);
  const { landingOfSet } = await import('../domain/landing.js');
  return (labels) => landingOfSet(labels, {}, rules, tax.vocab);
}

export async function dryRun({ drawer, box, textFor = null, fetch = overpassQuery, land = null }) {
  if (!DRAWERS.includes(drawer)) throw Object.assign(new Error(`The day-out test does not know a drawer called ${drawer}.`), { status: 400 });
  const spec = NAMED_FOR[drawer];
  const data = await fetch(queryFor(drawer, box), { timeoutMs: 130_000 });
  const els = (data.elements ?? []).map(withPoint);
  // Candidates come from the box; objects from the box and its margin, so a
  // pool just over a quarter's edge still speaks for the centre inside it.
  const candidates = els.filter((el) => isCandidate(drawer, el) && inBox(box, el));
  const objects = els.filter((el) => spec.object(el.tags));
  const readText = textFor ?? (async (c) => (await heldFor(`osm:${c.type}/${c.id}`)).text);
  // The taxonomy's landing is loaded the first time an out row needs it, so
  // a dry run with nothing out — and a test with a stubbed map — never opens
  // the database (Codex, 26 Sep 2026).
  let landing = land;
  const landAt = async (labels) => { landing ??= await landingFor(); return landing(labels); };
  const rows = [];
  for (const c of candidates) {
    const nearby = c.lat == null ? [] : objects
      .filter((o) => o !== c && o.lat != null && metres(c, o) <= ADJACENT_M)
      .map((o) => ({ tags: o.tags, name: o.tags.name ?? null, m: Math.round(metres(c, o)) }));
    const text = await readText(c);
    const v = dayOutVerdict(drawer, { tags: c.tags, nearby, text, name: c.tags.name ?? '' });
    // Where an out place still belongs, by its own labels. A members-only
    // place fails every drawer the test runs in, so it is never said to stay
    // in one of those (Codex, 26 Sep 2026); a drawer the test does not run
    // in is named, since the owner's rule for those is a separate decision.
    let elsewhere = { drawer: null, via: null };
    if (v.verdict === 'out') {
      const labels = labelsOf(c.tags).filter((l) => !FEEDER[drawer]?.includes(l));
      const filed = labels.length ? await landAt(labels) : null;
      const other = filed?.subcategory ?? null;
      if (other && other !== drawer && !(v.by === 'members' && DRAWERS.includes(other))) elsewhere = { drawer: other, via: labels.join(' ') };
    }
    rows.push({
      ref: `osm:${c.type}/${c.id}`,
      name: c.tags.name ?? '(unnamed)',
      verdict: v.verdict,
      by: v.by,
      reason: v.reason,
      nearest: nearby.length ? `${nearby[0].name ?? 'a pool'} ${nearby[0].m} m` : null,
      sport: c.tags.sport ?? null,
      brand: c.tags.brand ?? null,
      staysIn: v.verdict === 'out' ? (elsewhere.drawer ?? 'none — leaves Epic') : drawer,
      staysVia: elsewhere.via,
    });
  }
  const order = { kept: 0, provisional: 1, out: 2 };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.name.localeCompare(b.name));
  return {
    drawer, thing: spec.thing, box, adjacentM: ADJACENT_M,
    on: dayOutTestOn(),
    counts: {
      candidates: rows.length,
      kept: rows.filter((r) => r.verdict === 'kept').length,
      provisional: rows.filter((r) => r.verdict === 'provisional').length,
      out: rows.filter((r) => r.verdict === 'out').length,
      leavesEpic: rows.filter((r) => r.staysIn === 'none — leaves Epic').length,
      objects: objects.length,
    },
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
export async function judge(venueRef, { drawer, name = '', lat = null, lng = null, tags = null, text = '', fetch = overpassQuery, write = true, land = null } = {}) {
  if (!dayOutTestOn() || !DRAWERS.includes(drawer)) return null;
  const nearby = tags && NAMED_FOR[drawer].tag(tags) ? [] : await objectsAround(drawer, { lat, lng }, fetch);
  const v = dayOutVerdict(drawer, { tags, nearby, text, name });
  if (!v) return null;
  if (write) {
    await owned.putFact(venueRef, {
      field: 'day_out_test', source: 'own', value: { drawer, ...v, checkedAt: new Date().toISOString() },
      licence: 'ours', retention: 'indefinite', confidence: v.verdict === 'provisional' ? 0.5 : 1,
    });
    await applyVerdict(venueRef, { drawer, verdict: v, tags, land });
  }
  return v;
}

// ---------------------------------------------------------------------------
// what a verdict does to the filing
// ---------------------------------------------------------------------------

/**
 * Out of Pools is not out of Epic; and "not in Epic" is a list, never a
 * delete (owner, 26 Sep 2026, A5).
 *
 * A kept or provisional place is left where it is. An out place is refiled
 * under the drawer its own labels land in with the failed drawer's feeder
 * taken away; a place with nowhere left keeps its row and everything on it,
 * has its subcategory set aside into `not_in_epic_before` so every list that
 * keys on a subcategory drops it, and carries the reason and the moment
 * (migration 262). `restoreToEpic` puts it back exactly as it was.
 */
export async function applyVerdict(venueRef, { drawer, verdict, tags = null, land = null }) {
  if (!verdict || verdict.verdict !== 'out') return { effect: 'kept' };
  const labels = labelsOf(tags ?? {}).filter((l) => !FEEDER[drawer]?.includes(l));
  const landing = land ?? (labels.length ? await landingFor() : null);
  const filed = labels.length && landing ? landing(labels) : null;
  let other = filed?.subcategory ?? null;
  if (other === drawer || (verdict.by === 'members' && DRAWERS.includes(other))) other = null;
  if (other) {
    const { rows } = await query(
      `update place_index p
          set subcategory = $2, category = coalesce((select category_key from shelf_subcategories where key = $2), p.category),
              derived_by = 'day-out-test', indexed_at = now()
        where p.venue_ref = $1 and p.subcategory = $3
        returning venue_ref`,
      [venueRef, other, drawer],
    );
    return { effect: rows.length ? 'refiled' : 'unchanged', to: other };
  }
  const { rows } = await query(
    `update place_index p
        set not_in_epic_before = coalesce(p.not_in_epic_before, p.subcategory), subcategory = null,
            not_in_epic_at = now(), not_in_epic_reason = $2, indexed_at = now()
      where p.venue_ref = $1 and p.subcategory = $3
      returning venue_ref`,
    [venueRef, `${drawer}: ${verdict.reason}`, drawer],
  );
  return { effect: rows.length ? 'not-in-epic' : 'unchanged' };
}

/** The reversible list: what the test took off every shelf, and why. */
export async function notInEpic({ limit = 200 } = {}) {
  const { rows } = await query(
    `select p.venue_ref, r.name, p.not_in_epic_before as was, p.not_in_epic_reason as reason, p.not_in_epic_at as at
       from place_index p left join place_records r on r.venue_ref = p.venue_ref
      where p.not_in_epic_at is not null
      order by p.not_in_epic_at desc limit $1`,
    [limit],
  );
  return rows;
}

/** Back exactly as it was: the drawer it held, the row it never lost. */
export async function restoreToEpic(venueRef) {
  const { rows } = await query(
    `update place_index p
        set subcategory = p.not_in_epic_before, not_in_epic_before = null, not_in_epic_at = null, not_in_epic_reason = null,
            derived_by = 'hand', indexed_at = now()
      where p.venue_ref = $1 and p.not_in_epic_at is not null
      returning venue_ref, subcategory`,
    [venueRef],
  );
  return rows[0] ?? null;
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
