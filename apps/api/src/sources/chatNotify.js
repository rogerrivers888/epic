/**
 * Telling people about the chat (C9, E5).
 *
 * The rule of *who* is `domain/chat.js whoIsTold`; this is the *how*. Every
 * decision to tell somebody is written to `chat_notifications` first, so the
 * record is honest whether or not a sender exists: neither the mail key nor
 * Twilio is Epic's to switch on (CLAUDE.md), and a row with `channel: 'none'`
 * is a message that could not be carried rather than one that was.
 *
 * Three things can hold a ping back rather than send it at once:
 *   · the person asked for one digest a day (`chat_prefs.digest`) — held
 *     until their digest time;
 *   · it is inside their quiet hours — held until they end;
 *   · a guest on a share link has no push token, so delivery goes to the
 *     contact on the invite, and only for the things a guest is told about
 *     (README §12) — the rule in whoIsTold already keeps it to that.
 *
 * `sweep()` runs every few minutes from server.js and sends what is due,
 * batching a person's held rows into one message.
 */

import * as chat from '../repositories/chat.js';
import * as accountsRepo from '../repositories/accounts.js';
import { sendMail, mailConfigured } from './mail.js';
import { sendSms, smsConfigured } from './sms.js';
import { inQuietHours } from '../domain/chat.js';
import { DEFAULT_TZ, wallClock, wallToUtc } from '../domain/time.js';

const senderUp = () => mailConfigured() || smsConfigured();

/** The contact a member is reached on: the account on their household that names them, else the first account. */
async function contactOf(person) {
  if (person.guestId) return person.contact ? { to: person.contact, kind: person.contactKind === 'email' ? 'email' : 'sms' } : null;
  if (!person.memberId) return null;
  const own = await accountsRepo.accountByMember(person.memberId).catch(() => null);
  const a = own ?? (person.householdId ? (await accountsRepo.accountsForHousehold(person.householdId).catch(() => []))[0] : null);
  if (!a) return null;
  if (a.email && mailConfigured()) return { to: a.email, kind: 'email' };
  if (a.mobile && smsConfigured()) return { to: a.mobile, kind: 'sms' };
  return null;
}

async function deliver(to, text, subject = 'On Epic') {
  try {
    if (to.kind === 'email') return (await sendMail({ to: to.to, subject, text })).sent ? 'email' : null;
    return (await sendSms({ to: to.to, text: `Epic: ${text}` })).sent ? 'sms' : null;
  } catch { return null; }
}

/** When a held ping should go: the next digest time, or the end of quiet hours. */
function holdUntilFor({ digest, settings, now }) {
  const tz = DEFAULT_TZ;
  const today = wallClock(now, tz);
  const hhmm = today.hhmm;
  if (digest) {
    const at = String(settings?.digest_at ?? '18:00').slice(0, 5);
    const todayAt = wallToUtc(today.dateStr, at, tz);
    if (todayAt > now) return todayAt;
    const tomorrow = new Date(now.getTime() + 86_400_000);
    return wallToUtc(wallClock(tomorrow, tz).dateStr, at, tz);
  }
  if (settings?.quiet_from && settings?.quiet_to && inQuietHours(hhmm, settings.quiet_from, settings.quiet_to)) {
    const end = String(settings.quiet_to).slice(0, 5);
    const todayEnd = wallToUtc(today.dateStr, end, tz);
    if (todayEnd > now) return todayEnd;
    const tomorrow = new Date(now.getTime() + 86_400_000);
    return wallToUtc(wallClock(tomorrow, tz).dateStr, end, tz);
  }
  return null;
}

/**
 * Tell one person one thing. Writes the row, and sends now unless it is held.
 * `person` carries `memberId | guestId`, and for a guest the invite contact.
 */
export async function tell(person, { kind, text, topicId = null, replyId = null, digest = false, settings = null }) {
  const now = new Date();
  const holdUntil = person.guestId ? null : holdUntilFor({ digest, settings, now });
  if (holdUntil) {
    return chat.insertNotification({ memberId: person.memberId, guestId: person.guestId, topicId, replyId, kind, text, holdUntil });
  }
  let channel = 'none';
  if (senderUp()) {
    const to = await contactOf(person);
    if (to) channel = (await deliver(to, text)) ?? 'none';
  }
  return chat.insertNotification({ memberId: person.memberId, guestId: person.guestId, topicId, replyId, kind, text, sentAt: new Date(), channel });
}

/** Send what is due: one message per person, however many rows were held. */
export async function sweep() {
  const due = await chat.dueNotifications();
  if (!due.length) return { sent: 0 };
  const byPerson = new Map();
  for (const n of due) {
    const key = n.member_id ? `m:${n.member_id}` : `g:${n.guest_id}`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(n);
  }
  let sent = 0;
  for (const rows of byPerson.values()) {
    const first = rows[0];
    const to = first.member_id
      ? (first.member_email && mailConfigured() ? { to: first.member_email, kind: 'email' } : first.member_mobile && smsConfigured() ? { to: first.member_mobile, kind: 'sms' } : null)
      : (first.guest_contact ? { to: first.guest_contact, kind: first.guest_contact_kind === 'email' ? 'email' : 'sms' } : null);
    const text = rows.length === 1 ? rows[0].text : `${rows.length} things on Epic today:\n\n${rows.map((r) => `· ${r.text}`).join('\n')}`;
    let channel = 'none';
    if (to && senderUp()) channel = (await deliver(to, text, rows.length === 1 ? 'On Epic' : 'Your Epic digest')) ?? 'none';
    await chat.markNotified(rows.map((r) => r.id), channel);
    if (channel !== 'none') sent += 1;
  }
  return { sent };
}

let loop = null;
/** Every five minutes, whatever is due goes. */
export function startChatLoop() {
  if (loop || process.env.NODE_ENV === 'test') return;
  const tick = () => sweep().catch((err) => console.error('chat sweep', err.message));
  loop = setInterval(tick, 5 * 60_000);
  loop.unref?.();
  setTimeout(tick, 15_000).unref?.();
}
