/**
 * "Use my email" on the free account step (G21; guest handoff G21/G24/G30).
 *
 * Booking, asking to book and joining a waiting list all open "Your free
 * account": Continue with Google (routes/authGoogle.js, `?intent=guest`) or
 * this. The person gives an address (and, if they like, their name); a link is
 * sent; opening it makes the account — or signs in the one the address already
 * has — through the ordinary link door (`POST /api/session/link`).
 *
 * Three rules:
 *
 *  - **Nothing is made for an address nobody proved.** An address with no
 *    account gets a guest link (`createGuestLink`): the account is made only
 *    when that link is opened (`consumeGuestLink`).
 *  - **No enumeration.** An address with an account gets its ordinary login
 *    link; one without gets a guest link; a suspended one gets nothing — and
 *    the reply, and the e-mail's words, are the same in every case.
 *  - **Held to the sign-in limit**, as every public door that sends is
 *    (limits.js › SENDING_DOORS).
 */

import express from 'express';
import { accountByEmail, createGuestLink, normaliseEmail } from '../repositories/accounts.js';
import { sendLoginLink } from './session.js';
import { guestNext } from './authGoogle.js';

const router = express.Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GUEST_LINK_SENT = 'Check your email — a link to finish is on its way. It works once, for 15 minutes.';

router.post('/auth/guest', async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    // The address's shape only — says nothing about whether it has an account.
    if (!email || email.length > 254 || !EMAIL.test(email)) {
      return res.status(400).json({ error: 'bad_email', message: "That email doesn't look right." });
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) || null : null;
    const back = guestNext(req.body?.next);
    const account = await accountByEmail(email);
    if (account) {
      // Their own account, signed in as it is — never a second one, never a change of plan.
      if (account.status !== 'suspended') await sendLoginLink(req, account, { next: back });
    } else {
      await sendLoginLink(req, { email }, { next: back, mint: () => createGuestLink({ email, name }) });
    }
    res.json({ sent: true, message: GUEST_LINK_SENT });
  } catch (err) { next(err); }
});

export default router;
