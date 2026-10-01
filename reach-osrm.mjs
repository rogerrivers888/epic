/**
 * Stand OSRM up over an OSM extract, build the walking and cycling matrices,
 * tear OSRM down.
 *
 * Owner, 1 Oct 2026: "build OSRM walking and cycling on our GB OSM extract, as a
 * batch build (compute the matrices, then tear OSRM down, ~£0/month)."
 *
 * This is the operator's entry point; the matrix-writing core is
 * `apps/api/src/sources/osrmMatrix.js`. OSRM runs only while this script does:
 * it starts one `osrm-routed` container per profile, asks it the whole grid a
 * `/table` request at a time, writes the rows (`method = 'osrm'`), and stops the
 * container. Production never runs a router — the served path reads the stored
 * rows. The script is at the repo root and `.dockerignore`d (`/*.mjs`), so it is
 * the record in git and never ships in the image.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DO NOT POINT THIS AT PRODUCTION BY HAND. Walking is already a live travel mode
 * on Inspire, and until the read path consumes routed times — the display fence
 * (`domain/band.js#fenceToBand`), the `/reach/from` provenance, and the guard
 * that stops the estimator refresh writing `estimate` edges into an OSRM-owned
 * mode — a production matrix would make the counts disagree with the list. The
 * production build runs as a gated one-off Railway job behind an Approval card
 * (owner, 1 Oct 2026: a larger instance if needed, torn down after, its cost and
 * run time on the card). This stays the local and regional tool, and the shared
 * core the Railway job calls.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Before running it, build the `.osrm` files once per profile (needs real RAM;
 * the whole-GB extract wants ~16GB for `osrm-extract`, so do it on a machine
 * with it, or a region at a time):
 *
 *   docker run --rm -v $DIR:/data $IMG osrm-extract   -p /opt/foot.lua    /data/<x>.pbf
 *   docker run --rm -v $DIR:/data $IMG osrm-partition                     /data/<x>.osrm
 *   docker run --rm -v $DIR:/data $IMG osrm-customize                     /data/<x>.osrm
 *   (repeat with /opt/bicycle.lua into a second dir for cycling)
 *
 * Then:
 *
 *   EPIC_OSRM_DATA_WALKING=$DIR_FOOT/<x>.osrm \
 *   EPIC_OSRM_DATA_CYCLING=$DIR_BIKE/<x>.osrm \
 *   node reach-osrm.mjs both
 *
 * Cells OSRM cannot route to (off the extract, an island with no path) are
 * dropped, never written as zero — so a regional extract honestly builds only
 * the cells it covers, and the full-GB build fills the rest. Resumable: an
 * origin already built to the horizon by OSRM is skipped.
 *
 * Usage: node reach-osrm.mjs [walking|cycling|both]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { query, pool } from './apps/api/src/db.js';
import { allCells } from './apps/api/src/repositories/reach.js';
import { HORIZON_MINUTES, boundKm } from './apps/api/src/domain/reach.js';
import { osrmTable, buildOsrmMode } from './apps/api/src/sources/osrmMatrix.js';

const IMAGE = process.env.EPIC_OSRM_IMAGE || 'ghcr.io/project-osrm/osrm-backend:latest';
const PORT = Number(process.env.EPIC_OSRM_PORT || 5055);
const SCHEME = process.env.EPIC_OSRM_SCHEME || 'sector';
const HORIZON = Number(process.env.EPIC_OSRM_HORIZON || HORIZON_MINUTES);
const RESUME = process.env.EPIC_OSRM_RESUME !== '0';
const CHUNK = Number(process.env.EPIC_OSRM_CHUNK || 300);
// The chunk is the destination-loop stride; zero or a non-integer would step
// `j += 0` and spin forever on the first origin with candidates (Codex). The
// horizon has to be a real positive number of minutes for the same reason.
if (!Number.isInteger(CHUNK) || CHUNK < 1) {
  console.error(`EPIC_OSRM_CHUNK must be a positive integer, not "${process.env.EPIC_OSRM_CHUNK}".`);
  process.exit(1);
}
if (!Number.isFinite(HORIZON) || HORIZON < 1) {
  console.error(`EPIC_OSRM_HORIZON must be a positive number, not "${process.env.EPIC_OSRM_HORIZON}".`);
  process.exit(1);
}
const PROFILE = { walking: 'foot', cycling: 'bike' };
const DATA = { walking: process.env.EPIC_OSRM_DATA_WALKING, cycling: process.env.EPIC_OSRM_DATA_CYCLING };
// A regional extract routes honestly only for cells inside it: OSRM snaps a
// coordinate off the extract to the nearest node it *does* hold, which invents a
// time rather than refusing one. So when building from a region (not whole-GB),
// fence the cells to its bounding box — "minLng,minLat,maxLng,maxLat" — and the
// rest of the grid is left for the build that covers it.
//
// A present-but-malformed box is refused, never quietly ignored: dropping the
// bad components and falling back to "no fence" would build every GB origin
// against a regional router, and OSRM would snap them in and mark the invented
// rows complete (Codex). Absent (unset/empty) is the only thing that means
// whole-GB; anything else must be four ordered numbers.
const rawBbox = (process.env.EPIC_OSRM_BBOX || '').trim();
let BBOX = [];
if (rawBbox) {
  const parts = rawBbox.split(',').map((s) => Number(s.trim()));
  const ok = parts.length === 4 && parts.every((n) => Number.isFinite(n))
    && parts[0] < parts[2] && parts[1] < parts[3];
  if (!ok) {
    console.error(`EPIC_OSRM_BBOX must be "minLng,minLat,maxLng,maxLat" — four ordered numbers — not "${rawBbox}".`);
    process.exit(1);
  }
  BBOX = parts;
}
const inBbox = BBOX.length === 4
  ? (c) => c.lng >= BBOX[0] && c.lat >= BBOX[1] && c.lng <= BBOX[2] && c.lat <= BBOX[3]
  : () => true;

const want = (process.argv[2] || 'both').toLowerCase();
const modes = want === 'both' ? ['walking', 'cycling'] : [want];
for (const m of modes) {
  if (!PROFILE[m]) { console.error(`Unknown mode "${m}" — walking, cycling or both.`); process.exit(1); }
  if (!DATA[m]) { console.error(`Set EPIC_OSRM_DATA_${m.toUpperCase()} to the ${PROFILE[m]} .osrm base.`); process.exit(1); }
  // The `.osrm` path is a base; the files on disk are `<base>.mldgr` and the
  // rest. `.fileIndex` is written by osrm-extract for any dataset, so it is the
  // one that says "this was built."
  if (!existsSync(`${DATA[m]}.fileIndex`)) { console.error(`No OSRM data at ${DATA[m]}.* — build it first (see the header).`); process.exit(1); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The router is started detached, so `--rm` only clears it once it stops — and
// a `finally` does not run on SIGINT/SIGTERM. Without this, interrupting a long
// resumable batch would leave osrm-routed alive, holding the port so the resumed
// run cannot start (Codex). Track the live container and stop it on the way out.
let liveContainer = null;
const stopLive = () => {
  if (liveContainer) {
    try { execFileSync('docker', ['stop', liveContainer], { stdio: 'ignore' }); } catch { /* already gone */ }
    liveContainer = null;
  }
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopLive(); process.exit(130); });
}

/** Start osrm-routed for a profile's data, return its container id. */
function startRouted(dataBase) {
  // Resolve to absolute first: Docker reads `-v data/foo:/data` (a relative
  // path) as a named volume, which may not contain a slash, so the documented
  // relative invocation would fail at the mount though existsSync passed (Codex).
  const abs = path.resolve(dataBase);
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const id = execFileSync('docker', [
    'run', '-d', '--rm', '-p', `127.0.0.1:${PORT}:5000`, '-v', `${dir}:/data`,
    IMAGE, 'osrm-routed', '--algorithm', 'mld', '--max-table-size', String(CHUNK + 50), `/data/${base}`,
  ], { encoding: 'utf8' }).trim();
  return id;
}

/** Wait until the router answers a /nearest, or give up. */
async function waitReady(sampleCell) {
  const url = `http://127.0.0.1:${PORT}/nearest/v1/driving/${sampleCell.lng},${sampleCell.lat}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) { const b = await res.json(); if (b.code === 'Ok') return true; }
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  return false;
}

async function run() {
  const all = await allCells({ scheme: SCHEME });
  if (!all.length) { console.error(`No cells for scheme "${SCHEME}".`); process.exit(1); }
  const cells = all.filter(inBbox);
  if (!cells.length) { console.error('The bounding box left no cells.'); process.exit(1); }
  const sample = cells[Math.floor(cells.length / 2)];
  console.log(`${cells.length}/${all.length} cells${BBOX.length === 4 ? ' in bbox' : ''}, horizon ${HORIZON} min, resume ${RESUME ? 'on' : 'off'}.`);

  for (const mode of modes) {
    let container = null;
    const t0 = Date.now();
    console.log(`\n== ${mode} (${PROFILE[mode]}) ==`);
    // A regional (bbox) build must not mark a boundary origin complete when its
    // reach crosses out of the extract: route to every cell in the box, but
    // build *from* only the origins whose whole horizon stays inside it, by the
    // same wide bound the candidate search uses (Codex, P1). The rest are left
    // for the build that covers them. Whole-GB (no bbox) builds every origin.
    let origins = cells;
    if (BBOX.length === 4) {
      const km = boundKm(HORIZON, mode) * 1.5;
      const dLat = km / 111;
      // A degree of longitude is shortest at the poleward edge of the box, so
      // the margin taken there is the one that holds everywhere in it — a
      // midpoint cosine would leave the top edge short (Codex).
      const poleward = Math.max(Math.abs(BBOX[1]), Math.abs(BBOX[3]));
      const dLng = km / (111 * Math.cos((poleward * Math.PI) / 180));
      origins = cells.filter((c) => c.lng >= BBOX[0] + dLng && c.lat >= BBOX[1] + dLat
        && c.lng <= BBOX[2] - dLng && c.lat <= BBOX[3] - dLat);
      console.log(`  ${origins.length} interior origins (of ${cells.length} in box), routing to all ${cells.length}`);
    }
    try {
      container = startRouted(DATA[mode]);
      liveContainer = container;
      console.log(`osrm-routed ${container.slice(0, 12)} on :${PORT}, waiting…`);
      if (!(await waitReady(sample))) throw new Error('osrm-routed did not become ready in 60s');
      const table = osrmTable(`http://127.0.0.1:${PORT}`, { profile: PROFILE[mode] });
      const res = await buildOsrmMode({
        mode, cells, origins, table, horizon: HORIZON, scheme: SCHEME, resume: RESUME, chunk: CHUNK,
        onProgress: ({ done, of, built, skipped, pairs }) =>
          console.log(`  ${done}/${of} (built ${built}, skipped ${skipped}, ${pairs} pairs)`),
      });
      const secs = Math.round((Date.now() - t0) / 1000);
      console.log(`  done: built ${res.built}, skipped ${res.skipped}, ${res.pairs} pairs in ${secs}s (run ${res.runId}).`);
    } finally {
      stopLive();
    }
  }
  await pool.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
