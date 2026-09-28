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

/** Read a month from the export into billing_days. Returns what it read, or why it cannot. */
export async function readMonth(month) {
  const got = await monthBySkuDay(month);
  if (!got.speaks) return got;
  await withTransaction(async (c) => {
    await c.query(`delete from billing_days where to_char(day, 'YYYY-MM') = $1`, [month]);
    for (const r of got.rows) {
      await c.query(
        `insert into billing_days (day, service, sku, sku_id, meter, usage, unit, cost, credits, promo, currency)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (day, sku_id) do update set usage = billing_days.usage + excluded.usage, cost = billing_days.cost + excluded.cost,
           credits = billing_days.credits + excluded.credits, promo = billing_days.promo + excluded.promo, read_at = now()`,
        [r.day, r.service, r.sku, r.skuId, meterOf(r.sku), r.usage, r.unit, r.cost, r.credits, r.promo, r.currency]);
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
         where meter is not null and to_char(day, 'YYYY-MM') = $1 group by 1, 2),
      asked as (
        select id, (created_at at time zone 'Europe/London')::date as day, m.key as meter, (m.value)::numeric as n
          from provider_calls, jsonb_each_text(units) m
         where to_char(created_at at time zone 'Europe/London', 'YYYY-MM') = $1
           and m.key like 'google-%' and m.value ~ '^[0-9.]+$' and (m.value)::numeric > 0),
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
  const [{ rows: billed }, { rows: ledger }, { rows: unmapped }] = await Promise.all([
    query(`select to_char(day, 'YYYY-MM-DD') as day, meter, sum(usage)::float usage, sum(cost)::float cost, sum(credits)::float credits, sum(promo)::float promo
             from billing_days where meter is not null and to_char(day, 'YYYY-MM') = $1 group by 1, 2 order by 1, 2`, [month]),
    query(`select to_char((created_at at time zone 'Europe/London')::date, 'YYYY-MM-DD') as day, m.key as meter,
                  sum((m.value)::numeric)::float requests, sum(estimated_cost_usd)::float est_usd, sum(billed_gbp)::float billed_gbp,
                  count(*) filter (where household_id is null)::int no_household
             from provider_calls, jsonb_each_text(units) m
            where to_char(created_at at time zone 'Europe/London', 'YYYY-MM') = $1 and m.key like 'google-%' and m.value ~ '^[0-9.]+$'
            group by 1, 2 order by 1, 2`, [month]),
    query(`select sku, sum(cost)::float cost from billing_days where meter is null and to_char(day, 'YYYY-MM') = $1 group by 1 order by 2 desc`, [month]),
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
    totals: { billedGbp: sum(days, (d) => d.billedGbp), creditGbp: sum(days, (d) => d.creditGbp), ledgerEstimateGbp: sum(ledger, (l) => l.est_usd) * USD_TO_GBP, attributedGbp: sum(days, (d) => d.attributedGbp) },
    days, billedOnly, ledgerOnly, unmapped,
  };
}

/** Daily: read this month (and last, while it can still change), attribute, refresh the tile. */
export async function billingDaily(now = new Date()) {
  const month = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const out = [];
  for (const m of [month(last), month(now)]) {
    const read = await readMonth(m);
    if (!read.speaks) return { speaks: false, why: read.why };
    out.push({ month: m, ...read, ...(await attribute(m)) });
  }
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
