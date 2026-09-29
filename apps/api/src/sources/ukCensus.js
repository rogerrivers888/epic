/**
 * The census of the rest of the UK, a day at a time, on the server's own clock.
 *
 * Owner, 28 Sep 2026: "a new run each day over the remaining UK areas, capped
 * at 70,000 IDs-only requests, skipping anything censused in the last 30 days,
 * until the UK is done. Starts each day only if the billing export shows the
 * previous day's census cost at £0 (or pennies). If billing hasn't written the
 * day yet, run anyway — but stop and alert me the moment any day shows more
 * than £5. … a server-side scheduled job … that survives this session closing,
 * with each run attributed as before. Same daily report: districts done,
 * places added, requests, billed cost, days remaining. Tell me when the UK is
 * complete."
 *
 * Nothing here is kept anywhere of its own. The programme is its runs — every
 * `census_runs` row labelled `The rest of the UK — day N` — and what it decides
 * is read from them and from Google's own billing (`billing_days`) on every
 * tick, so a restart, a deploy or a second process all come to the same
 * answer. A database with no such run (a laptop, the tests) never starts one:
 * the programme began with day 1, which a person started by hand on
 * production.
 *
 * Each day's run is a new run over every area, not a resumed one. Starting
 * walks past every tile censused in the last thirty days, so a new run carries
 * on where the last stopped — which is the owner's (b), chosen over resuming
 * with the resume key.
 */

import crypto from 'node:crypto';
import { query, pool } from '../db.js';
import * as censusRun from './censusRun.js';
import { sendMail, mailStatus } from './mail.js';
import { searchTextDailyLimit } from './googleQuota.js';

/** Every UK postcode area, Northern Ireland included (BT). */
export const UK_AREAS = [
  'AB', 'AL', 'B', 'BA', 'BB', 'BD', 'BH', 'BL', 'BN', 'BR', 'BS', 'BT', 'CA', 'CB', 'CF', 'CH', 'CM', 'CO', 'CR', 'CT',
  'CV', 'CW', 'DA', 'DD', 'DE', 'DG', 'DH', 'DL', 'DN', 'DT', 'DY', 'E', 'EC', 'EH', 'EN', 'EX', 'FK', 'FY', 'G', 'GL',
  'GU', 'HA', 'HD', 'HG', 'HP', 'HR', 'HS', 'HU', 'HX', 'IG', 'IP', 'IV', 'KA', 'KT', 'KW', 'KY', 'L', 'LA', 'LD', 'LE',
  'LL', 'LN', 'LS', 'LU', 'M', 'ME', 'MK', 'ML', 'N', 'NE', 'NG', 'NN', 'NP', 'NR', 'NW', 'OL', 'OX', 'PA', 'PE', 'PH',
  'PL', 'PO', 'PR', 'RG', 'RH', 'RM', 'S', 'SA', 'SE', 'SG', 'SK', 'SL', 'SM', 'SN', 'SO', 'SP', 'SR', 'SS', 'ST', 'SW',
  'SY', 'TA', 'TD', 'TF', 'TN', 'TQ', 'TR', 'TS', 'TW', 'UB', 'W', 'WA', 'WC', 'WD', 'WF', 'WN', 'WR', 'WS', 'WV', 'YO',
  'ZE',
];

export const LABEL = censusRun.ONE_DAY_LABEL;
export const DAY_REQUESTS = 70_000;
/**
 * The day once Google raises the limit (owner, 29 Sep 2026: "when the limit
 * shows 160,000, raise the census to 150,000/day automatically"), leaving ten
 * thousand of the day for households.
 */
export const RAISED_LIMIT = 160_000;
export const RAISED_DAY = 150_000;
/**
 * The size a day's run was given. Its own share of the day, which is set to
 * the size when it starts and never touched — not its ceiling, which is
 * brought down to close off a day that ran past midnight (Codex, 29 Sep 2026).
 */
export const daySizeOf = (run) => Number(run?.night_share) || DAY_REQUESTS;

/** How big today is: 150,000 once Google's limit reads 160,000, else 70,000 — and 70,000 when it cannot be read. */
export function daySize(quota) {
  if (quota?.speaks && quota.limit >= RAISED_LIMIT) return { requests: RAISED_DAY, cap: Math.min(quota.limit, 1e9) };
  // A limit read below the old 75,000 is kept to, with the same 5,000 left for
  // households (Codex, 29 Sep 2026).
  if (quota?.speaks && Number.isFinite(quota.limit) && quota.limit < 75_000) {
    return { requests: Math.max(0, Math.min(DAY_REQUESTS, quota.limit - 5_000)), cap: quota.limit };
  }
  return { requests: DAY_REQUESTS, cap: 75_000 };
}
/** "£0 (or pennies)": under a pound of census cost on a day is pennies. */
export const PENNIES_GBP = 1;
/** "stop and alert me the moment any day shows more than £5." */
export const DAY_ALERT_GBP = 5;
/** Whose decision a daily run is: the programme's — and the reset clock never wakes it. */
export const STARTED_BY = censusRun.ONE_DAY_RUNS;
/** A plan whose heartbeat has been silent this long was cut short (its writer beats every 200 squares). */
const PLANNING_MS = 5 * 60_000;
/** How a day ends: at the run's own ceiling, or ended for the day at the shared cap. */
const DAY_ENDED = /^(stopped at the \d+-request ceiling|ended for the day)/;

/**
 * Pounds as said in an alert: to the penny, or to a hundredth of one when it
 * is a fraction of a penny — "£0.00" for a stop on 0.3p says nothing, and a
 * rise within the same penny would be the same subject, swallowed as already
 * sent (Codex, 29 Sep 2026).
 */
export const gbp = (x) => {
  const n = Number(x ?? 0);
  return `£${Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? n.toFixed(2) : n.toFixed(4)}`;
};

/** The quota day a moment falls in: Google's day is Los Angeles's. */
export const pacificDay = (at) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(at));

/** The programme's runs, oldest first. */
export async function programme() {
  const { rows } = await query(
    // `day` is the quota day the run last asked in (rollDay keeps it), which
    // is when its day ended — not when somebody closed it off (Codex).
    `select *, to_char(day, 'YYYY-MM-DD') as quota_day from census_runs where label like $1 order by started_at`, [`${LABEL} %`]);
  return rows;
}

/**
 * What Google billed, by day, from the day the programme began: the census's
 * own SKU (Text Search Essentials — IDs Only is the `google-essentials` meter)
 * and every Google SKU together. A day the export has not written is absent,
 * which is not the same fact as nought.
 */
export async function billedByDay(fromDay) {
  const { rows } = await query(
    // The census is the Text Search IDs Only / Essentials SKU alone — the
    // `google-essentials` meter also carries Place Details Essentials — and
    // the £5 stop is every line the export billed that day, mapped to a meter
    // or not: a new SKU nobody has mapped yet is still money (Codex, 28 Sep 2026).
    // After the credits Google never charges — free tier, discounts — and
    // before the promotional credit, which is spending of a credit that runs
    // out: the spend tile's own rule, usage not credit (Codex, 29 Sep 2026).
    `select to_char(day, 'YYYY-MM-DD') as day,
            coalesce(sum(cost + credits - promo) filter (where sku ~* 'text search' and sku ~* '(essentials|ids only)'), 0)::float as census_gbp,
            coalesce(sum(cost + credits - promo), 0)::float as google_gbp,
            -- What Places actually charged: after every credit, promotional
            -- included. Owner, 29 Sep 2026: "if Places spend on
            -- epic-maps-509205 is above £0 for any day … stop and tell me."
            -- Places only: its meters or its service, not Routes (Codex, 29 Sep 2026).
            coalesce(sum(cost + credits) filter (where service ~* 'places'
              or meter in ('google-essentials', 'google-pro', 'google-search', 'google-details', 'google-photos')), 0)::float as places_net_gbp
       from billing_days
      where day >= $1::date
      group by 1 order by 1`, [fromDay]);
  return rows;
}

/**
 * What a quota day was billed. The export's days are London's and the quota
 * day is Los Angeles's, so a day's run is billed across two export days: both
 * are read and summed, for the decision and the report alike (Codex, 29 Sep
 * 2026). Either written is enough to speak; neither is "not billed yet".
 */
export function billedFor(bills, quotaDay) {
  const next = new Date(Date.parse(`${quotaDay}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const spans = bills.filter((b) => b.day === quotaDay || b.day === next);
  if (!spans.length) return null;
  // Final only once both export days are in: a report marked billed from one
  // of them would understate the day for good (Codex, 29 Sep 2026).
  // Or once the export holds a later day: a London day with no Google usage
  // has no row at all, and waiting for both would wait for ever (Codex, 29 Sep 2026).
  const final = spans.length === 2 || bills.some((b) => b.day > next);
  return {
    day: quotaDay, final,
    census_gbp: spans.reduce((n, b) => n + b.census_gbp, 0),
    google_gbp: spans.reduce((n, b) => n + b.google_gbp, 0),
    places_net_gbp: spans.reduce((n, b) => n + (b.places_net_gbp ?? 0), 0),
  };
}

/** A service session of the run's own, so every ledger row names the day it belongs to. */
async function sessionFor(label) {
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label, expires_at, revoked_at, kind)
     values ('census:' || $1, $2, now(), now(), 'service') returning id`,
    [crypto.randomUUID(), `census: ${label}`]);
  return s.id;
}

/**
 * What the programme should do now, and why — decided, not done.
 *
 *   off       no programme run in this database
 *   halted    a day since it began was billed more than £5 of Google
 *   complete  the latest run finished every tile of the UK
 *   working   the latest run is running or waiting on the quota day
 *   stopped   somebody stopped the latest run: a person's stop is not undone
 *   today     the latest run ended in today's quota day; tomorrow's is next
 *   held      yesterday's census was billed above pennies
 *   start     a new day's run is due
 */
export async function decide(now = new Date()) {
  const runs = await programme();
  if (!runs.length) return { action: 'off', runs };
  // Days are numbered by the runs that were days: a plan cut short and
  // replaced does not use up a number. And a plan cut short is not the latest
  // day either: everything is decided from the last real day's run, so a
  // restart between setting one aside and starting its replacement still
  // passes through the billing gate (Codex, 29 Sep 2026).
  const cutShort = (r) => r.state === 'stopped' && /^planning cut short/.test(r.problem ?? '');
  const real = runs.filter((r) => !cutShort(r));
  const days = real.length;
  const latest = real[real.length - 1] ?? runs[runs.length - 1];
  // Complete first: after the UK is done, Google spending on anything else is
  // not the census's, and must not turn a finished programme into a halted
  // one (Codex, 29 Sep 2026).
  const { rows: [finishedFirst] } = await query(`select value from bo_settings where key = 'census:uk-complete'`);
  const bills = await billedByDay(pacificDay(runs[0].started_at));
  // What a person has looked at and lifted (POST /census/uk/lift): only a
  // figure that has grown since stops it or is said again (Codex, 29 Sep 2026).
  const { rows: [lifted] } = await query(`select value from bo_settings where key = 'census:uk-hold-lifted'`);
  // A lift written before these maps existed (its figures under `seen` only)
  // covers every bill on days up to the day it was made, as it stood then: an
  // upgrade must not stop the census again on a charge already looked at
  // (Codex, 29 Sep 2026).
  const legacyThrough = lifted && !lifted.value?.seenNet && lifted.value?.at ? pacificDay(lifted.value.at) : null;
  const legacy = (list) => (legacyThrough ? Object.fromEntries(list.filter((b) => b.day <= legacyThrough).map((b) => [b.day, Infinity])) : {});
  const legacySpans = runs.map((r) => billedFor(bills, pacificDay(r.started_at))).filter(Boolean);
  const seenGoogle = lifted?.value?.seenGoogle ?? legacy(bills);
  const seenNet = lifted?.value?.seenNet ?? legacy(bills);
  const seenGoogleSpan = lifted?.value?.seenGoogleSpan ?? legacy(legacySpans);
  const seenNetSpan = lifted?.value?.seenNetSpan ?? legacy(legacySpans);
  const EPS = 1e-9;
  const unseen = (b, key, seen, floor) => b[key] > floor + EPS && b[key] > (seen[b.day] ?? -Infinity) + EPS;
  if (finishedFirst) {
    // But its own days' bills still count: the last day's arrives after it
    // finished, and a costly one is still said (Codex, 29 Sep 2026).
    const days = runs.map((r) => billedFor(bills, pacificDay(r.started_at))).filter(Boolean);
    const over = days.find((b) => unseen(b, 'google_gbp', seenGoogleSpan, DAY_ALERT_GBP));
    // And a late Places charge for one of its days, after credits, is said too
    // — unless it is one a person already lifted (Codex, 29 Sep 2026).
    // Each export day on its own as well: a charge offset by the next day's
    // credit is still a day Places cost money (Codex, 29 Sep 2026).
    // Only the export days the census's own days span: Places used a month
    // after it finished is not the census's (Codex, 29 Sep 2026).
    const spanned = new Set(runs.flatMap((r) => {
      const d0 = pacificDay(r.started_at);
      return [d0, new Date(Date.parse(`${d0}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)];
    }));
    const net = bills.filter((b) => spanned.has(b.day)).find((b) => unseen(b, 'places_net_gbp', seenNet, 0))
      ?? days.find((b) => unseen(b, 'places_net_gbp', seenNetSpan, 0));
    return { action: 'complete', runs, latest, bills, over: over ? { ...over, kind: 'five' } : net ? { ...net, kind: 'net' } : null };
  }
  // Any export day over £5, and any quota day of the programme over £5 across
  // the two London days it spans — £3 and £3 is £6 (Codex, 29 Sep 2026). The
  // two overlap at the edges, which errs towards stopping.
  //
  // And any day on which Places cost money at all, after every credit (owner,
  // 29 Sep 2026: "if Places spend on epic-maps-509205 is above £0 for any day,
  // or the £5/day stop trips, stop and tell me"). Either stops the census for
  // good; a person who has looked lifts it (POST /census/uk/lift), and only a
  // figure that has grown since stops it again.
  const spans = runs.map((r) => billedFor(bills, pacificDay(r.started_at))).filter(Boolean);
  // Any amount at all: above £0 means a fraction of a penny too, and a lifted
  // figure stops it again on any growth (Codex, 29 Sep 2026). The epsilon is
  // only float noise.
  const five = bills.find((b) => unseen(b, 'google_gbp', seenGoogle, DAY_ALERT_GBP))
    ?? spans.find((b) => unseen(b, 'google_gbp', seenGoogleSpan, DAY_ALERT_GBP));
  if (five) return { action: 'halted', runs, latest, bills, over: { ...five, kind: 'five' } };
  const spent = bills.find((b) => unseen(b, 'places_net_gbp', seenNet, 0))
    ?? spans.find((b) => unseen(b, 'places_net_gbp', seenNetSpan, 0));
  if (spent) return { action: 'halted', runs, latest, bills, over: { ...spent, kind: 'net' } };
  // Done is complete only if no square was given up on: a run finishes with
  // its failed squares set aside, and the UK is not done while they are
  // unasked. A day that ended so is followed by another, which tries them
  // again (Codex, 28 Sep 2026).
  // Read from the run's own record, written when it finished — not from the
  // squares, which a later census may already have reused (Codex, 29 Sep 2026).
  const failed = latest.state === 'done' ? Math.max(0, Number(latest.tiles_total ?? 0) - Number(latest.tiles_done ?? 0)) : 0;
  // Complete is said once and kept: the squares a finished UK leaves behind
  // are reused by later censuses, and reading them again would un-finish it
  // and start another whole-UK day (Codex, 29 Sep 2026).
  const { rows: [finished] } = await query(`select value from bo_settings where key = 'census:uk-complete'`);
  if (finished) return { action: 'complete', runs, latest, bills };
  if (latest.state === 'done' && !failed) {
    await query(
      `insert into bo_settings (key, value, updated_by) values ('census:uk-complete', $1, 'the UK census') on conflict (key) do nothing`,
      [JSON.stringify({ runId: latest.id, at: new Date(now).toISOString() })]);
    return { action: 'complete', runs, latest, bills };
  }
  if (['running', 'waiting'].includes(latest.state)) {
    // Still going after its quota day turned — a late start, an outage — it is
    // not today's run: it is brought to its ceiling where it stands, pauses
    // there as any day does, and today gets a run of its own (Codex, 28 Sep 2026).
    const late = latest.state === 'running' && pacificDay(latest.started_at) < pacificDay(now);
    return { action: late ? 'overran' : 'working', runs, latest, bills };
  }
  // A day's run the programme built but never switched on — the process went
  // while its plan was being written — is not anybody's stop. It is set aside
  // and the day started again, the same day (Codex, 28 Sep 2026).
  // A day's plan written but not switched on — another census was going at
  // the time — is switched on now, once nothing else is (Codex, 29 Sep 2026).
  if (latest.state === 'paused' && latest.started_by === STARTED_BY && latest.problem === censusRun.PLAN_WRITTEN) {
    return { action: 'switch on', runs, latest, bills, day: days };
  }
  const unfinishedPlan = latest.state === 'paused' && latest.started_by === STARTED_BY && latest.problem === 'built paused; resume to start'
    && new Date(now).getTime() - new Date(latest.last_seen_at ?? latest.started_at).getTime() > PLANNING_MS;
  if (unfinishedPlan) return { action: 'replan', runs, latest, bills, day: days };
  const dayEnded = (latest.state === 'paused' && DAY_ENDED.test(latest.problem ?? '')) || latest.state === 'done';
  if (!dayEnded) return { action: 'stopped', runs, latest, bills };
  // A day's run is the quota day it was started in: one run a day, however
  // late the last one was closed off (Codex, 28 Sep 2026).
  if (pacificDay(latest.started_at) >= pacificDay(now)) return { action: 'today', runs, latest, bills };
  // Any day of the programme, not only the latest: a census bill that
  // arrives late for an earlier day holds it just the same (Codex, 29 Sep 2026).
  // Except days a person has looked at and lifted the hold over (POST
  // /census/uk/lift): only a bill nobody has seen holds it (Codex, 29 Sep 2026).
  // A lift records each day's census bill as it was seen; a day holds again
  // only if its bill has grown since — exports backfill earlier days, and a
  // date line would wave a late charge through (Codex, 29 Sep 2026).
  // (The old hold on a census bill of £1 is gone: any net Places spend now stops it, above.)
  const yesterday = billedFor(bills, pacificDay(latest.started_at));
  // Held stays held. The owner's rule for the gate (28 Sep 2026): "If it's
  // anything meaningful: stay paused and report the figure." A census that
  // cost money means the free assumption is wrong, and the next day would
  // spend it again; only a person lifts it — by starting a run by hand.
  // (The latest day is among those just read, lifted or not.)
  // Another census live, or a plan being written: wait, rather than make the
  // day's session and be refused (Codex, 29 Sep 2026).
  const { rows: other } = await query(
    `select 1 from census_runs
      where state in ('running', 'waiting')
         or (state = 'paused' and problem = 'built paused; resume to start' and coalesce(last_seen_at, started_at) > now() - interval '5 minutes')
      limit 1`);
  if (other.length) return { action: 'waiting on another census', runs, latest, bills };
  return { action: 'start', runs, latest, bills, yesterday: yesterday ?? null, day: days + 1 };
}

/**
 * A day's run built paused, switched on — only if nothing else is going: a
 * census started by hand while this one was being planned is not joined by a
 * second (Codex, 28 Sep 2026), and under the lock starting and resuming
 * share, so a resume cannot slip in between the check and the switch (Codex,
 * 29 Sep 2026). Left as it is otherwise, and tried again next tick.
 */
async function switchOn(id) {
  return censusRun.withStartLock(async (db) => (await db.query(
    `update census_runs set state = 'running', problem = null, last_seen_at = now()
      where id = $1 and state = 'paused' and problem like 'built paused%'
        and not exists (select 1 from census_runs o where o.id <> $1
                          and (o.state in ('running', 'waiting')
                               -- nor while another plan is still being written, as
                               -- starting and resuming wait (Codex, 29 Sep 2026)
                               or (o.state = 'paused' and o.problem = 'built paused; resume to start'
                                   and coalesce(o.last_seen_at, o.started_at) > now() - interval '5 minutes')))`, [id])).rowCount > 0)
    .catch(() => false);
}

/**
 * One tick: decide, and do what was decided. Called hourly by the server and
 * once at boot. `start` is a seam for the tests, which cannot plan the whole
 * UK on every assertion.
 */
export async function tick(opts = {}) {
  // One tick at a time across every process: two replicas that both decided
  // "start" before either had inserted its run would each start the day
  // (Codex, 28 Sep 2026). A tick that cannot take the lock does nothing; the
  // one holding it decides for both.
  const client = await pool.connect();
  try {
    const { rows: [{ ok }] } = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK]);
    if (!ok) return { action: 'busy' };
    try { return await tickLocked(opts); } finally { await client.query('select pg_advisory_unlock($1)', [LOCK]); }
  } finally { client.release(); }
}
/** The advisory lock's key: "UKCENSUS" folded into an int8. */
const LOCK = 0x554b43454e535553n.toString();

async function tickLocked({ now = new Date(), start = censusRun.startRun, stop = censusRun.requestStop, tell = () => {}, endDay = censusRun.endForTheDay, quota = searchTextDailyLimit } = {}) {
  // A day's run asleep at the shared cap is ended for the day, not carried
  // into tomorrow (Codex, 28 Sep 2026).
  const { rows: asleep } = await query(
    `select id from census_runs where label like $1 and state = 'waiting'`, [`${LABEL} %`]);
  for (const r of asleep) await endDay(r.id);
  const d = await decide(now);
  if (d.action === 'halted') {
    // Stopped where it stands, as a day ends — not as a person's stop — so that
    // once the bill is looked at and the hold lifted, the next day follows
    // (Codex, 29 Sep 2026). A running day is brought to its ceiling and pauses
    // at the next drawer; a sleeping one is ended for the day.
    if (d.latest?.state === 'running') {
      await query(`update census_runs set max_requests = least(max_requests, requests) where id = $1 and state = 'running'`, [d.latest.id]);
    } else if (d.latest?.state === 'waiting') {
      await endDay(d.latest.id);
    }
    tell({ kind: 'alert', subject: d.over.kind === 'net'
      ? `Census stopped: Places cost ${gbp(d.over.places_net_gbp)} after credits on ${d.over.day}`
      : `Census stopped: Google billed ${gbp(d.over.google_gbp)} on ${d.over.day}`, d });
  }
  if (d.action === 'complete' && d.over) {
    tell({ kind: 'alert', subject: d.over.kind === 'net'
      ? `Census (finished): Places cost ${gbp(d.over.places_net_gbp)} after credits on ${d.over.day}`
      : `Census (finished) was billed ${gbp(d.over.google_gbp)} of Google on ${d.over.day}`, d });
  }
  if (d.action === 'held') tell({ kind: 'alert', subject: `Census held: the census was billed £${d.yesterday.census_gbp.toFixed(2)} on ${d.yesterday.day}`, d });
  if (d.action === 'overran') {
    await query(
      `update census_runs set max_requests = least(max_requests, requests) where id = $1 and state = 'running'`, [d.latest.id]);
    return d;
  }
  if (d.action === 'switch on') {
    const on = await switchOn(d.latest.id);
    if (on) tell({ kind: 'started', subject: `Census day ${d.day} started`, d, run: d.latest });
    return { ...d, action: on ? 'switched on' : 'waiting on another census' };
  }
  if (d.action === 'replan') {
    await query(
      `update census_runs set state = 'stopped', finished_at = now(), problem = 'planning cut short; replaced by the next run'
        where id = $1 and state = 'paused'`, [d.latest.id]);
  }
  if (d.action !== 'start' && d.action !== 'replan') return d;
  // Keep the ended days' figures before this day's plan reuses their squares
  // (Codex, 29 Sep 2026): status() writes each ended day down once.
  await status(now);
  // Today's size from Google's own limit, read now (at most hourly) — before
  // anything is made: a limit that leaves the census nothing means wait
  // (Codex, 29 Sep 2026).
  const q = await quota();
  const size = daySize(q);
  if (size.requests <= 0) return { ...d, action: 'no quota for the census', quota: q };
  const label = `${LABEL} ${d.day}`;
  const sessionId = await sessionFor(label);
  // Built paused, and switched on only once its plan is whole: a run is
  // visible to the workers the moment its row exists, and the UK is three
  // thousand squares to record after that, so a worker could otherwise empty a
  // half-written plan and call the run done (Codex, 28 Sep 2026). And its own
  // share of the day as well as its ceiling, which is what makes the engine
  // advance it one worker at a time under its own lock — two processes could
  // otherwise each spend the day's remaining allowance (Codex, same day).
  const run = await start({
    label, areas: UK_AREAS, maxRequests: size.requests, nightShare: size.requests, ratePerSec: 5, dailyCap: size.cap,
    startedBy: STARTED_BY, startedSessionId: sessionId, paused: true,
  });
  const on = run?.id ? await switchOn(run.id) : false;
  // Said only if it is true (Codex, 29 Sep 2026).
  if (!on) return { ...d, action: 'blocked', built: run, sessionId };
  tell({ kind: 'started', subject: `Census day ${d.day} started`, d, run });
  // The first day at the raised size says so, with the new days remaining
  // (owner: "tell me the new days-remaining"). Said once: the subject is fixed.
  // Only on the day it changes: the day before was smaller (Codex, 29 Sep 2026).
  if (size.requests === RAISED_DAY && daySizeOf(d.latest) < RAISED_DAY) {
    const st = await status(now);
    const perTile = st.requestsPerTile;
    const days = perTile ? Math.max(st.tilesLeft ? 1 : 0, Math.ceil((st.tilesLeft * perTile) / RAISED_DAY)) : null;
    tell({ kind: 'raised', subject: `Census raised to ${RAISED_DAY.toLocaleString('en-GB')} a day: ${days == null ? 'days left not yet measurable' : `about ${days} day${days === 1 ? '' : 's'} left`}`, d, run });
  }
  return { ...d, started: run, sessionId, quota: q };
}

/**
 * The daily report, one row per day, and where the whole thing stands.
 *
 * Districts done is districts whose every row on the board is whole; places
 * added and requests are the run's own; billed cost is Google's, from the
 * export, or "not billed yet"; days remaining is the latest plan's unfinished
 * tiles at the programme's own measured requests per tile.
 */
export async function status(now = new Date()) {
  const d = await decide(now);
  if (d.action === 'off') return { action: 'off', days: [] };

  const days = [];
  let requests = 0; let tilesAsked = 0;
  const counted = d.runs.filter((r) => !(r.state === 'stopped' && /^planning cut short/.test(r.problem ?? '')));
  for (const [i, r] of counted.entries()) {
    // One aggregation over the run's own slices (its index leads with the
    // run), not a scan per square every ten minutes (Codex, 29 Sep 2026).
    const { rows: [t] } = await query(
      `select count(distinct area_slug)::int as asked from census_slices where census_run_id = $1`, [r.id]);
    const day = pacificDay(r.started_at);
    const b = billedFor(d.bills ?? [], day);
    requests += Number(r.requests ?? 0); tilesAsked += Number(t.asked ?? 0);
    // Each day's figures as they stood when that day ended, not as they stand
    // now (Codex, 29 Sep 2026): its plan is the whole UK, so the districts
    // whose every square in it had been censused by its end is how many were
    // done in all that day, and the squares not yet censused by then are what
    // was left. A square's censused_at only moves when it is censused again,
    // thirty days on, so both stay what they were.
    const ended = ['paused', 'done', 'stopped'].includes(r.state) && !/^built paused/.test(r.problem ?? '');
    const key = `census:uk-day:${r.id}`;
    const { rows: [kept] } = ended
      ? await query('select value from bo_settings where key = $1', [key])
      : { rows: [] };
    // A day kept before it carried districts and areas left gets them now,
    // once (29 Sep 2026: the one-line report names what is left).
    // Only while that day's squares cannot yet have been censused again (the
    // freshness window is 30 days): past that, current tiles do not say what
    // was left then, and it stays unknown (Codex, 29 Sep 2026).
    const recent = new Date(now).getTime() - new Date(r.finished_at ?? r.started_at).getTime() < 30 * 86_400_000;
    const canFill = recent || !ended;
    const unknown = { districts: null, left: null, districtsLeft: null, areasLeft: null };
    const { rows: [then] } = kept && (kept.value.districtsLeft != null || !canFill) ? { rows: [kept.value] }
      : !kept && !canFill ? { rows: [unknown] } : await query(
      `with plan as (
         -- Done means done: a stale square being asked again keeps its old
         -- censused_at but is not done (Codex, 29 Sep 2026). The state is
         -- read when the day is kept, just after it ends.
         select t.outcodes, (t.state = 'done' and t.censused_at is not null and t.censused_at <= coalesce(r.finished_at, now())) as done
           from census_run_tiles m join census_tiles t on t.grid_key = m.grid_key join census_runs r on r.id = m.run_id
          where m.run_id = $1)
       , dist as (select c.code, bool_and(done) as whole from plan, unnest(plan.outcodes) c(code) group by c.code)
       select (select count(*) filter (where whole)::int from dist) as districts,
              (select count(*) filter (where not whole)::int from dist) as "districtsLeft",
              (select count(distinct substring(code from '^[A-Z]+')) filter (where not whole)::int from dist) as "areasLeft",
              (select count(*) filter (where not done)::int from plan) as left`, [r.id]);
    // Kept once the day has ended, so a square censused again thirty days on
    // cannot rewrite what that day said (Codex, 29 Sep 2026). In the back
    // office's own settings table, under a key its reader ignores.
    if (ended && canFill && (!kept || kept.value.districtsLeft == null)) {
      // Normally written when the run ended (censusRun.keepDayFigures); this
      // is for a day that ended before that existed, or before it carried
      // what was left. What it already said about districts done stands.
      const value = { districts: kept?.value?.districts ?? then.districts, left: kept?.value?.left ?? then.left,
        districtsLeft: then.districtsLeft, areasLeft: then.areasLeft };
      await query(
        `insert into bo_settings (key, value, updated_by) values ($1, $2, 'the UK census')
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [key, JSON.stringify(value)]);
      Object.assign(then, value);
    }
    // New to the census: places this day found that no earlier run had.
    // Counted once when the day is kept and stored with it; only a day still
    // going is counted live (Codex, 29 Sep 2026: a scan of the whole history
    // on every look).
    const { rows: [fresh] } = kept?.value?.newPlaces != null ? { rows: [{ n: kept.value.newPlaces }] } : await query(
      `select count(distinct s.venue_ref)::int as n from census_run_surfacings s
        where s.run_id = $1
          and not exists (select 1 from census_run_surfacings o join census_runs ro on ro.id = o.run_id
                           where o.venue_ref = s.venue_ref and o.run_id <> $1 and ro.started_at < $2)`, [r.id, r.started_at]);
    if (ended && kept && kept.value.newPlaces == null) {
      await query(`update bo_settings set value = value || jsonb_build_object('newPlaces', $2::int), updated_at = now() where key = $1`, [key, fresh.n]);
    }
    const rate = tilesAsked ? requests / tilesAsked : null;
    days.push({
      day: i + 1, date: day, runId: r.id, state: r.state, ended, requests: Number(r.requests ?? 0), places: Number(r.places ?? 0),
      tilesAsked: Number(t.asked ?? 0),
      districts: then.districts,
      districtsLeft: then.districtsLeft ?? null,
      areasLeft: then.areasLeft ?? null,
      newPlaces: fresh.n,
      tilesLeft: then.left,
      daysLeft: rate == null || then.left == null ? null : Math.max(then.left ? 1 : 0, Math.ceil((then.left * rate) / daySizeOf(r))),
      billed: b ? { censusGbp: b.census_gbp, googleGbp: b.google_gbp, placesNetGbp: b.places_net_gbp, final: b.final } : null,
    });
  }
  const { rows: [districts] } = await query(
    `select count(*)::int as whole from (
       select area_slug from area_counts where area_slug ~ '^[a-z]{1,2}[0-9]' group by area_slug having bool_and(complete)) x`);
  const latest = d.latest;
  // Counted from the tiles, every one not done: a square given up on within a
  // run is tried again the next day, so it is work left like any other
  // (Codex, 29 Sep 2026).
  const { rows: [l] } = await query(
    `select count(*) filter (where t.state <> 'done')::int as left
       from census_run_tiles m join census_tiles t on t.grid_key = m.grid_key where m.run_id = $1`, [latest.id]);
  // Complete is complete: nothing left, whatever later censuses do to the squares.
  const left = d.action === 'complete' ? 0 : l.left;
  const perTile = tilesAsked ? requests / tilesAsked : null;
  return {
    action: d.action,
    halted: d.action === 'halted' ? { day: d.over.day, kind: d.over.kind, googleGbp: d.over.google_gbp, placesNetGbp: d.over.places_net_gbp ?? 0 } : null,
    // What holds it, so the screen can say so beside "Lift the hold".
    held: d.action === 'held' ? { day: d.yesterday.day, censusGbp: d.yesterday.census_gbp } : null,
    complete: d.action === 'complete',
    districtsWhole: districts.whole,
    tilesLeft: left,
    requestsPerTile: perTile == null ? null : Math.round(perTile),
    // A floor on the days: the measured rate so far is the rural south-west,
    // and the cities to come split further.
    // At the size of the latest day: 150,000 once Google's limit was raised.
    daysLeft: d.action === 'complete' ? 0 : perTile == null ? null
      : Math.max(left ? 1 : 0, Math.ceil((left * perTile) / daySizeOf(latest))),
    dayRequests: daySizeOf(latest),
    days,
  };
}

/**
 * Tell the owner, once. Every tick decides afresh, so a day held or halted is
 * decided again every hour; what is said is said once — by e-mail when a
 * sender is configured (never twice: the mail log is asked first), and in the
 * server's log once per process either way. Until Postmark is set up in
 * Doppler the log and GET /census/uk are all there is, and the status says so.
 */
const saidHere = new Set();
/**
 * Who hears. The owner's own address at Epic, where Postmark delivers while
 * the account is in test mode (owner, 29 Sep 2026: "only @epic.day addresses
 * receive mail for now"); a list in EPIC_CENSUS_REPORT_TO overrides it.
 */
export const reportTo = () => String(process.env.EPIC_CENSUS_REPORT_TO || 'roger@epic.day')
  .split(',').map((a) => a.trim()).filter(Boolean);

export async function notify({ subject, text = null, purpose = 'census_report', send = sendMail, configured = () => mailStatus().configured, to = reportTo() }) {
  if (!saidHere.has(subject)) { saidHere.add(subject); console.log(`epic-api: census — ${subject}`); }
  if (!configured()) return { mailed: false, why: 'no mail sender' };
  // The check and the send under one lock, so two processes cannot both find
  // nothing sent and both send it (Codex, 29 Sep 2026).
  const client = await pool.connect();
  try {
    // Tried, not waited for: a waiter would hold a connection the holder may
    // need. Whoever holds it sends; the rest find it sent next time.
    const { rows: [{ got }] } = await client.query('select pg_try_advisory_lock(hashtext($1)) as got', ['census-notify']);
    if (!got) return { mailed: false, why: 'another process is sending it' };
    try {
      if (!to.length) return { mailed: false, why: 'nobody to send it to' };
      // Each recipient on its own: one delivered is not the list delivered, and
      // a restart between two sends must not skip the second (Codex, 29 Sep
      // 2026). Sent, or being sent right now — not a send a restart cut off,
      // which would otherwise swallow the notice for good. Each send is a row
      // on the Mail screen, as "Census report" or "Census alert".
      let mailed = false; let why = 'already sent';
      for (const address of to) {
        const { rows } = await client.query(
          `select 1 from mail_messages
            where purpose like 'census%' and subject = $1 and lower(to_address) = lower($2)
              and (status not in ('failed', 'sending') or (status = 'sending' and sent_at > now() - interval '15 minutes'))
            limit 1`, [subject.slice(0, 300), address]);
        if (rows.length) continue;
        const out = await send({ to: address, subject, text: text ?? subject, purpose });
        mailed = mailed || Boolean(out.sent); why = out.sent ? null : out.message;
      }
      return { mailed, why };
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', ['census-notify']);
    }
  } finally { client.release(); }
}

/** One day's report, in the owner's five figures. */
export function reportLine(day) {
  // One line (owner, 29 Sep 2026): calls made, new places found, areas left, £ that day.
  const n = (x) => Number(x ?? 0).toLocaleString('en-GB');
  const left = day.districtsLeft == null ? '' : ` · ${n(day.districtsLeft)} districts left in ${n(day.areasLeft)} areas`;
  const money = day.billed
    ? ` · ${gbp(day.billed.placesNetGbp)} that day${day.billed.final ? '' : ' so far'}`
    : ' · billing export: nothing yet';
  return `Census day ${day.day} (${day.date}): ${n(day.requests)} calls · ${n(day.newPlaces)} new places${left}${money}`;
}

/** The server's hourly call: the tick, then the report of every day that has ended, then the news. */
export async function daily(now = new Date()) {
  const tellings = [];
  const out = await tick({ now, tell: (t) => tellings.push(t) });
  if (out.action === 'off') return out;
  const st = await status(now);
  for (const t of tellings) {
    await notify({ subject: t.subject, purpose: t.kind === 'alert' ? 'census_alert' : 'census_report',
      text: `${t.subject}.\n\n${st.days.map((d) => reportLine(d)).join('\n')}` });
  }
  // A day's report once its run has stopped for the day (or for good). The
  // billed figure arrives a day or so later, so a report is sent again once
  // Google has written it — a different subject, said once.
  // Only a day that has ended: a plan still being written, or built and not
  // switched on, is not a day, and its notice would suppress the real one
  // under the same subject (Codex, 29 Sep 2026).
  for (const d of st.days.filter((x) => x.ended)) {
    const line = reportLine(d);
    await notify({ subject: `Census — the rest of the UK, day ${d.day}${d.billed?.final ? ', billed' : ''}`, text: line });
  }
  if (st.complete) await notify({ subject: 'Census — the rest of the UK is complete', text: st.days.map((d) => reportLine(d)).join('\n') });
  return { ...out, status: st };
}

/**
 * A person lifts the hold: every census day billed so far is seen, and only a
 * later one above pennies holds the programme again. Written down with who
 * lifted it and when.
 */
export async function liftHold({ who = null, now = new Date() } = {}) {
  // What each programme day was billed for the census, as seen now: only
  // those amounts are lifted. A bill that arrives later, or grows, holds it
  // again (Codex, 29 Sep 2026).
  const runs = await programme();
  const bills = runs.length ? await billedByDay(pacificDay(runs[0].started_at)) : [];
  const spans = runs.map((r) => billedFor(bills, pacificDay(r.started_at))).filter(Boolean);
  const seen = Object.fromEntries(spans.map((b) => [b.day, b.census_gbp]));
  // Export days and quota-day totals kept apart: they share dates, and one
  // written over the other left a lifted charge stopping it again at once
  // (Codex, 29 Sep 2026).
  const seenGoogle = Object.fromEntries(bills.map((b) => [b.day, b.google_gbp]));
  const seenNet = Object.fromEntries(bills.map((b) => [b.day, b.places_net_gbp ?? 0]));
  const seenGoogleSpan = Object.fromEntries(spans.map((b) => [b.day, b.google_gbp]));
  const seenNetSpan = Object.fromEntries(spans.map((b) => [b.day, b.places_net_gbp ?? 0]));
  await query(
    `insert into bo_settings (key, value, updated_by) values ('census:uk-hold-lifted', $1, $2)
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now(), version = bo_settings.version + 1`,
    [JSON.stringify({ seen, seenGoogle, seenNet, seenGoogleSpan, seenNetSpan, at: new Date(now).toISOString() }), who]);
  return { seen, seenGoogle, seenNet, seenGoogleSpan, seenNetSpan };
}
