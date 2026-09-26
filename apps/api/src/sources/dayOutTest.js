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
 * The same verdict, computed at enrichment from what the owned record holds,
 * is written as a fact on the place (`recordVerdict`) — when the switch is
 * on, and only then.
 */

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
 * The objects the test reads for one drawer inside one box: the places the
 * drawer is fed from, and everything that could be the named-for thing.
 */
function queryFor(drawer, box) {
  const spec = NAMED_FOR[drawer];
  const b = `(${box.s},${box.w},${box.n},${box.e})`;
  const objects = {
    pools: `nwr["leisure"="swimming_pool"]${b};`,
    lidos: `nwr["leisure"="swimming_pool"]${b};`,
    athletics: `nwr["leisure"="track"]${b};`,
    climbing: `nwr["sport"~"climbing|bouldering"]${b};`,
    'racquet-clubs': `nwr["sport"~"tennis|squash|badminton|padel"]${b};`,
  }[drawer];
  return `[out:json][timeout:120];(nwr${spec.selector}${b};${objects});out center tags;`;
}

const point = (el) => ({ lat: el.lat ?? el.center?.lat, lng: el.lon ?? el.center?.lon });

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

/**
 * The dry run: every place the drawer would be fed from inside the box, with
 * its verdict and the evidence beside its name.
 */
export async function dryRun({ drawer, box, textFor = null }) {
  if (!DRAWERS.includes(drawer)) throw Object.assign(new Error(`The day-out test does not know a drawer called ${drawer}.`), { status: 400 });
  const spec = NAMED_FOR[drawer];
  const data = await overpassQuery(queryFor(drawer, box), { timeoutMs: 130_000 });
  const els = (data.elements ?? []).map((el) => ({ ...el, ...point(el), tags: el.tags ?? {} }));
  // The candidates are the drawer's own selector; the objects are everything
  // else that came back. A place can be both — a pool tagged as a sports
  // centre judges itself by its tags first.
  const { key, values } = selectorParts(spec.selector);
  const candidates = els.filter((el) => values.includes(String(el.tags[key] ?? '')));
  const objects = els.filter((el) => spec.object(el.tags));
  const rows = [];
  for (const c of candidates) {
    const nearby = c.lat == null ? [] : objects
      .filter((o) => o !== c && o.lat != null && metres(c, o) <= ADJACENT_M)
      .map((o) => ({ tags: o.tags, name: o.tags.name ?? null, m: Math.round(metres(c, o)) }));
    const text = textFor ? await textFor(c) : '';
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

/**
 * At enrichment: judge a place from what the owned record holds and write the
 * verdict as a fact of ours. Only when the switch is on — off, this returns
 * null and touches nothing, which is the state the owner asked for.
 */
export async function recordVerdict(venueRef, { drawer, tags = null, text = '', name = '' } = {}) {
  if (!dayOutTestOn() || !DRAWERS.includes(drawer)) return null;
  const v = dayOutVerdict(drawer, { tags, nearby: [], text, name });
  if (!v) return null;
  await owned.putFact(venueRef, {
    field: 'day_out_test', source: 'own', value: { drawer, ...v }, licence: 'ours', retention: 'indefinite', confidence: v.verdict === 'provisional' ? 0.5 : 1,
  }).catch(() => null);
  return v;
}
