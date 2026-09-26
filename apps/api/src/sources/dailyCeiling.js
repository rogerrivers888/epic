/**
 * The estate's daily ceiling on money, across every provider (owner, 26 Sep
 * 2026, G8: "Daily £ ceiling across the estate from estimated_cost_usd: alarm
 * at 80% (email and back-office banner), refuse at 100%. Propose the figure.").
 *
 * The monthly bounds count requests per household; nothing counted money per
 * day across everybody, which is how a loop nobody was watching spent £22 in
 * an afternoon three times in one month. This does: the day's
 * `estimated_cost_usd` over the whole ledger, London's day, against
 * EPIC_DAILY_SPEND_CEILING_GBP.
 *
 * **The figure proposed is £30 a day** (26 Sep 2026). Of this month's 24 days
 * at list price, 16 were under it; the eight over it were the unattributed
 * own.js loop (now off), the atlas rating harvests, and the 25 Sep sweep —
 * which at £34 without the loop would have needed the ceiling raised for the
 * day, deliberately. The owner sets the number; this is the default until he
 * does.
 *
 * List prices, not an invoice: `estimated_cost_usd` takes no free allowance
 * off, so this ceiling is reached before Google's bill says the same thing.
 * That is the safe side to be wrong on.
 *
 * Asked at the paid door (sources/paidGate.js) and before every Claude call
 * (claude.js). Crossing 80% raises a `warn` alarm and 100% a `stop` alarm,
 * each once a day (the row in `spend_alarms` is the once), with an e-mail to
 * EPIC_ALARM_EMAIL where one is set and the back-office banner either way.
 */

import { USD_TO_GBP } from '../domain/providerPrices.js';

export const DAILY_CEILING_GBP = () => Number(process.env.EPIC_DAILY_SPEND_CEILING_GBP || 30);
const WARN_AT = 0.8;

export class DailyCeilingError extends Error {
  constructor(spentGbp, ceilingGbp) {
    super(`Today's spend has reached the estate's daily ceiling (£${spentGbp.toFixed(2)} of £${ceilingGbp.toFixed(2)}); paid calls are refused until midnight.`);
    this.code = 'daily_ceiling_reached';
    this.status = 429;
  }
}

let db = null;
const load = () => (db ??= import('../db.js'));

// London's day, from the database clock, so every process agrees on when it turns.
const TODAY = `(date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')`;

/**
 * What the ledger says today has cost, in dollars. Held for a few seconds —
 * the photo grid asks once a picture — which lets a burst overshoot by what it
 * admits inside that window; the next admission after it is refused.
 */
const HOLD_MS = 5_000;
let held = null;
export async function spentTodayUsd({ fresh = false } = {}) {
  if (!fresh && held && Date.now() - held.at < HOLD_MS) return held.usd;
  const { query } = await load();
  const { rows: [row] } = await query(
    `select coalesce(sum(estimated_cost_usd), 0)::float as usd from provider_calls where created_at >= ${TODAY}`);
  held = { usd: row.usd, at: Date.now() };
  return row.usd;
}

/** Today against the ceiling, for the banner and the refusal. */
export async function todayStatus({ fresh = false } = {}) {
  const spentGbp = (await spentTodayUsd({ fresh })) * USD_TO_GBP;
  const ceilingGbp = DAILY_CEILING_GBP();
  const ratio = ceilingGbp > 0 ? spentGbp / ceilingGbp : 1;
  const level = ratio >= 1 ? 'stop' : ratio >= WARN_AT ? 'warn' : null;
  return { spentGbp, ceilingGbp, ratio, level };
}

/**
 * A paid row has just been written: look again, so a call that crosses 80% or
 * 100% raises its alarm now rather than on the next paid call, which may not
 * come today (Codex, 26 Sep 2026). Never throws — the call has been made.
 */
export function noteSpend(usd) {
  if (!(usd > 0)) return;
  held = null;
  void todayStatus({ fresh: true })
    .then((s) => (s.level ? raiseAlarm(s) : null))
    .catch((err) => console.warn(`spend alarm: ${err.message}`));
}

/** Refuse at the ceiling; raise the alarm at 80% and at 100%, once a day each. */
export async function assertUnderDailyCeiling() {
  const s = await todayStatus();
  if (s.level) void raiseAlarm(s).catch((err) => console.warn(`spend alarm: ${err.message}`));
  if (s.level === 'stop') throw new DailyCeilingError(s.spentGbp, s.ceilingGbp);
}

/**
 * The alarm, once. The insert is the once: whichever process gets the row
 * first sends the mail, and a restart finds it already there.
 */
export async function raiseAlarm({ level, spentGbp, ceilingGbp }, { send = null } = {}) {
  const { query } = await load();
  const { rows: [row] } = await query(
    `insert into spend_alarms (day, level, spent_usd, ceiling_usd)
     values ((now() at time zone 'Europe/London')::date, $1, $2, $3)
     on conflict (day, level) do nothing returning day`,
    [level, spentGbp / USD_TO_GBP, ceilingGbp / USD_TO_GBP],
  );
  if (!row) return { raised: false };
  const to = String(process.env.EPIC_ALARM_EMAIL || '').trim();
  let note = null; let mailed = false;
  if (!to) note = 'EPIC_ALARM_EMAIL is not set, so the banner is the only alarm';
  else {
    const sendMail = send ?? (await import('./mail.js')).sendMail;
    const subject = level === 'stop'
      ? `Epic: daily spend ceiling reached — paid calls refused (£${spentGbp.toFixed(2)} of £${ceilingGbp.toFixed(2)})`
      : `Epic: today's spend is at ${Math.round((spentGbp / ceilingGbp) * 100)}% of the daily ceiling (£${spentGbp.toFixed(2)} of £${ceilingGbp.toFixed(2)})`;
    const text = level === 'stop'
      ? `Every paid Google, Routes and Claude call is refused until midnight London time. The ledger is in the back office; EPIC_DAILY_SPEND_CEILING_GBP moves the ceiling.`
      : `Paid calls go on until the ceiling, then stop until midnight London time. The ledger is in the back office.`;
    const out = await sendMail({ to, subject, text, purpose: 'spend_alarm' }).catch((err) => ({ sent: false, message: err.message }));
    mailed = Boolean(out?.sent);
    note = mailed ? null : String(out?.message ?? 'not sent').slice(0, 300);
  }
  await query(`update spend_alarms set mailed = $3, mail_note = $4 where day = $1 and level = $2`, [row.day, level, mailed, note]);
  return { raised: true, mailed, note };
}

/** Today's alarms, for the banner. */
export async function alarmsToday() {
  const { query } = await load();
  const { rows } = await query(
    `select level, raised_at, mailed, mail_note from spend_alarms where day = (now() at time zone 'Europe/London')::date order by raised_at`);
  return rows;
}
