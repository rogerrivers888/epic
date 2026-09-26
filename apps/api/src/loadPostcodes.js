/**
 * Every live postcode in Great Britain, from the ONS, into `postcodes`.
 *
 *   npm run postcodes                # downloads the current ONSPD and loads it
 *   npm run postcodes -- /tmp/x.zip  # from an archive already on disk
 *
 * Run inside the API container (`railway ssh --service Epic-api -- npm run
 * postcodes -w @epic/api`), where the database is reachable and the archive —
 * 1.3 GB zipped, four unzipped — is streamed rather than kept. Nothing licensed
 * is involved: the ONS Postcode Directory is Open Government Licence v3.0,
 * with the OS and Royal Mail notices in migration 253.
 *
 * Streaming end to end: the archive is read entry by entry with yauzl, each
 * per-area CSV is parsed line by line, and rows go in five thousand at a time
 * as one insert. Terminated postcodes are skipped; a postcode with no usable
 * coordinate (the ONS writes 99.999999 for those) is skipped too. Re-runnable:
 * an existing postcode is moved rather than duplicated, and a run that stops
 * half way has loaded what it loaded.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { query, pool } from './db.js';

const require = createRequire(import.meta.url);
const yauzl = require('yauzl');

/** The ONS geoportal item for the current directory (August 2026). */
const ONSPD_URL = process.env.EPIC_ONSPD_URL
  || 'https://www.arcgis.com/sharing/rest/content/items/9e5a92a3cfb14dc7ad43d6ea7a7b8c7f/data';
const SOURCE = process.env.EPIC_ONSPD_SOURCE || 'onspd-2026-08';
const BATCH = 5000;

async function download(url, to) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`ONSPD download failed: ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(to));
  return to;
}

const openZip = (file) => new Promise((resolve, reject) => {
  yauzl.open(file, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
});
const openEntry = (zip, entry) => new Promise((resolve, reject) => {
  zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
});

async function insert(rows) {
  if (!rows.length) return;
  const pcds = [], sector = [], outcode = [], lat = [], lng = [];
  for (const r of rows) { pcds.push(r.pcds); sector.push(r.sector); outcode.push(r.outcode); lat.push(r.lat); lng.push(r.lng); }
  await query(
    `insert into postcodes (pcds, sector, outcode, lat, lng, source)
     select p, s, o, la, ln, $6 from unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[]) as u(p, s, o, la, ln)
     on conflict (pcds) do update set sector = excluded.sector, outcode = excluded.outcode,
       lat = excluded.lat, lng = excluded.lng, source = excluded.source, loaded_at = now()`,
    [pcds, sector, outcode, lat, lng, SOURCE]);
}

async function loadEntry(zip, entry, stats) {
  const stream = await openEntry(zip, entry);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null; let ix = null; let batch = [];
  for await (const line of lines) {
    if (!header) {
      header = line.split(',').map((h) => h.replace(/"/g, '').trim().toLowerCase());
      ix = { pcds: header.indexOf('pcds'), doterm: header.indexOf('doterm'), lat: header.indexOf('lat'), lng: header.indexOf('long') };
      if (Object.values(ix).some((i) => i < 0)) throw new Error(`${entry.fileName}: columns pcds, doterm, lat, long not all found`);
      continue;
    }
    // The ONSPD quotes every field; a straight split on commas is safe because
    // none of the four we read can contain one.
    const cols = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    stats.rows += 1;
    if (cols[ix.doterm]?.trim()) { stats.terminated += 1; continue; }
    const la = Number(cols[ix.lat]); const ln = Number(cols[ix.lng]);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || la > 90 || la === 0) { stats.unplaced += 1; continue; }
    const pcds = cols[ix.pcds].replace(/\s+/g, ' ').trim();
    const [out, inw] = pcds.split(' ');
    if (!out || !inw) { stats.unplaced += 1; continue; }
    batch.push({ pcds, sector: `${out} ${inw[0]}`, outcode: out, lat: la, lng: ln });
    if (batch.length >= BATCH) { await insert(batch); stats.loaded += batch.length; batch = []; }
  }
  await insert(batch); stats.loaded += batch.length;
}

export async function loadPostcodes(file) {
  const stats = { files: 0, rows: 0, loaded: 0, terminated: 0, unplaced: 0, retired: 0 };
  const startedAt = new Date();
  const zip = await openZip(file);
  await new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', (entry) => {
      const wanted = /^Data\/multi_csv\/.*\.csv$/i.test(entry.fileName);
      if (!wanted) { zip.readEntry(); return; }
      loadEntry(zip, entry, stats)
        .then(() => { stats.files += 1; console.log(`${entry.fileName}: ${stats.loaded.toLocaleString('en-GB')} loaded so far`); zip.readEntry(); })
        .catch(reject);
    });
    zip.on('end', resolve);
    zip.on('error', reject);
  });
  // A postcode this release no longer lists as live — terminated since the
  // last load, or gone — was skipped above and would otherwise stay in the
  // table for ever, placing boxes by a street that no longer answers (Codex,
  // 26 Sep 2026). Only after every file has been read, so a run that stopped
  // half way retires nothing.
  if (stats.files > 0) {
    const { rowCount } = await query('delete from postcodes where loaded_at < $1', [startedAt]);
    stats.retired = rowCount ?? 0;
  }
  return stats;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  (async () => {
    const given = process.argv[2];
    const file = given || await download(ONSPD_URL, path.join(os.tmpdir(), 'onspd.zip'));
    console.log(`loading ${file}`);
    const stats = await loadPostcodes(file);
    const { rows: [n] } = await query('select count(*)::int as n, count(distinct outcode)::int as outcodes, count(distinct sector)::int as sectors from postcodes');
    console.log({ ...stats, table: n });
    if (!given) fs.rmSync(file, { force: true });
    await pool.end();
  })().catch((err) => { console.error(err); process.exit(1); });
}
