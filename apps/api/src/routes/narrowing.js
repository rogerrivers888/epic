/**
 * Narrowing preview — read-only (owner, 1 Oct 2026). PROPOSE ONLY.
 *
 * `GET /api/admin/narrowing/preview?scope=ring|estate&where=&minutes=&mode=`
 *
 * Returns the Culture census counts for churches, landmarks and monuments
 * (museums beside them as the comparator), split into what the notability rule
 * would keep and drop, with examples of each and the rule in plain words. It
 * computes and returns numbers; it writes nothing, hides nothing, and changes no
 * filing. Applying the rule is a separate step the owner approves (H1).
 *
 * Gated on `view_library` like the rest of the filing desk, behind the admin
 * door. Only `select` queries run.
 */

import { Router } from 'express';
import { requires } from '../access.js';
import { narrowingPreview, PROPOSED_RULE, SUBCATEGORIES } from '../repositories/narrowing.js';

export const narrowingRoutes = Router();

narrowingRoutes.get('/preview', requires('view_library'), async (req, res, next) => {
  try {
    const scope = String(req.query.scope ?? 'ring').toLowerCase() === 'estate' ? 'estate' : 'ring';
    const out = await narrowingPreview({
      scope,
      where: req.query.where ?? null,
      lat: req.query.lat ?? null,
      lng: req.query.lng ?? null,
      minutes: req.query.minutes,
      mode: req.query.mode,
    });
    if (out.error) return res.status(400).json(out);
    res.json({ ...out, proposedRule: PROPOSED_RULE });
  } catch (err) { next(err); }
});

/** The drawers the rule covers, and the comparator, without running a count. */
narrowingRoutes.get('/subcategories', requires('view_library'), async (_req, res, next) => {
  try {
    res.json({ subcategories: SUBCATEGORIES, proposedRule: PROPOSED_RULE });
  } catch (err) { next(err); }
});

export default narrowingRoutes;
