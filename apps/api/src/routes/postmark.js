/**
 * Postmark's webhook: what became of the e-mails we sent.
 *
 * Postmark POSTs one event at a time — Delivery, Open, Bounce, SpamComplaint —
 * to the URL the owner gives it in the server's Webhooks settings. The URL
 * carries HTTP Basic credentials (`https://postmark:<token>@…/api/postmark/events`)
 * and the password is `POSTMARK_WEBHOOK_TOKEN`, a secret we make up; the same
 * arrangement as Parcelvision's. Anything without it, or with the wrong one,
 * is answered 401 and not read.
 *
 * Public (auth.js PUBLIC) because Postmark has no session; it is the token
 * that admits it. Always 200 on a good token, even for a MessageID we do not
 * know — Postmark retries anything else, and a test event from its console is
 * not one of ours.
 */

import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { applyProviderEvent } from '../repositories/mail.js';

const router = express.Router();

const TOKEN = () => (process.env.POSTMARK_WEBHOOK_TOKEN || '').trim();

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

/** The password half of the Basic credentials, if the request carries any. */
function presented(req) {
  const h = String(req.headers.authorization || '');
  if (!/^basic /i.test(h)) return null;
  try { const [, pass = ''] = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8').split(/:(.*)/s); return pass; } catch { return null; }
}

router.post('/events', express.json({ limit: '256kb' }), async (req, res, next) => {
  try {
    const token = TOKEN();
    const given = presented(req);
    if (!token || given == null || !same(given, token)) {
      res.set('WWW-Authenticate', 'Basic realm="postmark"');
      return res.status(401).json({ error: 'unauthorised', message: token ? 'The webhook credentials do not match POSTMARK_WEBHOOK_TOKEN.' : 'POSTMARK_WEBHOOK_TOKEN is not set, so no webhook is accepted.' });
    }
    const events = Array.isArray(req.body) ? req.body : [req.body];
    let applied = 0;
    for (const ev of events) { if (ev && typeof ev === 'object' && (await applyProviderEvent(ev))) applied += 1; }
    res.json({ ok: true, applied, of: events.length });
  } catch (err) { next(err); }
});

export default router;
