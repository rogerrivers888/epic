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

export const LABEL = censusRun.ONE_DAY_LABEL;
export const DAY_REQUESTS = 70_000;
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
            coalesce(sum(cost + credits - promo), 0)::float as google_gbp
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
  return { day: quotaDay, census_gbp: spans.reduce((n, b) => n + b.census_gbp, 0), google_gbp: spans.reduce((n, b) => n + b.google_gbp, 0), final: spans.length === 2 };
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
  const bills = await billedByDay(pacificDay(runs[0].started_at));
  // Any export day over £5, and any quota day of the programme over £5 across
  // the two London days it spans — £3 and £3 is £6 (Codex, 29 Sep 2026). The
  // two overlap at the edges, which errs towards stopping.
  const over = bills.find((b) => b.google_gbp > DAY_ALERT_GBP)
    ?? runs.map((r) => billedFor(bills, pacificDay(r.started_at))).find((b) => b && b.google_gbp > DAY_ALERT_GBP);
  if (over) return { action: 'halted', runs, latest, bills, over };
  // Done is complete only if no square was given up on: a run finishes with
  // its failed squares set aside, and the UK is not done while they are
  // unasked. A day that ended so is followed by another, which tries them
  // again (Codex, 28 Sep 2026).
  const { rows: [{ failed }] } = latest.state === 'done'
    ? await query(
      `select count(*)::int as failed from census_run_tiles m join census_tiles t on t.grid_key = m.grid_key
        where m.run_id = $1 and t.state <> 'done'`, [latest.id])
    : { rows: [{ failed: 0 }] };
  if (latest.state === 'done' && !failed) return { action: 'complete', runs, latest, bills };
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
  const unfinishedPlan = latest.state === 'paused' && latest.started_by === STARTED_BY && /^built paused/.test(latest.problem ?? '')
    && new Date(now).getTime() - new Date(latest.last_seen_at ?? latest.started_at).getTime() > PLANNING_MS;
  if (unfinishedPlan) return { action: 'replan', runs, latest, bills, day: days };
  const dayEnded = (latest.state === 'paused' && DAY_ENDED.test(latest.problem ?? '')) || latest.state === 'done';
  if (!dayEnded) return { action: 'stopped', runs, latest, bills };
  // A day's run is the quota day it was started in: one run a day, however
  // late the last one was closed off (Codex, 28 Sep 2026).
  if (pacificDay(latest.started_at) >= pacificDay(now)) return { action: 'today', runs, latest, bills };
  const yesterday = billedFor(bills, pacificDay(latest.started_at));
  if (yesterday && yesterday.census_gbp >= PENNIES_GBP) return { action: 'held', runs, latest, bills, yesterday };
  return { action: 'start', runs, latest, bills, yesterday: yesterday ?? null, day: days + 1 };
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
  if (d.action === 'overran') {
    await query(
      `update census_runs set max_requests = least(max_requests, requests) where id = $1 and state = 'running'`, [d.latest.id]);
    return d;
  }
  if (d.action === 'replan') {
    await query(
      `update census_runs set state = 'stopped', finished_at = now(), problem = 'planning cut short; replaced by the next run'
        where id = $1 and state = 'paused'`, [d.latest.id]);
  }
  if (d.action !== 'start' && d.action !== 'replan') return d;
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
    label, areas: UK_AREAS, maxRequests: DAY_REQUESTS, nightShare: DAY_REQUESTS, ratePerSec: 5, dailyCap: 75_000,
    startedBy: STARTED_BY, startedSessionId: sessionId, paused: true,
  });
  let on = false;
  if (run?.id) {
    // Only if nothing else is going: a census started by hand while this one
    // was being planned is not joined by a second (Codex, 28 Sep 2026). Left
    // built-paused, it is replanned once the other is done.
    // Under the lock starting and resuming share, so a resume cannot slip in
    // between this check and this switch (Codex, 29 Sep 2026).
    on = await censusRun.withStartLock(async (db) => (await db.query(
      `update census_runs set state = 'running', problem = null, last_seen_at = now()
        where id = $1 and state = 'paused' and problem like 'built paused%'
          and not exists (select 1 from census_runs o where o.id <> $1 and o.state in ('running', 'waiting'))`, [run.id])).rowCount > 0)
      .catch(() => false);
  }
  // Said only if it is true (Codex, 29 Sep 2026).
  if (!on) return { ...d, action: 'blocked', built: run, sessionId };
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

  const days = [];
  let requests = 0; let tilesAsked = 0;
  const counted = d.runs.filter((r) => !(r.state === 'stopped' && /^planning cut short/.test(r.problem ?? '')));
  for (const [i, r] of counted.entries()) {
    const { rows: [t] } = await query(
      `select count(*) filter (where s.n > 0)::int as asked
         from census_run_tiles m
         left join lateral (select count(*) n from census_slices s where s.census_run_id = m.run_id and s.area_slug = m.grid_key) s on true
        where m.run_id = $1`, [r.id]);
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
    const { rows: [then] } = kept ? { rows: [kept.value] } : await query(
      `with plan as (
         select t.outcodes, (t.censused_at is not null and t.censused_at <= coalesce(r.finished_at, now())) as done
           from census_run_tiles m join census_tiles t on t.grid_key = m.grid_key join census_runs r on r.id = m.run_id
          where m.run_id = $1)
       select (select count(*)::int from (select c.code from plan, unnest(plan.outcodes) c(code) group by c.code having bool_and(done)) x) as districts,
              (select count(*) filter (where not done)::int from plan) as left`, [r.id]);
    // Kept once the day has ended, so a square censused again thirty days on
    // cannot rewrite what that day said (Codex, 29 Sep 2026). In the back
    // office's own settings table, under a key its reader ignores.
    if (ended && !kept) {
      await query(
        `insert into bo_settings (key, value, updated_by) values ($1, $2, 'the UK census') on conflict (key) do nothing`,
        [key, JSON.stringify({ districts: then.districts, left: then.left })]);
    }
    const rate = tilesAsked ? requests / tilesAsked : null;
    days.push({
      day: i + 1, date: day, runId: r.id, state: r.state, ended, requests: Number(r.requests ?? 0), places: Number(r.places ?? 0),
      tilesAsked: Number(t.asked ?? 0),
      districts: then.districts,
      tilesLeft: then.left,
      daysLeft: rate == null ? null : Math.max(then.left ? 1 : 0, Math.ceil((then.left * rate) / DAY_REQUESTS)),
      billed: b ? { censusGbp: b.census_gbp, googleGbp: b.google_gbp, final: b.final } : null,
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
    daysLeft: perTile == null ? null : Math.max(left ? 1 : 0, Math.ceil((left * perTile) / DAY_REQUESTS)),
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
export async function notify({ subject, text = null, send = sendMail, configured = () => mailStatus().configured }) {
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
      const { rows } = await client.query(
        `select 1 from mail_messages where purpose = 'census' and subject = $1 and status <> 'failed' limit 1`, [subject.slice(0, 300)]);
      if (rows.length) return { mailed: false, why: 'already sent' };
      const owner = await ownerAccount();
      if (!owner?.email) return { mailed: false, why: 'no owner address' };
      const out = await send({ to: owner.email, subject, text: text ?? subject, purpose: 'census' });
      return { mailed: Boolean(out.sent), why: out.sent ? null : out.message };
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', ['census-notify']);
    }
  } finally { client.release(); }
}

/** One day's report, in the owner's five figures. */
export function reportLine(day, whole = day.districts, daysLeft = day.daysLeft) {
  const billed = day.billed
    ? `${day.billed.final ? 'billed' : 'billed so far'} £${day.billed.censusGbp.toFixed(2)} for the census (Google £${day.billed.googleGbp.toFixed(2)} that day)`
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
    await notify({ subject: t.subject, text: `${t.subject}.\n\n${st.days.map((d) => reportLine(d)).join('\n')}` });
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
