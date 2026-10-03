/**
 * Message templates (K16 step 1, Roger, 3 Oct 2026): the records of what Epic
 * says, versioned, previewable and testable, and the two functions later
 * batches will move senders onto — `render` and `deliver`.
 *
 *   · Every save is a new version; nothing is overwritten. Restore saves an
 *     older version again as the newest. Both are written to the back
 *     office's Changes log (bo_changes, area Messages), the log the back
 *     office already keeps for its own settings-like records (desk settings,
 *     mappings, collections) — not hosting_changes, which is the trail of
 *     events, bookings and payouts, and whose subjects a template is not.
 *   · A template names a trigger from the catalogue in domain/messages.js and
 *     may use only that trigger's fields; saving one that names anything else
 *     is refused with what it may use.
 *   · A marketing template is sent only by e-mail, only to an address that
 *     said yes, and only with an unsubscribe link in it (Roger, 3 Oct 2026).
 *   · Push is a declared channel and is refused for delivery: nothing delivers it.
 *   · No sender is moved here. The seeded records hold today's exact words;
 *     the code that sends them still holds its own copy until a later batch
 *     moves it over.
 */

import { query, withTransaction } from '../db.js';
import { CHANNELS, TRIGGERS, UNSUBSCRIBE_FIELD, fieldsOf, parse, renderChannels, samplesFor, validateChannels } from '../domain/messages.js';
import { SEED_TEMPLATES } from '../domain/messageSeeds.js';
import { logChange } from '../desk/changes.js';
import * as notifications from './notifications.js';
import { sendMail } from '../sources/mail.js';
import { sendSms } from '../sources/sms.js';

const refuse = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const empty = (v) => v == null || v === '' || v === false;

/** The senders, swappable in tests so nothing leaves the machine. */
export const senders = { mail: (m) => sendMail(m), sms: (m) => sendSms(m) };

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

let seeded = null;
/**
 * Write the seed records that are not there yet. Only where absent: a record
 * the owner has edited is his, and a seed never writes over it. Once a process.
 */
export function ensureSeeded({ force = false } = {}) {
  if (seeded && !force) return seeded;
  seeded = withTransaction(async (c) => {
    let added = 0;
    for (const s of SEED_TEMPLATES) {
      // Checked against the catalogue like any save — except the unsubscribe rule: the one marketing seed is
      // today's words exactly, which have no unsubscribe line, and deliver() refuses it until the owner adds one.
      const channels = validateChannels(s.trigger, s.channels, { category: 'transactional' });
      const { rows: [row] } = await c.query(
        `insert into message_templates (key, name, trigger, category, kind, notification_kind, sent_by, state)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (key) do nothing returning key`,
        [s.key, s.name, s.trigger, s.category, s.kind, s.notificationKind, s.sentBy, s.state],
      );
      if (!row) continue;
      await c.query(
        `insert into message_template_versions (template_key, version, channels, note, saved_by) values ($1, 1, $2::jsonb, $3, 'Epic (seed, K16)')`,
        [s.key, JSON.stringify(channels), s.state === 'new_wording' ? 'New wording for the owner to read; nothing sends it yet.' : 'Today’s words, exactly as the code sends them.'],
      );
      added += 1;
    }
    return { added };
  }).catch((err) => { seeded = null; throw err; });
  return seeded;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const shape = (r) => r && ({
  key: r.key, name: r.name, trigger: r.trigger, triggerLabel: TRIGGERS[r.trigger]?.label ?? null,
  category: r.category, kind: r.kind, notificationKind: r.notification_kind, sentBy: r.sent_by, state: r.state,
  version: r.current_version, channels: r.channels ?? {}, savedBy: r.saved_by ?? null, savedAt: r.saved_at ?? null,
  updatedAt: r.updated_at,
  // Push is shown as not available yet, whatever a template says for it.
  channelStatus: Object.fromEntries(Object.entries(CHANNELS).map(([k, c]) => [k, { label: c.label, available: c.available, ...(c.note ? { note: c.note } : {}), written: Boolean(r.channels?.[k]) }])),
});

const SELECT = `select t.*, v.channels, v.saved_by, v.saved_at
                  from message_templates t join message_template_versions v on v.template_key = t.key and v.version = t.current_version`;

/** Every template — or every one of a kind, automatic or reply — by name. Uncapped: there are tens, not thousands. */
export async function listTemplates({ kind = null } = {}) {
  await ensureSeeded();
  const { rows } = await query(`${SELECT} where ($1::text is null or t.kind = $1) order by t.name, t.key`, [kind]);
  return rows.map(shape);
}

/** One template at its current version, or null. */
export async function getTemplate(key) {
  await ensureSeeded();
  const { rows: [r] } = await query(`${SELECT} where t.key = $1`, [String(key)]);
  return shape(r) ?? null;
}

/** Every version of one, newest first. */
export async function versions(key) {
  await ensureSeeded();
  const { rows } = await query(
    `select v.version, v.channels, v.note, v.restored_from, v.saved_by, v.saved_at, (v.version = t.current_version) as current
       from message_template_versions v join message_templates t on t.key = v.template_key
      where v.template_key = $1 order by v.version desc`,
    [String(key)],
  );
  return rows.map((v) => ({ version: v.version, channels: v.channels, note: v.note, restoredFrom: v.restored_from, savedBy: v.saved_by, savedAt: v.saved_at, current: v.current }));
}

// ---------------------------------------------------------------------------
// Saving and restoring
// ---------------------------------------------------------------------------

async function writeVersion(c, t, { channels, note, restoredFrom = null, who, accountId }) {
  const next = t.current_version + 1;
  await c.query(
    `insert into message_template_versions (template_key, version, channels, note, restored_from, saved_by, saved_by_account)
     values ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
    [t.key, next, JSON.stringify(channels), note, restoredFrom, who, accountId],
  );
  return next;
}

/**
 * Save new words as the newest version. `channels` is the whole of what it
 * says (a channel left out is no longer said there); `name` and `category`
 * may change with it. Refused, with what it may use, when it names a field
 * the trigger does not provide, or when a marketing e-mail has no unsubscribe link.
 */
export async function saveVersion(key, { channels, name = null, category = null, note = null } = {}, { who, accountId = null } = {}) {
  if (!who) throw refuse(400, 'bad_request', 'A change says who made it.');
  await ensureSeeded();
  return withTransaction(async (c) => {
    const { rows: [t] } = await c.query('select * from message_templates where key = $1 for update', [String(key)]);
    if (!t) throw refuse(404, 'not_found', 'There is no such template.');
    const cat = category ?? t.category;
    const tidy = validateChannels(t.trigger, channels, { category: cat });
    const { rows: [cur] } = await c.query('select channels from message_template_versions where template_key = $1 and version = $2', [t.key, t.current_version]);
    const nm = name != null && String(name).trim() ? String(name).trim().slice(0, 200) : t.name;
    const next = await writeVersion(c, t, { channels: tidy, note: note == null ? null : String(note).slice(0, 500), who, accountId });
    // Words a sender still holds its own copy of are no longer a mirror of it once edited (Codex, 3 Oct 2026).
    const state = t.state === 'mirrors_code' ? 'edited' : t.state;
    await c.query('update message_templates set current_version = $2, name = $3, category = $4, state = $5, updated_at = now() where key = $1', [t.key, next, nm, cat, state]);
    await logChange({
      client: c, who, area: 'Messages', what: `Edited the “${nm}” message (version ${next})`,
      before: JSON.stringify({ version: t.current_version, category: t.category, channels: cur?.channels ?? null }),
      after: JSON.stringify({ version: next, category: cat, channels: tidy }), why: note, subjectType: 'message_template', subjectId: t.key,
    });
    return next;
  }).then(() => getTemplate(key));
}

/** Restore: an older version's words saved again as the newest. The history keeps both. */
export async function restoreVersion(key, version, { who, accountId = null, note = null } = {}) {
  if (!who) throw refuse(400, 'bad_request', 'A change says who made it.');
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) throw refuse(400, 'bad_request', 'Say which version to restore.');
  await ensureSeeded();
  await withTransaction(async (c) => {
    const { rows: [t] } = await c.query('select * from message_templates where key = $1 for update', [String(key)]);
    if (!t) throw refuse(404, 'not_found', 'There is no such template.');
    if (v === t.current_version) throw refuse(409, 'already_current', 'That version is the one in use.');
    const { rows: [old] } = await c.query('select channels from message_template_versions where template_key = $1 and version = $2', [t.key, v]);
    if (!old) throw refuse(404, 'no_version', `There is no version ${v} of this template.`);
    // Checked again on the way back: a field a trigger once provided may not be provided now.
    const tidy = validateChannels(t.trigger, old.channels, { category: t.category });
    const { rows: [cur] } = await c.query('select channels from message_template_versions where template_key = $1 and version = $2', [t.key, t.current_version]);
    const next = await writeVersion(c, t, { channels: tidy, note: note ?? `Restored version ${v}`, restoredFrom: v, who, accountId });
    await c.query("update message_templates set current_version = $2, state = case when state = 'mirrors_code' then 'edited' else state end, updated_at = now() where key = $1", [t.key, next]);
    await logChange({
      client: c, who, area: 'Messages', what: `Restored version ${v} of the “${t.name}” message (now version ${next})`,
      before: JSON.stringify({ version: t.current_version, channels: cur?.channels ?? null }), after: JSON.stringify({ version: next, channels: tidy }),
      why: note, subjectType: 'message_template', subjectId: t.key,
    });
  });
  return getTemplate(key);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The values a template is rendered with: what the caller gave, and the
 * host's own words fetched when the trigger carries them, a `hostId` is given
 * and `hostWords` is not (the host's text, served from one place).
 */
async function valuesFor(trigger, fields) {
  const v = { ...(fields ?? {}) };
  const kind = TRIGGERS[trigger]?.hostWords;
  if (kind && v.hostWords === undefined && v.hostId) v.hostWords = await notifications.hostWords(v.hostId, kind);
  return v;
}

/**
 * Render a template's current words with these fields. With a `channel`, that
 * channel's parts (`{ title, body }`, `{ subject, body }` …) or null when the
 * template says nothing there; without one, every channel.
 */
export async function render(templateKey, fields = {}, channel = null) {
  const t = await getTemplate(templateKey);
  if (!t) throw refuse(404, 'not_found', `There is no “${templateKey}” template.`);
  const values = await valuesFor(t.trigger, fields);
  const out = renderChannels(t.channels, values);
  return channel ? (out[channel] ?? null) : out;
}

/**
 * Preview: a template, an older version of it, or a draft of its words, drawn
 * with the trigger's sample fields (and any the caller overrides). A draft is
 * checked as a save would check it, so Preview says what Save would refuse.
 */
export async function preview(key, { version = null, channels = null, fields = null } = {}) {
  const t = await getTemplate(key);
  if (!t) throw refuse(404, 'not_found', 'There is no such template.');
  let words = t.channels;
  if (channels) words = validateChannels(t.trigger, channels, { category: t.category });
  else if (version != null) {
    if (!(Number.isInteger(Number(version)) && Number(version) >= 1)) throw refuse(400, 'bad_request', 'A version is a whole number from 1.');
    const { rows: [v] } = await query('select channels from message_template_versions where template_key = $1 and version = $2', [t.key, Number(version)]);
    if (!v) throw refuse(404, 'no_version', `There is no version ${version} of this template.`);
    words = v.channels;
  }
  const values = { ...samplesFor(t.trigger), ...(fields ?? {}) };
  return { key: t.key, trigger: t.trigger, fields: values, channels: renderChannels(words, values) };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Where a message goes: an address given, else the account's, else the household's first account's. */
async function addressFor(to = {}) {
  if (to.email || to.mobile) return { email: to.email ?? null, mobile: to.mobile ?? null };
  if (!to.accountId && !to.householdId) return { email: null, mobile: null };
  const { rows: [a] } = await query(
    `select email, mobile from accounts
      where ($1::uuid is not null and id = $1) or ($1::uuid is null and household_id = $2)
      order by created_at limit 1`,
    [to.accountId ?? null, to.householdId ?? null],
  );
  return { email: a?.email ?? null, mobile: a?.mobile ?? null };
}

/**
 * Whether this address said yes to this marketing message — asked of the
 * sign-up it was given for (Codex, 3 Oct 2026): "Tell me when" of a "Tell me
 * when" alert not unsubscribed from (guide_alerts, migration 373), the launch
 * list of a sign-up on epic.day (interest_signups). An account has no
 * marketing consent of its own yet, and SMS has none at all.
 */
export async function hasMarketingConsent(email, trigger = 'interest.signed_up', { alertId = null } = {}) {
  if (!email) return false;
  // A "Tell me when" message is about one alert, and only that alert's yes counts: unsubscribing from it
  // stops it even while the address keeps other alerts (Codex, 3 Oct 2026).
  if (trigger === 'tell_me_when.match') {
    if (!alertId) return false;
    const { rows: [r] } = await query('select 1 as yes from guide_alerts where id::text = $2 and lower(email) = lower($1) and unsubscribed_at is null', [String(email), String(alertId)]);
    return Boolean(r);
  }
  if (trigger === 'interest.signed_up') {
    const { rows: [r] } = await query('select 1 as yes from interest_signups where lower(email) = lower($1) limit 1', [String(email)]);
    return Boolean(r);
  }
  return false;
}

async function logSend({ t, version = t.version, channel, purpose, toKind, toRef, result, by, dedupeKey = null }) {
  await query(
    `insert into message_sends (template_key, version, channel, purpose, to_kind, to_ref, result, by_account, dedupe_key) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     on conflict do nothing`,
    [t.key, version, channel, purpose, toKind, toRef, JSON.stringify(result ?? {}), by, dedupeKey],
  ).catch((err) => console.error(`epic-api: message log — ${err.message}`));
}

/**
 * Claim a once-only send before it goes: true when this key has not sent this
 * template on this channel, and the claim is written; false when it has.
 * E-mail and SMS deliveries are kept to their key as in-app ones are (Codex, 3 Oct 2026).
 */
async function claim(t, channel, dedupeKey, toKind, toRef, by) {
  if (!dedupeKey) return true;
  const { rows } = await query(
    `insert into message_sends (template_key, version, channel, purpose, to_kind, to_ref, result, by_account, dedupe_key)
     values ($1, $2, $3, 'deliver', $4, $5, '{"claimed":true}'::jsonb, $6, $7) on conflict do nothing returning id`,
    [t.key, t.version, channel, toKind, toRef, by, dedupeKey],
  );
  return rows.length > 0;
}
/** Write what became of a claimed send onto its claim. */
async function settle(t, channel, dedupeKey, result) {
  await query(
    `update message_sends set result = $4::jsonb where template_key = $1 and channel = $2 and dedupe_key = $3 and purpose = 'deliver'`,
    [t.key, channel, dedupeKey, JSON.stringify(result ?? {})],
  ).catch((err) => console.error(`epic-api: message log — ${err.message}`));
}

/** Whether a host switched this kind's e-mail off (E13); a guest's e-mail is never switched off here. */
async function hostSwitchedOff(t, to = {}) {
  const kind = t.notificationKind;
  if (!kind || notifications.KINDS[kind]?.audience !== 'host') return false;
  // Sent to an account, the preference is its household's host (Codex, 3 Oct 2026).
  let householdId = to.householdId ?? null;
  if (!householdId && to.accountId) householdId = (await query('select household_id from accounts where id = $1', [to.accountId])).rows[0]?.household_id ?? null;
  if (!householdId) return false;
  const { rows: [h] } = await query('select notification_prefs from hosts where household_id = $1', [householdId]);
  return h?.notification_prefs?.[kind] === false;
}

/**
 * Send a template to one person (later batches move senders onto this; none
 * calls it yet). `to` is `{ householdId | accountId | email | mobile }`;
 * `channels` defaults to every channel the template says something on that
 * can be delivered. In-app is written through notifications.notify (its
 * e-mail switched off there, because this sends the template's own e-mail);
 * a dedupe key already used stops every channel, so a repeat sends nothing.
 * Push is refused. A marketing template goes only by e-mail, only to an
 * address that said yes, and only with its unsubscribe link filled in; a
 * "Tell me when" names the alert it is about (`consent: { alertId }`).
 */
export async function deliver({ templateKey, fields = {}, to = {}, channels = null, dedupeKey = null, link = null, by = null, consent = null } = {}) {
  const t = await getTemplate(templateKey);
  if (!t) throw refuse(404, 'not_found', `There is no “${templateKey}” template.`);
  const has = Object.keys(t.channels);
  const want = channels ? [...new Set(channels)] : has.filter((c) => CHANNELS[c]?.available);
  if (want.includes('push')) throw refuse(400, 'push_not_available', 'Push isn’t available yet: nothing delivers it.');
  for (const c of want) {
    if (!CHANNELS[c]) throw refuse(400, 'bad_channel', `“${c}” is not a channel.`);
    if (!has.includes(c)) throw refuse(400, 'not_written', `“${t.name}” says nothing on ${CHANNELS[c].label}.`);
  }
  if (!want.length) throw refuse(400, 'nothing_to_send', `“${t.name}” has nothing that can be delivered.`);
  if (want.includes('in_app')) {
    if (!t.notificationKind) throw refuse(400, 'no_kind', `“${t.name}” has no notification kind to write an in-app message under.`);
    // A kind the notifications list does not know yet is registered there when its sender is wired, not guessed here (Codex, 3 Oct 2026).
    if (!notifications.KINDS[t.notificationKind]) throw refuse(409, 'kind_not_registered', `“${t.name}” is written under “${t.notificationKind}”, which in-app notifications do not have yet.`);
    if (!to.householdId && !to.accountId) throw refuse(400, 'no_recipient', 'An in-app message needs a household or an account.');
  }
  // A host's message is sent to a household or an account, never to a bare address: the host's own
  // e-mail switches are kept by household, and a bare address would step round them (Codex, 3 Oct 2026).
  if (notifications.KINDS[t.notificationKind]?.audience === 'host' && !to.householdId && !to.accountId) {
    throw refuse(400, 'no_recipient', `“${t.name}” goes to a host: say which household or account, so their e-mail settings are kept.`);
  }
  const values = await valuesFor(t.trigger, fields);
  const addr = await addressFor(to);
  if (t.category === 'marketing') {
    if (want.some((c) => c !== 'email')) throw refuse(403, 'no_consent', 'A marketing message goes by e-mail only: nobody has said yes to it anywhere else.');
    if (!fieldsOf(parse(t.channels.email.body)).has(UNSUBSCRIBE_FIELD)) throw refuse(409, 'needs_unsubscribe', `“${t.name}” is marketing and its e-mail has no unsubscribe link yet, so it cannot be sent from here.`);
    if (empty(values[UNSUBSCRIBE_FIELD])) throw refuse(400, 'needs_unsubscribe', 'A marketing e-mail needs its unsubscribe link filled in.');
    if (!(await hasMarketingConsent(addr.email, t.trigger, { alertId: consent?.alertId ?? null }))) throw refuse(403, 'no_consent', 'That address has not said yes to marketing from Epic.');
  }
  const out = renderChannels(t.channels, values, want);
  const sent = {};
  const toRef = to.accountId ?? to.householdId ?? null;
  if (want.includes('in_app')) {
    const row = await notifications.notify({
      householdId: to.householdId ?? null, accountId: to.accountId ?? null, kind: t.notificationKind,
      // Scoped to the template, as message_sends is: one template's key never silences another's (Codex, 3 Oct 2026).
      title: out.in_app.title, body: out.in_app.body, link, dedupeKey: dedupeKey ? `template:${t.key}:${dedupeKey}` : null, email: false,
    });
    sent.in_app = row ? { written: true, id: row.id } : { written: false, reason: 'already_sent' };
    await logSend({ t, channel: 'in_app', purpose: 'deliver', toKind: to.accountId ? 'account' : 'household', toRef, result: sent.in_app, by });
    // Already said once under this key: nothing else goes either.
    if (!row) return { template: t.key, version: t.version, channels: sent };
  }
  if (want.includes('email')) {
    if (!addr.email) sent.email = { sent: false, reason: 'no_address' };
    else if (await hostSwitchedOff(t, to)) sent.email = { sent: false, reason: 'switched_off' };
    else if (!(await claim(t, 'email', dedupeKey, 'email', addr.email, by))) sent.email = { sent: false, reason: 'already_sent' };
    else {
      sent.email = await senders.mail({ to: addr.email, subject: out.email.subject, text: out.email.body, purpose: `template_${t.key}` }).catch((e) => ({ sent: false, reason: 'send_failed', message: e.message }));
      if (dedupeKey) await settle(t, 'email', dedupeKey, sent.email);
    }
    if (!dedupeKey) await logSend({ t, channel: 'email', purpose: 'deliver', toKind: 'email', toRef: addr.email, result: sent.email, by });
  }
  if (want.includes('sms')) {
    if (!addr.mobile) sent.sms = { sent: false, reason: 'no_address' };
    else if (!(await claim(t, 'sms', dedupeKey, 'mobile', addr.mobile, by))) sent.sms = { sent: false, reason: 'already_sent' };
    else {
      sent.sms = await senders.sms({ to: addr.mobile, text: out.sms.body }).catch((e) => ({ sent: false, reason: 'send_failed', message: e.message }));
      if (dedupeKey) await settle(t, 'sms', dedupeKey, sent.sms);
    }
    if (!dedupeKey) await logSend({ t, channel: 'sms', purpose: 'deliver', toKind: 'mobile', toRef: addr.mobile, result: sent.sms, by });
  }
  return { template: t.key, version: t.version, channels: sent };
}

/**
 * "Send me a test": the template drawn with its sample fields (or a draft of
 * its words) and sent to the signed-in staff member's own address — never a
 * customer's: there is no `to` to give. E-mail and SMS only; each send is
 * logged with who asked for it.
 */
export async function sendTest(key, { account, channels = null, channelsDraft = null, version = null, fields = null } = {}) {
  if (!account?.id) throw refuse(403, 'needs_account', 'A test goes to your own address, so it needs you signed in as yourself.');
  const p = await preview(key, { version, channels: channelsDraft, fields });
  const t = await getTemplate(key);
  const want = channels ? [...new Set(channels)] : ['email', 'sms'].filter((c) => p.channels[c]);
  if (want.includes('push')) throw refuse(400, 'push_not_available', 'Push isn’t available yet: nothing delivers it.');
  const bad = want.filter((c) => !['email', 'sms'].includes(c));
  if (bad.length) throw refuse(400, 'bad_channel', 'A test is sent by e-mail or SMS.');
  const usable = want.filter((c) => p.channels[c]);
  if (!usable.length) throw refuse(400, 'nothing_to_send', 'This template says nothing by e-mail or SMS.');
  const sent = {};
  for (const c of usable) {
    const r = p.channels[c];
    if (c === 'email') {
      sent.email = account.email
        ? await senders.mail({ to: account.email, subject: r.subject, text: r.body, purpose: 'template_test' }).catch((e) => ({ sent: false, reason: 'send_failed', message: e.message }))
        : { sent: false, reason: 'no_address', message: 'Your account has no e-mail address.' };
      await logSend({ t, version: version ?? t.version, channel: 'email', purpose: 'test', toKind: 'self', toRef: account.email ?? null, result: sent.email, by: account.id });
    } else {
      sent.sms = account.mobile
        ? await senders.sms({ to: account.mobile, text: r.body }).catch((e) => ({ sent: false, reason: 'send_failed', message: e.message }))
        : { sent: false, reason: 'no_address', message: 'Your account has no mobile number.' };
      await logSend({ t, version: version ?? t.version, channel: 'sms', purpose: 'test', toKind: 'self', toRef: account.mobile ?? null, result: sent.sms, by: account.id });
    }
  }
  return { template: t.key, version: version ?? t.version, draft: Boolean(channelsDraft), channels: sent };
}
