// First: it loads .env and aliases the old EPIC_* variables onto their EPIC_*
// names before anything reads one. See env.js.
import './env.js';
import pg from 'pg';

// DATE columns come back as 'YYYY-MM-DD', not a local-midnight Date that shifts with timezone.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://epic:epic@localhost:5432/epic',
  // The driver's default is ten, which is right for one server and wrong for
  // eighty-eight test files. `node --test` runs about ten at once and each one
  // imports this module, so a single suite reaches Postgres's hundred on its
  // own and two sessions testing together go past it: thirty unrelated
  // database-backed files fail at once and every one of them passes alone
  // (21 Sep 2026). A test file queries in sequence and needs two.
  max: process.env.NODE_ENV === 'test' || process.env.EPIC_TEST_POOL ? 2 : 10,
});

export const query = (text, params) => pool.query(text, params);

/**
 * Is the database answering?
 *
 * The one statement outside `repositories/` on purpose: it is not a question
 * about anything the household owns, it is the connection saying it is alive,
 * and it belongs with the pool it is testing.
 */
export const ping = () => pool.query('select 1');

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
