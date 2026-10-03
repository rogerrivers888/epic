/**
 * The hosting settings (handover §7): what each one may hold, and how the
 * lanes' config is laid over by them. Pure: no IO.
 *
 * One table, read at run time. A value is checked against its unit here before
 * it is written, so a malformed setting can never reach a rule; a setting still
 * to set (the owner's: guarantee pool, claim auto-pay limit, rating escalation
 * thresholds, DBS age) is null and whatever depends on it shows a dash.
 */

const int = (v, min = 0, max = 10_000_000) => Number.isSafeInteger(v) && v >= min && v <= max;
const pct = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Keys whose row has an on/off switch (handover §5: "Switches, default on"). */
export const SWITCHABLE = Object.freeze(['intro_zero', 'host_link_rate', 'minimum_fee']);

/** Keys the owner has still to set. Null is a value they may hold; nothing else may be null. */
export const TO_SET = Object.freeze(['guarantee_pool', 'claim_auto_pay_limit', 'rating_escalation', 'dbs_age']);

function ladderOk(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 6) return false;
  if (!isObj(v[0]) || !pct(v[0].pct)) return false;
  let prev = { pct: v[0].pct, ratedEvents: 0, avgAtLeast: 0 };
  for (const s of v.slice(1)) {
    if (!isObj(s) || !pct(s.pct) || !int(s.ratedEvents, 1, 10_000) || typeof s.avgAtLeast !== 'number' || s.avgAtLeast < 0 || s.avgAtLeast > 5) return false;
    // Each step is cheaper and asks for more than the one before.
    if (s.pct >= prev.pct || s.ratedEvents <= prev.ratedEvents || s.avgAtLeast < prev.avgAtLeast) return false;
    prev = s;
  }
  return true;
}

function refundsOk(v) {
  if (!isObj(v)) return false;
  for (const k of ['flexible', 'moderate', 'strict']) {
    const t = v[k];
    if (!isObj(t)) return false;
    const full = t.fullHoursBefore != null;
    const part = t.partHoursBefore != null;
    if (full === part) return false;
    if (full && !int(t.fullHoursBefore, 0, 8760)) return false;
    if (part && (!int(t.partHoursBefore, 0, 8760) || !pct(t.partPct))) return false;
  }
  return Object.keys(v).length === 3;
}

/** What each unit may hold. */
const UNIT = {
  pence: (v) => int(v, 0, 1_000_000),
  percent: pct,
  ladder: ladderOk,
  intro: (v) => isObj(v) && int(v.days, 0, 3650) && int(v.bookings, 0, 10_000) && Object.keys(v).length === 2,
  tip: (v) => isObj(v) && pct(v.pct) && int(v.minPence, 0, 100_000) && Object.keys(v).length === 2,
  refunds: refundsOk,
  days: (v) => int(v, 0, 365),
  hours: (v) => int(v, 0, 8760),
  months: (v) => int(v, 1, 600),
  on_request: (v) => isObj(v) && int(v.noticeHours, 0, 8760) && int(v.perWeek, 1, 100) && Object.keys(v).length === 2,
  switch: (v) => typeof v === 'boolean',
  // The names Safety and Standing both read (hostingAdmin.ratingThresholds, hostDesk.standingOf); an average is required.
  thresholds: (v) => isObj(v) && typeof v.avgBelowAtRisk === 'number' && v.avgBelowAtRisk >= 0 && v.avgBelowAtRisk <= 5
    && Object.keys(v).every((k) => ['avgBelowAtRisk', 'minRated', 'lateChangesAtRisk', 'complaintsUnderReview'].includes(k))
    && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0),
};

/**
 * Whether `value` may be written to the row `{ key, unit }`, and `is_on` with
 * it. Returns `{ ok: true }` or `{ ok: false, message }` in plain words.
 */
export function checkSetting(row, { value, isOn } = {}) {
  if (!row) return { ok: false, message: 'There is no such setting.' };
  if (isOn !== undefined) {
    if (typeof isOn !== 'boolean') return { ok: false, message: 'On or off is true or false.' };
    if (!SWITCHABLE.includes(row.key) && isOn === false) return { ok: false, message: `${row.label} cannot be switched off.` };
  }
  if (value === undefined) return isOn === undefined ? { ok: false, message: 'Nothing to change.' } : { ok: true };
  if (value === null) return TO_SET.includes(row.key) ? { ok: true } : { ok: false, message: `${row.label} needs a value.` };
  const check = UNIT[row.unit];
  if (!check) return { ok: false, message: `${row.label} has a unit Epic does not know (${row.unit}).` };
  return check(value) ? { ok: true } : { ok: false, message: `That is not a valid value for ${row.label}.` };
}

/**
 * The part of the lanes' config the settings own (domain/lanes.js
 * `DEFAULT_CONFIG`), from a settings map. A key that is null — still to set, or
 * switched off — is left out, so the default stands for anything the lanes
 * need a number for.
 */
export function configOverlay(m = {}) {
  const o = {};
  const n = (k) => (typeof m[k] === 'number' ? m[k] : null);
  if (n('private_event_fee') != null) o.privateEventPence = m.private_event_fee;
  if (n('pro_monthly') != null) o.proMonthlyPence = m.pro_monthly;
  if (n('private_payment_fee') != null) o.privateCollectPct = m.private_payment_fee;
  if (ladderOk(m.public_commission)) o.publicShare = m.public_commission;
  if (refundsOk(m.refund_terms)) o.refunds = m.refund_terms;
  if (n('cancellation_fee_pct') != null) o.cancellationFeePct = m.cancellation_fee_pct;
  if (n('decides_by_default') != null) o.decidesDaysBefore = m.decides_by_default;
  if (n('weekly_session_decides') != null) o.weeklyDecidesHoursBefore = m.weekly_session_decides;
  if (n('review_window') != null) o.reviewHours = m.review_window;
  const onRequest = {};
  if (isObj(m.on_request_limits)) Object.assign(onRequest, { noticeHours: m.on_request_limits.noticeHours, perWeek: m.on_request_limits.perWeek });
  if (n('ask_to_book_window') != null) onRequest.respondHours = m.ask_to_book_window;
  if (Object.keys(onRequest).length) o.onRequest = onRequest;
  return o;
}

/** A setting's value in words, for the back office and the change log. A null value is a dash. */
export function settingWords(row) {
  const v = row?.value;
  if (v == null) return '—';
  const money = (p) => `£${(p / 100).toFixed(2)}`;
  switch (row.unit) {
    case 'pence': return money(v);
    case 'percent': return `${v}%`;
    case 'ladder': return v.map((s, i) => (i === 0 ? `${s.pct}% start` : `${s.pct}% at ${s.ratedEvents} rated, ${s.avgAtLeast}+`)).join(' · ');
    case 'intro': return `${v.days} days or ${v.bookings} bookings`;
    case 'tip': return `${v.pct}%, minimum ${money(v.minPence)}`;
    case 'refunds': {
      const t = (x) => (x.fullHoursBefore != null ? (x.fullHoursBefore % 24 === 0 && x.fullHoursBefore >= 48 ? `${x.fullHoursBefore / 24} days` : `${x.fullHoursBefore}h`) : `${x.partPct}% to ${x.partHoursBefore / 24} days`);
      return `Flexible ${t(v.flexible)} · Moderate ${t(v.moderate)} · Strict ${t(v.strict)}`;
    }
    case 'days': return `${v} days before`;
    case 'hours': return `${v}h`;
    case 'months': return `${v} months`;
    case 'on_request': return `${v.noticeHours}h / ${v.perWeek} a week`;
    case 'switch': return v ? 'On' : 'Off';
    default: return JSON.stringify(v);
  }
}
