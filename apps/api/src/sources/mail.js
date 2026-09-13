import { APP_URL, configuredAppUrl } from '../origins.js';
import { deployed } from '../auth.js';
/**
 * Sending an e-mail, when there is anything to send it with.
 *
 * Epic never had a sender. Group reminders already know this and record
 * `no_channel` rather than pretending (routes/groups.js), and this file follows
 * the same rule for invitations: with no key configured it does not throw, does
 * not queue and does not silently drop the message — it says it could not send,
 * and the admin screen shows the owner the link to hand over himself.
 *
 * The sender is Postmark, because it is what Parcelvision sends with (owner,
 * 13 Sep 2026: "we should use the same service here because we get send and
 * read receipts, and bounced email reporting"). One HTTPS call, no SDK; every
 * send is written to `mail_messages` with Postmark's MessageID, and Postmark's
 * webhook (routes/postmark.js) brings back what became of it — delivered,
 * opened, bounced, marked as spam — against that id. A hard bounce or a
 * complaint keeps the address off the list for ninety days (domain/mail.js).
 *
 * The keys are the owner's to add (CLAUDE.md: anything that holds a secret is
 * the owner's to do). They go in Doppler, never in the repo and never as
 * Railway variables set by hand:
 *
 *   POSTMARK_SERVER_TOKEN    the server's token, from Postmark › the server › API Tokens
 *   POSTMARK_MESSAGE_STREAM  optional, the transactional stream to send on; `outbound` by default
 *   POSTMARK_WEBHOOK_TOKEN   a secret we make up; Postmark presents it as the password on the webhook URL
 *   EPIC_MAIL_FROM           the address mail comes from, on a domain verified in Postmark (DKIM and Return-Path)
 *   EPIC_WEB_URL             where the app is served, so a link in an e-mail points at the app rather than the API
 */

import { finishSend, recentTo, recordSend } from '../repositories/mail.js';
import { suppressedBy } from '../domain/mail.js';

const KEY = () => (process.env.POSTMARK_SERVER_TOKEN || '').trim();
const STREAM = () => (process.env.POSTMARK_MESSAGE_STREAM || 'outbound').trim();
export const mailConfigured = () => Boolean(KEY() && process.env.EPIC_MAIL_FROM);

/**
 * Why the owner cannot send yet, in two lengths.
 *
 * Three fields, for three readers. `message` is the whole thing and is what the
 * admin screen has always shown. `short` is one clause for beside a box on a
 * phone, saying what will happen instead rather than naming a variable, and
 * `setup` does the naming once, at the foot of the panel, where the person who
 * can act on it will read it.
 */
export function mailStatus() {
  if (KEY() && !process.env.EPIC_MAIL_FROM) {
    return { configured: false, reason: 'no_from', short: "E-mail isn't switched on yet — you'll copy the link instead.", setup: 'To send by e-mail, add EPIC_MAIL_FROM in Doppler — the address mail comes from, on a domain verified in Postmark.', message: 'A Postmark token is set but EPIC_MAIL_FROM is not, so there is no address to send from.' };
  }
  if (!KEY()) {
    return { configured: false, reason: 'no_sender', short: "E-mail isn't switched on yet — you'll copy the link instead.", setup: 'To send by e-mail, add POSTMARK_SERVER_TOKEN and EPIC_MAIL_FROM in Doppler.', message: 'No mail sender is configured. Add POSTMARK_SERVER_TOKEN and EPIC_MAIL_FROM in Doppler to send from Epic; until then, copy the link and send it yourself.' };
  }
  return { configured: true, from: process.env.EPIC_MAIL_FROM, provider: 'postmark', stream: STREAM(), events: Boolean((process.env.POSTMARK_WEBHOOK_TOKEN || '').trim()) };
}

/**
 * Where the app lives, for links that go out in an e-mail.
 *
 * Falls back to the request's own origin so a local developer gets a link that
 * works on their machine without setting anything.
 */
export function webUrl(req) {
  const set = String(process.env.EPIC_WEB_URL || '').trim().replace(/\/$/, '');
  if (set) return set;
  // Then the site, when it has actually been configured — a link e-mailed to
  // somebody outlives the request that made it, and should not carry whichever
  // hostname the back office happened to be open on. Only when it is *set*,
  // though: falling back to the default here would hand a developer running
  // locally a link into production.
  const app = configuredAppUrl();
  if (app) return app;
  const origin = req?.headers?.origin;
  if (origin) return String(origin).replace(/\/$/, '');
  // Deployed with nothing set at all, the live site beats a localhost link
  // that could never work; on a laptop, localhost is the right answer.
  return deployed() ? APP_URL : 'http://localhost:8081';
}

/**
 * Send one message. Never throws: the caller has already written down that a
 * link exists, and whether it could be delivered is a fact about the send, not
 * a reason to fail the request that made it.
 *
 * `purpose` is Postmark's Tag and the log's own word for what this was —
 * `invitation`, `sign_in`, `code`, `host_message` — so the Activity view there
 * and the Mail screen here group the same way.
 */
export async function sendMail({ to, subject, text, html, purpose = 'message' }) {
  const status = mailStatus();
  if (!status.configured) return { sent: false, reason: status.reason, message: status.message };
  // An address that bounced hard or complained is not tried again for a while:
  // Postmark suppresses it on its side too, and a send it refuses is a 406.
  const past = await recentTo(to).catch(() => []);
  const bad = suppressedBy(past);
  if (bad) {
    const m = await recordSend({ to, subject, purpose, status: 'failed', failure: `Not sent: this address ${bad.status === 'complained' ? 'marked an earlier message as spam' : 'bounced'} on ${new Date(bad.bounced_at).toLocaleDateString('en-GB')}.` }).catch(() => null);
    return { sent: false, reason: 'suppressed', message: m?.failure ?? 'This address bounced recently, so nothing was sent.' };
  }
  // The row first, then the send, with our id in Postmark's metadata: a
  // Delivery event can arrive before Postmark's reply to the send has been
  // read, and it must still find its row (Codex, 13 Sep 2026).
  const row = await recordSend({ to, subject, purpose, status: 'sent' }).catch(() => null);
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'X-Postmark-Server-Token': KEY(), accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ From: process.env.EPIC_MAIL_FROM, To: to, Subject: subject, TextBody: text, HtmlBody: html, MessageStream: STREAM(), Tag: purpose, TrackOpens: true, ...(row ? { Metadata: { epic_id: row.id } } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || Number(body?.ErrorCode ?? 0) !== 0) {
      // The provider's own words, trimmed: the owner is the only person who
      // sees this and it is what tells him the domain is not verified yet.
      const failure = `Postmark refused it (${body?.ErrorCode ?? res.status}). ${String(body?.Message ?? '').slice(0, 300)}`.trim();
      if (row) await finishSend(row.id, { status: 'failed', failure }).catch(() => null);
      return { sent: false, reason: 'send_failed', message: failure };
    }
    if (row) await finishSend(row.id, { providerId: body.MessageID ?? null, status: 'sent' }).catch(() => null);
    return { sent: true, id: row?.id ?? null, providerId: body.MessageID ?? null };
  } catch (err) {
    if (row) await finishSend(row.id, { status: 'failed', failure: err.message }).catch(() => null);
    return { sent: false, reason: 'send_failed', message: err.message };
  }
}

/**
 * The Epic shell every message is drawn in.
 *
 * A lime band with the wordmark, then ink type on cream, an ink button with
 * square corners, and the strapline under a 2px rule. It is a table because
 * Outlook still lays messages out with tables, and the palette is written in
 * literally because a mail client has no access to `theme.ts` — these are the
 * pack's own values (`docs/brand/README.txt`), and they are the only place in
 * the codebase allowed to repeat them.
 *
 * The mark is an image, so it is the real lockup where images load, with the
 * word itself as the alt text where they do not — which is most inboxes by
 * default. It is served from the web app's own origin, taken from the sign-in
 * link rather than from a second setting that could drift out of step with it.
 * The PNG is transparent with the pin's hole cut out of the path, so the band
 * shows through it: a mark exported on its own lime ground leaves a seam
 * wherever a client nudges the colour, and nothing renders identically twice
 * across inboxes. Archivo is asked for and will not be honoured by most
 * clients; the fallback stack is what actually renders, and the layout does
 * not depend on it.
 */
const LIME = '#C8F542', INK = '#201E1D', CREAM = '#FFFDF9', MUTED = '#605D5D';
const FONT = "Archivo,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

function shell({ url, body, action = 'Open Epic' }) {
  const origin = originOf(url);
  const mark = origin
    ? `<img src="${origin}/brand/epic-wordmark-ink.png" width="150" height="117" alt="Epic" style="display:block;border:0;outline:none;text-decoration:none">`
    : `<span style="font-family:${FONT};font-weight:800;font-size:44px;letter-spacing:-2.6px;color:${INK}">Epic</span>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CREAM};margin:0;padding:0">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border:2px solid ${INK};background:${CREAM}">
      <tr><td style="background:${LIME};padding:18px 24px;border-bottom:2px solid ${INK}">${mark}</td></tr>
      <tr><td style="padding:24px;font-family:${FONT};font-size:16px;line-height:1.5;color:${INK}">
${body}
        <p style="margin:24px 0 0"><a href="${url}" style="display:inline-block;background:${INK};color:${CREAM};font-weight:700;padding:14px 22px;text-decoration:none;border-radius:0">${action}</a></p>
      </td></tr>
      <tr><td style="border-top:2px solid ${INK};padding:14px 24px;font-family:${FONT};font-size:13px;font-weight:600;color:${INK}">Seize the day</td></tr>
    </table>
  </td></tr>
</table>`;
}

const note = (t) => `        <p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:${MUTED}">${t}</p>`;

/**
 * The invitation itself.
 *
 * Plain words, one link, and no tracking pixel or redirect: the address in the
 * e-mail is the address they land on. It says who it is from and that the link
 * is theirs alone, because a link that arrives with no explanation looks
 * exactly like the thing people are told never to click.
 */
export function invitationEmail({ name, url, from, expiresAt, returning = false }) {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const days = Math.max(1, Math.round((new Date(expiresAt) - Date.now()) / 86400000));
  const opening = returning
    ? 'Here is a fresh link to sign back in to Epic.'
    : `${from || 'Roger'} has set you up with Epic — it remembers every place you love, and plans days out around what everybody in your household will actually eat.`;
  const text = [
    hello,
    '',
    opening,
    '',
    'Open Epic:',
    url,
    '',
    `The link signs you in on the device you open it on and works once, within ${days} day${days === 1 ? '' : 's'}. After that the app stays signed in for ninety days.`,
    '',
    'If you were not expecting this, ignore it — nothing happens until the link is opened.',
  ].join('\n');
  const html = shell({ url, body: [
    `        <p style="margin:0">${hello}</p>`,
    `        <p style="margin:16px 0 0">${opening}</p>`,
    note(`The link signs you in on the device you open it on and works once, within ${days} day${days === 1 ? '' : 's'}. After that the app stays signed in for ninety days.`),
    note('If you were not expecting this, ignore it — nothing happens until the link is opened.'),
  ].join('\n') });
  return { subject: returning ? 'Your link back in to Epic' : 'Your invitation to Epic', text, html };
}

/**
 * The other invitation: somebody already in the household, not a new customer.
 *
 * `invitationEmail` above is for a friend the owner is giving Epic to, and it
 * describes what Epic is because they have never heard of it. Gina has: she is
 * in the household the mail is about, her allergens are already in it, and what
 * she needs to be told is whose it is and that it is the same one — not a
 * second, empty Epic of her own.
 */
export function householdInvitationEmail({ name, url, household, from, expiresAt, returning = false }) {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const days = Math.max(1, Math.round((new Date(expiresAt) - Date.now()) / 86400000));
  const who = from ? `${from} has` : 'You have been';
  const opening = returning
    ? `Here is a fresh link to sign back in to ${household || 'your household'} on Epic.`
    : `${who} added you to ${household ? `<b>${household}</b>` : 'the household'} on Epic. It is the same Epic they use — the same trips, the same saved places, and the tastes and allergies already written down for everybody at home.`;
  const plain = opening.replace(/<\/?b>/g, '');
  const text = [
    hello, '', plain, '', 'Open Epic:', url, '',
    `The link signs you in on the device you open it on and works once, within ${days} day${days === 1 ? '' : 's'}. After that the app stays signed in for ninety days.`,
    '', 'If you were not expecting this, ignore it — nothing happens until the link is opened.',
  ].join('\n');
  const html = shell({ url, body: [
    `        <p style="margin:0">${hello}</p>`,
    `        <p style="margin:16px 0 0">${opening}</p>`,
    note(`The link signs you in on the device you open it on and works once, within ${days} day${days === 1 ? '' : 's'}. After that the app stays signed in for ninety days.`),
    note('If you were not expecting this, ignore it — nothing happens until the link is opened.'),
  ].join('\n') });
  return { subject: returning ? 'Your link back in to Epic' : `You're in ${household || 'the household'} on Epic`, text, html };
}
