/**
 * One-off: find the test/agent sessions that leaked into "Signed-in devices"
 * (Settings revised v2, data change #3). SX6 now filters the devices list to
 * `kind = 'device'` on the server, and new sessions are classified at creation.
 * The residue is OLD sessions that were written as `device` (or before the
 * `kind` column existed, defaulting in) but whose label reads like a script or
 * a coding session — "f4-scroll", "G9 agent refusal check", and the like.
 *
 * REPORT ONLY. It prints what it would reclassify to `agent` and stops — a
 * person applies the change to production (H1). Run with `--apply` only once the
 * counts have been read and agreed; even then it reclassifies (never deletes),
 * so a mistake is a flip of a column, not a lost row.
 *
 *   node scripts/settings-v2-test-session-cleanup.mjs           # report
 *   node scripts/settings-v2-test-session-cleanup.mjs --apply   # reclassify
 */
import '../apps/api/src/env.js';
import { query } from '../apps/api/src/db.js';

// The same shape auth.js uses to tell an automated session from a real device.
const AUTOMATED = /(scroll|refusal|check|probe|agent|playwright|puppeteer|headless|node-fetch|curl|smoke|e2e|test|repro|f\d|g\d|c\d{2})/i;

const apply = process.argv.includes('--apply');

const hasKind = (await query(
  `select 1 from information_schema.columns where table_name='api_sessions' and column_name='kind'`)).rows.length > 0;

if (!hasKind) {
  console.log('This database has no api_sessions.kind column yet — run migrations first. Nothing to do.');
  process.exit(0);
}

const live = `revoked_at is null and expires_at > now()`;
const byKind = (await query(`select kind, count(*)::int n from api_sessions where ${live} group by kind order by kind`)).rows;
console.log('Live sessions by kind:', byKind);

const candidates = (await query(
  `select id, label, account_id, created_at, last_seen_at
     from api_sessions
    where ${live} and kind = 'device'
    order by last_seen_at desc`)).rows
  .filter((s) => AUTOMATED.test(s.label ?? ''));

console.log(`\nDevice-kind sessions whose label reads automated: ${candidates.length}`);
for (const s of candidates) console.log(`  · ${s.label}  (last seen ${s.last_seen_at?.toISOString?.() ?? s.last_seen_at})`);

if (!candidates.length) { console.log('\nNothing to reclassify.'); process.exit(0); }

if (!apply) {
  console.log('\nREPORT ONLY. Re-run with --apply (after agreeing the list) to reclassify these to kind=agent. Nothing has changed.');
  process.exit(0);
}

const ids = candidates.map((s) => s.id);
const { rowCount } = await query(`update api_sessions set kind = 'agent' where id = any($1)`, [ids]);
console.log(`\nReclassified ${rowCount} sessions to kind=agent. They no longer appear in any household's devices.`);
process.exit(0);
