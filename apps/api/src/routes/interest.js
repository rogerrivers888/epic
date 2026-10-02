/**
 * "Register your interest" — the one form on every page of epic.day (Website &
 * Registration v2, signed off 1 Oct 2026).
 *
 * `POST /api/interest`, public: no session, and admitted through the launch gate
 * (siteGate.js) on its own precise rule, because the people it is for are by
 * definition the ones who cannot sign in yet. What stands in for a credential is
 * what the Technical Foundations ask of every form: server-side validation, a
 * rate limit per caller (limits.js › interestLimit), and a honeypot.
 *
 * Three answers and no more, so the form cannot be used to learn anything about
 * an address: 200 `{ok:true}` (a new sign-up, a repeat, or a bot that filled the
 * honeypot — indistinguishable), 400 with the one sentence the page shows, or
 * 429 from the limiter.
 *
 * The confirmation goes out through Epic's existing sender (sources/mail.js),
 * only on a first sign-up to a list and only when mail is configured. It is
 * started and not waited on: a slow or failed send is a fact about the send,
 * not a reason to keep the person staring at a button.
 */

import express from 'express';
import { interestEdgeLimit, interestLimit, interestMailAllowed } from '../limits.js';
import { deployed } from '../auth.js';
import { readFileSync } from 'node:fs';

/** What each form on epic.day says above its button, by source (`home`, `host`). */
export const CONSENT_WORDINGS = JSON.parse(readFileSync(new URL('../sources/consentWordings.json', import.meta.url), 'utf8'));
import { addSignup } from '../repositories/interest.js';
import { interestEmail, mailConfigured, sendMail, webUrl } from '../sources/mail.js';

export const SOURCES = new Set(['home', 'host']);
// How often it runs (host page v6, 2 Oct 2026). The old four — activity, class,
// homeschool — are no longer offered; rows that carry them are still read (migration 335).
export const HOST_KINDS = new Set(['one-off', 'weekly', 'course', 'on-request']);
export const LOCALES = new Set(['en-gb', 'en-us']);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAD_EMAIL = { error: 'bad_email', message: "That email doesn't look right." };

/** A trimmed string no longer than `max`, or null for anything empty or not a string. */
export const text = (v, max = 300) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max).trim();
  return t || null;
};

/**
 * The visitor's country, from Cloudflare's `CF-IPCountry` — never from a lookup
 * of their address. Two letters or nothing; `XX` is Cloudflare for "unknown" and
 * `T1` for Tor, and neither is a country.
 */
export function countryOf(req) {
  const c = String(req.headers['cf-ipcountry'] ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' ? c : null;
}

/**
 * The body, checked. Returns `{ signup }` or `{ refusal }`. Exported for the
 * tests; the route is the only caller.
 */
export function readSignup(body, req) {
  const b = body && typeof body === 'object' ? body : {};
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL.test(email)) return { refusal: BAD_EMAIL };
  const source = typeof b.source === 'string' ? b.source.trim().toLowerCase() : '';
  if (!SOURCES.has(source)) return { refusal: { error: 'bad_source', message: 'That form is not one we know.' } };
  const locale = typeof b.locale === 'string' ? b.locale.trim().toLowerCase() : '';
  if (!LOCALES.has(locale)) return { refusal: { error: 'bad_locale', message: 'That site version is not one we know.' } };
  // The wording the person agreed to is the record of their consent (PECR); a
  // sign-up without it is one we could not later account for, so it is refused
  // rather than stored with a blank.
  // Only wording a form on the site actually shows (sources/consentWordings.json,
  // pinned to the site's own strings by apps/web/test/consentWording.test.ts):
  // the column is the record of what the person agreed to, so a direct request
  // cannot write one nobody was shown (Codex, 1 Oct 2026).
  const consentWording = text(b.consentWording, 300);
  if (!consentWording || !CONSENT_WORDINGS[source]?.includes(consentWording)) {
    return { refusal: { error: 'bad_consent', message: 'Something went wrong with that form. Try again.' } };
  }
  // The host kind belongs to the host page's picker and nowhere else; anything
  // outside the four, or anything from the homepage, is simply not given.
  const kind = typeof b.hostKind === 'string' ? b.hostKind.trim().toLowerCase() : '';
  const hostKind = source === 'host' && HOST_KINDS.has(kind) ? kind : null;
  return {
    signup: {
      email, source, hostKind, locale, consentWording,
      country: countryOf(req),
      landingPage: text(b.landingPage),
      referrer: text(b.referrer, 1000),
      utmSource: text(b.utmSource),
      utmMedium: text(b.utmMedium),
      utmCampaign: text(b.utmCampaign),
      utmTerm: text(b.utmTerm),
      utmContent: text(b.utmContent),
      gclid: text(b.gclid),
      fbclid: text(b.fbclid),
    },
  };
}

/**
 * The router. `send` and `configured` are the mail sender's, injectable so a
 * test can see what would have gone without Postmark.
 */
export function interestRouter({ send = sendMail, configured = mailConfigured, mailAllowed = interestMailAllowed } = {}) {
  const router = express.Router();

  router.post('/interest', interestEdgeLimit, interestLimit, async (req, res, next) => {
    try {
      // The honeypot: a field no person can see, so anything in it was typed by
      // a script. It gets the same success a person does — telling it apart
      // would only teach it to leave the field alone — and nothing is stored or sent.
      const pot = req.body?.website;
      if (pot != null && String(pot).trim() !== '') return res.json({ ok: true });

      const { signup, refusal } = readSignup(req.body, req);
      if (refusal) return res.status(400).json(refusal);

      const added = await addSignup(signup);
      // A repeat is answered exactly as a first sign-up, and gets no second email.
      if (added && configured() && mailAllowed()) {
        try {
          // Deployed, never the request's Origin: anybody can post somebody else's
          // address with their own Origin, and the button would carry it (Codex).
          const mail = interestEmail({ source: signup.source, url: webUrl(deployed() ? { headers: {} } : req) });
          Promise.resolve(send({ to: signup.email, ...mail, purpose: 'interest' }))
            .catch((err) => console.error(`epic-api: interest — confirmation not sent: ${err.message}`));
        } catch (err) {
          console.error(`epic-api: interest — confirmation not sent: ${err.message}`);
        }
      }
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default interestRouter();
