/**
 * The local OpenStreetMap extract: download, read, load, and ask
 * (back-office handover 5.3; migration 267).
 *
 * Loading is three streaming passes over the file, so memory stays bounded by
 * what is kept rather than by the size of the country:
 *
 *   1. ways and relations — keep the named ones of the kinds we care about,
 *      with up to eight evenly spaced node references each (enough for a
 *      centre), and note which member ways the kept relations need;
 *   2. ways again — the member ways' node references;
 *   3. nodes — keep the named nodes of the kinds we care about, and read the
 *      coordinates of every node the ways and relations need. Nodes arrive
 *      sorted by id, so the wanted ids are a sorted array walked alongside.
 *
 * A load writes under a new load id and swaps it in only when it finishes, so
 * a failed or half-read load never replaces a good one.
 *
 * Downloading a national extract (Great Britain is about 1.9 GB) is free —
 * Geofabrik publishes it openly — but it is a bulk load into production and
 * runs only when a person starts it (H1).
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { readPbf } from './osmPbf.js';

/**
 * The extracts Epic covers. Great Britain rather than the United Kingdom:
 * the UK extract includes Northern Ireland, which the Ireland one also holds,
 * and one region is loaded once (checked 28 Sep 2026: GB 2.18 GB, Ireland and
 * Northern Ireland 0.41 GB at Geofabrik).
 */
export const EXTRACTS = {
  'great-britain': 'https://download.geofabrik.de/europe/great-britain-latest.osm.pbf',
  'ireland-and-northern-ireland': 'https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf',
};

/**
 * Whether an element is worth keeping: named, and of a kind a day out, the
 * researcher's matching, or the transport layer (A13, E7) needs. Roads,
 * houses and boundaries are never kept.
 */
const KEEP_KEYS = ['amenity', 'tourism', 'leisure', 'shop', 'historic', 'craft', 'club', 'sport', 'natural', 'man_made'];
export function keep(tags) {
  if (!tags?.name) return false;
  if (tags.highway || tags.boundary || tags.place) return false;
  if (KEEP_KEYS.some((k) => tags[k])) return true;
  if (tags.railway && ['station', 'halt', 'tram_stop'].includes(tags.railway)) return true;
  if (tags.public_transport === 'station' || tags.aeroway === 'aerodrome') return true;
  return false;
}

/** Up to n evenly spaced items of a list. */
function spaced(list, n = 8) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor((i * (list.length - 1)) / (n - 1))]);
  return out;
}

/** Download an extract to a file, returning its size. */
export async function download(url, path) {
  await mkdir(path.replace(/\/[^/]+$/, ''), { recursive: true });
  const res = await fetch(url, { headers: { 'user-agent': `Epic/0.1 (${process.env.EPIC_CONTACT_EMAIL ?? 'hello@epic.day'})` } });
  if (!res.ok || !res.body) throw new Error(`download ${url}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  return (await stat(path)).size;
}

/**
 * Read a .osm.pbf file into `osm_features` under a new load id for `region`,
 * then swap it in. Returns what it kept.
 */
export async function loadFile({ path, region, url = null, onProgress = null }) {
  const loadId = randomUUID();
  // Pass 1: ways and relations worth keeping.
  const ways = []; // { id, tags, refs }
  const rels = []; // { id, tags, memberWays }
  const memberWays = new Set();
  await readPbf(path, (e) => {
    if (!keep(e.tags)) return;
    // Tags held as JSON text until they are written: a national file keeps
    // over a million ways, and a string is a fraction of an object's size.
    if (e.type === 'way' && e.refs.length) ways.push({ id: e.id, name: e.tags.name, tags: JSON.stringify(e.tags), refs: spaced(e.refs) });
    else if (e.type === 'relation') {
      const mw = spaced(e.members.filter((m) => m.type === 'way').map((m) => m.id), 4);
      if (mw.length) { rels.push({ id: e.id, name: e.tags.name, tags: JSON.stringify(e.tags), memberWays: mw }); mw.forEach((w) => memberWays.add(w)); }
    }
  }, { node: false, way: true, relation: true });
  onProgress?.({ pass: 1, ways: ways.length, relations: rels.length });

  // Pass 2: the member ways' node references.
  const memberRefs = new Map();
  if (memberWays.size) {
    await readPbf(path, (e) => { if (memberWays.has(e.id)) memberRefs.set(e.id, spaced(e.refs, 4)); }, { node: false, way: true, relation: false });
  }
  onProgress?.({ pass: 2, memberWays: memberRefs.size });

  // Every node whose coordinates are needed, sorted, for a merge walk.
  const neededSet = new Set();
  for (const w of ways) for (const r of w.refs) neededSet.add(r);
  for (const refs of memberRefs.values()) for (const r of refs) neededSet.add(r);
  const needed = Float64Array.from(neededSet).sort();
  neededSet.clear();
  const lat = new Float64Array(needed.length).fill(NaN);
  const lng = new Float64Array(needed.length).fill(NaN);

  // Pass 3: nodes. Kept nodes are inserted in batches as they arrive.
  let batch = [];
  let kept = 0;
  let box = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
  const widen = (la, lo) => {
    if (la < box.minLat) box.minLat = la; if (la > box.maxLat) box.maxLat = la;
    if (lo < box.minLng) box.minLng = lo; if (lo > box.maxLng) box.maxLng = lo;
  };
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch; batch = [];
    const vals = []; const args = [];
    rows.forEach((r, i) => {
      vals.push(`($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}::jsonb, $${i * 7 + 6}, $${i * 7 + 7})`);
      args.push(r.ref, r.name, r.lat, r.lng, typeof r.tags === 'string' ? r.tags : JSON.stringify(r.tags), region, loadId);
    });
    await query(
      `insert into osm_features (ref, name, lat, lng, tags, region, load_id) values ${vals.join(',')}
       on conflict (ref) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
         tags = excluded.tags, region = excluded.region, load_id = excluded.load_id`, args);
    kept += rows.length;
  };
  let ptr = 0;
  const pending = [];
  await readPbf(path, (e) => {
    if (e.type !== 'node') return;
    while (ptr < needed.length && needed[ptr] < e.id) ptr += 1;
    if (ptr < needed.length && needed[ptr] === e.id) { lat[ptr] = e.lat; lng[ptr] = e.lon; }
    if (keep(e.tags)) {
      batch.push({ ref: `node/${e.id}`, name: e.tags.name, lat: e.lat, lng: e.lon, tags: e.tags });
      widen(e.lat, e.lon);
      if (batch.length >= 500) pending.push(flush());
    }
  }, { node: true, way: false, relation: false });
  await Promise.all(pending);
  await flush();
  onProgress?.({ pass: 3, nodes: kept });

  // Centres for the ways and relations, from the coordinates just read.
  const at = (id) => {
    let lo = 0; let hi = needed.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (needed[mid] === id) return Number.isNaN(lat[mid]) ? null : [lat[mid], lng[mid]];
      if (needed[mid] < id) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  };
  const centre = (refs) => {
    const pts = refs.map(at).filter(Boolean);
    if (!pts.length) return null;
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  };
  for (const w of ways) {
    const c = centre(w.refs);
    if (!c) continue;
    batch.push({ ref: `way/${w.id}`, name: w.name, lat: c[0], lng: c[1], tags: w.tags });
    widen(c[0], c[1]);
    if (batch.length >= 500) await flush();
  }
  for (const r of rels) {
    const c = centre(r.memberWays.flatMap((w) => memberRefs.get(w) ?? []));
    if (!c) continue;
    batch.push({ ref: `relation/${r.id}`, name: r.name, lat: c[0], lng: c[1], tags: r.tags });
    widen(c[0], c[1]);
    if (batch.length >= 500) await flush();
  }
  await flush();

  // Swap in: this load becomes the region's, and the previous one goes.
  await withTransaction(async (c) => {
    await c.query('delete from osm_features where region = $1 and load_id <> $2', [region, loadId]);
    await c.query(
      `insert into osm_extracts (region, url, load_id, state, features, min_lat, max_lat, min_lng, max_lng, finished_at, problem)
       values ($1, $2, $3, 'done', $4, $5, $6, $7, $8, now(), null)
       on conflict (region) do update set url = excluded.url, load_id = excluded.load_id, state = 'done', features = excluded.features,
         min_lat = excluded.min_lat, max_lat = excluded.max_lat, min_lng = excluded.min_lng, max_lng = excluded.max_lng,
         finished_at = now(), problem = null`,
      [region, url ?? EXTRACTS[region] ?? path, loadId, kept, box.minLat, box.maxLat, box.minLng, box.maxLng]);
  });
  forgetCoverage();
  return { region, loadId, features: kept, box };
}

/**
 * Download and load one region. Started by a person (H1); marks its state as
 * it goes so the back office can show it, and cleans its file up after.
 */
/**
 * Load one region in its own process. A national extract peaks near 1 GB
 * (Great Britain, measured 28 Sep 2026: 972,593 places, 2½ minutes, 1.0 GB
 * resident), which must never be the API's own memory: a worker that runs
 * out stops alone, and the region reads failed with the reason.
 */
export async function loadRegion({ region, who }) {
  if (!EXTRACTS[region]) throw Object.assign(new Error(`${region} is not an extract Epic loads.`), { status: 400 });
  const { fork } = await import('node:child_process');
  const worker = new URL('./osmWorker.js', import.meta.url);
  const code = await new Promise((resolve) => {
    const child = fork(worker, [region, who ?? 'Epic'], { execArgv: ['--max-old-space-size=3072'], stdio: 'inherit' });
    child.on('exit', (c, sig) => resolve(sig ? `signal ${sig}` : c));
    child.on('error', () => resolve('could not start'));
  });
  const { rows: [x] } = await query('select state, features, problem from osm_extracts where region = $1', [region]);
  if (code !== 0 && x && ['downloading', 'reading'].includes(x.state)) {
    await query(`update osm_extracts set state = 'failed', problem = $2, finished_at = now() where region = $1`,
      [region, `the loader stopped (${code}) before it finished`]);
    return { region, error: `stopped (${code})` };
  }
  return x?.state === 'done' ? { region, features: x.features } : { region, error: x?.problem ?? `stopped (${code})` };
}

/** The load itself, run inside the worker (osmWorker.js). */
export async function loadRegionHere({ region, who, dir = '/tmp/epic-osm' }) {
  const url = EXTRACTS[region];
  if (!url) throw Object.assign(new Error(`${region} is not an extract Epic loads.`), { status: 400 });
  const path = `${dir}/${region}.osm.pbf`;
  await query(
    `insert into osm_extracts (region, url, state, started_at, started_by) values ($1, $2, 'downloading', now(), $3)
     on conflict (region) do update set state = 'downloading', started_at = now(), started_by = excluded.started_by, problem = null`,
    [region, url, who]);
  try {
    const bytes = await download(url, path);
    await query(`update osm_extracts set state = 'reading', bytes = $2 where region = $1`, [region, bytes]);
    return await loadFile({ path, region, url });
  } catch (err) {
    await query(`update osm_extracts set state = 'failed', problem = $2, finished_at = now() where region = $1`, [region, String(err.message).slice(0, 300)]);
    throw err;
  } finally {
    await rm(path, { force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Asking: the same questions Overpass answered, from our own table.

let coverage = null;
let coverageAt = 0;
export function forgetCoverage() { coverage = null; }

/** The boxes of the finished extracts. */
async function covered() {
  if (coverage && Date.now() - coverageAt < 60_000) return coverage;
  const { rows } = await query(`select region, min_lat, max_lat, min_lng, max_lng from osm_extracts where state = 'done'`).catch(() => ({ rows: [] }));
  coverage = rows;
  coverageAt = Date.now();
  return coverage;
}

/** Whether a point is inside a loaded extract, so the local table can answer for it. */
export async function covers(lat, lng) {
  if (lat == null || lng == null) return (await covered()).length > 0;
  return (await covered()).some((r) => lat >= r.min_lat && lat <= r.max_lat && lng >= r.min_lng && lng <= r.max_lng);
}

const asElement = (r) => {
  const [type, id] = r.ref.split('/');
  return { type, id: Number(id), lat: r.lat, lon: r.lng, center: type === 'node' ? undefined : { lat: r.lat, lon: r.lng }, tags: r.tags };
};

/** One element by its reference ('way/123'), or null. */
export async function element(ref) {
  const { rows: [r] } = await query('select ref, lat, lng, tags from osm_features where ref = $1', [ref]);
  return r ? asElement(r) : null;
}

/** A box around a point, in degrees, radius in metres. */
function box(lat, lng, radiusM) {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lat + dLat, lng - dLng, lng + dLng];
}

/** Named places near a point whose name matches any of these stems (case-insensitive). */
export async function nearByName(lat, lng, radiusM, stems, limit = 200) {
  const [a, b, c, d] = box(lat, lng, radiusM);
  const re = stems.map((s) => String(s).replace(/[^\p{L}\p{N} '-]/gu, '')).filter(Boolean).join('|');
  if (!re) return [];
  const { rows } = await query(
    `select ref, lat, lng, tags from osm_features
      where lat between $1 and $2 and lng between $3 and $4 and name ~* $5 limit $6`,
    [a, b, c, d, `(${re})`, limit]);
  return rows.map(asElement);
}

/** Named places of any of these kinds (tag keys) near a point. */
export async function nearByKind(lat, lng, radiusM, kinds, limit = 300) {
  const [a, b, c, d] = box(lat, lng, radiusM);
  const { rows } = await query(
    `select ref, lat, lng, tags from osm_features
      where lat between $1 and $2 and lng between $3 and $4 and tags ?| $5 limit $6`,
    [a, b, c, d, kinds, limit]);
  return rows.map(asElement);
}

/** The state of every extract, for the back office. */
export async function extracts() {
  const { rows } = await query('select * from osm_extracts order by region');
  return Object.keys(EXTRACTS).map((region) => rows.find((r) => r.region === region) ?? { region, url: EXTRACTS[region], state: 'never' });
}

/**
 * The regions a person has switched on, from config (EPIC_OSM_EXTRACT, a
 * comma list of region keys). No button starts a job (handover 1); a load
 * happens because the owner put a region in config, at boot and monthly.
 */
export const REGIONS_ON = () => String(process.env.EPIC_OSM_EXTRACT ?? '').split(',').map((r) => r.trim()).filter((r) => EXTRACTS[r]);

/**
 * The regions switched on: EPIC_OSM_EXTRACT where it is set, otherwise the
 * back-office setting `osmRegions` (config a person sets, logged in Changes).
 */
export async function regionsOn() {
  if (String(process.env.EPIC_OSM_EXTRACT ?? '').trim()) return REGIONS_ON();
  const { settings } = await import('../desk/settings.js');
  const v = (await settings()).values.osmRegions;
  return Array.isArray(v) ? v.filter((r) => EXTRACTS[r]) : [];
}

/** A load still marked running after this long died with its process. */
const STUCK_MS = 6 * 3600_000;
let loading = null;

/** Load every switched-on region that has never loaded, failed, or is a month old. One at a time. */
export async function loadDue({ who = 'Epic (monthly)' } = {}) {
  // One pass at a time in this process: the setting and the daily tick can
  // both ask.
  if (loading) return loading;
  loading = (async () => {
    const out = [];
    for (const region of await regionsOn()) {
      const { rows: [x] } = await query('select state, started_at, finished_at from osm_extracts where region = $1', [region]);
      const running = x && ['downloading', 'reading'].includes(x.state);
      const stuck = running && (!x.started_at || Date.now() - new Date(x.started_at).getTime() > STUCK_MS);
      const stale = !x || x.state === 'never' || x.state === 'failed' || stuck
        || (x.state === 'done' && Date.now() - new Date(x.finished_at).getTime() > 30 * 86400_000);
      if (!stale || (running && !stuck)) continue;
      out.push(await loadRegion({ region, who }).catch((err) => ({ region, error: err.message })));
    }
    return out;
  })().finally(() => { loading = null; });
  return loading;
}
