/**
 * Bank holidays, England and Wales (Epic hosting v7: "Bank holidays: use
 * gov.uk bank-holidays.json, England and Wales for now"). Scotland and
 * Northern Ireland need their own lists, and the file carries both, so adding
 * them later is choosing a different division here.
 *
 * Free and keyless. Fetched at most once a day per process; while a fetch is
 * failing the last good list is kept, and before the first one a short list
 * bundled here is used, so a Weekly or Course step never fails for want of it.
 */

import * as providerCalls from '../repositories/providerCalls.js';

const URL_ = process.env.EPIC_BANK_HOLIDAYS_URL || 'https://www.gov.uk/bank-holidays.json';
const DIVISION = 'england-and-wales';
const DAY_MS = 86_400_000;

/** gov.uk's own published dates (England and Wales), 2026–2027: the floor under a failed fetch. */
export const BUNDLED = [
  ['2026-01-01', 'New Year’s Day'], ['2026-04-03', 'Good Friday'], ['2026-04-06', 'Easter Monday'], ['2026-05-04', 'Early May bank holiday'],
  ['2026-05-25', 'Spring bank holiday'], ['2026-08-31', 'Summer bank holiday'], ['2026-12-25', 'Christmas Day'], ['2026-12-28', 'Boxing Day'],
  ['2027-01-01', 'New Year’s Day'], ['2027-03-26', 'Good Friday'], ['2027-03-29', 'Easter Monday'], ['2027-05-03', 'Early May bank holiday'],
  ['2027-05-31', 'Spring bank holiday'], ['2027-08-30', 'Summer bank holiday'], ['2027-12-27', 'Christmas Day'], ['2027-12-28', 'Boxing Day'],
].map(([date, title]) => ({ date, title }));

let cache = { at: 0, list: null, source: 'bundled' };

/** Test seam: forget what was fetched. */
export const resetBankHolidays = () => { cache = { at: 0, list: null, source: 'bundled' }; };

/** The England-and-Wales events out of gov.uk's file, or null when it is not that file. */
export function parseGovUk(json) {
  const events = json?.[DIVISION]?.events;
  if (!Array.isArray(events) || !events.length) return null;
  return events.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e?.date ?? '')).map((e) => ({ date: e.date, title: String(e.title ?? 'Bank holiday') }));
}

/**
 * The list: `[{ date, title }]`, oldest first. `householdId` attributes the
 * fetch when one actually happens (every outbound call is attributed).
 */
export async function bankHolidays({ householdId = null, now = Date.now(), fetchImpl = fetch } = {}) {
  if (cache.list && now - cache.at < DAY_MS) return cache.list;
  const started = Date.now();
  try {
    const res = await fetchImpl(URL_, { headers: { accept: 'application/json' } });
    const list = res.ok ? parseGovUk(await res.json()) : null;
    if (!list) throw new Error(`http_${res.status}`);
    cache = { at: now, list, source: 'gov.uk' };
    if (householdId) await providerCalls.recordMetered({ householdId, provider: 'govuk', purpose: 'host.bank_holidays', units: { 'govuk-requests': 1 }, costUsd: 0, ok: true, ms: Date.now() - started }).catch(() => null);
    return list;
  } catch (err) {
    if (householdId) await providerCalls.recordFailure({ householdId, provider: 'govuk', purpose: 'host.bank_holidays', ms: Date.now() - started, fault: String(err?.message ?? 'error').slice(0, 40) });
    // Keep the last good list; try again in an hour rather than on every request.
    cache = { at: now - DAY_MS + 3_600_000, list: cache.list ?? BUNDLED, source: cache.list ? cache.source : 'bundled' };
    return cache.list;
  }
}

export const bankHolidaySource = () => cache.source;
