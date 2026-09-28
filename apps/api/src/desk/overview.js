/**
 * Overview: read-only (handover 6.1, C50; README "Overview"). No inputs.
 *
 *   - Needs you: only true human decisions — mapping decisions waiting, and
 *     person-set defaults their confirmed places contradict. "Nothing needs
 *     you" when empty. The machine's backlog is not listed.
 *   - Health: Verification, Sources, Accuracy, Spend, each green, amber or red
 *     — or `none` where the tile cannot speak (Accuracy building, no source
 *     asked anything this week), which is never drawn as green.
 *   - Collections: most engaged, shown but never opened, reach nobody; "—"
 *     until there are real households.
 *   - Growth: places known, facts verified this week, households, with trends.
 */

import { query } from '../db.js';
import { settings } from './settings.js';
import { mappingState } from './mapping.js';
import { status as verificationStatus, sources } from './verification.js';
import { accuracy } from './accuracy.js';
import { collectionList } from './collections.js';
import { FILED_SQL, STANDARD, contradictedDefaults as banded } from './categories.js';
import { USD_TO_GBP } from '../domain/providerPrices.js';

/**
 * Person-set defaults most confirmed places contradict (C49), compared in
 * bands exactly as Categories compares them (`?sort=review` puts the same
 * subcategories first), so the two never disagree about what needs a person.
 */
const contradictedDefaults = () => banded();

/** Spend this month in pounds, by Google and Claude, from the ledger. */
async function spend() {
  const { rows } = await query(`
    select case when provider ~ 'google' then 'google' when provider ~ 'anthropic|claude' then 'claude' else 'other' end as who,
           coalesce(sum(estimated_cost_usd), 0)::float usd
      from provider_calls where created_at >= date_trunc('month', now()) group by 1`);
  const by = new Map(rows.map((r) => [r.who, r.usd * USD_TO_GBP]));
  return { google: by.get('google') ?? 0, claude: by.get('claude') ?? 0 };
}

/**
 * The Spend tile: the month's Google and Claude spend against each budget, in
 * the words the tile uses. The desk's Runs screen draws the same object at its
 * top, so the tile and "Recent runs and spend →" land where the spend is shown
 * (second audit CH.4) and the two can never disagree.
 */
function spendTile(money, cfg) {
  const googlePct = cfg.budgetGoogle ? money.google / cfg.budgetGoogle : 0;
  const claudePct = cfg.budgetClaude ? money.claude / cfg.budgetClaude : 0;
  const worst = Math.max(googlePct, claudePct);
  return {
    tone: worst > 1 ? 'red' : worst > 0.8 ? 'amber' : 'green',
    title: `Google £${Math.round(money.google)} of £${cfg.budgetGoogle} · Claude £${Math.round(money.claude)} of £${cfg.budgetClaude}`,
    line: worst > 1 ? 'over budget' : worst > 0.8 ? 'close to budget' : 'within budget',
    google: { spent: money.google, budget: cfg.budgetGoogle },
    claude: { spent: money.claude, budget: cfg.budgetClaude },
  };
}

/** This month's spend on its own, for the Runs screen. */
export async function spendThisMonth() {
  const [cfg, money] = await Promise.all([settings().then((s) => s.values), spend()]);
  return spendTile(money, cfg);
}

/**
 * The Verification tile. "Running" is claimed only when the verifier checked
 * something inside the stall window; an empty backlog with no check for
 * longer than that is Idle — grey, can't-speak, never green (second audit
 * CH.3). Read from the status's own `lastAt`, so it holds whether or not the
 * status names the idle state itself.
 */
export function verificationTile(verif, now = Date.now()) {
  const quiet = verif.lastAt && now - new Date(verif.lastAt).getTime() > STALL_MS;
  const state = verif.state === 'running' && quiet ? 'idle' : verif.state;
  if (state === 'running') return { tone: 'green', title: 'Running', line: `last checked ${ago(verif.lastAt)}` };
  if (state === 'idle') return { tone: 'none', title: 'Idle', line: `nothing to check · last checked ${ago(verif.lastAt)}` };
  if (state === 'stalled') return { tone: 'red', title: 'Stalled', line: `nothing checked for ${verif.hours} hours` };
  return { tone: 'red', title: 'Never run', line: 'nothing checked yet' };
}
const STALL_MS = 3 * 3600_000;

/**
 * A weekly series: seven points, this week and the six before it, so the
 * sparkline's first point is the "6 weeks" ago its line counts from.
 */
async function weekly(sql) {
  const { rows } = await query(sql);
  return rows.map((r) => ({ week: r.week, n: Number(r.n) }));
}

export async function overview() {
  const cfg = (await settings()).values;
  const [mapping, contradicted, verif, srcs, acc, coll, money, { rows: [{ n: households }] }] = await Promise.all([
    mappingState(),
    contradictedDefaults(),
    verificationStatus(),
    sources(cfg),
    accuracy({}),
    collectionList({}),
    spend(),
    // A household is counted once somebody has actually signed in to it.
    query(`select count(*)::int n from households h
            where exists (select 1 from accounts a where a.household_id = h.id and a.activated_at is not null)`),
  ]);

  // ---- Needs you
  const needs = [];
  if (mapping.counts.needs) needs.push({ key: 'mapping', n: mapping.counts.needs, label: `${mapping.counts.needs} mapping decision${mapping.counts.needs === 1 ? '' : 's'}`, where: 'Mapping › Needs a decision' });
  if (contradicted.length) needs.push({ key: 'defaults', n: contradicted.length, label: `${contradicted.length} bulk setting${contradicted.length === 1 ? '' : 's'} contradicted by ${contradicted.length === 1 ? 'its' : 'their'} places`, where: 'Categories › subcategory defaults', subs: [...new Set(contradicted.map((c) => c.sub))] });

  // ---- Health
  const heard = srcs.some((s) => s.source !== 'families' && s.checked > 0);
  const failing = srcs.filter((s) => s.status === 'Failing');
  const slow = srcs.filter((s) => s.status === 'Slow');
  const health = {
    verification: verificationTile(verif),
    // "All answering" is a claim, and it can only be made of sources that were
    // asked something: with nothing checked this week the tile cannot speak.
    sources: failing.length || slow.length || heard
      ? {
        tone: failing.length ? 'red' : slow.length ? 'amber' : 'green',
        title: failing.length ? `${failing.map((s) => s.label).join(', ')} failing` : slow.length ? `${slow.map((s) => s.label).join(', ')} slow` : 'All answering',
        line: failing.length || slow.length ? 'the rest answering' : null,
      }
      : { tone: 'none', title: 'Not asked yet', line: 'no source checked anything this week' },
    accuracy: acc.headline.building
      ? { tone: 'none', title: 'Building', line: `${acc.headline.answered} family answer${acc.headline.answered === 1 ? '' : 's'} so far` }
      : {
        tone: acc.headline.accuracy >= 90 ? 'green' : acc.headline.accuracy >= 80 ? 'amber' : 'red',
        title: `Machine agreed with families ${acc.headline.accuracy}%`,
        line: 'against family answers',
      },
    spend: spendTile(money, cfg),
  };

  // ---- Collections
  const speaks = coll.engagementSpeaks;
  const withE = coll.rows.filter((r) => r.active);
  const collections = speaks
    ? {
      speaks: true,
      mostEngaged: [...withE].sort((a, b) => (b.opened + b.hearted) - (a.opened + a.hearted)).slice(0, 3).map(pick),
      shownNeverOpened: withE.filter((r) => r.shown > 0 && r.opened === 0).slice(0, 3).map(pick),
      reachNobody: withE.filter((r) => r.shown === 0).slice(0, 3).map(pick),
    }
    : { speaks: false };

  // ---- Growth
  const [placesSeries, factsSeries, householdsSeries] = await Promise.all([
    weekly(`select to_char(date_trunc('week', g), 'YYYY-MM-DD') as week,
                   (select count(*) from place_index where subcategory is not null and not_in_epic_at is null and first_seen < g + interval '7 days') as n
              from generate_series(date_trunc('week', now()) - interval '6 weeks', date_trunc('week', now()), interval '1 week') g`),
    weekly(`select to_char(date_trunc('week', g), 'YYYY-MM-DD') as week,
                   (select count(*) from fact_checks where outcome = 'verified' and at >= g and at < g + interval '7 days') as n
              from generate_series(date_trunc('week', now()) - interval '6 weeks', date_trunc('week', now()), interval '1 week') g`),
    // Households by the end of each week, counted the way the headline is:
    // once somebody has signed in to it.
    weekly(`select to_char(date_trunc('week', g), 'YYYY-MM-DD') as week,
                   (select count(*) from households h where exists (
                      select 1 from accounts a where a.household_id = h.id and a.activated_at is not null
                         and a.activated_at < g + interval '7 days')) as n
              from generate_series(date_trunc('week', now()) - interval '6 weeks', date_trunc('week', now()), interval '1 week') g`),
  ]);
  const placesNow = placesSeries[placesSeries.length - 1]?.n ?? 0;
  const factsNow = factsSeries[factsSeries.length - 1]?.n ?? 0;
  const factsLast = factsSeries[factsSeries.length - 2]?.n ?? 0;
  const growth = {
    places: { n: placesNow, line: `+${(placesNow - (placesSeries[0]?.n ?? 0)).toLocaleString('en-GB')} in ${placesSeries.length - 1} weeks`, series: placesSeries },
    facts: { n: factsNow, line: `last week ${factsLast.toLocaleString('en-GB')}`, series: factsSeries },
    households: households ? { n: households, line: null, series: householdsSeries } : { n: null, line: 'none yet', series: householdsSeries },
  };

  return { needs, health, collections, growth };
}

function pick(r) { return { key: r.key, title: r.title, shown: r.shown, opened: r.opened, hearted: r.hearted }; }

/** "4 min ago", "3 hours ago", "2 days ago". */
export function ago(at) {
  if (!at) return 'never';
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
