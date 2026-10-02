/**
 * The OSRM walking and cycling build, as a one-off job the owner approves.
 *
 * Owner, 1 Oct 2026: "Run the full-UK matrix build on Railway as a one-off
 * server job (temporarily larger instance if needed, torn down after), filed as
 * an Approval card with the expected cost and run time, so I approve with one
 * click."
 *
 * So the build has two halves that never meet except through one setting:
 *
 *   approve  POST /admin/reach/osrm-build (what the Approval card replays) marks
 *            `reach:osrm-build` approved. Nothing runs in the API.
 *   run      the `osrm-build` Railway service (ops/osrm-build) wakes on a cron,
 *            calls `runOsrmBuildJob`, and exits within seconds unless a build is
 *            approved. When one is, it claims it atomically, downloads the GB
 *            extract, and for each of walking and cycling builds the OSRM graph,
 *            stands `osrm-routed` up inside the container, writes the matrix
 *            (sources/osrmMatrix.js), stops the router and deletes that
 *            profile's graph before the next — about 12 GB of scratch disk at
 *            peak rather than 22. Then it recounts every ring counted before it
 *            finished, because a ring drawn from the old reach is stale (the
 *            race osrmMatrix.js recorded for whoever first runs the build), and
 *            marks the build done.
 *
 * OSRM is only ever up inside that container while it builds, and the service
 * can be stopped or deleted afterwards: the served path reads the stored rows.
 * Nothing here calls a paid provider.
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { pool, query } from '../db.js';
import { HORIZON_MINUTES, boundKm } from '../domain/reach.js';
import { allCells } from '../repositories/reach.js';
import { buildOsrmMode, osrmTable } from '../sources/osrmMatrix.js';

export const OSRM_BUILD_KEY = 'reach:osrm-build';

/** A run that has said `running` for this long without finishing died with its container. */
export const STALE_RUN_HOURS = 12;

/** The profiles, in the order they are built: OSRM's Lua profile and the matrix's mode. */
export const PROFILES = [
  { mode: 'walking', lua: '/opt/foot.lua', label: 'foot' },
  { mode: 'cycling', lua: '/opt/bicycle.lua', label: 'bike' },
];

/** The build's state, or `{ state: 'none' }` when nobody has asked for one. */
export async function osrmBuildState() {
  const { rows: [row] } = await query('select value, updated_at from bo_settings where key = $1', [OSRM_BUILD_KEY]);
  return row ? { ...row.value, updatedAt: row.updated_at } : { state: 'none' };
}

/** Write the state and its audit row in one transaction, serialised on the key. */
async function writeState(next, { who, expect = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [OSRM_BUILD_KEY]);
    const { rows: [prior] } = await client.query('select value from bo_settings where key = $1', [OSRM_BUILD_KEY]);
    const was = prior?.value ?? { state: 'none' };
    if (expect && !expect(was)) {
      await client.query('rollback');
      return { changed: false, was };
    }
    const value = { ...was, ...(typeof next === 'function' ? next(was) : next) };
    const { rows: [row] } = await client.query(
      `insert into bo_settings (key, value, version, updated_by, updated_at) values ($1, $2::jsonb, 1, $3, now())
       on conflict (key) do update set value = excluded.value, version = bo_settings.version + 1,
         updated_by = excluded.updated_by, updated_at = now()
       returning version`,
      [OSRM_BUILD_KEY, JSON.stringify(value), who]);
    await client.query(
      'insert into bo_settings_log (key, version, before, after, who) values ($1, $2, $3::jsonb, $4::jsonb, $5)',
      [OSRM_BUILD_KEY, row.version, JSON.stringify(was), JSON.stringify(value), who]);
    await client.query('commit');
    return { changed: true, was, value };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The Approval card's action: approve one build. Refused while one is running —
 * approving twice must not start two. A build that is done or failed may be
 * approved again (a rebuild, or a retry).
 */
export async function approveOsrmBuild({ by = null } = {}) {
  const who = String(by ?? '').trim() || 'unnamed caller';
  // A retry of a failed build resumes where it stopped; anything else — the
  // first build, or a rebuild after one finished — starts fresh, or every origin
  // would be skipped over its old marker and the rebuild would do nothing
  // (Codex). Read under the same lock the write takes.
  const out = await writeState(
    (was) => ({ state: 'approved', approvedBy: who, approvedAt: new Date().toISOString(), startedAt: null,
      finishedAt: null, why: null, result: null, resume: was.state === 'failed' }),
    { who, expect: (was) => was.state !== 'running' && was.state !== 'approved' },
  );
  if (!out.changed) {
    const err = new Error(out.was.state === 'running'
      ? 'An OSRM build is already running; it cannot be approved again until it finishes.'
      : 'An OSRM build is already approved and waiting for the build service to pick it up.');
    err.status = 409;
    throw err;
  }
  return out.value;
}

/** Claim the approved build for this run, atomically: two cron ticks cannot both start it. */
export async function claimOsrmBuild({ by = 'osrm-build service' } = {}) {
  const out = await writeState(
    { state: 'running', startedAt: new Date().toISOString(), runBy: by },
    { who: by, expect: (was) => was.state === 'approved' },
  );
  return out.changed ? out.value : null;
}

/** A `running` state older than STALE_RUN_HOURS is a container that died: say so, so it can be re-approved. */
export async function retireStaleRun({ now = Date.now(), by = 'osrm-build service' } = {}) {
  const out = await writeState(
    { state: 'failed', finishedAt: new Date(now).toISOString(), why: `stopped without finishing (no word for ${STALE_RUN_HOURS}h) — approve again to retry` },
    { who: by, expect: (was) => was.state === 'running' && was.startedAt && now - Date.parse(was.startedAt) > STALE_RUN_HOURS * 3600_000 },
  );
  return out.changed;
}

/** Run a command to completion, inheriting stdio; reject on a non-zero exit. */
export function run(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

/** Stand osrm-routed up over one graph; returns { url, stop }. */
export async function startRouted(graph, { port = 5055, fetchImpl = fetch, sample = null } = {}) {
  const child = spawn('osrm-routed', ['--algorithm', 'mld', '--port', String(port), '--max-table-size', '400', graph], { stdio: 'inherit' });
  const url = `http://127.0.0.1:${port}`;
  const stop = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
  const at = sample ?? { lat: 51.5, lng: -0.12 };
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode != null) throw new Error(`osrm-routed exited ${child.exitCode}`);
    try {
      const res = await fetchImpl(`${url}/nearest/v1/driving/${at.lng},${at.lat}`);
      if (res.ok && (await res.json()).code === 'Ok') return { url, stop };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error('osrm-routed did not become ready in 120s');
}

/** Fetch the extract to disk (skipped when it is already there). */
export async function download(url, dest, { fetchImpl = fetch } = {}) {
  const have = await stat(dest).catch(() => null);
  if (have && have.size > 0) return;
  // Into a temporary file, renamed only once it is whole: an interrupted
  // download must never leave a partial extract that a retry then trusts (Codex).
  const part = `${dest}.part`;
  await rm(part, { force: true });
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new Error(`extract download ${res.status}`);
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  } catch (err) {
    await rm(part, { force: true }).catch(() => {});
    throw err;
  }
  await rename(part, dest);
}

/**
 * One wake of the build service. Returns what it did:
 *   { ran: false, reason }   nothing approved (the ordinary tick), or retired a dead run
 *   { ran: true, result }    built both modes and recounted the rings
 * A failure inside the build is recorded as `failed` with its reason and rethrown.
 *
 * Every side of it is injectable so the state machine can be tested without OSRM.
 */
export async function runOsrmBuildJob({
  dataDir = process.env.EPIC_OSRM_DATA_DIR || '/data',
  extractUrl = process.env.EPIC_OSRM_EXTRACT_URL || 'https://download.geofabrik.de/europe/great-britain-latest.osm.pbf',
  horizon = HORIZON_MINUTES,
  bbox = null,
  deps = {},
} = {}) {
  const d = {
    claim: claimOsrmBuild, retire: retireStaleRun, record: writeState,
    download, run, startRouted, allCells, buildOsrmMode, osrmTable,
    recountRings: async (before) => (await import('../repositories/ringTables.js')).refreshAllBefore({ before }),
    rmrf: (p) => rm(p, { recursive: true, force: true }),
    log: (...a) => console.log('[osrm-build]', ...a),
    ...deps,
  };
  if (await d.retire()) return { ran: false, reason: 'retired a run that died' };
  const claimed = await d.claim();
  if (!claimed) return { ran: false, reason: 'nothing approved' };

  const t0 = Date.now();
  const result = { modes: {} };
  try {
    await mkdir(dataDir, { recursive: true });
    const pbf = path.join(dataDir, 'gb.osm.pbf');
    const resume = claimed.resume === true;
    // A fresh build takes today's extract; a retry may reuse the one it fetched.
    if (!resume) await d.rmrf(pbf);
    d.log(resume ? 'resuming a failed build' : 'fresh build', '— extract', extractUrl);
    await d.download(extractUrl, pbf);

    let cells = await d.allCells({ scheme: 'sector' });
    if (bbox) cells = cells.filter((c) => c.lng >= bbox[0] && c.lat >= bbox[1] && c.lng <= bbox[2] && c.lat <= bbox[3]);
    const sample = cells[Math.floor(cells.length / 2)] ?? null;

    for (const p of PROFILES) {
      const dir = path.join(dataDir, p.label);
      await d.rmrf(dir);
      await mkdir(dir, { recursive: true });
      const graph = path.join(dir, 'gb.osrm');
      // osrm-extract writes beside its input, so the extract is linked in.
      await d.run('ln', ['-f', pbf, path.join(dir, 'gb.osm.pbf')]);
      d.log(p.label, 'extract'); await d.run('osrm-extract', ['-p', p.lua, path.join(dir, 'gb.osm.pbf')]);
      d.log(p.label, 'partition'); await d.run('osrm-partition', [graph]);
      d.log(p.label, 'customize'); await d.run('osrm-customize', [graph]);
      // A trial over a regional box builds only the origins whose whole reach
      // stays inside it, routing to every cell in the box — a boundary origin is
      // never marked complete with its cross-boundary neighbours missing (the
      // same fence reach-osrm.mjs keeps). The production run is whole-GB.
      let origins = cells;
      if (bbox) {
        const km = boundKm(horizon, p.mode) * 1.5;
        const dLat = km / 111;
        const poleward = Math.max(Math.abs(bbox[1]), Math.abs(bbox[3]));
        const dLng = km / (111 * Math.cos((poleward * Math.PI) / 180));
        origins = cells.filter((c) => c.lng >= bbox[0] + dLng && c.lat >= bbox[1] + dLat
          && c.lng <= bbox[2] - dLng && c.lat <= bbox[3] - dLat);
      }
      const routed = await d.startRouted(graph, { sample });
      try {
        const out = await d.buildOsrmMode({
          mode: p.mode, cells, origins, table: d.osrmTable(routed.url, { profile: p.label }), horizon,
          resume, chunk: 300,
          onProgress: ({ done, of, pairs }) => d.log(p.mode, `${done}/${of}`, `${pairs} pairs`),
        });
        result.modes[p.mode] = { built: out.built, skipped: out.skipped, pairs: out.pairs, runId: out.runId };
      } finally {
        routed.stop();
      }
      // Its graph is ~10 GB at GB scale; gone before the next profile is built.
      await d.rmrf(dir);
    }

    // Every ring counted from the old reach is stale now. Recounted from the
    // finished matrix — the reconciliation a rebuild owes the ring tables.
    const before = new Date().toISOString();
    const rings = await d.recountRings(before);
    result.ringsRecounted = Array.isArray(rings) ? rings.length : null;
    result.minutes = Math.round((Date.now() - t0) / 60000);
    await d.record({ state: 'done', finishedAt: new Date().toISOString(), result, why: null }, { who: 'osrm-build service' });
    return { ran: true, result };
  } catch (err) {
    await d.record(
      { state: 'failed', finishedAt: new Date().toISOString(), why: String(err?.message ?? err).slice(0, 400), result },
      { who: 'osrm-build service' },
    ).catch(() => {});
    throw err;
  }
}
