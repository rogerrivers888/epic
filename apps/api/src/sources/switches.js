/**
 * The owner's switch on each source, held where every adapter can read it.
 *
 * Settings › Providers lets the owner switch a source off. That switch lived
 * in `sources/index.js`, and `enabledSources()` honoured it — which covered
 * the search path and nothing else. Every adapter that is called directly
 * (`googleSource.rating`, `.photos`, `.get`, `.censusSlice`, `.suggest`, the
 * Tripadvisor lookups) went on answering with the source switched off, and
 * only four of those fourteen callers thought to ask `sourceOff()` first.
 *
 * A flag read at the caller is a flag most callers do not read. So the switch
 * is asked at the one door each adapter's requests go through — `call()` in
 * google.js, `get()` in tripadvisor.js — and a request refused there is noted
 * on the meter as `switched_off`, which puts the refusal on the ledger the
 * owner reads rather than in a log nobody does.
 *
 * This file has no imports, on purpose: `index.js` imports every adapter, and
 * an adapter importing `index.js` back would be a cycle. The Set lives here;
 * `index.js` still owns loading it from the database and changing it.
 */

let offKeys = new Set();

/** Whether the owner has switched this source off. */
export const sourceOff = (key) => offKeys.has(key);

/** Replace the whole set — `index.js` calls this after reading or writing app_settings. */
export function setOffKeys(keys) {
  offKeys = new Set(keys);
  return [...offKeys];
}

export const offKeysList = () => [...offKeys];
