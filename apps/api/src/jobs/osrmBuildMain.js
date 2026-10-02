/**
 * The osrm-build service's command (ops/osrm-build): one wake, then exit.
 *
 * Runs on a cron. Exits within seconds unless the owner has approved a build
 * (POST /admin/reach/osrm-build, the Approval card's action); when one is
 * approved it builds it — see jobs/osrmBuild.js.
 *
 * EPIC_OSRM_BBOX ("minLng,minLat,maxLng,maxLat") fences the build to a region,
 * for a regional extract in a trial run; production leaves it unset.
 */
import { pool } from '../db.js';
import { runOsrmBuildJob } from './osrmBuild.js';

const raw = (process.env.EPIC_OSRM_BBOX || '').trim();
let bbox = null;
if (raw) {
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (!(parts.length === 4 && parts.every(Number.isFinite) && parts[0] < parts[2] && parts[1] < parts[3])) {
    console.error(`EPIC_OSRM_BBOX must be four ordered numbers, not "${raw}".`);
    process.exit(1);
  }
  bbox = parts;
}

try {
  const out = await runOsrmBuildJob({ bbox });
  console.log('[osrm-build]', JSON.stringify(out));
} catch (err) {
  console.error('[osrm-build] failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
