/**
 * The runs that spend, in one list.
 *
 * Collect lives inside Places: starting a run happens where you find the gap,
 * and every *Collect here* button carries its own scope. **This page only
 * watches.** It exists because runs take hours, spend money and die when a
 * deploy lands mid-flight, so one page has to answer "what is going, what did it
 * cost, what failed" without the operator having to remember which county they
 * were in. It does no area browsing of its own.
 */

import { query } from '../db.js';
import { menuCauses } from './scout.js';
import { OURS_KINDS, oursKindOf } from '../domain/menuCauses.js';
import * as collectRuns from './collectRuns.js';
import { PRICE_PER_UNIT_USD, USD_TO_GBP } from '../domain/providerPrices.js';
import { OTHER_PURSE } from '../constants.js';

/** Pounds, to the nearest tenth of a penny, the way the board writes money. */
/**
 * A price, in as many places as it needs and no more.
 *
 * Under a penny a unit wants three; a whole run's cost wants two, because
 * "£0.758 a run" is a figure nobody says out loud (18 Sep 2026, the separate
 * audit).
 */
const pounds = (gbp) => `£${(gbp >= 0.1 ? gbp.toFixed(2) : gbp.toFixed(3).replace(/0$/, ''))}`;

/**
 * The eight ways of getting more data.
 *
 * `costs` and `cap` are said the way an operator would say them — "£1.40 each",
 * "78 of 120 left", "none" — because a ceiling written as a number with no unit
 * is a ceiling nobody checks.
 */
export const RUNS = [
  { key: 'harvest', label: 'The attraction harvest',
    explain: 'Wikidata and Wikipedia, ranked, with pictures we may keep. 107 regions.',
    costs: 'free', free: true, action: 'Run it' },
  { key: 'sweep', label: 'The postcode sweep',
    explain: 'One outcode’s food census. Chains are dropped and ratings banded at the call.',
    // What the button does, so a label never promises something it does not.
    // These three are asked of a *selection*, and choosing one is on Places.
    // The figure is worked out in `list()` from what our own sweeps have
    // actually cost, because a price typed on a screen is a price that stops
    // being true (18 Sep 2026, the separate audit).
    costs: null, free: false, action: 'Choose where' },
  { key: 'menus', label: 'Read the menus',
    explain: null, costs: 'free', free: true, action: 'See failures' },
  { key: 'rate', label: 'Ask Google what people think',
    explain: 'Banded into a word at the call; the figure is never written down.',
    // From the one price table, never retyped: it said £0.014 while the ledger
    // charged about £0.025, so the figure beside the button disagreed with the
    // quote and with the ceiling (Codex, 17 Sep 2026).
    costs: `${pounds(PRICE_PER_UNIT_USD.google * USD_TO_GBP)} each`, free: false, action: 'Choose where' },
  { key: 'tripadvisor', label: 'Ask Tripadvisor',
    explain: 'Opt-in, and the only run with a hard monthly ceiling.',
    costs: 'licensed', free: false, action: 'Choose where' },
  { key: 'curate', label: 'Write it up ourselves',
    explain: 'From the venue’s own site, Wikipedia and OSM — never from a provider’s reviews.',
    costs: 'free', free: true, action: 'Choose where' },
  { key: 'bench', label: 'Check our ordering against theirs',
    explain: 'Our order beside the licensed one. Verdicts are kept and the figures dropped.',
    costs: null, free: false, action: 'Open it' },
  { key: 'rescore', label: 'Work out the scores again',
    explain: 'No network and nothing spent. Run it after any change to the ready bar.',
    costs: 'free', free: true, action: 'Run it' },
  // Collect is the umbrella the other three are asked under, started from
  // Places. It is on this board because it is long-running and a deploy can
  // interrupt it — which is precisely what this page is for (Codex, 17 Sep
  // 2026).
  { key: 'collect', label: 'Collect, from Places',
    explain: 'Works through a list of places asking each source in turn. Picks itself up after a deploy.',
    costs: 'what the sources cost', free: false, action: 'Choose where' },
];

const one = async (sql, args = []) => (await query(sql, args)).rows[0] ?? null;

/** What every run is doing, what it last cost, and which of them need looking at. */
export async function list() {
  const harvest = await one(
    `select state, stage, started_at, finished_at, touched_at, counts, error, scope
       from harvest_runs order by started_at desc limit 1`);
  const harvestRegions = await one(
    `select count(*)::int as all_, count(*) filter (where harvest_state = 'done')::int as done from regions`);
  const sweep = await one(
    `select count(*)::int as areas, max(swept_at) as last, count(*) filter (where sweeping_since is not null)::int as going
       from scout_areas`);
  const sweepSpend = await one(
    // `cost_cents` is US cents — `activitySweep.js` writes `calls × USD × 100`.
    // Aliasing it as pence and printing it as pounds overstated every historical
    // figure on the board by about a quarter (Codex, 18 Sep 2026).
    `select round(coalesce(sum(cost_cents), 0) * ${USD_TO_GBP})::int as pence,
            count(*) filter (where cost_cents > 0)::int as runs,
            max(finished_at) as last from sweep_runs`);
  const menus = await one(
    `select count(*) filter (where state = 'read')::int as read,
            count(*) filter (where state <> 'read' and cause is not null)::int as failed,
            count(*)::int as tried, max(read_at) as last
       from place_menus`);
  const oursFailed = await one(
    `select count(*)::int as n from place_menus where state <> 'read' and cause = 'ours'`);
  const rate = await one(
    `select count(*)::int as calls, max(created_at) as last
       from provider_calls where provider = 'google' and purpose like 'admin.lookup.rate%'
        and created_at > now() - interval '90 days'`);
  // Their billable units, not our rows: one view is two locations (Codex,
  // 17 Sep 2026).
  // Off the meter rather than the label: a browse that asks several sources
  // together is one row named after all of them (Codex, 18 Sep 2026).
  const ta = await one(
    `select coalesce(sum(coalesce((units->>'tripadvisor')::int, 1)), 0)::int as calls,
            max(created_at) as last
       from provider_calls where units ? 'tripadvisor' and created_at > date_trunc('month', now())`);
  const curate = await one(`select count(*)::int as n, max(curated_at) as last from place_records where curated_at is not null`);
  const bench = await one(
    `select count(*)::int as n, max(ran_at) as last,
            round(coalesce(sum(cost_cents), 0) * ${USD_TO_GBP})::int as pence,
            count(*) filter (where cost_cents > 0)::int as paid,
            coalesce(sum(calls), 0)::int as calls
       from source_bench_runs`).catch(() => null);
  const rescore = await one('select max(indexed_at) as last, count(*)::int as n from place_index');
  const collect = await collectRuns.latest();

  const rows = [
    {
      ...RUNS[0],
      state: harvest?.state === 'running' ? 'running' : harvest?.state === 'failed' ? 'failed' : 'idle',
      where: harvest?.state === 'running'
        ? `Running · ${harvestRegions.done} of ${harvestRegions.all_}`
        : `Done · ${harvestRegions.done} of ${harvestRegions.all_} regions`,
      progress: harvestRegions.all_ ? harvestRegions.done / harvestRegions.all_ : null,
      cap: 'none', lastAt: harvest?.finished_at ?? harvest?.started_at ?? null,
      startedAt: harvest?.state === 'running' ? harvest.started_at : null,
      error: harvest?.error ?? null,
      // A deploy kills a run in flight and it has to be told to pick up. Saying
      // so is the whole reason this page exists.
      stranded: harvest?.state === 'running' && harvest.touched_at && (Date.now() - new Date(harvest.touched_at).getTime()) > 30 * 60_000
        ? { since: harvest.touched_at, why: 'a deploy' } : null,
    },
    {
      ...RUNS[1],
      state: sweep?.going ? 'running' : 'idle',
      where: `Done · ${sweep?.areas ?? 0} outcode${(sweep?.areas ?? 0) === 1 ? '' : 's'}`,
      cap: 'you set it', lastAt: sweep?.last ?? sweepSpend?.last ?? null, spentPence: sweepSpend?.pence ?? 0,
      // What one has cost, on average, out of the ledger we keep of them. With
      // none to average, the unit price is the honest thing to print: a sweep's
      // bill is one Places request a place, and how many places there are in an
      // outcode is not knowable in advance.
      costs: sweepSpend?.runs
        ? `${pounds((sweepSpend.pence / sweepSpend.runs) / 100)} a sweep`
        : `${pounds(PRICE_PER_UNIT_USD.google * USD_TO_GBP)} a place`,
    },
    {
      ...RUNS[2],
      state: (menus?.failed ?? 0) > 0 ? 'failures' : 'idle',
      where: (menus?.failed ?? 0) > 0 ? 'Done, with failures' : 'Done',
      cap: 'none', lastAt: menus?.last ?? null,
      tried: menus?.tried ?? 0, read: menus?.read ?? 0, failed: menus?.failed ?? 0, ours: oursFailed?.n ?? 0,
      // BO3a's own hover, which says how many of the failures are ours — the
      // sentence the board is for, and it had been replaced by a general
      // description of the run (18 Sep 2026, the separate audit).
      explain: 'Reads a venue’s own menu, from their site and never from a provider.'
        + ((menus?.failed ?? 0)
          ? ` ${oursFailed?.n ?? 0} of the ${menus.failed} failures ${(oursFailed?.n ?? 0) === 1 ? 'was' : 'were'} ours.`
          : ''),
    },
    { ...RUNS[3], state: 'idle', where: 'Idle', cap: 'you set the spend', lastAt: rate?.last ?? null, calls: rate?.calls ?? 0 },
    {
      ...RUNS[4], state: 'idle', where: 'Idle',
      // The only run with a hard monthly ceiling, enforced before the call is
      // made rather than after it.
      cap: `${Math.max(0, TRIPADVISOR_CAP - (ta?.calls ?? 0))} of ${TRIPADVISOR_CAP} left`,
      capLeft: Math.max(0, TRIPADVISOR_CAP - (ta?.calls ?? 0)), capOf: TRIPADVISOR_CAP,
      lastAt: ta?.last ?? null,
    },
    { ...RUNS[5], state: 'idle', where: 'Idle', cap: 'none', lastAt: curate?.last ?? null, done: curate?.n ?? 0 },
    {
      ...RUNS[6], state: 'idle', where: 'Idle', cap: '30 places', lastAt: bench?.last ?? null,
      // The same rule as the sweep: what one has cost us, or the unit price of
      // the calls it makes. The bench compares thirty places, so thirty
      // requests is the shape of its bill.
      costs: bench?.paid
        ? `${pounds((bench.pence / bench.paid) / 100)} a run`
        : `${pounds(30 * PRICE_PER_UNIT_USD.google * USD_TO_GBP)} a run of 30`,
    },
    { ...RUNS[7], state: 'idle', where: 'Idle', cap: 'none', lastAt: rescore?.last ?? null, places: rescore?.n ?? 0 },
    {
      ...RUNS[8],
      state: collect?.state === 'running' ? 'running' : collect?.state === 'failed' ? 'failed' : 'idle',
      where: !collect ? 'Idle'
        // Two collections over different places are allowed at once, and the
        // board draws one row: it says so rather than hiding the other (Codex,
        // 18 Sep 2026).
        : collect.state === 'running' ? `Running · ${collect.asked} asked, ${collect.left} to go${collect.alsoRunning ? ` · and ${collect.alsoRunning} more going` : ''}`
        : collect.state === 'failed' ? `Stopped · ${collect.problem ?? 'it fell over'}`
        : `Done · ${collect.asked} place${collect.asked === 1 ? '' : 's'}${collect.where ? ` in ${collect.where}` : ''}`,
      progress: collect && collect.asked + collect.left ? collect.asked / (collect.asked + collect.left) : null,
      cap: 'the ceiling, asked again every chunk',
      lastAt: collect?.finishedAt ?? collect?.startedAt ?? null,
      startedAt: collect?.state === 'running' ? collect.startedAt : null,
      spentPence: collect?.spentPence ?? 0,
      error: collect?.problem ?? null,
      // Untouched for ten minutes while claiming to be going: a deploy took it,
      // and it is picked up on the hour.
      stranded: collect?.stranded ? { since: collect.touchedAt, why: 'a deploy' } : null,
    },
  ];

  // The same money the ceiling is made of. This figure is printed against the
  // ceiling and drawn as a bar under it, so summing the whole ledger put Claude
  // planning and OpenAI speech into a board about buying places — a number that
  // disagrees with the guard beside it is worse than no number (Codex, 18 Sep
  // 2026). `constants.js` OTHER_PURSE holds the two that bill elsewhere.
  const spend = await one(
    `select coalesce(sum(estimated_cost_usd), 0)::numeric as usd, count(*)::int as calls
       from provider_calls
      where created_at > date_trunc('month', now())
        and provider <> all ($1::text[])`, [OTHER_PURSE]);
  const ceiling = await one("select value from app_settings where key = 'collect.ceiling_pence'").catch(() => null);

  return {
    runs: rows,
    // Every collection that is going, not only the one the row draws.
    running: rows.filter((r) => r.state === 'running').length + (collect?.alsoRunning ?? 0),
    // A run that stopped, failed or was never picked up. Two of them is a number
    // somebody has to act on today.
    needsLooking: rows.filter((r) => r.stranded || r.state === 'failed' || (r.key === 'menus' && r.ours > 0)).length
      + (collect?.alsoStranded ?? 0),
    spentPence: Math.round(Number(spend?.usd ?? 0) * 100 * USD_TO_GBP),
    calls: spend?.calls ?? 0,
    ceilingPence: Number(ceiling?.value ?? 25000),
    tripadvisor: { left: Math.max(0, TRIPADVISOR_CAP - (ta?.calls ?? 0)), of: TRIPADVISOR_CAP },
  };
}

export const TRIPADVISOR_CAP = Number(process.env.EPIC_LOOKUP_TRIPADVISOR_CAP ?? process.env.ROAM_LOOKUP_TRIPADVISOR_CAP ?? 120);

/**
 * BO3b — one run's failures, **ours kept separate from theirs**.
 *
 * 132 of the first 341 menu failures were Epic's own bugs. Folded into the same
 * list they read as a hundred and thirty-two restaurants with broken websites,
 * which is how they sat in the backlog. On their own and above theirs, they are
 * a morning's work.
 */
export async function failures(runKey) {
  const run = RUNS.find((r) => r.key === runKey) ?? null;
  // Only the menu reader keeps a per-place failure list. The others either
  // cannot fail per place or record their failures on the run. Saying which run
  // this is, and that it keeps no list, is the difference between an empty
  // board and an empty board titled "Read the menus" (17 Sep 2026, the
  // verification audit).
  if (runKey !== 'menus') {
    return {
      runKey, label: run?.label ?? 'That run', ours: [], theirs: [],
      totals: { tried: 0, read: 0, failed: 0, ours: 0 },
      keepsAList: false,
      why: run
        ? `${run.label} does not keep a failure list per place. What it last did is on Runs.`
        : 'No run by that name.',
    };
  }
  const causes = await menuCauses();
  const { rows: ours } = await query(
    `select venue_ref, coalesce(venue_label, venue_ref) as label, why, read_at
       from place_menus where state <> 'read' and cause = 'ours'`);
  const byKind = new Map(OURS_KINDS.map((k) => [k.key, []]));
  for (const r of ours) byKind.get(oursKindOf(r.why))?.push(r);
  const totals = await one(
    `select count(*)::int as tried,
            count(*) filter (where state = 'read')::int as read,
            count(*) filter (where state <> 'read' and cause is not null)::int as failed,
            count(*) filter (where cause = 'ours')::int as ours,
            max(read_at) as last
       from place_menus`);
  return {
    runKey, label: run?.label ?? 'Read the menus', keepsAList: true, why: null,
    totals,
    ours: OURS_KINDS.map((k) => ({
      key: k.key, label: k.label, n: byKind.get(k.key).length,
      examples: byKind.get(k.key).slice(0, 3).map((r) => r.label),
    })).filter((k) => k.n > 0),
    theirs: causes.filter((c) => c.key !== 'ours').map((c) => ({
      key: c.key, label: c.label, detail: c.detail, fix: c.fix, n: c.n, examples: c.examples,
    })),
  };
}

/** The places behind one failure cause, so a row is a piece of work you can open. */
/**
 * The places behind one cause.
 *
 * `place_menus` only, because the menu reader is the only run with a per-place
 * failure list — the route used to ignore its own `:key`, so asking any other
 * run for its failures answered with the menus' (17 Sep 2026).
 */
export async function failing(cause, { oursKind = null, limit = 200 } = {}) {
  const { rows } = await query(
    `select venue_ref, coalesce(venue_label, venue_ref) as label, why, menu_url, read_at, attempts
       from place_menus where state <> 'read' and cause = $1 order by read_at desc limit $2`,
    [cause, limit]);
  return oursKind ? rows.filter((r) => oursKindOf(r.why) === oursKind) : rows;
}

/** What each run last did, most recent first. The history on one row. */
export async function history(runKey, { limit = 20 } = {}) {
  if (runKey === 'harvest') {
    return (await query(
      `select id, scope, stage, state, counts, error, started_at, finished_at, started_by
         from harvest_runs order by started_at desc limit $1`, [limit])).rows;
  }
  if (runKey === 'sweep') {
    return (await query(
      `select id, region_slug as scope, provider, calls, cost_cents, found, matched, kept, problems, started_at, finished_at, started_by
         from sweep_runs order by started_at desc limit $1`, [limit])).rows;
  }
  return (await query(
    `select created_at as started_at, provider, purpose, estimated_cost_usd, units
       from provider_calls where purpose like $1 order by created_at desc limit $2`,
    [`%${runKey}%`, limit])).rows;
}

/** A run that a deploy killed, waiting to be told to pick up. */
export async function stranded() {
  const { rows } = await query(
    `select id, scope, stage, started_at, touched_at, counts from harvest_runs
      where state = 'running' and touched_at < now() - interval '30 minutes'
      order by started_at limit 5`);
  return rows;
}
