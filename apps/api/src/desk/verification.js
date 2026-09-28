/**
 * Verification: a health check only (handover 6.3, C45; README "Verification").
 *
 * Its one job is to show the machine is running and flowing. There are no
 * buttons that start jobs. Every number drills down to its items. Can't-speak
 * states are explicit: "Never run" when nothing has ever been checked, never an
 * empty page that looks fine.
 */

import { query } from '../db.js';
import { settings } from './settings.js';
import { describe, SOURCE_WORD } from './places.js';
import { recordMetered } from '../repositories/providerCalls.js';

const STALL_MS = 3 * 3600_000;

/** Whether the machine is running, stalled or has never run. */
export async function status() {
  const [{ rows: [last] }, { rows: [{ n: backlog }] }] = await Promise.all([
    query('select max(at) at, count(*)::int n from fact_checks'),
    query('select count(*)::int n from fact_suggestions'),
  ]);
  if (!last?.n) return { state: 'never', lastAt: null, backlog };
  const age = Date.now() - new Date(last.at).getTime();
  // Stalled only when there is something to check and nothing has been: an
  // empty backlog with no recent checks is quiet, not broken.
  if (backlog > 0 && age > STALL_MS) return { state: 'stalled', lastAt: last.at, backlog, hours: Math.floor(age / 3600_000) };
  // Nothing waiting and nothing checked for longer than the stall window: not
  // broken, but not "Running" either — idle, drawn grey (audit CH.3, 28 Sep).
  if (backlog === 0 && age > STALL_MS) return { state: 'idle', lastAt: last.at, backlog };
  return { state: 'running', lastAt: last.at, backlog };
}

/** Buckets for a period: 24 hourly or 7 daily. */
function buckets(period) {
  const hourly = period === '24h';
  const n = hourly ? 24 : 7;
  const step = hourly ? 3600_000 : 86400_000;
  const end = hourly ? Math.ceil(Date.now() / step) * step : new Date(new Date().toDateString()).getTime() + step;
  return Array.from({ length: n }, (_, i) => ({ from: new Date(end - (n - i) * step), to: new Date(end - (n - i - 1) * step) }));
}

/**
 * The three charts, the secondary numbers and the sources table.
 * `period` is '24h' or '7d'.
 */
export async function verification({ period = '24h' } = {}) {
  const cfg = (await settings()).values;
  const st = await status();
  if (st.state === 'never') return { status: st, period };
  const bs = buckets(period);
  const since = bs[0].from;
  const [{ rows: checks }, { rows: waiting }, { rows: [oldest] }, { rows: [drops] }] = await Promise.all([
    query('select outcome, source, first_seen, at from fact_checks where at >= $1 or (first_seen is not null and first_seen >= $1)', [since]),
    query('select first_seen from fact_suggestions'),
    query('select min(first_seen) at from fact_suggestions'),
    // This month's for the big number; the two weeks from their own window,
    // so "this week · the week before" does not fall to nought on the 1st
    // (audit, 28 Sep 2026).
    query(`select count(*) filter (where at >= date_trunc('month', now()))::int as month,
                  count(*) filter (where at >= now() - interval '7 days')::int as this_week,
                  count(*) filter (where at < now() - interval '7 days' and at >= now() - interval '14 days')::int as week_before
             from fact_checks where outcome = 'dropped' and at >= least(date_trunc('month', now()), now() - interval '14 days')`),
  ]);
  const inB = (t, b) => { const x = new Date(t).getTime(); return x >= b.from.getTime() && x < b.to.getTime(); };
  // Backlog at the end of each bucket: waiting suggestions first seen by then,
  // plus checked ones first seen by then but checked after.
  const backlogSeries = bs.map((b) => {
    const end = b.to.getTime();
    const still = waiting.filter((w) => new Date(w.first_seen).getTime() < end).length;
    const later = checks.filter((c) => c.first_seen && new Date(c.first_seen).getTime() < end && new Date(c.at).getTime() >= end).length;
    return { at: b.to, n: still + later };
  });
  const confirmedSeries = bs.map((b) => ({ at: b.from, n: checks.filter((c) => c.outcome === 'verified' && inB(c.at, b)).length }));
  const droppedSeries = bs.map((b) => ({ at: b.from, n: checks.filter((c) => c.outcome === 'dropped' && inB(c.at, b)).length }));
  const inPeriod = checks.filter((c) => new Date(c.at).getTime() >= since.getTime());
  const confirmed = confirmedSeries.reduce((n, p) => n + p.n, 0);
  const half = Math.floor(confirmedSeries.length / 2);
  const firstHalf = confirmedSeries.slice(0, half).reduce((n, p) => n + p.n, 0);
  const secondHalf = confirmedSeries.slice(half).reduce((n, p) => n + p.n, 0);
  const dropped = { month: drops?.month ?? 0, thisWeek: drops?.this_week ?? 0, weekBefore: drops?.week_before ?? 0 };
  return {
    status: st,
    period,
    backlog: {
      now: st.backlog,
      oldestDays: oldest?.at ? Math.floor((Date.now() - new Date(oldest.at).getTime()) / 86400_000) : null,
      oldestAt: oldest?.at ?? null,
      series: backlogSeries,
      // Amber if rising across the period.
      amber: backlogSeries.length > 1 && backlogSeries[backlogSeries.length - 1].n > backlogSeries[0].n,
    },
    confirmed: {
      total: confirmed,
      series: confirmedSeries,
      // Amber if it falls sharply: the second half under half the first.
      amber: firstHalf > 0 && secondHalf < firstHalf / 2,
    },
    dropped: {
      ...dropped,
      series: droppedSeries,
      // Amber when above zero and rising.
      amber: dropped.thisWeek > 0 && dropped.thisWeek > dropped.weekBefore,
    },
    numbers: {
      checked: inPeriod.filter((c) => c.outcome !== 'dropped').length,
      notThere: inPeriod.filter((c) => c.outcome === 'no').length,
      nothingFound: inPeriod.filter((c) => c.outcome === 'dont_know').length,
      conflicts: (await query(`select count(*)::int n from place_fact_answers where state = 'conflict'`)).rows[0].n,
    },
    sources: await sources(cfg),
  };
}

/** Our own machine sources, in the order the table lists them. */
const MACHINE = ['site', 'osm', 'wikipedia', 'wikidata'];

/**
 * The purpose a verification fetch is written under in `provider_calls`.
 * A stable string: add, never rename.
 */
export const VERIFY_PURPOSE = 'fact-verify';

/**
 * Which sources the verify step actually fetches from. The venue page and
 * the Wikipedia body are read from the copy the researcher stored, and the
 * open map from Epic's own extract, so checking them makes no request that
 * could fail; only Wikidata's facilities are fetched live.
 */
const FETCHED_WHEN_CHECKING = new Set(['wikidata']);

/**
 * Write down one fetch the verify step made, and whether it came back — the
 * numerator and denominator of a source's Failing % (README "Verification":
 * the failure rate of that source's own checks, not of every call anybody
 * made to the same provider). Free: no cost, no household. Never throws —
 * the check it describes has already happened.
 */
export async function noteFetch(source, ok, { ms = null, fault = null } = {}) {
  await recordMetered({
    householdId: null, provider: String(source), purpose: VERIFY_PURPOSE, units: null,
    costUsd: 0, ok: Boolean(ok), ms, fault: ok ? null : String(fault ?? 'error').slice(0, 40),
  }).catch(() => null);
}

/**
 * The sources table: checked in 7 days, answered, failing %, and a status
 * from the owner's thresholds (Slow ≥ sourceSlow %, Failing ≥ sourceFailing
 * %). A machine source that checked nothing while others were active is
 * Failing. Failing % is the share of the verify step's own fetches from that
 * source that failed (`noteFetch`); where the step fetched nothing it cannot
 * speak and says why (`failingWhy`). Families checked nothing while machine
 * sources were active is "—" with a note, never Healthy and never red:
 * families answer only after real visits.
 */
export async function sources(cfg) {
  const { rows: evidence } = await query(
    `select source, count(*)::int checked, count(*) filter (where says in ('yes','no'))::int answered
       from place_fact_evidence where checked_at >= now() - interval '7 days' group by source`);
  const { rows: calls } = await query(
    `select provider, count(*)::int n, count(*) filter (where ok is false or failed > 0)::int failed
       from provider_calls where purpose = $1 and created_at >= now() - interval '7 days' group by provider`, [VERIFY_PURPOSE]);
  const { rows: [fam] } = await query(
    // "Didn't notice" (stored as unsure) is never counted anywhere — not even
    // as a check (the visit question, 28 Sep 2026).
    `select count(*)::int checked, count(*)::int answered
       from family_answers where answered_at >= now() - interval '7 days' and answer in ('yes', 'no')`);
  const ev = new Map(evidence.map((e) => [e.source, e]));
  const out = [];
  for (const src of MACHINE) {
    const e = ev.get(src) ?? { checked: 0, answered: 0 };
    const c = calls.find((x) => x.provider === src);
    const failingWhy = c?.n ? null
      : FETCHED_WHEN_CHECKING.has(src) ? 'No fetches recorded by the check in the last 7 days'
        : 'Checked from the copy Epic holds — nothing fetched, so nothing can fail';
    out.push({ source: src, label: SOURCE_WORD[src], checked: e.checked, answered: e.answered, failingPct: c?.n ? Math.round((c.failed / c.n) * 100) : null, failingWhy, note: null });
  }
  out.push({ source: 'families', label: SOURCE_WORD.families, checked: fam?.checked ?? 0, answered: fam?.answered ?? 0, failingPct: null, failingWhy: 'Families are asked, not fetched', note: null });
  // Only our machine sources say whether checking is running at all; a family
  // answer arriving while nothing is checked must not turn every machine
  // source red (Codex, 28 Sep 2026).
  const anyActive = out.some((s) => s.source !== 'families' && s.checked > 0);
  for (const s of out) {
    if (s.source === 'families') {
      s.status = s.checked > 0 ? 'Healthy' : '—';
      if (!s.checked && anyActive) s.note = 'no family answers this week';
    } else if (anyActive && s.checked === 0) {
      // Failing because it checked nothing while the others did — not because
      // a fetch failed, so "nothing can fail" would contradict the red word.
      s.status = 'Failing';
      if (s.failingPct == null) s.failingWhy = 'Checked nothing this week while others did';
    } else if (s.failingPct == null) s.status = s.checked > 0 ? 'Healthy' : '—';
    else if (s.failingPct >= cfg.sourceFailing) s.status = 'Failing';
    else if (s.failingPct >= cfg.sourceSlow) s.status = 'Slow';
    else s.status = 'Healthy';
  }
  return out;
}

/**
 * The four counts in Fact automations' header (prototype `ruleResults`):
 * verified this month, conflicts standing now, don't know this month, and
 * the backlog. Each opens its Verification drill-down.
 */
export async function monthResults() {
  const [{ rows: [m] }, { rows: [c] }, { rows: [b] }] = await Promise.all([
    query(`select count(*) filter (where outcome = 'verified')::int verified,
                  count(*) filter (where outcome = 'dont_know')::int dont_know
             from fact_checks where at >= date_trunc('month', now())`),
    query(`select count(*)::int n from place_fact_answers where state = 'conflict'`),
    query('select count(*)::int n from fact_suggestions'),
  ]);
  return { verified: m?.verified ?? 0, conflicts: c?.n ?? 0, dontKnow: m?.dont_know ?? 0, backlog: b?.n ?? 0 };
}

/**
 * A drill-down: fact · place · area · outcome · when, filterable by country,
 * county and feature. `kind` is backlog | confirmed | dropped | checked |
 * answered | notThere | nothingFound | conflicts; `source` narrows to one of
 * our sources (the Sources table's numbers). Backlog items sort oldest first;
 * Dropped at 30 days is this month's, as its chart card counts it.
 */
export async function items({ kind, period = '7d', source = null, country = null, county = null, feature = null, limit = 300 } = {}) {
  // 'month' is this calendar month, as Fact automations' header counts it.
  const since = period === 'month'
    ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    : new Date(Date.now() - (period === '24h' ? 1 : period === '30d' ? 30 : 7) * 86400_000);
  let rows = [];
  if (kind === 'backlog') {
    ({ rows } = await query(`select venue_ref, feature, first_seen as at, 'backlog' as outcome, null as source from fact_suggestions order by first_seen asc limit 2000`));
  } else if (kind === 'conflicts') {
    ({ rows } = await query(
      `select x.venue_ref, a.label as feature, x.checked_at as at, 'conflict' as outcome, x.source
         from place_fact_answers x join place_attributes a on a.key = x.attribute_key where x.state = 'conflict' order by x.checked_at desc limit 2000`));
  } else if (source && (kind === 'checked' || kind === 'answered')) {
    // A Sources-table number, opened: read the same records it was counted
    // from — every piece of evidence that source gave in the last 7 days, or
    // every family answer — not the verdicts, which name only the source that
    // won (Codex, 28 Sep 2026).
    if (source === 'families') {
      ({ rows } = await query(
        `select f.venue_ref, a.label as feature, f.answered_at as at,
                case f.answer when 'yes' then 'verified' else 'no' end as outcome, 'families' as source
           from family_answers f join place_attributes a on a.key = f.attribute_key
          where f.answered_at >= now() - interval '7 days' and f.answer in ('yes', 'no')
          order by f.answered_at desc limit 2000`));
    } else {
      ({ rows } = await query(
        `select e.venue_ref, a.label as feature, e.checked_at as at,
                case e.says when 'yes' then 'verified' when 'no' then 'no' else 'dont_know' end as outcome, e.source
           from place_fact_evidence e join place_attributes a on a.key = e.attribute_key
          where e.source = $1 and e.checked_at >= now() - interval '7 days' ${kind === 'answered' ? `and e.says in ('yes','no')` : ''}
          order by e.checked_at desc limit 2000`, [source]));
    }
  } else {
    const outcome = {
      confirmed: ['verified'], dropped: ['dropped'], checked: ['verified', 'no', 'dont_know', 'conflict'],
      answered: ['verified', 'no', 'conflict'], notThere: ['no'], nothingFound: ['dont_know'],
    }[kind];
    if (!outcome) return { rows: [], total: 0, counties: [], countries: [], features: [] };
    const args = [outcome];
    let where = 'outcome = any($1)';
    if (kind === 'dropped' || period === 'month') where += ` and at >= date_trunc('month', now())`;
    else { args.push(since); where += ` and at >= $${args.length}`; }
    if (source) { args.push(source); where += ` and source = $${args.length}`; }
    ({ rows } = await query(`select venue_ref, feature, at, outcome, source from fact_checks where ${where} order by at desc limit 2000`, args));
  }
  const d = await describe(rows.map((r) => r.venue_ref));
  const WORD = { verified: 'Confirmed', no: 'Not there', dont_know: 'Nothing found', conflict: 'Conflict', dropped: 'Dropped at 30 days', backlog: 'Backlog' };
  const all = rows.map((r) => {
    const p = d.get(r.venue_ref) ?? {};
    return { ref: r.venue_ref, feature: r.feature, place: p.name ?? null, area: p.area ?? null, county: p.county ?? null, country: p.country ?? null, outcome: WORD[r.outcome] ?? r.outcome, source: SOURCE_WORD[r.source] ?? r.source ?? null, at: r.at };
  });
  const out = all
    .filter((r) => !country || r.country === country)
    .filter((r) => !county || r.county === county)
    .filter((r) => !feature || String(r.feature).toLowerCase() === String(feature).toLowerCase());
  return {
    rows: out.slice(0, limit),
    total: out.length,
    // The filters' choices come from the whole drill-down, not the narrowed one.
    counties: [...new Set(all.map((r) => r.county).filter(Boolean))].sort(),
    countries: [...new Set(all.map((r) => r.country).filter(Boolean))].sort(),
    features: [...new Set(all.map((r) => r.feature).filter(Boolean))].sort(),
  };
}
