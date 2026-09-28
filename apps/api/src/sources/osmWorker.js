/**
 * One open-map extract, loaded in its own process (osmExtract.loadRegion).
 * `node osmWorker.js <region> <who>`; exits 0 when the region is done.
 */
import { loadRegionHere } from './osmExtract.js';
import { pool } from '../db.js';

const [, , region, who] = process.argv;
try {
  const out = await loadRegionHere({ region, who });
  console.log(`osm extract ${region}: ${out.features} places`);
  await pool.end().catch(() => {});
  process.exit(0);
} catch (err) {
  console.error(`osm extract ${region}: ${err.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
