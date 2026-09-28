/**
 * Google Cloud's own billing, read from the standard usage cost export in
 * BigQuery (owner, 29 Sep 2026: project epic-maps-509205, dataset
 * billing_export, EU; account 016AC3-155881-368408). Google billing is the
 * source of truth for spend (register C51); our ledger (`provider_calls`) is
 * the record of who asked for what.
 *
 * Read-only: a service account holding BigQuery Data Viewer on the dataset
 * and BigQuery Job User on the project, its JSON key in Doppler as
 * GCP_BILLING_SA_JSON. No Google SDK: the key signs a JWT, the JWT buys an
 * access token, and one query runs through the REST API. Nothing here can
 * spend — a query over the export costs a few megabytes of the free tier.
 *
 * Can't-speak: with no key, or a table not there yet (the export backfills
 * over a day), every reader returns `{ speaks: false, why }`, never a nought.
 */

import { createSign } from 'node:crypto';

export const PROJECT = process.env.EPIC_BILLING_PROJECT ?? 'epic-maps-509205';
export const DATASET = process.env.EPIC_BILLING_DATASET ?? 'billing_export';
export const ACCOUNT = process.env.EPIC_BILLING_ACCOUNT ?? '016AC3-155881-368408';
export const TABLE = `${PROJECT}.${DATASET}.gcp_billing_export_v1_${ACCOUNT.replace(/-/g, '_')}`;
const LOCATION = 'EU';

function key() {
  const raw = process.env.GCP_BILLING_SA_JSON;
  if (!raw) return null;
  try {
    const k = JSON.parse(raw);
    return k.client_email && k.private_key ? k : null;
  } catch { return null; }
}

export const configured = () => Boolean(key());

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

let cached = null;
async function accessToken(fetcher = fetch) {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const k = key();
  if (!k) throw Object.assign(new Error('No billing key (GCP_BILLING_SA_JSON) is set.'), { code: 'no_key' });
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    iss: k.client_email, scope: 'https://www.googleapis.com/auth/bigquery.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = b64url(createSign('RSA-SHA256').update(`${head}.${body}`).sign(k.private_key));
  const res = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw Object.assign(new Error(`Google refused the billing key (${res.status}).`), { code: 'auth' });
  cached = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** One query, parameters named, rows back as plain objects. */
export async function run(sql, params = {}, fetcher = fetch) {
  const token = await accessToken(fetcher);
  const res = await fetcher(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: sql, useLegacySql: false, location: LOCATION, timeoutMs: 30_000,
      parameterMode: 'NAMED',
      queryParameters: Object.entries(params).map(([name, value]) => ({
        name, parameterType: { type: 'STRING' }, parameterValue: { value: String(value) },
      })),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = j?.error?.message ?? `status ${res.status}`;
    const notYet = /not found/i.test(why);
    throw Object.assign(new Error(notYet ? 'The billing export table is not there yet (it backfills over a day).' : `BigQuery: ${why.slice(0, 200)}`), { code: notYet ? 'not_yet' : 'bigquery' });
  }
  // A query past its timeout comes back 200 with jobComplete false and no
  // rows: wait for it, never read "not finished" as "empty" (Codex, 29 Sep).
  let page = j;
  const deadline = Date.now() + 120_000;
  while (page.jobComplete === false) {
    if (Date.now() > deadline) throw Object.assign(new Error('BigQuery did not finish the billing query in two minutes.'), { code: 'bigquery' });
    await new Promise((r) => setTimeout(r, 2000));
    const ref = page.jobReference ?? j.jobReference;
    const r2 = await fetcher(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries/${ref.jobId}?location=${ref.location ?? LOCATION}&timeoutMs=10000`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
    page = await r2.json().catch(() => ({}));
    if (!r2.ok) throw Object.assign(new Error(`BigQuery: ${page?.error?.message ?? r2.status}`), { code: 'bigquery' });
  }
  // A job can finish and still have failed: 200, jobComplete, and an errors
  // list. That is never an empty result (Codex, 29 Sep 2026).
  // `errors` can also carry warnings beside a good result, so what is fatal is
  // a failed job (`status.errorResult`) or no result at all (Codex).
  const listed = page.errors?.length ? page.errors : j.errors?.length ? j.errors : null;
  const fatal = page.status?.errorResult ?? (!page.schema ? listed?.[0] ?? { message: 'no result' } : null);
  if (fatal) throw Object.assign(new Error(`BigQuery: ${String(fatal.message ?? 'the query failed').slice(0, 200)}`), { code: 'bigquery' });
  const fields = (page.schema?.fields ?? []).map((f) => f.name);
  const rows = [...(page.rows ?? [])];
  let token2 = page.pageToken;
  while (token2) {
    const ref = page.jobReference ?? j.jobReference;
    const r3 = await fetcher(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries/${ref.jobId}?location=${ref.location ?? LOCATION}&pageToken=${encodeURIComponent(token2)}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
    const more = await r3.json().catch(() => ({}));
    if (!r3.ok) throw Object.assign(new Error(`BigQuery: ${more?.error?.message ?? r3.status}`), { code: 'bigquery' });
    rows.push(...(more.rows ?? []));
    token2 = more.pageToken;
  }
  return rows.map((r) => Object.fromEntries(r.f.map((c, i) => [fields[i], c.v])));
}

const speakless = (err) => ({ speaks: false, why: err.code === 'no_key' ? 'No billing key yet — GCP_BILLING_SA_JSON in Doppler.' : err.message });

/**
 * One month, per SKU per day: usage before credit, the credits applied (by
 * type), and what was actually paid. Google Maps only — the Places and Routes
 * services — and every other service in one "other" line.
 */
export async function monthBySkuDay(month, fetcher = fetch) {
  try {
    const rows = await run(`
      select format_date('%Y-%m-%d', date(usage_start_time, 'Europe/London')) as day,
             service.description as service, sku.description as sku, sku.id as sku_id,
             sum(usage.amount) as usage, any_value(usage.unit) as unit,
             sum(cost) as cost,
             sum((select coalesce(sum(c.amount), 0) from unnest(credits) c)) as credits,
             sum((select coalesce(sum(c.amount), 0) from unnest(credits) c where c.type = 'PROMOTION')) as promo,
             any_value(currency) as currency
        from \`${TABLE}\`
       where invoice.month = @month
       group by 1, 2, 3, 4
       order by 1, 2, 3`, { month: month.replace('-', '') }, fetcher);
    return { speaks: true, month, rows: rows.map((r) => ({
      day: r.day, service: r.service, sku: r.sku, skuId: r.sku_id, unit: r.unit, currency: r.currency,
      usage: Number(r.usage), cost: Number(r.cost), credits: Number(r.credits), promo: Number(r.promo),
      paid: Number(r.cost) + Number(r.credits),
    })) };
  } catch (err) { return speakless(err); }
}

/**
 * The tile's numbers: this month's usage before credit, what was paid, and
 * the promotional credit used since it was granted — the remaining credit is
 * the grant less that (the export records credit spent, not a balance).
 */
export async function snapshot({ month, creditTotalGbp, grantedMonth = '202608' } = {}, fetcher = fetch) {
  try {
    const [m] = await run(`
      select count(*) as n, sum(cost) as usage, sum(cost) + sum((select coalesce(sum(c.amount), 0) from unnest(credits) c)) as paid, any_value(currency) as currency
        from \`${TABLE}\` where invoice.month = @month`, { month: month.replace('-', '') }, fetcher);
    // An export with no rows for the month has not been filled yet — Google
    // fills it within a day of switching it on. That is "cannot say", never a
    // month that cost nothing: read as £0 it overwrote the console figure on
    // the tile (29 Sep 2026).
    if (!Number(m?.n)) return { speaks: false, why: `The billing export has no rows for ${month} yet — Google fills it within a day of switching it on.` };
    const [p] = await run(`
      select count(*) as n, -sum((select coalesce(sum(c.amount), 0) from unnest(credits) c where c.type = 'PROMOTION')) as used
        from \`${TABLE}\` where invoice.month >= @since`, { since: grantedMonth }, fetcher);
    if (!Number(p?.n)) return { speaks: false, why: 'The billing export has no rows since the credit was granted yet.' };
    return {
      speaks: true, month, currency: m?.currency ?? null,
      usageGbp: Number(m?.usage ?? 0), paidGbp: Math.max(0, Number(m?.paid ?? 0)),
      creditUsedGbp: Number(p?.used ?? 0),
      creditGbp: creditTotalGbp == null ? null : Math.max(0, creditTotalGbp - Number(p?.used ?? 0)),
    };
  } catch (err) { return speakless(err); }
}
