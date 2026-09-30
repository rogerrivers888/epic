/**
 * Three owned sources of points, loaded onto our own disk (owner, C59 step 3,
 * 30 Sep 2026): the FSA food hygiene register, Historic England's National
 * Heritage List, and OS Open Names. All three are published under the Open
 * Government Licence, so what is loaded is kept, and every point matched from
 * them is written to owned_points with its source and licence.
 *
 * Each is loaded whole into a new load, and only once it has all arrived is
 * the previous load deleted: a failed or interrupted load leaves the last good
 * one standing. Refreshed weekly (server.js), never by a button.
 *
 * Nothing here is paid for, and nothing is asked of a provider that bills.
 */

import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { query, pool } from '../db.js';

export const SOURCES = ['fsa', 'historic-england', 'os-open-names'];
const WEEK_MS = 7 * 86_400_000;
const STUCK_MS = 6 * 3600_000;

const FSA_AUTHORITIES = 'https://api.ratings.food.gov.uk/Authorities';
// The register's own open-data files, one per council, JSON beside the XML.
const fsaFileUrl = (xmlName) => String(xmlName)
  .replace(/^https?:\/\/ratings\.food\.gov\.uk\/OpenDataFiles\//i, 'https://ratings.food.gov.uk/api/open-data-files/')
  .replace(/\.xml$/i, '.json');

const NHLE = 'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer';
// The layers that name a place a family might go to. Building Preservation
// Notices and Certificates of Immunity are planning instruments, not places.
export const NHLE_LAYERS = [
  { id: 0, layer: 'listed-building', points: true },
  { id: 6, layer: 'scheduled-monument' },
  { id: 7, layer: 'park-garden' },
  { id: 8, layer: 'battlefield' },
  { id: 10, layer: 'world-heritage' },
];

const OS_NAMES = 'https://api.os.uk/downloads/v1/products/OpenNames/downloads?area=GB&format=CSV&redirect';
// Named features a family might go to; settlements, roads and postcodes are
// not places in that sense, and would match every business in them.
export const OS_TYPES = new Set(['landform', 'hydrography', 'landcover', 'other']);
const OS_LOCAL_TYPES_OUT = new Set(['Named Road', 'Numbered Road', 'Postcode', 'Section Of Named Road', 'Section Of Numbered Road']);

const UA = { 'user-agent': 'Epic (epic.day) owned-sources loader; roger@epic.day' };

/** Every source's last load, for the back office. */
export async function loads() {
  const { rows } = await query('select * from owned_source_loads order by source');
  return rows;
}

/** Load whatever is a week old, has never loaded, failed, or is stuck. One pass at a time. */
let running = null;
export async function loadDue({ who = 'Epic (weekly)', only = null, fetcher = fetch } = {}) {
  if (running) return running;
  running = (async () => {
    const out = [];
    for (const source of only ?? SOURCES) {
      const { rows: [x] } = await query('select * from owned_source_loads where source = $1', [source]);
      const loading = x?.state === 'loading';
      const stuck = loading && (!x.started_at || Date.now() - new Date(x.started_at).getTime() > STUCK_MS);
      const due = !x || x.state === 'never' || x.state === 'failed' || stuck
        || (x.state === 'done' && Date.now() - new Date(x.finished_at).getTime() > WEEK_MS);
      if (!due || (loading && !stuck)) continue;
      out.push(await loadSource(source, { who, fetcher }).catch((err) => ({ source, error: err.message })));
    }
    return out;
  })().finally(() => { running = null; });
  return running;
}

/** One source, loaded whole into a new load; the old one goes only once the new one is in. */
export async function loadSource(source, { who = 'Epic', fetcher = fetch } = {}) {
  const loader = { fsa: loadFsa, 'historic-england': loadHeritage, 'os-open-names': loadOsNames }[source];
  if (!loader) throw new Error(`not an owned source: ${source}`);
  const loadId = randomUUID();
  // Claimed in one statement: a load already under way (and not stuck) is
  // left to finish, never raced — two would each delete the other's rows
  // (Codex, 30 Sep 2026).
  const { rows: [claimed] } = await query(
    `update owned_source_loads set state = 'loading', load_id = $2, problem = null, started_at = now(), finished_at = null, started_by = $3
      where source = $1 and (state <> 'loading' or started_at is null or started_at < now() - interval '6 hours')
      returning source`, [source, loadId, who]);
  if (!claimed) throw new Error(`${source} is already loading`);
  try {
    const rows = await loader(loadId, fetcher);
    const table = { fsa: 'fsa_establishments', 'historic-england': 'heritage_entries', 'os-open-names': 'os_names' }[source];
    // A load that brought nothing is a failure, never an empty country.
    if (!rows) throw new Error('the source answered with nothing');
    // Live first, then the old loads go: the matcher reads the live load only.
    // Only while this load is still the one claimed — a load that ran so long
    // another took over publishes nothing and deletes nothing (Codex, 30 Sep 2026).
    const { rowCount: mine } = await query(
      `update owned_source_loads set state = 'done', rows = $2, live_load = $3, finished_at = now()
        where source = $1 and load_id = $3 and state = 'loading'`, [source, rows, loadId]);
    if (!mine) throw new Error(`${source}: another load took over while this one ran`);
    await query(`delete from ${table} where load_id <> $1`, [loadId]);
    return { source, rows };
  } catch (err) {
    await query(`update owned_source_loads set state = 'failed', problem = $2, finished_at = now() where source = $1 and load_id = $3`, [source, String(err.message).slice(0, 500), loadId]);
    // What this load wrote is not a load; the last good one stands.
    const table = { fsa: 'fsa_establishments', 'historic-england': 'heritage_entries', 'os-open-names': 'os_names' }[source];
    await query(`delete from ${table} where load_id = $1`, [loadId]).catch(() => null);
    throw err;
  }
}

async function getJson(url, fetcher, headers = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetcher(url, { headers: { ...UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(120_000) });
    if (res.ok) return res.json();
    // A busy server is waited for, three times; anything else is an answer.
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((ok) => setTimeout(ok, 5_000 * (attempt + 1))); continue; }
    throw new Error(`${url.split('?')[0]} answered ${res.status}`);
  }
}

/** Rows written in batches of five hundred, on one statement each. */
async function insertBatch(table, columns, rows, conflict) {
  if (!rows.length) return;
  const n = columns.length;
  const values = rows.map((_, i) => `(${columns.map((__, j) => `$${i * n + j + 1}`).join(',')})`).join(',');
  await pool.query(`insert into ${table} (${columns.join(',')}) values ${values} ${conflict}`, rows.flat());
}

// ---------------------------------------------------------------------------
// FSA: every council's file, one after another
// ---------------------------------------------------------------------------
export async function loadFsa(loadId, fetcher = fetch) {
  const { authorities = [] } = await getJson(FSA_AUTHORITIES, fetcher, { 'x-api-version': '2' });
  if (!authorities.length) throw new Error('the register listed no councils');
  let total = 0;
  const failed = [];
  for (const a of authorities) {
    if (!a.FileName) continue;
    let body;
    try { body = await getJson(fsaFileUrl(a.FileName), fetcher); } catch (err) { failed.push(`${a.Name}: ${err.message}`); continue; }
    // An array, as the feed serves it; the XML's EstablishmentDetail nesting
    // read too, should the JSON ever follow it.
    const coll = body?.FHRSEstablishment?.EstablishmentCollection;
    const list = Array.isArray(coll) ? coll : (Array.isArray(coll?.EstablishmentDetail) ? coll.EstablishmentDetail : []);
    const rows = [];
    for (const e of list) {
      const lat = Number(e?.Geocode?.Latitude); const lng = Number(e?.Geocode?.Longitude);
      if (!e?.FHRSID || !e.BusinessName || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
      rows.push([Number(e.FHRSID), String(e.BusinessName), e.BusinessType ?? null, e.BusinessTypeID ?? null, e.PostCode ?? null, e.LocalAuthorityName ?? a.Name ?? null, lat, lng, loadId]);
    }
    for (let i = 0; i < rows.length; i += 500) {
      await insertBatch('fsa_establishments',
        ['fhrsid', 'name', 'business_type', 'business_type_id', 'postcode', 'authority', 'lat', 'lng', 'load_id'],
        rows.slice(i, i + 500),
        'on conflict do nothing');
    }
    total += rows.length;
  }
  // A handful of councils failing is a partial register, not a register; a
  // load that lost more than one in twenty is refused and the last one kept.
  if (failed.length > Math.max(3, authorities.length / 20)) throw new Error(`${failed.length} councils failed: ${failed.slice(0, 3).join('; ')}`);
  return total;
}

// ---------------------------------------------------------------------------
// Historic England: the National Heritage List, a page at a time
// ---------------------------------------------------------------------------
export async function loadHeritage(loadId, fetcher = fetch) {
  let total = 0;
  for (const L of NHLE_LAYERS) {
    const { count } = await getJson(`${NHLE}/${L.id}/query?where=1%3D1&returnCountOnly=true&f=json`, fetcher);
    let got = 0;
    for (let offset = 0; ; offset += 2000) {
      const geo = L.points ? 'returnGeometry=true' : 'returnGeometry=false&returnCentroid=true';
      const page = await getJson(`${NHLE}/${L.id}/query?where=1%3D1&outFields=ListEntry,Name,Grade&${geo}&outSR=4326&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=2000&f=json`, fetcher);
      const features = page.features ?? [];
      const rows = [];
      for (const f of features) {
        // A multipoint layer answers with `points`; a point layer with x and y
        // (Codex, 30 Sep 2026) — either is read; a polygon with its centroid.
        const g = f.geometry;
        const pt = L.points
          ? (g?.points?.[0] ?? (Number.isFinite(g?.x) && Number.isFinite(g?.y) ? [g.x, g.y] : null))
          : (f.centroid ? [f.centroid.x, f.centroid.y] : null);
        const entry = Number(f.attributes?.ListEntry);
        if (!pt || !Number.isFinite(entry) || !f.attributes?.Name) continue;
        rows.push([entry, L.layer, String(f.attributes.Name), f.attributes.Grade ?? null, Number(pt[1]), Number(pt[0]), loadId]);
      }
      for (let i = 0; i < rows.length; i += 500) {
        await insertBatch('heritage_entries', ['list_entry', 'layer', 'name', 'grade', 'lat', 'lng', 'load_id'], rows.slice(i, i + 500), 'on conflict do nothing');
      }
      got += rows.length;
      // A feature that did not become a row is a layer read wrongly, not a place.
      if (features.length && rows.length < features.length * 0.99) throw new Error(`${L.layer}: ${features.length - rows.length} of ${features.length} features had no name or point`);
      if (!features.length || (!page.exceededTransferLimit && features.length < 2000)) break;
    }
    // Every entry the list says it holds, or the layer is not loaded.
    if (got < count) throw new Error(`${L.layer}: ${got} of ${count} arrived`);
    total += got;
  }
  return total;
}

// ---------------------------------------------------------------------------
// OS Open Names: one zip of CSVs, grid references turned into latitude and longitude
// ---------------------------------------------------------------------------
export async function loadOsNames(loadId, fetcher = fetch) {
  const res = await fetcher(OS_NAMES, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20 * 60_000) });
  if (!res.ok) throw new Error(`OS Open Names answered ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  let total = 0;
  for (const { name, data } of zipEntries(zip)) {
    if (!/\.csv$/i.test(name) || /header/i.test(name)) continue;
    const rows = [];
    for (const line of data.toString('utf8').split(/\r?\n/)) {
      if (!line) continue;
      const c = parseCsvLine(line);
      // ID, NAMES_URI, NAME1, NAME1_LANG, NAME2, NAME2_LANG, TYPE, LOCAL_TYPE, GEOMETRY_X, GEOMETRY_Y, ...
      const [id, , name1, , , , type, localType, x, y] = c;
      if (!id || !name1 || !OS_TYPES.has(type) || OS_LOCAL_TYPES_OUT.has(localType)) continue;
      const e = Number(x); const n = Number(y);
      if (!Number.isFinite(e) || !Number.isFinite(n)) continue;
      const { lat, lng } = bngToWgs84(e, n);
      rows.push([id, name1, type, localType ?? null, lat, lng, loadId]);
    }
    for (let i = 0; i < rows.length; i += 500) {
      await insertBatch('os_names', ['id', 'name', 'type', 'local_type', 'lat', 'lng', 'load_id'], rows.slice(i, i + 500), 'on conflict do nothing');
    }
    total += rows.length;
  }
  return total;
}

/** A CSV line, with quoted fields and doubled quotes inside them. */
export function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * The files in a zip, read from its central directory. Stored and deflated
 * entries only, which is all a published dataset uses; anything else is said
 * rather than skipped.
 */
export function* zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < entries; k += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('a broken zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressed);
    if (method === 0) yield { name, data: raw };
    else if (method === 8) yield { name, data: inflateRawSync(raw) };
    else throw new Error(`${name}: a zip method (${method}) this reader does not know`);
  }
}

/**
 * British National Grid easting and northing to WGS84 latitude and longitude:
 * the inverse transverse Mercator on the Airy 1830 ellipsoid, then a Helmert
 * shift from OSGB36. Good to a few metres, which is well inside a place.
 */
export function bngToWgs84(E, N) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180, lon0 = (-2 * Math.PI) / 180, N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;
  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
    const Mb = (3 * n + 3 * n * n + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (N - N0 - M >= 0.00001);
  const cos = Math.cos(lat), sin = Math.sin(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
  const eta2 = nu / rho - 1;
  const tan = Math.tan(lat), tan2 = tan * tan, tan4 = tan2 * tan2, tan6 = tan4 * tan2;
  const sec = 1 / cos, nu3 = nu * nu * nu, nu5 = nu3 * nu * nu, nu7 = nu5 * nu * nu;
  const VII = tan / (2 * rho * nu);
  const VIII = (tan / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tan / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = sec / nu;
  const XI = (sec / (6 * nu3)) * (nu / rho + 2 * tan2);
  const XII = (sec / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (sec / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);
  const dE = E - E0, dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2, dE5 = dE4 * dE, dE6 = dE4 * dE2, dE7 = dE6 * dE;
  const phi = lat - VII * dE2 + VIII * dE4 - IX * dE6;
  const lambda = lon0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;
  // OSGB36 → WGS84 by Helmert, through Cartesian coordinates.
  const H = 0;
  const sinP = Math.sin(phi), cosP = Math.cos(phi), sinL = Math.sin(lambda), cosL = Math.cos(lambda);
  const nuA = a / Math.sqrt(1 - e2 * sinP * sinP);
  const x1 = (nuA + H) * cosP * cosL, y1 = (nuA + H) * cosP * sinL, z1 = ((1 - e2) * nuA + H) * sinP;
  const tx = 446.448, ty = -125.157, tz = 542.060, s = 20.4894e-6;
  const rx = ((0.1502 / 3600) * Math.PI) / 180, ry = ((0.2470 / 3600) * Math.PI) / 180, rz = ((0.8421 / 3600) * Math.PI) / 180;
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;
  const aW = 6378137, bW = 6356752.3142, e2W = 1 - (bW * bW) / (aW * aW);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let phiW = Math.atan2(z2, p * (1 - e2W));
  for (let i = 0; i < 10; i += 1) {
    const nuW = aW / Math.sqrt(1 - e2W * Math.sin(phiW) ** 2);
    phiW = Math.atan2(z2 + e2W * nuW * Math.sin(phiW), p);
  }
  return { lat: (phiW * 180) / Math.PI, lng: (Math.atan2(y2, x2) * 180) / Math.PI };
}
