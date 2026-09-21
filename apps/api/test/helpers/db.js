/**
 * A database of its own, built from the migrations, for the tests to ruin.
 *
 * Never the development database. These tests delete households to prove the
 * cascades behave, and the local `epic` database is somebody's working copy —
 * so this creates `epic_test` beside it, runs every migration into it from
 * nothing, and hands back a pool pointed at that.
 *
 * Building it from the migration files is half the point: "the migrations apply
 * cleanly from an empty database" is the one thing a deploy depends on and
 * nothing else here checks.
 *
 * From the committed ones only — see `migrationFiles`. What a deploy applies is
 * what is on the branch, so that is what the tests have to be built from; a
 * `.sql` sitting untracked in somebody's working copy is not part of the
 * product yet and must not decide whether anybody else's tests run.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../../.env'), quiet: true });

const BASE = process.env.DATABASE_URL || 'postgres://epic:epic@localhost:5434/epic';
const run = promisify(execFile);

/**
 * The migrations this branch actually has, which is not the same as the `.sql`
 * files on disk.
 *
 * Reading the directory meant a migration somebody had written and not yet
 * committed was applied to *everybody's* test database. On 21 Sep 2026 one of
 * mine was broken and took 22 test files down across every session on the
 * machine, each of them failing at the build step before running a single
 * assertion — and none of the failures were theirs to read. An uncommitted
 * migration is one session's work in progress and should cost the others
 * nothing.
 *
 * So: `git ls-files`, and anything untracked is named out loud rather than
 * silently skipped. Silence would be its own trap — the author would be testing
 * against a database that does not have their migration in it and would have no
 * way to know.
 */
let listed = null;
async function migrationFiles(dir) {
  // Worked out once per process. `node --test` gives each test file its own
  // process, so this is one `git` call per file rather than per database — but
  // a file that builds more than one database should not pay for it twice, and
  // on a machine running several sessions' suites at once every spawn avoided
  // is contention avoided.
  if (listed) return listed;
  let tracked;
  try {
    const { stdout } = await run('git', ['ls-files', '--', 'migrations'], { cwd: path.resolve(dir, '..') });
    tracked = new Set(stdout.split('\n').map((f) => path.basename(f.trim())).filter((f) => f.endsWith('.sql')));
  } catch {
    // No git, or not a checkout: fall back to the directory rather than
    // refusing to run at all. A CI image without .git still has to test.
    listed = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    return listed;
  }
  const onDisk = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql'));
  const skipped = onDisk.filter((f) => !tracked.has(f)).sort();
  if (skipped.length) {
    // One line, once, naming them: whoever wrote them needs to know their work
    // is not in the database they are about to test against.
    console.warn(`[test db] skipping ${skipped.length} uncommitted migration${skipped.length === 1 ? '' : 's'}: ${skipped.join(', ')} — commit to include`);
  }
  listed = onDisk.filter((f) => tracked.has(f)).sort();
  return listed;
}

/**
 * One database per test file.
 *
 * `node --test` runs files in parallel, and two of them dropping and rebuilding
 * the same database is a race that fails in a different place every time. The
 * name comes from the file being run, so the suites cannot collide and a
 * leftover from a crashed run is reused rather than accumulating.
 */
const suite = (process.argv[1] || 'suite').split('/').pop().replace(/\.test\.js$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
const TEST_DB = process.env.EPIC_TEST_DB || `epic_test_${suite}`;

const urlFor = (database) => {
  const u = new URL(BASE);
  u.pathname = `/${database}`;
  return u.toString();
};

let ready = null;

/**
 * The test database, migrated and empty. Safe to call from every test file:
 * the work happens once per process.
 */
export function testDatabase() {
  if (ready) return ready;
  ready = (async () => {
    // `postgres` is the database that always exists; connect there to make ours.
    const admin = new pg.Pool({ connectionString: urlFor('postgres') });
    try {
      await admin.query(`drop database if exists ${TEST_DB} with (force)`);
      await admin.query(`create database ${TEST_DB}`);
    } finally {
      await admin.end();
    }

    // Everything downstream reads DATABASE_URL when it is first imported, so it
    // is set before any of it is.
    process.env.DATABASE_URL = urlFor(TEST_DB);

    const { pool, query, withTransaction } = await import('../../src/db.js');
    const dir = path.resolve(here, '../../migrations');
    const files = await migrationFiles(dir);
    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      try {
        await query(sql);
      } catch (err) {
        throw new Error(`migration ${file} failed against an empty database: ${err.message}`);
      }
    }
    return { pool, query, withTransaction, migrations: files.length };
  })();
  return ready;
}

/** A household with one member, enough to hang a visit and a rating from. */
export async function aHousehold(query, name = `test-${Math.random().toString(36).slice(2, 8)}`) {
  const { rows: [household] } = await query('insert into households (name) values ($1) returning *', [name]);
  const { rows: [member] } = await query(
    'insert into members (household_id, name, is_minor) values ($1, $2, false) returning *',
    [household.id, 'Test person'],
  );
  return { household, member };
}
