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
  const [{ rows: checks }, { rows: waiting }, { rows: [oldest] }, { rows: droppedMonth }] = await Promise.all([
    query('select outcome, source, first_seen, at from fact_checks where at >= $1 or (first_seen is not null and first_seen >= $1)', [since]),
    query('select first_seen from fact_suggestions'),
    query('select min(first_seen) at from fact_suggestions'),
    query(`select at from fact_checks where outcome = 'dropped' and at >= date_trunc('month', now())`),
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
  const weekAgo = Date.now() - 7 * 86400_000;
  const dropped = {
    month: droppedMonth.length,
    thisWeek: droppedMonth.filter((d) => new Date(d.at).getTime() >= weekAgo).length,
    weekBefore: droppedMonth.filter((d) => { const t = new Date(d.at).getTime(); return t < weekAgo && t >= weekAgo - 7 * 86400_000; }).length,
  };
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

/** Our own sources: which provider_calls purposes/providers each is read by. */
const SOURCE_PROVIDERS = {
  site: ['site', 'venue'],
  osm: ['osm', 'overpass', 'nominatim'],
  wikipedia: ['wikipedia'],
  wikidata: ['wikidata'],
};

/**
 * The sources table: checked in 7 days, answered, failing %, and a status
 * from the owner's thresholds (Slow ≥ sourceSlow %, Failing ≥ sourceFailing
 * %). A source that checked nothing while others were active is Failing.
 */
export async function sources(cfg) {
  const { rows: evidence } = await query(
    `select source, count(*)::int checked, count(*) filter (where says in ('yes','no'))::int answered
       from place_fact_evidence where checked_at >= now() - interval '7 days' group by source`);
  const { rows: calls } = await query(
    `select provider, count(*)::int n, count(*) filter (where ok is false or failed > 0)::int failed
       from provider_calls where created_at >= now() - interval '7 days' group by provider`);
  const { rows: [fam] } = await query(
    `select count(*)::int checked, count(*) filter (where answer <> 'didnt_notice')::int answered
       from family_answers where answered_at >= now() - interval '7 days'`);
  const ev = new Map(evidence.map((e) => [e.source, e]));
  const out = [];
  for (const [src, providers] of Object.entries(SOURCE_PROVIDERS)) {
    const e = ev.get(src) ?? { checked: 0, answered: 0 };
    const c = calls.filter((x) => providers.some((p) => String(x.provider).toLowerCase().includes(p)));
    const n = c.reduce((s, x) => s + x.n, 0);
    const failed = c.reduce((s, x) => s + x.failed, 0);
    out.push({ source: src, label: SOURCE_WORD[src], checked: e.checked, answered: e.answered, failingPct: n ? Math.round((failed / n) * 100) : null });
  }
  out.push({ source: 'families', label: SOURCE_WORD.families, checked: fam?.checked ?? 0, answered: fam?.answered ?? 0, failingPct: null });
  // Only our machine sources say whether checking is running at all; a family
  // answer arriving while nothing is checked must not turn every machine
  // source red (Codex, 28 Sep 2026).
  const anyActive = out.some((s) => s.source !== 'families' && s.checked > 0);
  for (const s of out) {
    if (s.source !== 'families' && anyActive && s.checked === 0) s.status = 'Failing';
    else if (s.failingPct == null) s.status = s.checked > 0 || s.source === 'families' ? 'Healthy' : '—';
    else if (s.failingPct >= cfg.sourceFailing) s.status = 'Failing';
    else if (s.failingPct >= cfg.sourceSlow) s.status = 'Slow';
    else s.status = 'Healthy';
  }
  return out;
}

/**
 * A drill-down: fact · place · area · outcome · when, filterable by country,
 * county and feature. `kind` is backlog | confirmed | dropped | checked |
 * answered | notThere | nothingFound | conflicts; `source` narrows to one of
 * our sources (the Sources table's numbers). Backlog items sort oldest first;
 * Dropped at 30 days is this month's, as its chart card counts it.
 */
export async function items({ kind, period = '7d', source = null, country = null, county = null, feature = null, limit = 300 } = {}) {
  const since = new Date(Date.now() - (period === '24h' ? 1 : period === '30d' ? 30 : 7) * 86400_000);
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
                case f.answer when 'yes' then 'verified' when 'no' then 'no' else 'dont_know' end as outcome, 'families' as source
           from family_answers f join place_attributes a on a.key = f.attribute_key
          where f.answered_at >= now() - interval '7 days' ${kind === 'answered' ? `and f.answer <> 'didnt_notice'` : ''}
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
    if (kind === 'dropped') where += ` and at >= date_trunc('month', now())`;
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
