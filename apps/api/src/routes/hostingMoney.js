/**
 * Hosting v4, phase 1: the settings, the change log, the reconciliation, and a
 * household's notifications (handover §6–§8).
 *
 *   GET  /api/admin/hosting/settings          every setting, in words, with who changed it
 *   PUT  /api/admin/hosting/settings/:key     the owner, personally signed in (G7/G11);
 *                                             an agent is told to file it for approval
 *   GET  /api/admin/hosting/changes           the change log ("Changes", §3.8)
 *   GET  /api/admin/hosting/reconciliation    the last Stripe reconciliation
 *   GET  /api/notifications                   the household's, newest first
 *   POST /api/notifications/read              one ({ id }) or all
 */

import { Router } from 'express';
import * as settings from '../repositories/hostingSettings.js';
import * as ledger from '../repositories/hostingLedger.js';
import * as notifications from '../repositories/notifications.js';
import { settingWords, SWITCHABLE, TO_SET } from '../domain/hostingSettings.js';
import { requires, requireOwnerSignedIn } from '../access.js';
import { currentAccount, runOutsideRequest } from '../context.js';
import { query } from '../db.js';
import { currentHousehold } from './household.js';
import { moneyTick } from '../sources/hostingMoney.js';

export const router = Router();
export const adminRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const settingPayload = (r) => ({
  key: r.key,
  label: r.label,
  unit: r.unit,
  value: r.value,
  isOn: r.is_on,
  switchable: SWITCHABLE.includes(r.key),
  toSet: TO_SET.includes(r.key) && r.value == null,
  words: r.is_on === false ? 'Off' : settingWords(r),
  changedAt: r.changed_at,
  changedBy: r.changed_by_email ?? null,
  approvalId: r.approval_id ?? null,
});

adminRouter.get('/settings', requires('view_hosting'), async (_req, res, next) => {
  try {
    // Changes filed for the owner and still open — waiting, or approved and failed to run, or unknown: shown against their setting (BO8l).
    const { rows: pending } = await query(
      `select id, request, payload, state, created_at from approvals
        where state in ('pending', 'failed', 'unknown') and request like 'PUT /api/admin/hosting/settings/%' order by created_at`,
    );
    const waiting = new Map();
    for (const a of pending) {
      const key = decodeURIComponent(a.request.slice('PUT /api/admin/hosting/settings/'.length).split('?')[0]);
      waiting.set(key, { approvalId: a.id, state: a.state, value: a.payload?.value, isOn: a.payload?.isOn, why: a.payload?.why ?? null, at: a.created_at });
    }
    res.json({ settings: (await settings.list()).map((r) => ({ ...settingPayload(r), pending: waiting.get(r.key) ?? null })), waitingApproval: pending.length });
  } catch (err) { next(err); }
});

adminRouter.put('/settings/:key', requireOwnerSignedIn('change a hosting setting'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const approvalId = typeof body.approvalId === 'string' && UUID.test(body.approvalId) ? body.approvalId : null;
    const out = await settings.change(req.params.key, { value: body.value, isOn: body.isOn }, { by: currentAccount()?.id ?? null, why: body.why, approvalId });
    if (out.error) return res.status(out.status).json({ error: out.error });
    const rows = await settings.list();
    res.json({ setting: settingPayload(rows.find((r) => r.key === req.params.key) ?? out.row) });
  } catch (err) { next(err); }
});

adminRouter.get('/changes', requires('view_hosting'), async (req, res, next) => {
  try {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
    const subject = typeof req.query.subject === 'string' ? req.query.subject.slice(0, 100) : null;
    const { rows, limit, capped } = await settings.changes({ subjectKind: kind, subjectId: subject, limit: Number(req.query.limit) || 200 });
    res.json({
      changes: rows.map((r) => ({ id: r.id, subjectKind: r.subject_kind, subjectId: r.subject_id, field: r.field, before: r.before, after: r.after, why: r.why, by: r.by_email ?? r.by_label, byLabel: r.by_label, approvalId: r.approval_id, at: r.at })),
      limit,
      capped,
    });
  } catch (err) { next(err); }
});

adminRouter.get('/reconciliation', requires('view_hosting'), async (_req, res, next) => {
  try {
    const last = await ledger.lastReconciliation();
    res.json({ last: last ? { ranAt: last.ran_at, mode: last.mode, checked: last.checked, mismatched: last.mismatched, details: last.details } : null });
  } catch (err) { next(err); }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const audience = ['guest', 'host'].includes(req.query.audience) ? req.query.audience : null;
    const { rows, unread, capped } = await notifications.forHousehold(household.id, { audience });
    res.json({
      notifications: rows.map((r) => ({ id: r.id, audience: r.audience, kind: r.kind, title: r.title, body: r.body, link: r.link, read: Boolean(r.read_at), at: r.created_at })),
      unread,
      capped,
    });
  } catch (err) { next(err); }
});

router.post('/notifications/read', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const id = req.body?.id;
    if (id != null && !(typeof id === 'string' && UUID.test(id))) return res.status(400).json({ error: 'That is not a notification.' });
    res.json({ marked: await notifications.markRead(household.id, id ?? null) });
  } catch (err) { next(err); }
});

/** Payouts, reconciliation and queued e-mail, every ten minutes. */
export function startHostingMoneyLoop() {
  const run = () => runOutsideRequest(() => moneyTick()).catch((err) => console.error('hosting money tick failed', err.message));
  setTimeout(run, 45_000).unref?.();
  return setInterval(run, 10 * 60_000).unref?.();
}

export default router;
