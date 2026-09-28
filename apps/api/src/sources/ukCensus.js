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
import { ownerAccount } from '../repositories/accounts.js';

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

export const LABEL = 'The rest of the UK — day';
export const DAY_REQUESTS = 70_000;
/** "£0 (or pennies)": under a pound of census cost on a day is pennies. */
export const PENNIES_GBP = 1;
/** "stop and alert me the moment any day shows more than £5." */
export const DAY_ALERT_GBP = 5;
/** Whose decision a daily run is: the programme's — and the reset clock never wakes it. */
export const STARTED_BY = censusRun.ONE_DAY_RUNS;
/** How a day ends: at the run's own ceiling, or ended for the day at the shared cap. */
const DAY_ENDED = /^(stopped at the \d+-request ceiling|ended for the day)/;

/** The quota day a moment falls in: Google's day is Los Angeles's. */
export const pacificDay = (at) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(at));

/** The programme's runs, oldest first. */
export async function programme() {
  const { rows } = await query(
    `select * from census_runs where label like $1 order by started_at`, [`${LABEL} %`]);
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
    `select to_char(day, 'YYYY-MM-DD') as day,
            coalesce(sum(cost) filter (where meter = 'google-essentials'), 0)::float as census_gbp,
            coalesce(sum(cost), 0)::float as google_gbp
       from billing_days
      where meter is not null and day >= $1::date
      group by 1 order by 1`, [fromDay]);
  return rows;
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
  const latest = runs[runs.length - 1];
  const bills = await billedByDay(pacificDay(runs[0].started_at));
  const over = bills.find((b) => b.google_gbp > DAY_ALERT_GBP);
  if (over) return { action: 'halted', runs, latest, bills, over };
  if (latest.state === 'done') return { action: 'complete', runs, latest, bills };
  if (['running', 'waiting'].includes(latest.state)) return { action: 'working', runs, latest, bills };
  if (!(latest.state === 'paused' && DAY_ENDED.test(latest.problem ?? ''))) return { action: 'stopped', runs, latest, bills };
  const ended = latest.finished_at ?? latest.last_seen_at ?? latest.started_at;
  if (pacificDay(ended) >= pacificDay(now)) return { action: 'today', runs, latest, bills };
  const yesterday = bills.find((b) => b.day === pacificDay(latest.started_at));
  if (yesterday && yesterday.census_gbp >= PENNIES_GBP) return { action: 'held', runs, latest, bills, yesterday };
  return { action: 'start', runs, latest, bills, yesterday: yesterday ?? null, day: runs.length + 1 };
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

async function tickLocked({ now = new Date(), start = censusRun.startRun, stop = censusRun.requestStop, tell = () => {}, endDay = censusRun.endForTheDay } = {}) {
  // A day's run asleep at the shared cap is ended for the day, not carried
  // into tomorrow (Codex, 28 Sep 2026).
  const { rows: asleep } = await query(
    `select id from census_runs where label like $1 and state = 'waiting'`, [`${LABEL} %`]);
  for (const r of asleep) await endDay(r.id);
  const d = await decide(now);
  if (d.action === 'halted') {
    if (['running', 'waiting'].includes(d.latest?.state)) await stop(d.latest.id);
    tell({ kind: 'alert', subject: `Census stopped: Google billed £${d.over.google_gbp.toFixed(2)} on ${d.over.day}`, d });
  }
  if (d.action === 'held') tell({ kind: 'alert', subject: `Census held: the census was billed £${d.yesterday.census_gbp.toFixed(2)} on ${d.yesterday.day}`, d });
  if (d.action !== 'start') return d;
  const label = `${LABEL} ${d.day}`;
  const sessionId = await sessionFor(label);
  const run = await start({
    label, areas: UK_AREAS, maxRequests: DAY_REQUESTS, ratePerSec: 5, dailyCap: 75_000,
    startedBy: STARTED_BY, startedSessionId: sessionId,
  });
  tell({ kind: 'started', subject: `Census day ${d.day} started`, d, run });
  return { ...d, started: run, sessionId };
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
  const bills = new Map((d.bills ?? []).map((b) => [b.day, b]));
  const days = [];
  let requests = 0; let tilesAsked = 0;
  for (const [i, r] of d.runs.entries()) {
    const { rows: [t] } = await query(
      `select count(*) filter (where s.n > 0)::int as asked
         from census_run_tiles m
         left join lateral (select count(*) n from census_slices s where s.census_run_id = m.run_id and s.area_slug = m.grid_key) s on true
        where m.run_id = $1`, [r.id]);
    const day = pacificDay(r.started_at);
    const b = bills.get(day);
    requests += Number(r.requests ?? 0); tilesAsked += Number(t.asked ?? 0);
    days.push({
      day: i + 1, date: day, runId: r.id, state: r.state, requests: Number(r.requests ?? 0), places: Number(r.places ?? 0),
      tilesAsked: Number(t.asked ?? 0),
      billed: b ? { censusGbp: b.census_gbp, googleGbp: b.google_gbp } : null,
    });
  }
  const { rows: [districts] } = await query(
    `select count(*)::int as whole from (
       select area_slug from area_counts where area_slug ~ '^[a-z]{1,2}[0-9]' group by area_slug having bool_and(complete)) x`);
  const latest = d.latest;
  // Counted from the tiles: a tile given up on after its tries is not work
  // left, and the run row does not carry that count (Codex, 28 Sep 2026).
  const { rows: [l] } = await query(
    `select count(*) filter (where t.state <> 'done' and not (t.state = 'failed' and t.failures >= $2))::int as left
       from census_run_tiles m join census_tiles t on t.grid_key = m.grid_key where m.run_id = $1`,
    [latest.id, censusRun.MAX_TILE_TRIES]);
  const left = l.left;
  const perTile = tilesAsked ? requests / tilesAsked : null;
  return {
    action: d.action,
    halted: d.action === 'halted' ? { day: d.over.day, googleGbp: d.over.google_gbp } : null,
    complete: d.action === 'complete',
    districtsWhole: districts.whole,
    tilesLeft: left,
    requestsPerTile: perTile == null ? null : Math.round(perTile),
    // A floor on the days: the measured rate so far is the rural south-west,
    // and the cities to come split further.
    daysLeft: perTile == null ? null : Math.ceil((left * perTile) / DAY_REQUESTS),
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
export async function notify({ subject, text = null }) {
  if (!saidHere.has(subject)) { saidHere.add(subject); console.log(`epic-api: census — ${subject}`); }
  if (!mailStatus().configured) return { mailed: false, why: 'no mail sender' };
  const { rows } = await query(
    `select 1 from mail_messages where purpose = 'census' and subject = $1 and status <> 'failed' limit 1`, [subject.slice(0, 300)]);
  if (rows.length) return { mailed: false, why: 'already sent' };
  const owner = await ownerAccount();
  if (!owner?.email) return { mailed: false, why: 'no owner address' };
  const out = await sendMail({ to: owner.email, subject, text: text ?? subject, purpose: 'census' });
  return { mailed: Boolean(out.sent), why: out.sent ? null : out.message };
}

/** One day's report, in the owner's five figures. */
export function reportLine(day, whole, daysLeft) {
  const billed = day.billed
    ? `billed £${day.billed.censusGbp.toFixed(2)} for the census (Google £${day.billed.googleGbp.toFixed(2)} that day)`
    : 'not billed yet';
  return `Day ${day.day} (${day.date}): ${whole.toLocaleString('en-GB')} districts done, ${day.places.toLocaleString('en-GB')} places added, `
    + `${day.requests.toLocaleString('en-GB')} requests, ${billed}, `
    + `${daysLeft == null ? 'days remaining not yet measurable' : `about ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`}.`;
}

/** The server's hourly call: the tick, then the report of every day that has ended, then the news. */
export async function daily(now = new Date()) {
  const tellings = [];
  const out = await tick({ now, tell: (t) => tellings.push(t) });
  if (out.action === 'off') return out;
  const st = await status(now);
  for (const t of tellings) {
    await notify({ subject: t.subject, text: `${t.subject}.\n\n${st.days.map((d) => reportLine(d, st.districtsWhole, st.daysLeft)).join('\n')}` });
  }
  // A day's report once its run has stopped for the day (or for good). The
  // billed figure arrives a day or so later, so a report is sent again once
  // Google has written it — a different subject, said once.
  for (const d of st.days.filter((x) => x.state !== 'running' && x.state !== 'waiting')) {
    const line = reportLine(d, st.districtsWhole, st.daysLeft);
    await notify({ subject: `Census — the rest of the UK, day ${d.day}${d.billed ? ', billed' : ''}`, text: line });
  }
  if (st.complete) await notify({ subject: 'Census — the rest of the UK is complete', text: st.days.map((d) => reportLine(d, st.districtsWhole, 0)).join('\n') });
  return { ...out, status: st };
}
