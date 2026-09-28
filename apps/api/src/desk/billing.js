/**
 * Billing against the ledger (owner, 29 Sep 2026). Google's export says what
 * was billed per SKU per day; the ledger says who asked. This module keeps
 * the first (`billing_days`), shares each day's billed usage for a SKU across
 * that day's ledger rows for the same meter in proportion to their requests
 * (`provider_calls.billed_gbp`), and reports the two side by side — so every
 * pound Google billed has a household, a session and a purpose.
 */

import { query, withTransaction } from '../db.js';
import { monthBySkuDay, snapshot } from '../sources/billingExport.js';
import { settings, setSetting } from './settings.js';
import { USD_TO_GBP } from '../domain/providerPrices.js';

/** Google's SKU description → our meter key. Unmapped SKUs are reported, never guessed. */
// The ledger's own names (sources/google.js skuFor): `google-pro` is the Pro
// tier of Text Search and of Place Details alike; Enterprise/Atmosphere is
// `google-search` for a search and `google-details` for a place (Codex).
export const METER_OF = [
  [/text search.*(enterprise|atmosphere)/i, 'google-search'],
  [/place details.*(enterprise|atmosphere)/i, 'google-details'],
  [/(text search|place details).*pro/i, 'google-pro'],
  [/(text search|place details).*(essentials|ids only)/i, 'google-essentials'],
  [/place details/i, 'google-details'],
  [/place photo|photo/i, 'google-photos'],
  [/route/i, 'google-routes'],
];
export const meterOf = (sku) => METER_OF.find(([re]) => re.test(String(sku ?? '')))?.[1] ?? null;

/**
 * The ledger's Google requests, one row per row and meter. A row from before
 * SKU-tier metering carries only a bare `google` count and is reported as
 * `google-legacy` — seen, but not attributable to a billed SKU (Codex, 29 Sep
 * 2026). So is a row whose units are a bare number or numeric string (the
 * source bench writes its call count that way): counted, never dropped
 * (Codex). `pro-details` is not a meter of its own: it marks how many of a
 * row's `google-pro` requests were Place Details, whose free allowance is
 * separate from Text Search's (googleEstimate).
 */
// Every reader passes the month as $1: the range keeps it to the month's
// rows instead of reading the whole ledger (perf, round 3). `at` is the row's
// own instant, so a reader can take part of a month (supplierCost.js prices
// a window that starts or ends inside one) without a second read.
// `provider_call_bills_google` (migration 285) is true of every row either
// branch can read and of more besides, so it changes nothing counted; it
// lets the month be read from the partial index over Google's rows instead
// of scanning every free-source row of the month (round 4 PERF).
// `ledgerMetersBetween(from, to)` is the same read over any range, given as
// two SQL expressions — supplierCost.js prices twelve months from one read of
// it (Codex, round 4: a query per supplier per month was 300 a request).
export const ledgerMetersBetween = (from, to) => `
  select p.id, to_char(p.created_at at time zone 'Europe/London', 'YYYY-MM') as month,
         (p.created_at at time zone 'Europe/London')::date as day,
         case when m.key = 'google' then 'google-legacy' else m.key end as meter, (m.value)::numeric as n,
         p.created_at as at
    from provider_calls p, jsonb_each_text(p.units) m
   where p.created_at >= ${from}
     and p.created_at < ${to}
     and provider_call_bills_google(p.units, p.provider)
     and jsonb_typeof(p.units) = 'object' and m.value ~ '^[0-9.]+$'
     and (m.key like 'google-%'
          or (m.key = 'google' and not exists (select 1 from jsonb_object_keys(p.units) k where k like 'google-%')))
  union all
  select p.id, to_char(p.created_at at time zone 'Europe/London', 'YYYY-MM'),
         (p.created_at at time zone 'Europe/London')::date,
         case when p.provider ~* 'route' then 'google-routes' else 'google-legacy' end, (p.units #>> '{}')::numeric,
         p.created_at
    from provider_calls p
   where p.created_at >= ${from}
     and p.created_at < ${to}
     and provider_call_bills_google(p.units, p.provider)
     and jsonb_typeof(p.units) in ('number', 'string') and p.provider ~* 'google' and (p.units #>> '{}') ~ '^[0-9.]+$'`;
export const LEDGER_METERS = ledgerMetersBetween(
  `(($1::text || '-01')::date::timestamp at time zone 'Europe/London')`,
  `((($1::text || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/London')`);

/** How many of a month's `google-pro` requests were marked as Place Details. */
export const PRO_DETAILS = `
  select coalesce(sum((p.units->>'pro-details')::numeric), 0)::float as n
    from provider_calls p
   where provider_call_bills_google(p.units, p.provider)
     and jsonb_typeof(p.units) = 'object' and (p.units->>'pro-details') ~ '^[0-9.]+$'
     and p.created_at >= (($1::text || '-01')::date::timestamp at time zone 'Europe/London')
     and p.created_at < ((($1::text || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/London')`;

/**
 * The ledger's Google estimate for a month, as Google would bill it: per
 * SKU line, only the requests beyond that line's free monthly allowance, at
 * its price (sources/pricing.js LINES). The ledger's own per-request figure
 * is list price for every request — the reason September read £512 against
 * Google's £40.61 (owner, 29 Sep 2026). Pre-tier rows count against the old
 * `google` line only, never twice.
 */
// Google's list price for Place Details Pro — $17 a thousand, where Text
// Search Pro is $32 (Codex). The ledger prices every Pro request at the
// dearer rate; the estimate of a bill does not.
const PLACE_DETAILS_PRO_USD = 0.017;

// `q`: the query function to read with — a transaction's own client where a
// caller holds a lock (routes/placeIndex.js roomToSpend), else the pool.
export async function googleEstimate(month, { until = null, q = query } = {}) {
  const { LINES } = await import('../sources/pricing.js');
  // Text Search Pro and Place Details Pro are two SKUs with a free allowance
  // each, not pooled (Codex, 29 Sep 2026). A request marked `pro-details` is
  // judged against its own allowance; an unmarked Pro request (every row from
  // before the mark) against Text Search's — the dearer reading, never the
  // cheaper one. The two reads are asked side by side (round 4 PERF).
  const [{ rows }, { rows: [{ n: proDetails = 0 } = {}] }] = await Promise.all([
    // `until`: only the rows before an instant — what a bill read up to that
    // instant has not yet covered is the rest (desk/supplierCost.js).
    q(`select meter, sum(n)::float as units from (${LEDGER_METERS}) x where month = $1 and ($2::timestamptz is null or at < $2) group by 1`, [month, until]),
    q(`${PRO_DETAILS} and ($2::timestamptz is null or p.created_at < $2)`, [month, until]),
  ]);
  const units = new Map();
  for (const r of rows) units.set(r.meter === 'google-legacy' ? 'google' : r.meter, r.units);
  return priceGoogle(units, proDetails, LINES);
}

/**
 * Price a month's Google requests in memory: `units` is meter → requests
 * (the pre-tier `google` meter under `google`), `proDetails` how many of the
 * Pro requests were Place Details. The one pricing googleEstimate and the
 * batched months in supplierCost.js both use, so the two cannot disagree.
 */
export function priceGoogle(units, proDetails, LINES) {
  const counted = [];
  for (const line of LINES.filter((l) => l.source === 'google' && l.allowance)) {
    const used = units.get(line.key) ?? 0;
    if (line.key === 'google-pro') {
      const details = Math.min(proDetails, used);
      counted.push({ line, key: 'google-pro', used: used - details });
      counted.push({ line, key: 'google-pro-details', used: details, beyondUsd: PLACE_DETAILS_PRO_USD });
    } else counted.push({ line, key: line.key, used });
  }
  let usd = 0;
  const lines = [];
  for (const { line, key, used, beyondUsd } of counted) {
    const billable = Math.max(0, used - line.allowance.limit);
    const lineUsd = billable * (beyondUsd ?? line.allowance.beyondUsd ?? 0);
    usd += lineUsd;
    lines.push({ key, used, free: line.allowance.limit, billable, gbp: lineUsd * USD_TO_GBP });
  }
  return { gbp: usd * USD_TO_GBP, lines };
}

/** Read a month from the export into billing_days. Returns what it read, or why it cannot. */
export async function readMonth(month) {
  const got = await monthBySkuDay(month);
  if (!got.speaks) return got;
  // No rows is an export not filled yet, not a month with no usage: what was
  // read before is kept, never replaced by nothing (29 Sep 2026).
  if (!got.rows.length) return { speaks: true, month, rows: 0, empty: true };
  await withTransaction(async (c) => {
    // The invoice month's import is replaced whole — the export is read by
    // invoice month, so it is kept and replaced by invoice month (278).
    await c.query('delete from billing_days where invoice_month = $1', [month]);
    for (const r of got.rows) {
      await c.query(
        `insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, unit, cost, credits, promo, currency)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [month, r.day, r.service, r.sku, r.skuId, meterOf(r.sku), r.usage, r.unit, r.cost, r.credits, r.promo, r.currency]);
    }
  });
  return { speaks: true, month, rows: got.rows.length };
}

/**
 * Share each billed day and meter across that day's ledger rows, by the
 * requests each made on that meter. A day billing has but the ledger lacks
 * (spend with no row) is reported, not invented.
 */
export async function attribute(month) {
  return withTransaction(async (c) => {
    await c.query(`update provider_calls set billed_gbp = null, billed_at = null
                    where to_char(created_at at time zone 'Europe/London', 'YYYY-MM') = $1`, [month]);
    const { rowCount } = await c.query(`
      with billed as (
        select day, meter, sum(cost) as cost from billing_days
         -- by the day it was used, whichever invoice carried it: late usage
         -- billed on a later invoice still lands on the rows that made it (Codex)
         where meter is not null and to_char(day, 'YYYY-MM') = $1 group by 1, 2),
      asked as (
        select id, day, meter, n from (${LEDGER_METERS}) x where month = $1 and n > 0),
      totals as (select day, meter, sum(n) as n from asked group by 1, 2),
      share as (
        select a.id, sum(b.cost * a.n / nullif(t.n, 0)) as gbp
          from asked a join totals t using (day, meter) join billed b using (day, meter)
         group by a.id)
      update provider_calls p set billed_gbp = s.gbp, billed_at = now() from share s where p.id = s.id`, [month]);
    return { rows: rowCount };
  });
}

/**
 * The reconciliation, per day per meter: what billing charged (before
 * credit), the requests it counted, what the ledger counted and estimated,
 * and whose they were. Unmapped SKUs and unmatched days are listed.
 */
export async function reconcile(month) {
  const [{ rows: billed }, { rows: ledger }, { rows: unmapped }, estimate] = await Promise.all([
    query(`select to_char(day, 'YYYY-MM-DD') as day, meter, sum(usage)::float usage, sum(cost)::float cost, sum(credits)::float credits, sum(promo)::float promo
             from billing_days where meter is not null and invoice_month = $1 group by 1, 2 order by 1, 2`, [month]),
    query(`select to_char(x.day, 'YYYY-MM-DD') as day, x.meter,
                  sum(x.n)::float requests, sum(p.estimated_cost_usd)::float est_usd, sum(p.billed_gbp)::float billed_gbp,
                  count(*) filter (where p.household_id is null)::int no_household
             from (${LEDGER_METERS}) x join provider_calls p on p.id = x.id
            where x.month = $1
            group by 1, 2 order by 1, 2`, [month]),
    query(`select sku, sum(cost)::float cost from billing_days where meter is null and invoice_month = $1 group by 1 order by 2 desc`, [month]),
    googleEstimate(month),
  ]);
  const key = (r) => `${r.day}|${r.meter}`;
  const L = new Map(ledger.map((r) => [key(r), r]));
  const days = billed.map((b) => {
    const l = L.get(key(b));
    return { day: b.day, meter: b.meter, billedUsage: b.usage, billedGbp: b.cost, creditGbp: -b.credits, promoGbp: -b.promo,
      ledgerRequests: l?.requests ?? 0, ledgerEstimateGbp: (l?.est_usd ?? 0) * USD_TO_GBP, attributedGbp: l?.billed_gbp ?? 0, noHousehold: l?.no_household ?? 0 };
  });
  const billedOnly = days.filter((d) => !d.ledgerRequests && d.billedGbp > 0);
  const ledgerOnly = ledger.filter((l) => !billed.some((b) => key(b) === key(l)) && l.requests > 0);
  const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
  return {
    month,
    totals: {
      billedGbp: sum(days, (d) => d.billedGbp), creditGbp: sum(days, (d) => d.creditGbp), attributedGbp: sum(days, (d) => d.attributedGbp),
      // after Google's free monthly allowances, per SKU line — the fair comparison with billing
      ledgerEstimateGbp: estimate.gbp, estimateLines: estimate.lines,
    },
    days, billedOnly, ledgerOnly, unmapped,
  };
}

/** Daily: read this month (and last, while it can still change), attribute, refresh the tile. */
export async function billingDaily(now = new Date()) {
  const month = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const out = [];
  const read = [month(last), month(now)];
  // The usage months these invoices carried before the re-read too: a late
  // row a refresh removes still leaves its month to be re-attributed (Codex).
  const { rows: before } = await query(
    `select distinct to_char(day, 'YYYY-MM') as m from billing_days where invoice_month = any($1)`, [read]);
  const empty = new Set();
  for (const m of read) {
    const r = await readMonth(m);
    if (!r.speaks) return { speaks: false, why: r.why };
    if (r.empty) empty.add(m);
    out.push({ month: m, ...r });
  }
  // Attribute every usage month those invoices touched — including an
  // earlier month whose late usage a later invoice carried.
  const { rows: after } = await query(
    `select distinct to_char(day, 'YYYY-MM') as m from billing_days where invoice_month = any($1)`, [read]);
  // A month the export has nothing for yet is not attributed: attributing
  // clears billed_gbp first, and there is nothing to put back.
  const usageMonths = [...new Set([...before, ...after].map((r) => r.m))].filter((m) => !empty.has(m)).sort();
  for (const m of usageMonths) out.push({ month: m, attributed: true, ...(await attribute(m)) });
  // The tile: usage before credit this month, and the credit left.
  const cfg = (await settings()).values;
  const prev = cfg.billing ?? {};
  const snap = await snapshot({ month: month(now), creditTotalGbp: prev.creditTotalGbp ?? null });
  if (snap.speaks && prev.creditExpires) {
    await setSetting('billing', {
      month: snap.month, usageGbp: snap.usageGbp, paidGbp: snap.paidGbp,
      creditGbp: snap.creditGbp ?? prev.creditGbp, creditTotalGbp: prev.creditTotalGbp ?? null, creditExpires: prev.creditExpires,
      source: 'BigQuery billing export', at: new Date().toISOString(),
    }, { who: 'Epic (billing export)' });
  }
  return { speaks: true, months: out };
}
