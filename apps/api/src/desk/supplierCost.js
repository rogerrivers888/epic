/**
 * What a supplier actually cost, rather than what the ledger's list price
 * says (owner, 29 Sep 2026: "Runs › Collect shows 'Spent this month £516.22
 * of a ceiling of £550'. That's the inflated ledger — real spend is about
 * £130 … Make sure the ceiling check uses the corrected cost").
 *
 * The ledger (`provider_calls.estimated_cost_usd`) prices every request at
 * list price, from the first: no free allowance, and the pre-tier Google rows
 * at the flat Enterprise rate. Google bills only past each SKU's monthly
 * allowance, IDs-only is free, and Tripadvisor gives 1,000 locations a month.
 *
 * Google, per month: billed up to the bill's cutoff — the export's days
 * (billing_days, by usage day) or, while the export is empty, the console
 * figure the owner read (bo_settings 'billing', with its `at`) — plus the
 * allowance-aware estimate of what the ledger asked after that cutoff: the
 * month's estimate at the end less the estimate at the cutoff, so a free
 * allowance is never spent twice. No bill for the month: the allowance-aware
 * estimate for all of it.
 */

import { query } from '../db.js';
import { USD_TO_GBP, PRICE_PER_UNIT_USD } from '../domain/providerPrices.js';
import { OTHER_PURSE } from '../constants.js';
import { googleEstimate } from './billing.js';
import { settings } from './settings.js';

/** London's month of an instant, as the ledger groups it. */
export const londonMonth = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(d);

const RANGE = `created_at >= (($1::text || '-01')::date::timestamp at time zone 'Europe/London')
           and created_at < ((($1::text || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/London')`;

/**
 * Google's month: { gbp, billedGbp, estimateGbp, cutoff, basis, source }.
 * `basis` is 'billed' (all of it read from a bill), 'billed+estimate' (a bill
 * up to `cutoff` and an estimate after), or 'estimate'.
 */
export async function googleMonth(month) {
  const { rows: [b] } = await query(
    `select coalesce(sum(cost), 0)::float as gbp, max(day) as last, count(*)::int as n
       from billing_days where meter is not null and to_char(day, 'YYYY-MM') = $1`, [month]);
  let billedGbp = null; let cutoff = null; let source = null;
  if (b?.n) {
    billedGbp = b.gbp;
    // The export is by usage day: everything up to the end of its last day.
    const { rows: [c] } = await query(`select (($1::date + 1)::timestamp at time zone 'Europe/London') as t`, [b.last]);
    cutoff = c.t; source = 'Google billing export';
  } else {
    const seed = (await settings()).values.billing;
    if (seed?.month === month && Number.isFinite(Number(seed.usageGbp))) {
      billedGbp = Number(seed.usageGbp);
      cutoff = seed.at ? new Date(seed.at) : null;
      source = seed.source ?? 'Google Cloud console';
    }
  }
  const all = await googleEstimate(month);
  if (billedGbp == null) return { gbp: all.gbp, billedGbp: null, estimateGbp: all.gbp, cutoff: null, basis: 'estimate', source: null };
  // A bill with no instant cannot say what came after it: it is taken as the
  // whole month so far, and said so.
  if (!cutoff) return { gbp: billedGbp, billedGbp, estimateGbp: 0, cutoff: null, basis: 'billed', source };
  const before = await googleEstimate(month, { until: cutoff });
  const after = Math.max(0, all.gbp - before.gbp);
  return { gbp: billedGbp + after, billedGbp, estimateGbp: after, cutoff, basis: after > 0 ? 'billed+estimate' : 'billed', source };
}

/**
 * Tripadvisor's month: locations past the 1,000 free a month, at its price
 * (owner, 29 Sep 2026). The ledger's figure for a row is list price times the
 * locations it returned, so the locations are read back from it.
 */
export async function tripadvisorMonth(month) {
  const { rows: [r] } = await query(
    `select coalesce(sum(estimated_cost_usd), 0)::float as usd from provider_calls where provider = 'tripadvisor' and ${RANGE}`, [month]);
  const price = PRICE_PER_UNIT_USD.tripadvisor;
  const locations = price ? Math.round(r.usd / price) : 0;
  const billable = Math.max(0, locations - 1000);
  return { gbp: billable * price * USD_TO_GBP, locations, billable, ledgerGbp: r.usd * USD_TO_GBP, basis: 'estimate' };
}

/**
 * The money the collection ceiling governs this month, corrected: Google and
 * Tripadvisor as above, and every other supplier outside OTHER_PURSE (Claude
 * and OpenAI keep their own purse, as before) at the ledger's own figure — a
 * supplier nobody has priced yet is counted, never waved through. A guard:
 * it never counts less than has happened, only no longer counts what Google
 * and Tripadvisor never charge.
 */
export async function collectPurse(month = londonMonth()) {
  const [g, ta, { rows: [o] }] = await Promise.all([
    googleMonth(month),
    tripadvisorMonth(month),
    query(
      `select coalesce(sum(estimated_cost_usd), 0)::float as usd from provider_calls
        where ${RANGE} and provider <> all ($2::text[]) and provider <> 'tripadvisor'
          -- a Google row the meters cannot read (no units) stays here at its
          -- ledger figure: counted, never dropped
          and not provider_call_bills_google(units, provider)`, [month, OTHER_PURSE]),
  ]);
  const otherGbp = o.usd * USD_TO_GBP;
  const gbp = g.gbp + ta.gbp + otherGbp;
  return { month, gbp, pence: Math.round(gbp * 100), google: g, tripadvisor: ta, otherGbp };
}
