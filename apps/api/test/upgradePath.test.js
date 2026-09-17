/**
 * The migrations apply to an installation that already has data in it.
 *
 * `helpers/db.js` proves they apply to an *empty* database, which is the case
 * that catches a typo. It does not catch the case that actually breaks a
 * deployment: the columns and rows an existing installation already has, and a
 * new migration that writes a child row before the parent table it points at
 * has been filled.
 *
 * That is exactly what happened (Codex, 17 Sep 2026). Migration 162 inserted
 * into `place_index_sources` for every researched `place_records` row, and
 * `place_index` is created empty by 142 — the rebuild that fills it runs after
 * every migration has passed. On an empty database there were no
 * `place_records` rows either, so nothing noticed.
 *
 * So this replays the real thing: everything up to the last migration before
 * the place index, a place with our own research on it, and then the rest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env'), quiet: true });
const BASE = process.env.DATABASE_URL || 'postgres://epic:epic@localhost:5434/epic';
const DB = 'epic_test_upgrade';

/** Where the place index begins: everything before it is "an existing installation". */
const INDEX_FROM = 142;

const urlFor = (database) => { const u = new URL(BASE); u.pathname = `/${database}`; return u.toString(); };

test('the migrations apply to an installation that already has research in it', async () => {
  const admin = new pg.Pool({ connectionString: urlFor('postgres') });
  try {
    await admin.query(`drop database if exists ${DB} with (force)`);
    await admin.query(`create database ${DB}`);
  } finally { await admin.end(); }

  const pool = new pg.Pool({ connectionString: urlFor(DB) });
  try {
    const dir = path.resolve(here, '../migrations');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const numberOf = (f) => Number(f.split('_')[0]);
    const before = files.filter((f) => numberOf(f) < INDEX_FROM);
    const after = files.filter((f) => numberOf(f) >= INDEX_FROM);
    assert.ok(before.length > 0 && after.length > 0, 'both halves exist');

    for (const f of before) {
      await pool.query(await fs.readFile(path.join(dir, f), 'utf8'))
        .catch((err) => { throw new Error(`${f} failed against an empty database: ${err.message}`); });
    }

    // What an existing installation has that an empty one does not: a place we
    // hold our own research on, and a household that has saved one.
    await pool.query(
      `insert into place_records (venue_ref, postcode, website, summary)
       values ('google:UPGRADE', 'SL4 1QN', 'https://example.org', 'A sentence of ours.')`);
    const { rows: [h] } = await pool.query(`insert into households (name) values ('Upgrading') returning id`);
    await pool.query(
      `insert into household_places (household_id, venue_ref, label, kind) values ($1, 'osm:node/42', 'Somewhere', 'saved')`,
      [h.id]);

    for (const f of after) {
      await pool.query(await fs.readFile(path.join(dir, f), 'utf8'))
        .catch((err) => { throw new Error(`${f} failed against an installation with data in it: ${err.message}`); });
    }

    // And the index is still empty, because filling it is the rebuild's job and
    // the rebuild runs after the migrations — which is the whole reason a
    // migration must not write a row that points into it.
    const { rows: [n] } = await pool.query('select count(*)::int as n from place_index');
    assert.equal(n.n, 0, 'a migration must not fill the index; buildIfEmpty does that at boot');
  } finally { await pool.end(); }
});
