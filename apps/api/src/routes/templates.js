/**
 * /api/admin/templates — the message templates (K16 step 1, Roger, 3 Oct
 * 2026). Data only; the screens come with the design handoff.
 *
 *   GET  /                      every template at its current version
 *   GET  /triggers              the moments a template can be sent at, with their fields and samples
 *   GET  /:key                  one, with its trigger's fields
 *   GET  /:key/versions         every version, newest first
 *   GET  /:key/preview?version= drawn with the trigger's sample fields
 *   POST /:key/preview          the same for a draft { channels, fields } — checked as Save would check it
 *   PUT  /:key                  { channels, name?, category?, note? } — a new version
 *   POST /:key/restore          { version, note? } — an older version saved again as the newest
 *   POST /:key/send-test        { channels?, draft?, version? } — to your own e-mail or mobile, never a customer's
 *
 * Reading is `view_audit` — what Epic says and to whom is part of the trail of
 * what it does — so an agent can read and propose. Changing words is estate-
 * wide configuration: `manage_settings`, and the owner signed in personally
 * (G11), so anybody else's attempt is answered with what to file in Approvals.
 * A test goes only to the signed-in person's own address, so it needs
 * `manage_settings` and an account, not the owner.
 */

import { Router } from 'express';
import { requires, requireOwnerSignedIn } from '../access.js';
import { currentAccount } from '../context.js';
import { TRIGGERS, CHANNELS } from '../domain/messages.js';
import * as templates from '../repositories/templates.js';

const router = Router();
const who = () => { const a = currentAccount(); return a?.email ?? a?.name ?? (a?.id ? `account ${a.id}` : null); };
const send = (res, err, next) => (err.status && err.status < 500 ? res.status(err.status).json({ error: err.code ?? 'refused', message: err.message, ...(err.unknown ? { unknown: err.unknown } : {}) }) : next(err));

router.get('/', requires('view_audit'), async (req, res, next) => {
  try {
    const kind = ['automatic', 'reply'].includes(String(req.query.kind)) ? String(req.query.kind) : null;
    res.json({ templates: await templates.listTemplates({ kind }), channels: CHANNELS });
  } catch (err) { send(res, err, next); }
});

router.get('/triggers', requires('view_audit'), (_req, res) => {
  res.json({ triggers: Object.entries(TRIGGERS).map(([key, t]) => ({ key, label: t.label, audience: t.audience, hostWords: t.hostWords ?? null, fields: t.fields })) });
});

router.get('/:key', requires('view_audit'), async (req, res, next) => {
  try {
    const t = await templates.getTemplate(req.params.key);
    if (!t) return res.status(404).json({ error: 'not_found', message: 'There is no such template.' });
    res.json({ template: t, fields: TRIGGERS[t.trigger]?.fields ?? {} });
  } catch (err) { send(res, err, next); }
});

router.get('/:key/versions', requires('view_audit'), async (req, res, next) => {
  try {
    const t = await templates.getTemplate(req.params.key);
    if (!t) return res.status(404).json({ error: 'not_found', message: 'There is no such template.' });
    res.json({ key: t.key, current: t.version, versions: await templates.versions(t.key) });
  } catch (err) { send(res, err, next); }
});

router.get('/:key/preview', requires('view_audit'), async (req, res, next) => {
  try { res.json(await templates.preview(req.params.key, { version: req.query.version ?? null })); } catch (err) { send(res, err, next); }
});

router.post('/:key/preview', requires('view_audit'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    res.json(await templates.preview(req.params.key, { channels: b.channels ?? null, version: b.version ?? null, fields: b.fields ?? null }));
  } catch (err) { send(res, err, next); }
});

router.put('/:key', requires('manage_settings'), requireOwnerSignedIn('change a message'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const t = await templates.saveVersion(req.params.key, { channels: b.channels, name: b.name ?? null, category: b.category ?? null, note: b.note ?? null }, { who: who(), accountId: currentAccount()?.id ?? null });
    res.json({ template: t });
  } catch (err) { send(res, err, next); }
});

router.post('/:key/restore', requires('manage_settings'), requireOwnerSignedIn('restore a message'), async (req, res, next) => {
  try {
    const t = await templates.restoreVersion(req.params.key, req.body?.version, { who: who(), accountId: currentAccount()?.id ?? null, note: req.body?.note ?? null });
    res.json({ template: t });
  } catch (err) { send(res, err, next); }
});

// A test is a real send, and a send is spend: the owner, signed in personally (G7/G11; Codex, 3 Oct 2026).
router.post('/:key/send-test', requires('manage_settings'), requireOwnerSignedIn('send a test message'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const channels = Array.isArray(b.channels) ? b.channels.map(String) : null;
    res.json(await templates.sendTest(req.params.key, { account: currentAccount(), channels, channelsDraft: b.draft ?? null, version: b.version ?? null }));
  } catch (err) { send(res, err, next); }
});

export default router;
