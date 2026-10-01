/**
 * Switch a live source off or back on from Settings › Providers.
 *
 * Non-secret configuration: the key stays where it is; a source without one
 * cannot be switched on from here. But it is estate-wide — switching a keyed
 * source back on re-enables its paid calls for every household — so it needs
 * the settings capability (the owner holds it), never merely a signed-in
 * session (G2 inventory, 28 Sep 2026). Its own module rather than inline in
 * server.js, so the door can be tested without booting the server.
 */

import { Router } from 'express';
import { requires, accessOf } from '../access.js';
import { setSourceOff, sourceHasKey, sourceKeys } from '../sources/index.js';
import { writeAuditStrict } from '../repositories/roles.js';

const router = Router();

router.patch('/sources/:key', requires('manage_settings'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    if (!sourceKeys().includes(key)) return res.status(404).json({ error: 'unknown_source' });
    const on = Boolean(req.body?.on);
    if (on && !sourceHasKey(key)) return res.status(409).json({ error: 'no_key', message: 'This source has no key yet; the owner adds it through Doppler.' });
    // Re-enabling a paid source is a safeguard override (G11): the owner
    // personally signed in. Turning one off is tightening and stays ordinary.
    if (on && !accessOf(req).elevated) {
      return res.status(403).json({ error: 'needs_personal_sign_in', message: 'Re-enabling a provider needs you logged in personally — Google, your password or an e-mail link.' });
    }
    // The owner's authorization, strictly and before the change: fail closed (G11).
    await writeAuditStrict({
      actorId: req.account?.id ?? null, actorLabel: req.account?.email ?? 'the owner',
      action: on ? 'source.on' : 'source.off', subjectType: 'source', subjectId: key, after: { on: on && sourceHasKey(key) },
    });
    const off = await setSourceOff(key, !on);
    res.json({ key, on: on && sourceHasKey(key), off });
  } catch (err) {
    next(err);
  }
});

export default router;
