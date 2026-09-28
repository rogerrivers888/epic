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

/** London's month of an instant, as the ledger groups it. */
export const londonMonth = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(d);

/**
 * The rows tripadvisorMonth prices — and exactly those, so the rest of the
 * purse can leave out these and no others (Codex: a row it cannot price
 * must stay at its ledger figure, never vanish).
 */
const TA_PRICED = `coalesce(jsonb_typeof(units) = 'object' and (units->>'tripadvisor') ~ '^[0-9.]+$', false) or provider = 'tripadvisor'`;

const RANGE = `created_at >= (($1::text || '-01')::date::timestamp at time zone 'Europe/London')
           and created_at < ((($1::text || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/London')`;

/**
 * Google's month: { gbp, billedGbp, estimateGbp, cutoff, basis, source }.
 * `basis` is 'billed' (all of it read from a bill), 'billed+estimate' (a bill
 * up to `cutoff` and an estimate after), or 'estimate'.
 */
export async function googleMonth(month, { q = query } = {}) {
  // The export fills a day over the next day or two, so its latest days are
  // not complete: the bill is trusted only up to two days before the last day
  // it holds, and everything from there on is estimated (Codex, 29 Sep 2026:
  // a part-filled day read as whole would hide the rest of that day's spend).
  const { rows: [b] } = await q(
    `with m as (select day, cost from billing_days where meter is not null and to_char(day, 'YYYY-MM') = $1),
          edge as (select max(day) - 1 as upto from m)
     select coalesce(sum(m.cost) filter (where m.day < edge.upto), 0)::float as gbp,
            count(*) filter (where m.day < edge.upto)::int as n,
            (select upto from edge) as upto
       from m, edge group by edge.upto`, [month]);
  let billedGbp = null; let cutoff = null; let source = null;
  if (b?.n) {
    billedGbp = b.gbp;
    const { rows: [c] } = await q(`select ($1::date::timestamp at time zone 'Europe/London') as t`, [b.upto]);
    cutoff = c.t; source = 'Google billing export';
  } else {
    // Read from the table, not the settings cache: on the caller's client,
    // and never a figure older than the row.
    const { rows: [row] } = await q(`select value from bo_settings where key = 'billing'`);
    const seed = row?.value ?? null;
    if (seed?.month === month && Number.isFinite(Number(seed.usageGbp))) {
      billedGbp = Number(seed.usageGbp);
      cutoff = seed.at ? new Date(seed.at) : null;
      source = seed.source ?? 'Google Cloud console';
    }
  }
  const all = await googleEstimate(month, { q });
  if (billedGbp == null) return { gbp: all.gbp, billedGbp: null, estimateGbp: all.gbp, cutoff: null, basis: 'estimate', source: null };
  // A bill with no instant cannot say what came after it: it is taken as the
  // whole month so far, and said so.
  if (!cutoff) return { gbp: billedGbp, billedGbp, estimateGbp: 0, cutoff: null, basis: 'billed', source };
  const before = await googleEstimate(month, { until: cutoff, q });
  const after = Math.max(0, all.gbp - before.gbp);
  return { gbp: billedGbp + after, billedGbp, estimateGbp: after, cutoff, basis: after > 0 ? 'billed+estimate' : 'billed', source };
}

/**
 * Tripadvisor's month: locations past the 1,000 free a month, at its price
 * (owner, 29 Sep 2026). The ledger's figure for a row is list price times the
 * locations it returned, so the locations are read back from it.
 */
export async function tripadvisorMonth(month, { q = query } = {}) {
  // Locations from the meter wherever a row carries one — a browse writes
  // `google+tripadvisor` with the count under `units.tripadvisor` (Codex) —
  // and, for a Tripadvisor row with no meter, read back from its list price.
  const price = PRICE_PER_UNIT_USD.tripadvisor;
  const { rows: [r] } = await q(
    `select coalesce(sum(case
              when jsonb_typeof(units) = 'object' and (units->>'tripadvisor') ~ '^[0-9.]+$' then (units->>'tripadvisor')::numeric
              when provider = 'tripadvisor' and $2::numeric > 0 then round(coalesce(estimated_cost_usd, 0) / $2::numeric)
              else 0 end), 0)::float as locations
       from provider_calls where ${RANGE} and (${TA_PRICED})`,
    [month, price ?? 0]);
  const locations = Math.round(r.locations);
  const billable = Math.max(0, locations - 1000);
  return { gbp: billable * price * USD_TO_GBP, locations, billable, basis: 'estimate' };
}

/**
 * The money the collection ceiling governs this month, corrected: Google and
 * Tripadvisor as above, and every other supplier outside OTHER_PURSE (Claude
 * and OpenAI keep their own purse, as before) at the ledger's own figure — a
 * supplier nobody has priced yet is counted, never waved through. A guard:
 * it never counts less than has happened, only no longer counts what Google
 * and Tripadvisor never charge.
 */
export async function collectPurse(month = londonMonth(), { q = query } = {}) {
  const [g, ta, { rows: [o] }] = await Promise.all([
    googleMonth(month, { q }),
    tripadvisorMonth(month, { q }),
    q(
      `select coalesce(sum(estimated_cost_usd), 0)::float as usd from provider_calls
        where ${RANGE} and provider <> all ($2::text[])
          -- Tripadvisor's money is tripadvisorMonth's, for the rows it prices
          and not (${TA_PRICED})
          -- a Google row the meters cannot read (no units) stays here at its
          -- ledger figure: counted, never dropped
          and not provider_call_bills_google(units, provider)`, [month, OTHER_PURSE]),
  ]);
  const otherGbp = o.usd * USD_TO_GBP;
  const gbp = g.gbp + ta.gbp + otherGbp;
  return { month, gbp, pence: Math.round(gbp * 100), google: g, tripadvisor: ta, otherGbp };
}

// ---------------------------------------------------------------------------
// every supplier, on the same figure (owner, 29 Sep 2026: "bring Suppliers
// and Money onto the same shared cost figure (£ throughout, $ in brackets,
// ledger figures labelled "estimate", Expected = last month's bill or budget,
// never $0)")
// ---------------------------------------------------------------------------

/** Suppliers whose bill is in dollars: their figure carries `nativeUsd` beside the £. */
export const BILLS_IN_USD = new Set(['anthropic', 'openai', 'tripadvisor', 'mapbox', 'fly']);

/**
 * Which ledger rows a supplier answers for. Google is one supplier — Places,
 * Routes, photos and the census are one bill — so it claims every row that
 * carries a Google meter, and every row a Google provider wrote without one.
 * The register's separate Routes entry is inside that bill (`within`), never
 * a second copy of it.
 */
const GOOGLE_ROWS = `(provider_call_bills_google(units, provider) or provider ~* 'google')`;
const GOOGLE_UNMETERED = `(provider ~* 'google' and not provider_call_bills_google(units, provider))`;
// The local scout is Claude with web search, billed on Anthropic's console:
// its rows are Anthropic's, or a console bill and the ledger would both count them.
const CLAUDE_ROWS = `(provider ~* 'anthropic|claude' or provider = 'scout')`;
/** A row no named supplier above answers for: the plain-ledger suppliers and the residue share these. */
const NOT_CLAIMED = `not ${GOOGLE_ROWS} and not ${CLAUDE_ROWS} and not (${TA_PRICED})`;

/**
 * How a register entry is priced. `google` for the Google bill, `within` for
 * a register entry whose money is inside another's bill, `invoiced` for one
 * the ledger never sees (Fly.io, Neon, R2, the stores).
 */
export function supplierKind(c) {
  const p = c?.providerKey ?? null;
  if (!p) return 'invoiced';
  if (p === 'google') return 'google';
  if (/^google/.test(p)) return 'within';
  if (p === 'tripadvisor') return 'tripadvisor';
  if (p === 'anthropic') return 'anthropic';
  return 'ledger';
}

/** The ledger rows a supplier answers for, as a predicate, with its parameters from $n. */
function claimOf(c, n) {
  switch (c.kind === 'residue' ? 'residue' : supplierKind(c)) {
    case 'google': return { sql: GOOGLE_ROWS, params: [] };
    case 'tripadvisor': return { sql: `(${TA_PRICED})`, params: [] };
    case 'anthropic': return { sql: CLAUDE_ROWS, params: [] };
    case 'ledger': return { sql: `(provider = $${n} and ${NOT_CLAIMED})`, params: [c.providerKey] };
    // The residue: rows no register entry answers for — a composite provider
    // string, or a source nobody has put on the register.
    case 'residue': return { sql: `(provider <> all ($${n}::text[]) and ${NOT_CLAIMED})`, params: [c.providerKeys ?? []] };
    default: return null;
  }
}

/** The ledger's list-price figure for a supplier's rows over [from, to). */
async function ledgerUsd(c, from, to, { q = query } = {}) {
  const claim = claimOf(c, 3);
  if (!claim) return 0;
  const { rows: [r] } = await q(
    `select coalesce(sum(estimated_cost_usd), 0)::float as usd from provider_calls
      where created_at >= $1 and created_at < $2 and ${claim.sql}`, [from, to, ...claim.params]);
  return r.usd;
}

const monthStart = (month) => new Date(`${month}-01T00:00:00Z`);
const nextMonth = (month) => {
  const d = monthStart(month);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
};
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
// The bounds a month's rows are read between, as the ledger groups them — London's.
const londonBounds = async (month, q) => {
  const { rows: [r] } = await q(
    `select (($1::text || '-01')::date::timestamp at time zone 'Europe/London') as a,
            ((($1::text || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/London') as b`, [month]);
  return [r.a, r.b];
};

/**
 * One supplier's month, on the figure every screen shares:
 * `{ gbp, nativeUsd, basis, source, at, note }`.
 *
 *   · Google — googleMonth: billed from the export or the console reading, the
 *     allowance-aware estimate after its cutoff, or the estimate for all of it.
 *     A Google row with no meter is added at its ledger figure where the month
 *     is estimated (counted, never dropped), and never where the bill covers it.
 *   · Anthropic — the console figure for its month is the bill, as the owner
 *     read it on `at`; nothing is added after it. Any other month is the
 *     ledger, labelled estimate.
 *   · Tripadvisor — locations past the 1,000 free a month.
 *   · Everyone else metered — the ledger at price past a pricing.js allowance
 *     where one exists, else the ledger's figure; an estimate either way.
 *   · `within` — inside another supplier's bill: `gbp` null, never a second copy.
 *   · `invoiced` — not metered: `gbp` null, never nought.
 *
 * `basis` is 'billed' | 'billed+estimate' | 'estimate', or null with no figure.
 */
export async function supplierMonth(c, month, { q = query, cache = null } = {}) {
  const key = `${c.key}|${month}`;
  if (cache?.has(key)) return cache.get(key);
  const p = supplierMonthUncached(c, month, { q });
  cache?.set(key, p);
  return p;
}

async function supplierMonthUncached(c, month, { q }) {
  const kind = supplierKind(c);
  const usd = BILLS_IN_USD.has(c.key);
  if (kind === 'invoiced') return { gbp: null, nativeUsd: null, basis: null, source: null, at: null, note: 'Invoiced, not metered' };
  if (kind === 'within') return { gbp: null, nativeUsd: null, basis: null, source: null, at: null, within: 'google-places', note: 'In Google’s bill' };

  if (kind === 'google') {
    const [g, [a, b]] = await Promise.all([googleMonth(month, { q }), londonBounds(month, q)]);
    // Unmetered Google rows the bill does not already cover: all of the month
    // when it is estimated, after the cutoff when a bill runs to one.
    const from = g.basis === 'estimate' ? a : g.cutoff;
    let extra = 0;
    if (from) {
      const { rows: [r] } = await q(
        `select coalesce(sum(estimated_cost_usd), 0)::float as usd from provider_calls
          where created_at >= $1 and created_at < $2 and ${GOOGLE_UNMETERED}`, [from, b]);
      extra = r.usd * USD_TO_GBP;
    }
    const basis = g.basis === 'billed' && extra > 0 ? 'billed+estimate' : g.basis;
    return {
      gbp: g.gbp + extra, nativeUsd: null, basis, source: g.source, at: g.cutoff ?? null,
      billedGbp: g.billedGbp, estimateGbp: g.estimateGbp + extra,
      note: g.basis === 'estimate' ? 'past each SKU’s free allowance' : null,
    };
  }

  if (kind === 'anthropic') {
    const { rows: [row] } = await q(`select value from bo_settings where key = 'claudeBilling'`).catch(() => ({ rows: [] }));
    const cb = row?.value ?? null;
    if (cb?.month === month && Number.isFinite(Number(cb.usd))) {
      const u = Number(cb.usd);
      return { gbp: cb.gbp != null && Number.isFinite(Number(cb.gbp)) ? Number(cb.gbp) : u * USD_TO_GBP, nativeUsd: u, basis: 'billed', source: cb.source ?? 'Anthropic console', at: cb.at ?? null, note: null };
    }
    const [a, b] = await londonBounds(month, q);
    const u = await ledgerUsd(c, a, b, { q });
    return { gbp: u * USD_TO_GBP, nativeUsd: u, basis: 'estimate', source: null, at: null, note: 'ledger, at list price' };
  }

  if (kind === 'tripadvisor') {
    const ta = await tripadvisorMonth(month, { q });
    return {
      gbp: ta.gbp, nativeUsd: ta.gbp / USD_TO_GBP, basis: 'estimate', source: null, at: null,
      note: `${ta.locations.toLocaleString('en-GB')} of 1,000 free`, locations: ta.locations,
    };
  }

  // The plain ledger, past an allowance where pricing.js names one.
  const [a, b] = await londonBounds(month, q);
  const { LINES } = await import('../sources/pricing.js');
  const line = LINES.find((l) => l.source === c.providerKey && l.allowance?.kind === 'monthly' && Number.isFinite(l.allowance.beyondUsd));
  let u;
  let note = 'ledger, at list price';
  if (line) {
    const claim = claimOf(c, 3);
    const { rows: [r] } = await q(
      `select coalesce(sum(case when jsonb_typeof(units) in ('number', 'string') and (units #>> '{}') ~ '^[0-9.]+$' then (units #>> '{}')::numeric
                                when jsonb_typeof(units) = 'object' and (units->>$4) ~ '^[0-9.]+$' then (units->>$4)::numeric
                                else 0 end), 0)::float as n
         from provider_calls where created_at >= $1 and created_at < $2 and ${claim.sql}`,
      [a, b, ...claim.params, c.providerKey]);
    u = Math.max(0, r.n - line.allowance.limit) * line.allowance.beyondUsd;
    note = `past ${line.allowance.limit.toLocaleString('en-GB')} free a month`;
  } else {
    u = await ledgerUsd(c, a, b, { q });
  }
  return { gbp: u * USD_TO_GBP, nativeUsd: usd ? u : null, basis: 'estimate', source: null, at: null, note };
}

/** The residue: ledger rows no register entry answers for, at the ledger's figure. */
export const residueOf = (register) => ({
  key: 'several', name: 'Several sources at once', kind: 'residue',
  providerKeys: register.map((c) => c.providerKey).filter(Boolean),
});

/** Bases combined: all billed is billed, all estimate is estimate, anything else is both. */
export function combineBasis(bases) {
  const b = bases.filter(Boolean);
  if (!b.length) return null;
  if (b.every((x) => x === 'billed')) return 'billed';
  if (b.every((x) => x === 'estimate')) return 'estimate';
  if (b.every((x) => x === 'budget')) return 'budget';
  return 'billed+estimate';
}

/**
 * A supplier over any window, from its months.
 *
 * The suite's windows are not all calendar months ("Last 30 days"), and a
 * bill is only ever read by the month. So a window is split into the months
 * it touches: a month it covers whole — or to date, for the month it ends in
 * — is that month's figure; a month it covers in part is that month's figure
 * times the share of the month's ledger (list price) that falls inside the
 * window. Showing the whole calendar month instead would count days outside
 * the window, and a straight share of days would spread a bill over days
 * nothing was asked. The parts of a month always add back to the month, so no
 * window counts a pound twice. Months are the window's own (UTC) months, the
 * key the ledger's London month is read by — an hour apart in summer, which
 * moves nothing a bill can see.
 */
export async function supplierWindow(c, from, to, { q = query, now = new Date(), cache = null } = {}) {
  const f = new Date(from); const t = new Date(to);
  const kind = c.kind === 'residue' ? 'residue' : supplierKind(c);
  if (kind === 'invoiced' || kind === 'within') return supplierMonth(c, monthKey(f), { q, cache });
  const parts = [];
  for (let m = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1)); m < t; m = nextMonth(monthKey(m))) {
    const month = monthKey(m);
    const end = nextMonth(month);
    const whole = f <= m && (t >= end || t >= new Date(Math.min(end.getTime(), now.getTime() - 60_000)));
    const fig = kind === 'residue' ? await residueMonth(c, month, { q, cache }) : await supplierMonth(c, month, { q, cache });
    if (whole || !fig.gbp) { parts.push({ ...fig, share: 1 }); continue; }
    const [inside, all] = await Promise.all([
      ledgerUsd(c, f > m ? f : m, t < end ? t : end, { q }),
      ledgerUsd(c, m, end, { q }),
    ]);
    const share = all > 0 ? inside / all : ((t < end ? t : end) - (f > m ? f : m)) / (end - m);
    parts.push({ ...fig, gbp: fig.gbp * share, nativeUsd: fig.nativeUsd == null ? null : fig.nativeUsd * share, share });
  }
  const priced = parts.filter((p) => p.gbp != null);
  const gbp = priced.reduce((s, p) => s + p.gbp, 0);
  const anyUsd = priced.some((p) => p.nativeUsd != null);
  // A month with nothing asked and nothing billed says nothing about the basis.
  const said = priced.filter((p) => p.gbp > 0 || p.basis !== 'estimate');
  const last = [...said].reverse().find((p) => p.source) ?? null;
  return {
    gbp,
    nativeUsd: anyUsd ? priced.reduce((s, p) => s + (p.nativeUsd ?? 0), 0) : null,
    basis: combineBasis(said.map((p) => p.basis)) ?? 'estimate',
    source: last?.source ?? null,
    at: last?.at ?? null,
    note: parts.length === 1 ? parts[0].note ?? null : null,
    apportioned: parts.some((p) => p.share < 1),
  };
}

async function residueMonth(c, month, { q, cache }) {
  const key = `several|${month}`;
  if (cache?.has(key)) return cache.get(key);
  const p = (async () => {
    const [a, b] = await londonBounds(month, q);
    const u = await ledgerUsd(c, a, b, { q });
    return { gbp: u * USD_TO_GBP, nativeUsd: null, basis: 'estimate', source: null, at: null, note: 'ledger, at list price' };
  })();
  cache?.set(key, p);
  return p;
}

/**
 * What a supplier was expected to cost over the months given: each month's
 * bill where there is one; its estimate where the estimate is above nought
 * (labelled so); else its monthly budget (Claude, Google); else nothing.
 * Never a nought that is not on a bill — "$0 expected" of a supplier nobody
 * has read a bill for is a measurement nobody made.
 */
export async function supplierExpected(c, months, { q = query, cache = null, budgets = {} } = {}) {
  const kind = supplierKind(c);
  if (kind === 'invoiced' || kind === 'within' || !months.length) return { gbp: null, nativeUsd: null, basis: null };
  const budget = kind === 'google' ? budgets.google : kind === 'anthropic' ? budgets.claude : null;
  let gbp = 0; let nativeUsd = BILLS_IN_USD.has(c.key) ? 0 : null; const bases = [];
  for (const month of months) {
    const m = await supplierMonth(c, month, { q, cache });
    if (m.basis === 'billed' || m.basis === 'billed+estimate' || (m.basis === 'estimate' && m.gbp > 0.005)) {
      gbp += m.gbp; if (nativeUsd != null) nativeUsd += m.nativeUsd ?? m.gbp / USD_TO_GBP; bases.push(m.basis);
    } else if (Number.isFinite(budget) && budget > 0) {
      gbp += budget; if (nativeUsd != null) nativeUsd += budget / USD_TO_GBP; bases.push('budget');
    } else return { gbp: null, nativeUsd: null, basis: null };
  }
  return { gbp, nativeUsd, basis: combineBasis(bases) };
}

/**
 * The months a window's "expected" is read from: the same number of whole
 * calendar months immediately before it. A window that does not start on a
 * month ("Last 30 days") is compared with the last whole month before the one
 * it ends in — last month's bill, as the owner asked.
 */
export function expectedMonths(period) {
  const from = new Date(period.from);
  const startsOnMonth = from.getUTCDate() === 1 && from.getUTCHours() === 0 && from.getUTCMinutes() === 0;
  const base = startsOnMonth ? from : (() => { const t = new Date(period.to); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)); })();
  const n = Math.max(1, period.months ?? 1);
  const out = [];
  for (let i = n; i >= 1; i -= 1) out.push(monthKey(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1))));
  return out;
}
