/**
 * Settings › Membership and billing, the API only (register L8, K12; Phase 4, 3 Oct 2026).
 *
 *   GET  /membership                 — the household's membership, and what each plan costs
 *   POST /membership/checkout {plan} — join: Stripe's hosted Checkout, a month free, card up front
 *   POST /membership/portal          — Stripe's portal: the card, receipts, switching plan, cancelling
 *   GET  /membership/cancel/:token   — the reminder's one tap (public: the token is the credential)
 *
 * The screen is Claude Design's to draw; until it is, Settings keeps its
 * "coming soon" row. Joining needs a person signed in — the shared passcode is
 * not anybody whose card this is.
 */

import { Router } from 'express';
import { currentAccount } from '../context.js';
import { currentHousehold } from './household.js';
import * as billing from '../repositories/membershipBilling.js';
import * as membership from '../sources/membership.js';
import { query } from '../db.js';

export const router = Router();
export const publicRouter = Router();

function signedIn() {
  const account = currentAccount();
  if (!account) throw Object.assign(new Error('Sign in as yourself to manage a membership.'), { status: 401, code: 'sign_in' });
  return account;
}

router.get('/membership', async (_req, res, next) => {
  try {
    const household = await currentHousehold();
    const { rows: prices } = await query(
      `select pp.plan_key, pl.label, pp.amount_pence from plan_prices pp join plans pl on pl.key = pp.plan_key
        where pp.channel = 'web' and pp.effective_to is null and pp.plan_key = any($1::text[]) order by pp.amount_pence`,
      [membership.MEMBERSHIP_PLANS],
    );
    res.json({
      membership: membership.membershipPayload(await billing.latestMembership(household.id)),
      plans: prices.map((p) => ({ planKey: p.plan_key, label: p.label, monthlyPence: p.amount_pence })),
      trialDays: membership.TRIAL_DAYS,
    });
  } catch (err) { next(err); }
});

router.post('/membership/checkout', async (req, res, next) => {
  try {
    const account = signedIn();
    const household = await currentHousehold();
    const out = await membership.startCheckout({ householdId: household.id, email: account.email, name: account.name ?? household.name, planKey: String(req.body?.plan ?? '') });
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/membership/portal', async (_req, res, next) => {
  try {
    const account = signedIn();
    const household = await currentHousehold();
    res.json({ url: await membership.portalUrl({ householdId: household.id, email: account.email }) });
  } catch (err) { next(err); }
});

// The reminder's "cancel in one tap": straight to Stripe's cancel page for that membership. A link that has had its
// day (a new reminder made a new one, or the membership has ended) goes to Settings instead.
publicRouter.get('/membership/cancel/:token', async (req, res) => {
  const fallback = `${(process.env.EPIC_APP_URL || process.env.APP_URL || 'https://epic.day').replace(/\/$/, '')}/settings`;
  try {
    const url = await membership.cancelUrlForToken(req.params.token);
    res.redirect(303, url ?? fallback);
  } catch {
    res.redirect(303, fallback);
  }
});

export default router;
