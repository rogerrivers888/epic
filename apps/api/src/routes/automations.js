/**
 * /api/admin/automations — automations as records, and their log (K16 step 1,
 * Roger, 3 Oct 2026). Data only; the screens come with the design handoff.
 *
 *   GET   /                     every automation, with its runs in the last 7 and 30 days
 *   GET   /runs?automation=&since=&limit=  the log, newest first (capped, and says so)
 *   GET   /:key                 one
 *   PATCH /:key                 { on?, locked?, rules? } — the owner, signed in personally
 *   POST  /runs/:id/undo        { note? } — the owner, signed in personally, through the automation's undo handler
 *
 * Same doors as the templates: reading is `view_audit`; changing is
 * `manage_settings` with the owner signed in personally (G11), so an agent's
 * attempt is answered with what to file in Approvals. The locks are enforced
 * in the repository, so no route can switch a locked automation.
 */

import { Router } from 'express';
import { requires, requireOwnerSignedIn } from '../access.js';
import { currentAccount } from '../context.js';
import * as automations from '../repositories/automations.js';

const router = Router();
const who = () => { const a = currentAccount(); return a?.email ?? a?.name ?? (a?.id ? `account ${a.id}` : null); };
const send = (res, err, next) => (err.status && err.status < 500 ? res.status(err.status).json({ error: err.code ?? 'refused', message: err.message }) : next(err));

router.get('/', requires('view_audit'), async (_req, res, next) => {
  try { res.json({ automations: await automations.listAutomations(), areas: automations.AREAS }); } catch (err) { send(res, err, next); }
});

router.get('/runs', requires('view_audit'), async (req, res, next) => {
  try {
    const since = req.query.since && !Number.isNaN(Date.parse(String(req.query.since))) ? new Date(String(req.query.since)) : null;
    const automation = req.query.automation ? String(req.query.automation) : null;
    if (automation && !automations.AUTOMATION_KEYS.includes(automation)) return res.status(404).json({ error: 'not_found', message: 'There is no such automation.' });
    res.json(await automations.listRuns({ automation, since, limit: req.query.limit }));
  } catch (err) { send(res, err, next); }
});

router.post('/runs/:id/undo', requires('manage_settings'), requireOwnerSignedIn('undo an automatic action'), async (req, res, next) => {
  try {
    const out = await automations.undoRun(req.params.id, { by: currentAccount()?.id ?? null, note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : null });
    res.json({ undone: true, did: out.did, run: { id: out.run.id, undoneAt: out.run.undone_at } });
  } catch (err) { send(res, err, next); }
});

router.get('/:key', requires('view_audit'), async (req, res, next) => {
  try {
    const a = await automations.getAutomation(req.params.key);
    if (!a) return res.status(404).json({ error: 'not_found', message: 'There is no such automation.' });
    res.json({ automation: a });
  } catch (err) { send(res, err, next); }
});

router.patch('/:key', requires('manage_settings'), requireOwnerSignedIn('change an automation'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    res.json({ automation: await automations.changeAutomation(req.params.key, { on: b.on, locked: b.locked, rules: b.rules, steps: b.steps }, { who: who() }) });
  } catch (err) { send(res, err, next); }
});

export default router;
