/**
 * Automations as records, and the log of everything they do (K16 step 1,
 * Roger, 3 Oct 2026).
 *
 *   · An automation is a row: its area, what fires it, its rule values (typed
 *     per automation, below), the templates it sends, an on/off switch, and a
 *     lock. Its logic lives in code (`logic` says where, or that it comes
 *     later); `honours_switch` says whether that code reads the switch yet.
 *   · An automation with no template cannot be switched on.
 *   · Child-safety pause is always on: locked, no switch, for anybody.
 *   · Rating suspension and the suspended step of Strikes are locked off —
 *     "Waits for the host rules page and Host Terms" — until the owner,
 *     signed in personally, unlocks them; only then can they be switched on.
 *   · Every switch, lock and rule change is in the back office's Changes log
 *     (bo_changes, area Automations), as template edits are (area Messages).
 *   · `automation_runs` is every automatic action: which automation, on what,
 *     the rule that fired, the evidence, what it did, and how to undo it.
 *     Undo goes through a handler registered per automation, and is refused
 *     where there is none or where it needs a person and none is named.
 *
 * For the Stripe chat (money code is theirs; this file only records):
 *
 *   import { logAutomationRun } from '../repositories/automations.js';
 *   await logAutomationRun({
 *     automation: 'decides_by',            // or 'complaint_auto_refund' — a key seeded below
 *     subjectKind: 'session', subjectId,   // what it acted on
 *     rule: 'Under the minimum at decides-by (6 needed, 3 booked)',
 *     evidence: { heads, min, decidesAt },  // what it saw, as it saw it
 *     did: 'Called off and refunded 3 bookings',
 *     undo: null,                          // money is never undone from here
 *   }, client);                            // optional: inside the caller's transaction
 *
 * A key not in AUTOMATION_SEEDS is refused, so a typo fails loudly rather
 * than logging under a name nothing reads.
 */

import { query, withTransaction } from '../db.js';
import { logChange } from '../desk/changes.js';
import { logChange as logHostingChange } from './hostingSettings.js';
import { ensureSeeded as ensureTemplates } from './templates.js';

const refuse = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rule value types: a number, a whole number, a list of whole numbers, a clock time, or a list of words. */
const TYPES = {
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  int: (v) => Number.isInteger(v) && v >= 0,
  ints: (v) => Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 0),
  time: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  pence: (v) => Number.isInteger(v) && v >= 0,
};

const HOST_RULES_WAIT = 'Waits for Host Terms';
const RUN_BY_PAYMENTS = 'Run by Payments';

/**
 * The automations, as the design handover lists them (§6, 3 Oct 2026) — 22,
 * in its areas and order — with Roger's values (§5) and his rulings:
 *
 *   · Seeded switched on (Roger, 3 Oct 2026: "seed every automation record
 *     switched on, in the same migration, so nothing that runs today stops").
 *     The rows are written by migration 374, not by code on first use; this
 *     list is what the migration wrote, and test/automations.test.js holds
 *     the two together.
 *   · Child-safety pause and the lapsed-checks pause are always on: no switch,
 *     for anybody (`lock_kind = 'always_on'`; a database check keeps them on).
 *   · Rating suspension, and the suspended step of Strikes, are locked off —
 *     "Waits for Host Terms" — until the owner switches on the host rules page
 *     and the Host Terms.
 *   · Automations whose code is the Payments (Stripe) chat's show "Run by
 *     Payments" and have no switch until that chat wires them to these
 *     records (`lock_kind = 'payments'`, Roger's answer 4).
 *   · "Nothing sent (deliberate)" is `noTemplate`: such an automation runs
 *     without a message by design. Any other automation without a template
 *     cannot be switched on.
 */
const A = (o) => ({ rules: {}, types: {}, templateKeys: [], isOn: true, locked: false, lockKind: null, lockReason: null, stepLocks: {}, noTemplate: null, logic: null, ownerChat: null, honoursSwitch: false, ...o });
const PAYMENTS = { locked: true, lockKind: 'payments', lockReason: RUN_BY_PAYMENTS, ownerChat: 'stripe' };
export const AUTOMATION_SEEDS = Object.freeze([
  // — Safety
  A({ key: 'hide_contact_details', area: 'safety', name: 'Hide contact details', trigger: 'chat.contact_hidden', templateKeys: ['contact_details_hidden'], logic: 'routes/chat.js — phone numbers and e-mail addresses in messages before a booking' }),
  A({
    key: 'strikes', area: 'safety', name: 'Strikes', trigger: 'host.strike',
    rules: { warningAt: 1, finalWarningAt: 2, suspendedAt: 3, expiryMonths: 12, lateChangesForStrike: 3, lateChangeWindowDays: 90 },
    types: { warningAt: 'int', finalWarningAt: 'int', suspendedAt: 'int', expiryMonths: 'int', lateChangesForStrike: 'int', lateChangeWindowDays: 'int' },
    templateKeys: ['strike_warning', 'strike_final_warning', 'strike_suspension'],
    stepLocks: { suspended: HOST_RULES_WAIT }, logic: 'The rules engine (sources/rulesEngine.js)',
  }),
  A({
    key: 'child_safety_pause', area: 'safety', name: 'Child safety pause', trigger: 'safety.child_safety_report', templateKeys: ['children_paused'],
    locked: true, lockKind: 'always_on', lockReason: 'Always on: a report about a child’s safety always pauses that host’s events with children; only a person closing the safety item lifts it (Roger, 3 Oct 2026).',
    logic: 'sources/safetyHolds.js childSafetyReported',
  }),
  A({
    key: 'checks_lapse_pause', area: 'safety', name: 'Checked lapses — pause public drop-off events', trigger: 'safety.checks_lapsed', templateKeys: ['checks_lapsed'],
    locked: true, lockKind: 'always_on', lockReason: 'Always on: a public drop-off event never runs on lapsed checks (Roger, 3 Oct 2026).',
    logic: 'sources/safetyHolds.js pauseForLapsedChecks',
  }),
  // — Hosting
  A({ key: 'rating_warning', area: 'hosting', name: 'Rating warning', trigger: 'host.rating_dropped', rules: { below: 3.8, lastRated: 10, minRated: 5 }, types: { below: 'number', lastRated: 'int', minRated: 'int' }, templateKeys: ['rating_dropped'], logic: 'The rules engine (sources/rulesEngine.js)' }),
  A({
    key: 'rating_suspension', area: 'hosting', name: 'Rating suspension', trigger: 'host.rating_dropped', rules: { below: 3.5, lastRated: 10, minRated: 5, comeBackDays: 90 }, types: { below: 'number', lastRated: 'int', minRated: 'int', comeBackDays: 'int' },
    templateKeys: ['strike_suspension'], isOn: false, locked: true, lockKind: 'owner', lockReason: HOST_RULES_WAIT, logic: 'The rules engine (sources/rulesEngine.js)',
  }),
  A({ key: 'checked_reminders', area: 'hosting', name: 'Checked reminders — now, then days 3, 7, 14', trigger: 'host.checked_expiring', rules: { remindOnDays: [0, 3, 7, 14] }, types: { remindOnDays: 'ints' }, templateKeys: ['check_expiring', 'referee_request', 'referee_reminder'], logic: 'The rules engine (sources/rulesEngine.js)' }),
  A({ key: 'back_to_draft', area: 'hosting', name: 'Back to draft after 30 days', trigger: 'host.back_to_draft', rules: { days: 30 }, types: { days: 'int' }, templateKeys: ['back_to_drafts'], logic: 'The rules engine (sources/rulesEngine.js)' }),
  A({ key: 'decides_by', area: 'hosting', name: 'Decides by', trigger: 'session.going_ahead', templateKeys: ['decides_by_result', 'called_off', 'event_called_off', 'under_minimum'], logic: 'sources/bookingMoney.js decideDue (the days are the hosting settings decides_by_default and weekly_session_decides)', ...PAYMENTS }),
  A({ key: 'reminder_24h', area: 'hosting', name: 'Reminder 24 h before', trigger: 'booking.reminder_24h', rules: { hoursBefore: 24 }, types: { hoursBefore: 'int' }, templateKeys: ['reminder_24h'], logic: 'routes/guestBookings.js guestPrompts' }),
  A({ key: 'morning_after', area: 'hosting', name: 'Did it happen? (morning after)', trigger: 'booking.morning_after', rules: { fromLocalTime: '08:00' }, types: { fromLocalTime: 'time' }, templateKeys: ['after_event'], logic: 'routes/guestBookings.js guestPrompts' }),
  A({ key: 'late_change', area: 'hosting', name: 'Late change counts (within 48 h)', trigger: 'host.late_change', rules: { withinHours: 48 }, types: { withinHours: 'int' }, templateKeys: ['late_change_counts'], logic: 'sources/bookingMoney.js marks a late cancel or move; the rules engine counts it' }),
  A({ key: 'events_go_live', area: 'hosting', name: 'Events go live', trigger: 'event.live', templateKeys: ['event_live'], logic: 'routes/hostingAdmin.js — AI-cleared events, and releaseApproved for “Approved · waiting on Checked”' }),
  // — Money
  A({ key: 'refunds_within_policy', area: 'money', name: 'Refunds within policy', trigger: 'refund.issued', templateKeys: ['refund_issued'], logic: 'sources/bookingMoney.js processRefunds', ...PAYMENTS }),
  A({ key: 'release_card_holds', area: 'money', name: 'Release card holds (24 h — the host didn’t reply)', trigger: 'booking.request_declined', rules: { hours: 24 }, types: { hours: 'int' }, templateKeys: ['ask_to_book_declined'], logic: 'Ask to book: a request the host has not answered in time releases the guest’s card hold', ...PAYMENTS }),
  A({ key: 'waitlist_offer', area: 'money', name: 'Pass on waiting-list places (12 h)', trigger: 'waitlist.place_offered', rules: { hours: 12 }, types: { hours: 'int' }, templateKeys: ['waitlist_offered'], logic: 'routes/guestBookings.js offerFreedPlaces (the hours are the hosting setting waitlist_offer)' }),
  A({ key: 'pay_hosts', area: 'money', name: 'Pay hosts (72 h, set in Billing)', trigger: 'payout.sent', noTemplate: 'Nothing sent (deliberate)', logic: 'sources/hostingMoney.js — payouts', ...PAYMENTS }),
  A({ key: 'complaint_hold', area: 'money', name: 'Hold payout on a complaint (host has 48 h; auto-refund up to £50, set in Billing)', trigger: 'complaint.opened', rules: { respondWithinHours: 48 }, types: { respondWithinHours: 'int' }, templateKeys: ['something_went_wrong'], logic: 'sources/hostingMoney.js — a complaint holds the payout', ...PAYMENTS }),
  A({ key: 'chargebacks', area: 'money', name: 'Chargebacks — evidence assembled, auto-sent 2 days before the deadline', trigger: 'payout.held', noTemplate: 'Nothing sent (deliberate)', logic: 'The Stripe chat’s dispute handling', ...PAYMENTS }),
  A({ key: 'fix_stripe_differences', area: 'money', name: 'Fix Stripe differences', trigger: 'payout.held', noTemplate: 'Nothing sent (deliberate)', logic: 'The Stripe chat’s reconciliation', ...PAYMENTS }),
  // — Members
  A({ key: 'failed_membership_payments', area: 'members', name: 'Failed membership payments — update-card email, retry after 3 days, then pause', trigger: 'membership.renewal_failed', templateKeys: ['renewal_failed'], logic: 'Membership billing (the Stripe chat’s)', ...PAYMENTS }),
  // — Demand
  A({ key: 'tell_me_when', area: 'demand', name: 'Tell me when — at most one a week', trigger: 'tell_me_when.match', rules: { maxPerWeek: 1 }, types: { maxPerWeek: 'int' }, templateKeys: ['tell_me_when'], logic: '“Tell me when” sign-ups (guide_alerts, migration 373)' }),
]);
const SEED = new Map(AUTOMATION_SEEDS.map((a) => [a.key, a]));
export const AUTOMATION_KEYS = Object.freeze([...SEED.keys()]);
/** The areas, in the order the design lists them. */
export const AREAS = Object.freeze(['safety', 'hosting', 'money', 'members', 'demand']);

/**
 * Whether an automation is on, for code that honours its switch. A record not
 * written yet keeps what the code did before records existed — on — rather
 * than reading the missing row as "off" and stopping something quietly. Never
 * asked by the two always-on pauses: they run whatever any record says.
 */
export async function isOn(key) {
  const { rows: [r] } = await query('select is_on from automations where key = $1', [key]);
  return r ? r.is_on : true;
}

/** What the list says instead of a switch: the design's words (handover §6). */
const STATUS = { always_on: 'Always on', payments: RUN_BY_PAYMENTS, owner: HOST_RULES_WAIT };

const shape = (r, counts) => ({
  key: r.key, area: r.area, name: r.name, trigger: r.trigger, rules: r.rules, ruleTypes: SEED.get(r.key)?.types ?? {},
  templateKeys: r.template_keys, noTemplate: r.no_template, on: r.is_on, locked: r.locked, lockKind: r.lock_kind, lockReason: r.lock_reason,
  // Whether the list draws a switch, and what it says when it does not.
  switchable: !r.locked, status: r.locked ? (STATUS[r.lock_kind] ?? r.lock_reason) : null,
  stepLocks: r.step_locks ?? {},
  logic: r.logic, ownerChat: r.owner_chat, honoursSwitch: r.honours_switch, updatedBy: r.updated_by, updatedAt: r.updated_at,
  runs: counts ? { last7: counts.d7 ?? 0, last30: counts.d30 ?? 0 } : undefined,
});

/** Run counts per automation for the last 7 and 30 days. Counted, not capped. */
export async function runCounts() {
  const { rows } = await query(
    `select automation_key, count(*) filter (where at >= now() - interval '7 days')::int as d7, count(*)::int as d30
       from automation_runs where at >= now() - interval '30 days' group by automation_key`,
  );
  return new Map(rows.map((r) => [r.automation_key, r]));
}

/** Every automation, with its run counts. */
export async function listAutomations() {
  const [{ rows }, counts] = await Promise.all([query('select * from automations'), runCounts()]);
  // The design's order: by area, then as the seed list has them; anything else after.
  const at = (k) => { const i = AUTOMATION_KEYS.indexOf(k); return i < 0 ? AUTOMATION_KEYS.length : i; };
  return rows.sort((a, b) => at(a.key) - at(b.key) || a.key.localeCompare(b.key)).map((r) => shape(r, counts.get(r.key) ?? { d7: 0, d30: 0 }));
}

export async function getAutomation(key) {
  const { rows: [r] } = await query('select * from automations where key = $1', [String(key)]);
  if (!r) return null;
  return shape(r, (await runCounts()).get(r.key) ?? { d7: 0, d30: 0 });
}

/** Rule values checked against the automation's types: no unknown keys, and each value its type or null. */
function checkRules(key, rules) {
  const types = SEED.get(key)?.types ?? {};
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw refuse(400, 'bad_rules', 'Rule values are a set of named values.');
  for (const [k, v] of Object.entries(rules)) {
    const type = types[k];
    if (!type) throw refuse(400, 'bad_rules', `“${k}” is not a rule of this automation.${Object.keys(types).length ? ` Its rules are ${Object.keys(types).join(', ')}.` : ' It has no rule values.'}`);
    if (v !== null && !TYPES[type](v)) throw refuse(400, 'bad_rules', `“${k}” must be ${{ number: 'a number', int: 'a whole number', ints: 'a list of whole numbers', time: 'a time like 08:00', pence: 'a whole number of pence' }[type]}.`);
  }
}

/**
 * Change an automation: `{ on, locked, rules, steps }`, any of them. The owner
 * only — the route asks for him signed in personally. Refused: any switch on
 * an always-on or Payments-run automation; switching while a lock holds;
 * unlocking anything but an owner's lock; switching on with no template
 * (unless it sends nothing by design), or with a template that does not
 * exist. `steps` locks or unlocks a step of an automation — the suspended
 * step of Strikes — and only one the owner holds. Each change is one row in Changes.
 */
export async function changeAutomation(key, { on, locked, rules, steps } = {}, { who } = {}) {
  if (!who) throw refuse(400, 'bad_request', 'A change says who made it.');
  await ensureTemplates();
  return withTransaction(async (c) => {
    const { rows: [a] } = await c.query('select * from automations where key = $1 for update', [String(key)]);
    if (!a) throw refuse(404, 'not_found', 'There is no such automation.');
    if (on === undefined && locked === undefined && rules === undefined && steps === undefined) throw refuse(400, 'nothing', 'Nothing to change.');
    if (on !== undefined && typeof on !== 'boolean') throw refuse(400, 'bad_request', 'On is on or off.');
    if (locked !== undefined && typeof locked !== 'boolean') throw refuse(400, 'bad_request', 'Locked is yes or no.');
    if (a.lock_kind === 'always_on' && (on !== undefined || locked !== undefined)) {
      throw refuse(409, 'always_on', `${a.name} is always on and has no switch.`);
    }
    if (a.lock_kind === 'payments' && (on !== undefined || locked !== undefined)) {
      throw refuse(409, 'run_by_payments', `${a.name} is run by Payments and has no switch here until that code reads this record.`);
    }
    let isLocked = a.locked;
    let isOnNow = a.is_on;
    if (locked !== undefined && locked !== a.locked) {
      if (a.lock_kind !== 'owner') throw refuse(409, 'no_lock', `${a.name} has no lock to change.`);
      isLocked = locked;
      // An owner's lock is a lock against it running: locking it again switches it off with it.
      const offToo = locked && a.is_on;
      if (offToo) { await c.query('update automations set is_on = false where key = $1', [a.key]); isOnNow = false; }
      await logChange({ client: c, who, area: 'Automations', what: `${locked ? 'Locked' : 'Unlocked'} “${a.name}”${offToo ? ', and switched it off' : ''}`, before: a.locked ? 'locked' : 'unlocked', after: locked ? 'locked' : 'unlocked', why: a.lock_reason, subjectType: 'automation', subjectId: a.key });
    }
    if (on !== undefined && on !== isOnNow) {
      if (isLocked) throw refuse(409, 'locked', `${a.name} is locked ${isOnNow ? 'on' : 'off'}: ${a.lock_reason}`);
      if (on && !a.no_template) {
        if (!a.template_keys.length) throw refuse(409, 'no_template', `${a.name} has no message to send, so it cannot be switched on. Give it a template first.`);
        const { rows: found } = await c.query('select key from message_templates where key = any($1::text[])', [a.template_keys]);
        const missing = a.template_keys.filter((k) => !found.some((f) => f.key === k));
        if (missing.length) throw refuse(409, 'no_template', `${a.name} names ${missing.map((k) => `“${k}”`).join(', ')}, which ${missing.length === 1 ? 'is not a template' : 'are not templates'}.`);
      }
      await c.query('update automations set is_on = $2 where key = $1', [a.key, on]);
      await logChange({ client: c, who, area: 'Automations', what: `Switched “${a.name}” ${on ? 'on' : 'off'}`, before: isOnNow ? 'on' : 'off', after: on ? 'on' : 'off', subjectType: 'automation', subjectId: a.key });
    }
    if (steps !== undefined) {
      if (!steps || typeof steps !== 'object' || Array.isArray(steps)) throw refuse(400, 'bad_request', 'Steps are a set of named locks.');
      const held = a.step_locks ?? {};
      const seedSteps = SEED.get(a.key)?.stepLocks ?? {};
      const next = { ...held };
      for (const [step, lock] of Object.entries(steps)) {
        if (!(step in seedSteps)) throw refuse(409, 'no_lock', `${a.name} has no “${step}” step to lock.`);
        if (typeof lock !== 'boolean') throw refuse(400, 'bad_request', 'A step is locked or not.');
        if (lock) next[step] = seedSteps[step]; else delete next[step];
      }
      if (JSON.stringify(next) !== JSON.stringify(held)) {
        await c.query('update automations set step_locks = $2::jsonb where key = $1', [a.key, JSON.stringify(next)]);
        await logChange({ client: c, who, area: 'Automations', what: `Changed which steps of “${a.name}” are locked`, before: JSON.stringify(held), after: JSON.stringify(next), subjectType: 'automation', subjectId: a.key });
      }
    }
    if (rules !== undefined) {
      checkRules(a.key, rules);
      const next = { ...a.rules, ...rules };
      if (JSON.stringify(next) !== JSON.stringify(a.rules)) {
        await c.query('update automations set rules = $2::jsonb where key = $1', [a.key, JSON.stringify(next)]);
        await logChange({ client: c, who, area: 'Automations', what: `Changed the rules of “${a.name}”`, before: JSON.stringify(a.rules), after: JSON.stringify(next), subjectType: 'automation', subjectId: a.key });
      }
    }
    await c.query('update automations set locked = $2, updated_by = $3, updated_at = now() where key = $1', [a.key, isLocked, who]);
  }).then(() => getAutomation(key));
}

/**
 * Whether one step of an automation may run: false while the step is locked
 * (the suspended step of Strikes, until Host Terms) — and false too while the
 * automation is off or missing, so the engine reads one answer.
 */
export async function stepAllowed(key, step) {
  const { rows: [r] } = await query('select is_on, step_locks from automations where key = $1', [key]);
  return Boolean(r && r.is_on && !(r.step_locks && step in r.step_locks));
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/**
 * Write one automatic action. `client` puts it in the caller's transaction, so
 * an action and its log row commit or fail together. Exported for the Stripe
 * chat's money jobs as `logAutomationRun` (see the head of this file).
 */
export async function logRun({ automation, subjectKind = null, subjectId = null, rule, evidence = {}, did, undo = null }, client = null) {
  if (!SEED.has(automation)) throw refuse(400, 'unknown_automation', `“${automation}” is not an automation.`);
  if (!rule || !did) throw refuse(400, 'bad_run', 'A run says which rule fired and what it did.');
  const q = client ? (t, p) => client.query(t, p) : query;
  const { rows: [row] } = await q(
    `insert into automation_runs (automation_key, subject_kind, subject_id, rule, evidence, did, undo)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb) returning *`,
    [automation, subjectKind, subjectId == null ? null : String(subjectId), String(rule).slice(0, 500), JSON.stringify(evidence ?? {}), String(did).slice(0, 1000), undo == null ? null : JSON.stringify(undo)],
  );
  return row;
}
export const logAutomationRun = logRun;

/** The log, newest first; for one automation and since a time when asked. Capped: it says what it found, never what is absent. */
export async function listRuns({ automation = null, since = null, limit = 200 } = {}) {
  const lim = Math.min(Math.max(1, Number(limit) || 200), 1000);
  const { rows } = await query(
    `select r.*, a.email as undone_by_email from automation_runs r left join accounts a on a.id = r.undone_by
      where ($1::text is null or r.automation_key = $1) and ($2::timestamptz is null or r.at >= $2)
      order by r.at desc limit $3`,
    [automation, since, lim + 1],
  );
  return {
    capped: rows.length > lim,
    limit: lim,
    runs: rows.slice(0, lim).map((r) => ({
      id: r.id, automation: r.automation_key, subject: r.subject_kind ? { kind: r.subject_kind, id: r.subject_id } : null,
      rule: r.rule, evidence: r.evidence, did: r.did, undoable: Boolean(UNDO.get(r.automation_key)?.fn) && !r.undone_at,
      at: r.at, undoneAt: r.undone_at, undoneBy: r.undone_by ? { id: r.undone_by, email: r.undone_by_email } : null, undoneNote: r.undone_note,
    })),
  };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Undo handlers, one per automation that may be undone: `fn(run, { by, client })`
 * puts things back and returns what it did in words; `refusal` is said instead
 * when an automation's runs are never undone from here.
 */
const UNDO = new Map();
export function registerUndo(automation, handler) { UNDO.set(automation, handler); }

// A child-safety pause is lifted only by a person closing the safety item, never from the log (Roger, 3 Oct 2026).
registerUndo('child_safety_pause', { refusal: 'A child-safety pause is lifted only by closing its safety item, by a person who has looked at the report.' });
registerUndo('waitlist_offer', { refusal: 'An offered place cannot be taken back: the household has been told it is theirs.' });
registerUndo('reminder_24h', { refusal: 'A reminder that has been sent cannot be unsent.' });
registerUndo('morning_after', { refusal: 'A message that has been sent cannot be unsent.' });

/** Lapsed-checks pause: each event still held for it goes back to the state it was in. The owner's to do. */
registerUndo('checks_lapse_pause', {
  person: true,
  async fn(run, { by, client: c }) {
    // The hold columns arrive with the hosting chat's child-safety batch; until then there is nothing held to put back.
    const { rows: [has] } = await c.query(`select 1 as yes from information_schema.columns where table_name = 'host_offers' and column_name = 'held_from'`);
    if (!has) throw refuse(409, 'nothing_to_undo', 'No event is held for lapsed checks yet: the hold arrives with the child-safety work.');
    const events = Array.isArray(run.undo?.events) ? run.undo.events : [];
    let back = 0;
    for (const e of events) {
      const { rows: [o] } = await c.query(
        `update host_offers set state = held_from, hold_reason = null, held_from = null, held_at = null, updated_at = now()
          where id = $1 and hold_reason = 'checks_lapsed' and state = 'paused' and held_from is not null
          returning id, state`,
        [e.id],
      );
      if (!o) continue;
      back += 1;
      await logHostingChange({ subjectKind: 'event', subjectId: o.id, field: 'state', before: { state: 'paused', hold: 'checks_lapsed' }, after: { state: o.state }, why: `Undo of an automatic pause (run ${run.id})`, by, byLabel: 'staff' }, c);
    }
    if (!back) throw refuse(409, 'nothing_to_undo', 'None of those events is still paused for lapsed checks.');
    return `Put ${back} event${back === 1 ? '' : 's'} back as ${back === 1 ? 'it was' : 'they were'}`;
  },
});

/** Approved → live: back to "Approved · waiting" while nobody has booked it. */
registerUndo('events_go_live', {
  person: true,
  async fn(run, { by, client: c }) {
    const id = run.subject_id;
    const { rows: [{ n }] } = await c.query(`select count(*)::int as n from experience_bookings where offer_id = $1 and state <> 'cancelled'`, [id]);
    if (n > 0) throw refuse(409, 'has_bookings', 'Somebody has booked it since it went live, so it stays live.');
    const { rows: [o] } = await c.query(`update host_offers set state = 'approved', published_at = null where id = $1 and state = 'live' returning id`, [id]);
    if (!o) throw refuse(409, 'nothing_to_undo', 'It is not live any more.');
    await logHostingChange({ subjectKind: 'event', subjectId: id, field: 'state', before: { state: 'live' }, after: { state: 'approved' }, why: `Undo of an automatic release (run ${run.id})`, by, byLabel: 'staff' }, c);
    return 'Put it back to Approved · waiting';
  },
});

/**
 * Undo one run through its automation's handler. Refused when there is no
 * handler or the handler refuses, when it needs a person and `by` names
 * nobody, and when it has been undone already.
 */
export async function undoRun(id, { by = null, note = null } = {}) {
  if (!UUID.test(String(id))) throw refuse(404, 'not_found', 'There is no such run.');
  return withTransaction(async (c) => {
    const { rows: [run] } = await c.query('select * from automation_runs where id = $1 for update', [id]);
    if (!run) throw refuse(404, 'not_found', 'There is no such run.');
    if (run.undone_at) throw refuse(409, 'already_undone', 'That has been undone already.');
    const h = UNDO.get(run.automation_key);
    if (!h?.fn) throw refuse(409, 'no_undo', h?.refusal ?? 'This automation’s actions cannot be undone from here.');
    if (!(by && UUID.test(String(by)))) throw refuse(403, 'person_only', 'Undoing this needs a person, signed in.');
    const said = await h.fn(run, { by, client: c });
    const { rows: [row] } = await c.query(
      `update automation_runs set undone_at = now(), undone_by = $2, undone_note = $3 where id = $1 returning *`,
      [id, by, [said, note].filter(Boolean).join(' — ').slice(0, 500) || null],
    );
    return { run: row, did: said };
  });
}
