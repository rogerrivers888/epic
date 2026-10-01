/**
 * The narrowing rule (Option 2, owner, 1 Oct 2026): the read-only measurement and
 * the gated, reversible apply path, behind the admin door.
 *
 *   GET  /api/admin/narrowing/preview?scope=ring|estate&where=&minutes=&mode=
 *                                          the measurement: countNow / surfaced /
 *                                          notSurfaced per drawer + cultureTotal
 *   GET  /api/admin/narrowing/subcategories the drawers and the rule, no count
 *   GET  /api/admin/narrowing/report        the live measurement beside the stored
 *                                          determination (what the check wrote / applied)
 *   POST /api/admin/narrowing/check         writes applied=false determinations; hides nothing
 *   POST /api/admin/narrowing/apply         the owner's OK — a signed-in device only
 *
 * Mirrors C57 (routes/closed.js): the check never applies, and apply is refused to
 * an agent's session. Nothing a family sees changes until apply. The read routes
 * are gated on `view_library`; check and apply on `manage_settings`.
 */

import { Router } from 'express';
import { requires } from '../access.js';
import { narrowingPreview, PROPOSED_RULE, SUBCATEGORIES } from '../repositories/narrowing.js';
import * as surfacing from '../repositories/placeSurfacing.js';
import { query } from '../db.js';

export const narrowingRoutes = Router();
const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';

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

// ---------------------------------------------------------------------------
// The apply path (Part B) — a real, reversible, gated family-facing change.
// Mirrors C57 (routes/closed.js): the check writes applied=false determinations,
// the report shows before/after, and apply is a signed-in device's own act —
// never an agent's. Nothing a family sees changes until apply.
// ---------------------------------------------------------------------------

/** What the rule would hold back: the live measurement beside the stored state. */
narrowingRoutes.get('/report', requires('view_library'), async (_req, res, next) => {
  try {
    res.json(await surfacing.surfacingReport({ examples: 10 }));
  } catch (err) { next(err); }
});

narrowingRoutes.post('/check', requires('manage_settings'), async (req, res, next) => {
  try {
    const by = actorOf(req);
    // Reserve the one run slot in the database (Codex #4/E): startCheck inserts the
    // 'running' row, which the single-running unique index (migration 321) refuses
    // if another instance already holds it — two concurrent checks yield one run.
    let checkId;
    try {
      checkId = await surfacing.startCheck({ by, dryRun: true });
    } catch (e) {
      if (e?.code === '23505') return res.status(409).json({ error: 'running', message: 'A check is already running.' });
      throw e;
    }
    // The reservation is held; run the rest asynchronously against it.
    void surfacing.runSurfacingCheck({ by, dryRun: true, checkId })
      .catch((err) => console.warn(`narrowing check: ${String(err?.message ?? err).slice(0, 200)}`));
    res.status(202).json({ started: true, checkId });
  } catch (err) { next(err); }
});

narrowingRoutes.post('/apply', requires('manage_settings'), async (req, res, next) => {
  try {
    // An estate-wide hiding is a privileged action: it needs the OWNER personally
    // signed in (G11 elevation), not merely a manage_settings device — a delegated
    // admin must not apply it (Codex #1). This is req.access.elevated, the same
    // gate as requireOwnerSignedIn; checked inline because this worktree's base
    // predates that export (see the hand-over note). An agent never reaches here:
    // the server-wide write guard refuses every agent POST except /api/admin/
    // approvals, and `requires('manage_settings')` refuses it first — so there is
    // no self-apply branch to write (Codex #5). A non-elevated caller is told to
    // sign in personally, or to file it for approval via /api/admin/approvals.
    if (!req.access?.elevated) {
      return res.status(403).json({
        error: 'needs_personal_sign_in',
        message: 'Applying the narrowing needs you signed in personally — open Epic and sign in with your e-mail link. A shared-passcode or agent session can’t; file it for approval instead.',
        request: `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}`,
        action: 'apply the narrowing',
      });
    }
    if (await surfacing.runningCheck()) return res.status(409).json({ error: 'running', message: 'Wait for the check to finish.' });
    const checkId = req.body?.checkId ? String(req.body.checkId) : null;
    const out = await surfacing.applySurfacing({ by: actorOf(req), checkId });
    // A guard tripped (no completed check named): report it, change nothing.
    if (out.error) return res.status(409).json(out);
    // What families are counted from follows at once — the same invalidation
    // onResurfaced uses, so apply and a re-surfacing never diverge (collections
    // cache forgotten, each county recounted, every ring recounted; free).
    await surfacing.invalidateCounts();
    await query(
      `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
       values ($1,$2,'narrowing.apply','place_surfacing',$3,'narrowing check',$4)`,
      [req.account?.id ?? null, actorOf(req), checkId ?? 'all', JSON.stringify(out)]).catch(() => null);
    res.json(out);
  } catch (err) { next(err); }
});

export default narrowingRoutes;
