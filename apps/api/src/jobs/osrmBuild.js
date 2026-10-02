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
 *            approved. When one is, it claims it atomically, downloads the UK
 *            extract, and for each of walking and cycling builds the OSRM graph,
 *            stands `osrm-routed` up inside the container, writes the matrix
 *            (sources/osrmMatrix.js), stops the router and deletes that
 *            profile's graph before the next — about 12 GB of scratch disk at
 *            peak rather than 22. Then it recounts exactly the walking and
 *            cycling rings the build affected — those that existed before it and
 *            any counted from the old reach while it ran (the race osrmMatrix.js
 *            recorded for whoever first runs the build) — and marks it done.
 *            Driving rings are not touched.
 *
 * Each build has an epoch (when it began). A retry after a failure keeps it and
 * resumes over only what that build wrote; a first build or a rebuild gets a
 * new one, so no origin is skipped over an older build's marker.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

/** The walking/cycling ring keys a build owes a recount, kept where a retry can find them. */
export const OSRM_RINGS_KEY = 'reach:osrm-build:rings';

const ringId = (k) => `${k.cell}|${k.mode}|${k.minutes}`;
const fromRingId = (id) => { const [cell, mode, minutes] = id.split('|'); return { cell, mode, minutes: Number(minutes) }; };

/** A run that has said `running` for this long without finishing died with its container. */
export const STALE_RUN_HOURS = 12;

/** The profiles, in the order they are built: OSRM's Lua profile and the matrix's mode. */
export const PROFILES = [
  { mode: 'walking', lua: '/opt/foot.lua', label: 'foot' },
  { mode: 'cycling', lua: '/opt/bicycle.lua', label: 'bike' },
];

/**
 * The owed-a-recount set: ring key -> the run that last owed it. A key re-added
 * by a newer run carries that run, so an older run finishing its recount cannot
 * forget an obligation the newer one renewed (Codex).
 */
export async function rememberRings(keys, run, q = query) {
  const map = Object.fromEntries((keys ?? []).map((k) => [ringId(k), String(run)]));
  if (!Object.keys(map).length) return;
  await q(
    `insert into bo_settings (key, value, version, updated_by, updated_at)
     values ($1, jsonb_build_object('rings', $2::jsonb), 1, 'osrm-build service', now())
     on conflict (key) do update set
       value = jsonb_build_object('rings', coalesce(bo_settings.value->'rings', '{}'::jsonb) || $2::jsonb),
       version = bo_settings.version + 1, updated_at = now()`,
    [OSRM_RINGS_KEY, JSON.stringify(map)]);
}

/** The owed set, each key with the run that owes it. */
export async function pendingRings() {
  const { rows: [row] } = await query('select value from bo_settings where key = $1', [OSRM_RINGS_KEY]);
  return Object.entries(row?.value?.rings ?? {}).map(([id, run]) => ({ ...fromRingId(id), run }));
}

/** Forget recounted entries — each only if it is still owed by the run it was read with. */
export async function forgetRings(entries) {
  const list = (entries ?? []).map((e) => [ringId(e), String(e.run)]);
  if (!list.length) return;
  await query(
    `update bo_settings set value = jsonb_build_object('rings', coalesce((
       select jsonb_object_agg(e.k, e.v)
         from jsonb_each(coalesce(value->'rings', '{}'::jsonb)) as e(k, v)
        where (e.k, e.v #>> '{}') not in (select * from unnest($2::text[], $3::text[]))), '{}'::jsonb)),
       updated_at = now()
      where key = $1`,
    [OSRM_RINGS_KEY, list.map((x) => x[0]), list.map((x) => x[1])]);
}

/** Recount what is owed, forgetting only what was recounted. Returns { done, failed }. */
async function settleOwed(d) {
  const owed = await d.pendingRings();
  const done = [];
  for (const k of owed) {
    try { await d.recountRing({ cell: k.cell, mode: k.mode, minutes: k.minutes }); done.push(k); } catch (err) {
      d.log('ring recount failed (stays owed)', ringId(k), String(err?.message ?? err));
    }
  }
  await d.forgetRings(done);
  return { done: done.length, failed: owed.length - done.length };
}

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
    // The database's clock, the one cell_builds.at and ring_counts.computed_at
    // are stamped with: an epoch or a cutoff from the worker's own clock would
    // be compared against times it did not set (Codex).
    const { rows: [{ now }] } = await client.query('select now() as now');
    if (expect && !expect(was)) {
      await client.query('rollback');
      return { changed: false, was };
    }
    const value = { ...was, ...(typeof next === 'function' ? next(was, new Date(now).toISOString()) : next) };
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
  // A retry keeps the failed build's epoch (when it began), so it resumes over
  // only what that build itself wrote; anything else gets a new epoch at claim.
  const out = await writeState(
    (was) => {
      const retry = was.state === 'failed' && Boolean(was.epoch);
      return { state: 'approved', approvedBy: who, approvedAt: new Date().toISOString(), startedAt: null,
        finishedAt: null, why: null, result: null, retry, epoch: retry ? was.epoch : null };
    },
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
    // A fresh heartbeat with the claim: the state is merged with the last run's,
    // and its old heartbeat must not make this run look silent (Codex).
    (was, now) => ({ state: 'running', startedAt: now, heartbeatAt: now, runBy: by, runId: randomUUID(), epoch: was.epoch ?? now }),
    { who: by, expect: (was) => was.state === 'approved' },
  );
  return out.changed ? out.value : null;
}

/**
 * The running build's heartbeat: a light in-place stamp (not an audit row — no
 * human changed anything), only while this run still holds the build. A long
 * build that is still working is never retired for having started long ago
 * (Codex).
 */
export async function heartbeat(runId) {
  await query(
    `update bo_settings set value = jsonb_set(value, '{heartbeatAt}', to_jsonb(now())), updated_at = now()
      where key = $1 and value->>'state' = 'running' and value->>'runId' = $2`,
    [OSRM_BUILD_KEY, String(runId)]);
}

/** A `running` state not heard from for STALE_RUN_HOURS is a container that died: say so, so it can be re-approved. */
export async function retireStaleRun({ now = Date.now(), by = 'osrm-build service' } = {}) {
  const out = await writeState(
    { state: 'failed', finishedAt: new Date(now).toISOString(), why: `stopped without finishing (no word for ${STALE_RUN_HOURS}h) — approve again to retry` },
    { who: by, expect: (was) => was.state === 'running' && (was.heartbeatAt || was.startedAt)
      && now - Date.parse(was.heartbeatAt || was.startedAt) > STALE_RUN_HOURS * 3600_000 },
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
  // The UK extract, Northern Ireland included: the sector grid has every BT
  // sector, and a Great-Britain-only extract would snap them onto GB roads and
  // invent their routes (Codex). Geofabrik publishes Great Britain and
  // Ireland-with-Northern-Ireland separately; openstreetmap.fr publishes the
  // United Kingdom as one file — the 2.4 GB extract this build was measured on
  // (1 Oct 2026). EPIC_OSRM_EXTRACT_URL overrides it.
  extractUrl = process.env.EPIC_OSRM_EXTRACT_URL || 'https://download.openstreetmap.fr/extracts/europe/united_kingdom-latest.osm.pbf',
  horizon = HORIZON_MINUTES,
  bbox = null,
  // How long to wait before a second sweep for ring counts that were already
  // under way in another process when the build finished (Codex): longer than a
  // ring refresh takes.
  graceMs = 5 * 60_000,
  deps = {},
} = {}) {
  const d = {
    claim: claimOsrmBuild, retire: retireStaleRun, record: writeState,
    download, run, startRouted, allCells, buildOsrmMode, osrmTable,
    rememberRings, pendingRings, forgetRings, state: osrmBuildState, heartbeat,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ringKeys: async ({ before = null, scope = null } = {}) => (await query(
      `select distinct cell, mode, minutes from ring_counts
        where mode in ('walking', 'cycling') and ($1::timestamptz is null or computed_at < $1::timestamptz)
          and ($2::text[] is null or (cell || '|' || mode) = any($2::text[]))`,
      [before, scope])).rows,
    recountRing: async (k) => (await import('../repositories/ringTables.js')).refreshRing({ ...k, force: true }),
    rmrf: (p) => rm(p, { recursive: true, force: true }),
    log: (...a) => console.log('[osrm-build]', ...a),
    ...deps,
  };
  if (await d.retire()) return { ran: false, reason: 'retired a run that died' };
  const claimed = await d.claim();
  if (!claimed) {
    // An idle wake settles any ring recount a finished build still owes (one
    // that failed transiently), so it is never stranded until the next build
    // (Codex). Not while a build is running — it will settle its own.
    if ((await d.state()).state !== 'running' && (await d.pendingRings()).length) {
      const owed = await settleOwed(d);
      return { ran: false, reason: 'settled owed ring recounts', ...owed };
    }
    return { ran: false, reason: 'nothing approved' };
  }

  const t0 = Date.now();
  const result = { modes: {} };
  try {
    await mkdir(dataDir, { recursive: true });
    const pbf = path.join(dataDir, 'gb.osm.pbf');
    const retry = claimed.retry === true;
    // A fresh build takes today's extract; a retry may reuse the one it fetched.
    if (!retry) await d.rmrf(pbf);
    d.log(retry ? `resuming the build begun ${claimed.epoch}` : 'fresh build', '— extract', extractUrl);
    // The walking and cycling rings that exist now are the ones this build
    // will make stale; their keys are kept so exactly those are recounted at
    // the end, even though the build drops each one as its origin is rebuilt.
    await d.download(extractUrl, pbf);

    let cells = await d.allCells({ scheme: 'sector' });
    if (bbox) cells = cells.filter((c) => c.lng >= bbox[0] && c.lat >= bbox[1] && c.lng <= bbox[2] && c.lat <= bbox[3]);
    const sample = cells[Math.floor(cells.length / 2)] ?? null;
    // The origins each mode rebuilds: every cell for the whole-UK build; for a
    // regional trial only those whose whole reach stays inside the box, routing
    // to every cell in it, so a boundary origin is never marked complete with
    // its cross-boundary neighbours missing (the fence reach-osrm.mjs keeps).
    const originsByMode = Object.fromEntries(PROFILES.map((p) => {
      if (!bbox) return [p.mode, cells];
      const km = boundKm(horizon, p.mode) * 1.5;
      const dLat = km / 111;
      const poleward = Math.max(Math.abs(bbox[1]), Math.abs(bbox[3]));
      const dLng = km / (111 * Math.cos((poleward * Math.PI) / 180));
      return [p.mode, cells.filter((c) => c.lng >= bbox[0] + dLng && c.lat >= bbox[1] + dLat
        && c.lng <= bbox[2] - dLng && c.lat <= bbox[3] - dLat)];
    }));
    // A regional trial only touches its own origins' rings, so it only owes those
    // (Codex); the whole-UK build owes every walking and cycling ring.
    const scope = bbox ? PROFILES.flatMap((p) => originsByMode[p.mode].map((c) => `${c.code}|${p.mode}`)) : null;
    // Persisted, not held in memory, so a retry after a failure still owes them.
    await d.rememberRings(await d.ringKeys({ scope }), claimed.runId);

    for (const p of PROFILES) {
      const dir = path.join(dataDir, p.label);
      await d.rmrf(dir);
      await mkdir(dir, { recursive: true });
      const graph = path.join(dir, 'gb.osrm');
      // osrm-extract writes beside its input, so the extract is linked in.
      await d.run('ln', ['-f', pbf, path.join(dir, 'gb.osm.pbf')]);
      const beat = () => d.heartbeat(claimed.runId).catch(() => {});
      await beat(); d.log(p.label, 'extract'); await d.run('osrm-extract', ['-p', p.lua, path.join(dir, 'gb.osm.pbf')]);
      await beat(); d.log(p.label, 'partition'); await d.run('osrm-partition', [graph]);
      await beat(); d.log(p.label, 'customize'); await d.run('osrm-customize', [graph]);
      await beat();
      const origins = originsByMode[p.mode];
      const routed = await d.startRouted(graph, { sample });
      try {
        const out = await d.buildOsrmMode({
          mode: p.mode, cells, origins, table: d.osrmTable(routed.url, { profile: p.label }), horizon,
          resume: true, since: claimed.epoch, chunk: 300,
          onRingsDropped: (keys, q) => d.rememberRings(keys, claimed.runId, q),
          onProgress: ({ done, of, pairs }) => { d.log(p.mode, `${done}/${of}`, `${pairs} pairs`); void beat(); },
        });
        result.modes[p.mode] = { built: out.built, skipped: out.skipped, pairs: out.pairs, runId: out.runId };
      } finally {
        routed.stop();
      }
      // Its graph is ~10 GB at GB scale; gone before the next profile is built.
      await d.rmrf(dir);
    }

    // Recount exactly the walking and cycling rings this build affected — the
    // ones that existed before it, and any counted while it ran from the reach
    // it was replacing (the race osrmMatrix.js recorded). Driving is untouched
    // by this build and is not recounted (Codex).
    // The cutoff on the database's clock — ring counts are stamped with it.
    const finished = new Date((await query('select now() as at')).rows[0].at).toISOString();
    await d.rememberRings(await d.ringKeys({ before: finished, scope }), claimed.runId);
    const first = await settleOwed(d);
    // A ring count another process had already begun from the old reach can
    // commit after that sweep; it is stamped with when it began, so a second
    // sweep after the grace period finds it by `computed_at < finished` and
    // nothing just recounted (stamped after) is touched again (Codex).
    if (graceMs > 0) await d.sleep(graceMs);
    await d.rememberRings(await d.ringKeys({ before: finished, scope }), claimed.runId);
    const second = await settleOwed(d);
    result.ringsRecounted = first.done + second.done;
    result.ringsStillOwed = second.failed;
    result.minutes = Math.round((Date.now() - t0) / 60000);
    const mine = (was) => was.state === 'running' && was.runId === claimed.runId;
    const rec = await d.record({ state: 'done', finishedAt: new Date().toISOString(), result, why: null }, { who: 'osrm-build service', expect: mine });
    if (rec && rec.changed === false) d.log('this run was superseded; its result is not recorded over the newer one');
    return { ran: true, result };
  } catch (err) {
    // Only over this run's own `running` state: a run retired for silence and
    // replaced must never write its ending over the newer build's (Codex).
    await d.record(
      { state: 'failed', finishedAt: new Date().toISOString(), why: String(err?.message ?? err).slice(0, 400), result },
      { who: 'osrm-build service', expect: (was) => was.state === 'running' && was.runId === claimed.runId },
    ).catch(() => {});
    throw err;
  }
}
