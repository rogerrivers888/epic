/**
 * Claude's spend, as the ledger records it and as Anthropic billed it (owner,
 * 29 Sep 2026: "Replace the £121 ledger estimate, show Claude spend in USD
 * with the GBP equivalent, and find why the ledger overstated it… report
 * which callers use the most tokens (census/harvest runs, the pipeline,
 * agents)").
 *
 * The ledger (`provider_calls`) knows who asked, with what tokens; it does
 * not know which model answered (the row has no model column), so its dollar
 * figure is list price at whichever rate the caller assumed. Anthropic's
 * console is the bill. The figure from the console is a setting
 * (`claudeBilling`) until an Admin API key is read — that key is the owner's.
 */

import { query } from '../db.js';

/** A purpose → the family the owner asked to see it under. First match wins. */
export const FAMILY_OF = [
  [/^(census|ring|sweep|research|own\.|admin\.bench|activity)/, 'Census, sweeps and research runs'],
  [/(harvest|vocabulary|classif|question|feature)/, 'Harvest and classifier runs'],
  [/^(desk|pipeline|spot|verify|answer|fact)/, 'Fact pipeline'],
  [/(menu|dish|taste)/, 'Menus and dishes'],
  [/(plan|inspire|preview|intent|trip|voice|itinerar)/, 'Planner and Inspire'],
  [/(host|skill|chat|group)/, 'Hosts, groups and chat'],
];
export const familyOf = (purpose) => FAMILY_OF.find(([re]) => re.test(String(purpose ?? '')))?.[1] ?? 'Everything else';

const CLAUDE = `provider ~* 'anthropic|claude'`;
const IN_MONTH = `p.created_at >= (($1::text || '-01')::date::timestamp at time zone 'Europe/London')
  and p.created_at < ((($1::text || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/London')`;

/**
 * One month's Claude rows by purpose and by who was signed in: calls, the
 * ones that failed, every kind of token, and the ledger's dollar figure —
 * with how much of that figure sits on rows that failed or carry no tokens
 * at all (a cost nobody's tokens can account for).
 */
export async function claudeByCaller(month) {
  const [{ rows: purposes }, { rows: kinds }, { rows: days }, { rows: sessions }] = await Promise.all([
    query(`
      select p.purpose, count(*)::int calls,
             count(*) filter (where p.ok = false or p.failed > 0)::int failed,
             coalesce(sum(p.input_tokens), 0)::float input, coalesce(sum(p.output_tokens), 0)::float output,
             coalesce(sum(p.cache_read_tokens), 0)::float cache_read, coalesce(sum(p.cache_write_tokens), 0)::float cache_write,
             coalesce(sum(p.estimated_cost_usd), 0)::float usd,
             coalesce(sum(p.estimated_cost_usd) filter (where p.ok = false or p.failed > 0), 0)::float usd_failed,
             coalesce(sum(p.estimated_cost_usd) filter (where coalesce(p.input_tokens, 0) + coalesce(p.output_tokens, 0)
               + coalesce(p.cache_read_tokens, 0) + coalesce(p.cache_write_tokens, 0) = 0), 0)::float usd_no_tokens
        from provider_calls p
       where ${CLAUDE} and ${IN_MONTH}
       group by 1 order by usd desc`, [month]),
    query(`
      select coalesce(s.kind, 'none') kind, count(*)::int calls,
             coalesce(sum(p.input_tokens), 0)::float + coalesce(sum(p.output_tokens), 0)::float
               + coalesce(sum(p.cache_read_tokens), 0)::float + coalesce(sum(p.cache_write_tokens), 0)::float tokens,
             coalesce(sum(p.estimated_cost_usd), 0)::float usd
        from provider_calls p left join api_sessions s on s.id = p.session_id
       where ${CLAUDE} and ${IN_MONTH}
       group by 1 order by usd desc`, [month]),
    query(`
      select to_char(p.created_at at time zone 'Europe/London', 'YYYY-MM-DD') as day, count(*)::int calls,
             coalesce(sum(p.input_tokens), 0)::float + coalesce(sum(p.output_tokens), 0)::float
               + coalesce(sum(p.cache_read_tokens), 0)::float + coalesce(sum(p.cache_write_tokens), 0)::float tokens,
             coalesce(sum(p.estimated_cost_usd), 0)::float usd
        from provider_calls p
       where ${CLAUDE} and ${IN_MONTH}
       group by 1 order by 1`, [month]),
    // The individual callers: each session with its label and kind, the
    // biggest first (Codex) — a kind alone folds every agent into one row.
    query(`
      select p.session_id, s.label, coalesce(s.kind, 'none') kind, count(*)::int calls,
             coalesce(sum(p.input_tokens), 0)::float + coalesce(sum(p.output_tokens), 0)::float
               + coalesce(sum(p.cache_read_tokens), 0)::float + coalesce(sum(p.cache_write_tokens), 0)::float tokens,
             coalesce(sum(p.estimated_cost_usd), 0)::float usd,
             array_agg(distinct p.purpose) purposes
        from provider_calls p left join api_sessions s on s.id = p.session_id
       where ${CLAUDE} and ${IN_MONTH}
       group by 1, 2, 3 order by usd desc limit 20`, [month]),
  ]);
  const tokensOf = (r) => r.input + r.output + r.cache_read + r.cache_write;
  const families = new Map();
  for (const r of purposes) {
    const f = familyOf(r.purpose);
    const x = families.get(f) ?? { family: f, calls: 0, tokens: 0, usd: 0, purposes: [] };
    x.calls += r.calls; x.tokens += tokensOf(r); x.usd += r.usd; x.purposes.push(r.purpose);
    families.set(f, x);
  }
  const total = purposes.reduce((t, r) => ({
    calls: t.calls + r.calls, failed: t.failed + r.failed, tokens: t.tokens + tokensOf(r),
    input: t.input + r.input, output: t.output + r.output, cacheRead: t.cacheRead + r.cache_read, cacheWrite: t.cacheWrite + r.cache_write,
    usd: t.usd + r.usd, usdFailed: t.usdFailed + r.usd_failed, usdNoTokens: t.usdNoTokens + r.usd_no_tokens,
  }), { calls: 0, failed: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, usdFailed: 0, usdNoTokens: 0 });
  return {
    month,
    total,
    families: [...families.values()].sort((a, b) => b.usd - a.usd),
    purposes: purposes.map((r) => ({
      purpose: r.purpose, family: familyOf(r.purpose), calls: r.calls, failed: r.failed,
      input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite: r.cache_write, tokens: tokensOf(r),
      usd: r.usd, usdFailed: r.usd_failed, usdNoTokens: r.usd_no_tokens,
    })),
    // Who was signed in: a device is a family or the owner on a phone; an
    // agent is a passcode session (Claude Code, scripts); a service row is
    // the server's own loops; none is a row from before sessions were kept.
    bySession: kinds,
    topSessions: sessions.map((r) => ({ sessionId: r.session_id, label: r.label, kind: r.kind, calls: r.calls, tokens: r.tokens, usd: r.usd, purposes: r.purposes })),
    days,
  };
}
