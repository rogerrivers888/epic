/**
 * The postcode directory, kept current.
 *
 * Owner, 26 Sep 2026: "Schedule the ONS refresh. A quarterly source nobody
 * refreshes goes stale silently, and it now decides where every place in the
 * country is counted. Monthly check, quarterly load."
 *
 * The ONS publishes the Postcode Directory four times a year (February, May,
 * August, November) on its geoportal, each release its own item. Once a month
 * this asks the geoportal for the newest "ONS Postcode Directory (<Month>
 * <Year>)" archive; when that is newer than the release loaded, the loader
 * (loadPostcodes.js) downloads it inside the container, stages it, and swaps
 * the whole snapshot in. Every step is written to `postcode_releases`, so
 * the back office can say which release the country is placed by and when it
 * was last checked — and a check that failed says so rather than nothing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { query } from '../db.js';
import { loadPostcodes } from '../loadPostcodes.js';

const SEARCH = 'https://www.arcgis.com/sharing/rest/search';
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
export const CHECK_EVERY_DAYS = 30;

/** '2026-08' from "ONS Postcode Directory (August 2026)", or null for anything else (a user guide, say). */
export function releaseOf(title) {
  const m = /^ONS Postcode Directory \(([A-Za-z]+) (\d{4})\)(?: for the (?:UK|United Kingdom))?$/i.exec(String(title ?? '').trim());
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  return month ? `${m[2]}-${String(month).padStart(2, '0')}` : null;
}

/** The newest directory among the geoportal's items: `{ release, item }`, or null. */
export function newestOf(items) {
  let best = null;
  for (const it of items ?? []) {
    if (it?.type !== 'CSV Collection') continue;
    const release = releaseOf(it.title);
    if (!release) continue;
    if (!best || release > best.release) best = { release, item: it.id };
  }
  return best;
}

/** Whether a monthly check is owed. */
export const isDue = (state, now = new Date()) =>
  !state?.checked_at || (now - new Date(state.checked_at)) >= CHECK_EVERY_DAYS * 86_400_000;

export async function latestRelease({ fetchImpl = fetch } = {}) {
  const url = `${SEARCH}?q=${encodeURIComponent('title:"ONS Postcode Directory" type:"CSV Collection" owner:ONSGeography_data')}&f=json&num=20&sortField=modified&sortOrder=desc`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`ONS geoportal search failed: ${res.status}`);
  const body = await res.json();
  return newestOf(body.results);
}

export async function state() {
  const { rows: [row] } = await query('select * from postcode_releases where one');
  return row ?? null;
}

/**
 * Check, and load if there is something newer. Returns what it did.
 *
 * `force` checks regardless of when the last check was; the load itself is
 * never forced past a release already loaded — re-loading the same release is
 * `npm run postcodes` by hand.
 */
export async function refreshIfDue({ force = false, fetchImpl = fetch, load = loadPostcodes, now = new Date() } = {}) {
  const current = await state();
  if (!force && !isDue(current, now)) return { checked: false, why: 'checked within the month' };
  if (current?.loading_since && now - new Date(current.loading_since) < 6 * 3600_000) return { checked: false, why: 'a load is in progress' };
  let latest;
  try {
    latest = await latestRelease({ fetchImpl });
    await query('update postcode_releases set checked_at = $1, latest_release = $2, latest_item = $3, last_error = null where one',
      [now, latest?.release ?? null, latest?.item ?? null]);
  } catch (err) {
    await query('update postcode_releases set checked_at = $1, last_error = $2 where one', [now, String(err.message).slice(0, 300)]);
    return { checked: true, loaded: false, why: err.message };
  }
  if (!latest) return { checked: true, loaded: false, why: 'the geoportal lists no directory' };
  if (current?.loaded_release && latest.release <= current.loaded_release) {
    return { checked: true, loaded: false, latest: latest.release, why: 'already loaded' };
  }
  // One claim, atomically: the boot check and a hand-pressed refresh arriving
  // together both read no load in progress and both downloaded to one path
  // (Codex, 26 Sep 2026). Whoever's update finds the slot free does the load;
  // a claim older than six hours is a load that died and is taken over.
  const { rows: claimed } = await query(
    `update postcode_releases set loading_since = now()
      where one and (loading_since is null or loading_since < now() - interval '6 hours') returning one`);
  if (!claimed.length) return { checked: true, loaded: false, why: 'a load is in progress' };
  const file = path.join(os.tmpdir(), `onspd-${latest.release}-${process.pid}-${Date.now()}.zip`);
  try {
    const res = await fetchImpl(`https://www.arcgis.com/sharing/rest/content/items/${latest.item}/data`, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`ONSPD download failed: ${res.status}`);
    await pipeline(res.body, fs.createWriteStream(file));
    const stats = await load(file, { source: `onspd-${latest.release}` });
    // Only a swapped snapshot is a load. An archive with nothing usable in it
    // resolves with nought and no swap, and recording it would leave the old
    // snapshot in use with the new release marked done (Codex, 26 Sep 2026).
    if (!stats?.swapped) throw new Error(`the ${latest.release} archive yielded no snapshot: ${JSON.stringify(stats)}`);
    await query('update postcode_releases set loaded_release = $1, loaded_at = now(), loading_since = null, last_error = null where one', [latest.release]);
    return { checked: true, loaded: true, release: latest.release, stats };
  } catch (err) {
    await query('update postcode_releases set loading_since = null, last_error = $1 where one', [String(err.message).slice(0, 300)]);
    return { checked: true, loaded: false, latest: latest.release, why: err.message };
  } finally {
    fs.rmSync(file, { force: true });
  }
}
