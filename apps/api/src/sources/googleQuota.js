/**
 * Google's daily limit on Text Search for the Maps project, read from Google.
 *
 * Owner, 29 Sep 2026: "I've requested a Google quota increase for
 * SearchTextRequest per day to 160,000 on epic-maps-509205 (pending Google's
 * approval). Until it's approved, carry on at 70,000/day as now. Watch the
 * quota: when the limit shows 160,000, raise the census to 150,000/day
 * automatically."
 *
 * Asked of the Cloud Quotas API with the billing export's key, read-only. That
 * key was made for BigQuery, and reading a project's quotas needs its own
 * grant (Cloud Quotas Viewer on the project); without it Google refuses, and
 * this says it cannot tell — never a number — so the census stays where it is.
 */

import { accessToken, configured, PROJECT } from './billingExport.js';

const READ_ONLY = 'https://www.googleapis.com/auth/cloud-platform.read-only';
const SERVICE = 'places.googleapis.com';
const HOUR = 3600_000;

let cached = null;

/**
 * `{ speaks: true, limit }` — the project's per-day Text Search limit, or
 * `{ speaks: false, why }`. Read at most once an hour.
 */
export async function searchTextDailyLimit({ fetcher = fetch, now = Date.now() } = {}) {
  if (cached && now - cached.at < HOUR) return cached.value;
  const value = await read(fetcher).catch((err) => ({ speaks: false, why: String(err.message).slice(0, 200) }));
  cached = { at: now, value };
  return value;
}

/** For the tests. */
export const forget = () => { cached = null; };

async function read(fetcher) {
  if (!configured()) return { speaks: false, why: 'no Google key on this server (GCP_BILLING_SA_JSON)' };
  const token = await accessToken(fetcher, READ_ONLY);
  const infos = [];
  let page = '';
  for (let i = 0; i < 20; i += 1) {
    const url = `https://cloudquotas.googleapis.com/v1/projects/${PROJECT}/locations/global/services/${SERVICE}/quotaInfos?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const res = await fetcher(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { speaks: false, why: `Google would not say (${res.status}${j?.error?.status ? ` ${j.error.status}` : ''}): the key needs Cloud Quotas Viewer on ${PROJECT}` };
    }
    infos.push(...(j.quotaInfos ?? []));
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return limitFrom(infos);
}

/**
 * The per-day Text Search limit among the quotas Google listed. A day's
 * refresh interval, "SearchText" in the quota's name or metric, and the
 * project-wide value (no dimensions) or else the largest; -1 is unlimited.
 */
export function limitFrom(infos) {
  const daily = infos.filter((q) => /day/i.test(q.refreshInterval ?? '') && /search.?text/i.test(`${q.quotaId ?? ''} ${q.metric ?? ''}`));
  if (!daily.length) return { speaks: false, why: 'Google listed no per-day Text Search quota' };
  const values = daily.flatMap((q) => (q.dimensionsInfos ?? []).map((d) => ({
    project: !d.dimensions || !Object.keys(d.dimensions).length,
    n: Number(d.details?.value),
  }))).filter((v) => Number.isFinite(v.n));
  if (!values.length) return { speaks: false, why: 'Google listed the quota with no value' };
  const pick = values.find((v) => v.project) ?? values.reduce((a, b) => (b.n > a.n ? b : a));
  return { speaks: true, limit: pick.n < 0 ? Infinity : pick.n };
}
