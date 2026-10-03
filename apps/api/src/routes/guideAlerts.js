/**
 * "Tell me when" on a subcategory guide (Epic Events on the web › Subcategory
 * guides, brief §6a; 3 Oct 2026).
 *
 * `POST /api/guide-alerts`, public for the same reason the waitlist is: the
 * people it is for have no account. It stands on the same three legs as
 * routes/interest.js — server-side validation, a per-caller rate limit and a
 * honeypot — and answers the same way: 200 for a new ask, a repeat and a bot
 * alike, a 400 with the one sentence the form shows, or a 429.
 *
 * The place is looked up from Ordnance Survey / ONS names (sources/ukPlace.js),
 * never Google, and stored as typed beside what it resolved to; a place that
 * cannot be told is kept as typed, never refused. Nothing is emailed yet: the
 * alert itself fires when a matching public event goes live, and is not built.
 */

import express from 'express';
import { readFileSync } from 'node:fs';
import { interestEdgeLimit, interestLimit } from '../limits.js';
import { addAlert } from '../repositories/guideAlerts.js';
import { placeKeyOf, placeOf } from '../sources/ukPlace.js';
import { LOCALES, text } from './interest.js';

/** The sentence beside each guide's tick (sources/consentWordings.json › guide), and so the guides there are. */
export const GUIDE_CONSENT = JSON.parse(readFileSync(new URL('../sources/consentWordings.json', import.meta.url), 'utf8')).guide;
export const RADII = new Set([10, 15, 25, 50]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const say = (error, message) => ({ refusal: { error, message } });

/**
 * The body, checked, in the order the form checks it: the email, the place, the
 * tick. Returns `{ alert }` or `{ refusal }`. Exported for the tests.
 */
export function readAlert(body) {
  const b = body && typeof body === 'object' ? body : {};
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL.test(email)) return say('bad_email', "That email doesn't look right.");
  const placeTyped = text(b.where, 120);
  if (!placeTyped) return say('no_place', 'Add a city, county or postcode.');
  if (b.consent !== true) return say('no_consent', 'Tick the box so we can email you.');
  const subcategory = typeof b.subcategory === 'string' ? b.subcategory.trim().toLowerCase() : '';
  if (!Object.hasOwn(GUIDE_CONSENT, subcategory)) return say('bad_subcategory', 'Something went wrong with that form. Try again.');
  // The words beside the tick are the record of what the person agreed to (PECR):
  // only the sentence this guide shows, so a direct request cannot store another.
  if (b.consentWording !== GUIDE_CONSENT[subcategory]) return say('bad_consent', 'Something went wrong with that form. Try again.');
  const within = Number(b.within);
  if (!RADII.has(within)) return say('bad_within', 'Something went wrong with that form. Try again.');
  const locale = typeof b.locale === 'string' ? b.locale.trim().toLowerCase() : '';
  if (!LOCALES.has(locale)) return say('bad_locale', 'That site version is not one we know.');
  return {
    alert: {
      email, subcategory, placeTyped, within, locale, consentWording: GUIDE_CONSENT[subcategory],
      pageUrl: text(b.pageUrl, 1000),
      referrer: text(b.referrer, 1000),
      utmSource: text(b.utmSource), utmMedium: text(b.utmMedium), utmCampaign: text(b.utmCampaign),
      utmTerm: text(b.utmTerm), utmContent: text(b.utmContent), gclid: text(b.gclid), fbclid: text(b.fbclid),
    },
  };
}

/** The router. `lookup` is the place lookup, injectable so a test never calls postcodes.io. */
export function guideAlertsRouter({ lookup = placeOf } = {}) {
  const router = express.Router();

  router.post('/guide-alerts', interestEdgeLimit, interestLimit, async (req, res, next) => {
    try {
      // The honeypot: thanked like a person, and nothing stored or looked up.
      const pot = req.body?.website;
      if (pot != null && String(pot).trim() !== '') return res.json({ ok: true, place: null });

      const { alert, refusal } = readAlert(req.body);
      if (refusal) return res.status(400).json(refusal);

      const place = await lookup(alert.placeTyped);
      await addAlert({ ...alert, place, placeKey: placeKeyOf(alert.placeTyped) });
      // Where it was filed, so the page can say it back; the same whether or not this was a repeat.
      return res.json({ ok: true, place: place?.name ?? null });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default guideAlertsRouter();
