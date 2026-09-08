// First, so .env is loaded and the old EPIC_* names are aliased before any
// module below reads one. See env.js.
import './env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

/** The number a migration file leads with: `017` of `017_scores_and_where.sql`. */
export const numberOf = (file) => file.slice(0, file.indexOf('_'));

/**
 * The files that have already collided, by name.
 *
 * Six numbers were used twice before there was anything to stop it. Every one of
 * these is applied wherever it matters, they order deterministically by full
 * filename, and renaming an applied file would make it run a second time — so
 * they are history.
 *
 * Named rather than numbered, because grandfathering the *number* would let a
 * new `030_anything.sql` in through the same door and recreate exactly the
 * divergence this guard exists to prevent (found by review, 4 Sep 2026).
 *
 * The list is explicit rather than derived from what a database has applied,
 * because "has this been applied" is a different answer in every environment:
 * an empty database has applied none of them, and a guard that inferred history
 * from that would refuse to build a database from scratch.
 */
const HISTORICAL_DUPLICATES = new Set([
  '009_favourites.sql', '009_timezone.sql',
  '019_prototype_reviews.sql', '019_retry_refused_where.sql',
  '021_home_radius.sql', '021_owned_places.sql',
  '028_group_setup.sql', '028_place_menus.sql',
  '029_home_country.sql', '029_research_version.sql',
  '030_group_cap.sql', '030_place_contents.sql',
]);

/**
 * Refuse a *new* migration whose number is already taken.
 *
 * Two files sharing a number is how two branches quietly disagree about the
 * order the schema was built in. It is caught here, while renumbering is still
 * free, rather than on the day two environments disagree.
 */
export function assertNoNewDuplicateNumbers(files) {
  const taken = new Map();
  for (const file of files) {
    const n = numberOf(file);
    if (!n) continue;
    const seen = taken.get(n);
    // Only a pair that is *both* on the list is history. A new file taking a
    // grandfathered number is the same mistake wearing an old number.
    if (seen && !(HISTORICAL_DUPLICATES.has(seen) && HISTORICAL_DUPLICATES.has(file))) {
      throw new Error(
        `two migrations share the number ${n}: ${seen} and ${file}. `
        + 'Renumber the new one — a duplicate number is how environments start disagreeing about the order.',
      );
    }
    if (!seen) taken.set(n, file);
  }
}

async function main() {
  await query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await query('select name from schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  assertNoNewDuplicateNumbers(files);

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
      ran += 1;
    } catch (err) {
      await client.query('rollback');
      console.error(`failed ${file}: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(ran === 0 ? 'migrations up to date' : `${ran} migration(s) applied`);
  await settleVisiting(pool);
  await pool.end();
}

/**
 * Whether the public may visit, decided once for a database that has never been
 * asked (migration 069, `domain/visiting.js`).
 *
 * The atlas is filtered on `visiting = 'yes'` before anything reaches a screen,
 * and the rule that sets it lives in JavaScript rather than SQL, so a migration
 * cannot backfill it. Nothing in a deploy ran it either: it is called by a
 * region harvest and by a back-office button, both of which somebody has to
 * start. On this production database that was done by hand and 89% of the atlas
 * is settled — but a restored backup, or a second environment, would come up
 * with every verdict null and therefore with an empty Inspire and empty county
 * pages, looking for all the world like a bug in the query (Codex, 8 Sep 2026).
 *
 * `visiting_by is null` is the test rather than `visiting is null`, because a
 * place the rule *considered* and could not settle is stored as a null verdict
 * with a reason. Those have been asked. This asks only about the ones that
 * never have, so a database that is already settled does no work at all.
 */
async function settleVisiting(pool) {
  let unasked = 0;
  try {
    const { rows } = await pool.query(
      `select count(*)::int as n from attractions
        where state = 'published' and visiting is null and visiting_by is null`);
    unasked = rows[0]?.n ?? 0;
  } catch {
    return;   // no atlas in this database yet; nothing to settle
  }
  if (!unasked) return;
  console.log(`${unasked} place(s) have never been asked whether you can visit — settling`);
  const { rejudgeVisiting } = await import('./repositories/library.js');
  const counts = await rejudgeVisiting({});
  console.log(`visiting settled: ${JSON.stringify(counts)}`);
}

// Only when run as a command. Imported — by a test, or by anything that wants
// `assertNoNewDuplicateNumbers` — this file must not migrate a database.
if (process.argv[1] && path.basename(process.argv[1]) === 'migrate.js') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
