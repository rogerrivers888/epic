// Closed places (decision C57, owner, 29 Sep 2026).
//
//   GET  /api/admin/closed/report          what the check would hide: by status, by reason, confirmed or not, twenty examples
//   POST /api/admin/closed/check           run the check over everything held (free sources only); writes proposals, hides nothing
//   POST /api/admin/closed/apply           the owner's OK: proposals become applied — a signed-in device only
//   GET  /api/admin/closed/place?ref=      one place's status, with reason, source and evidence
//   POST /api/admin/closed/place           a person sets it (applied at once: it is their own act)
//
// Item 4: "Report first — how many would be hidden, by reason, with 20
// examples — and wait for my OK before applying." So the check never applies,
// and apply is refused to an agent's session the way a paid-hours grant is.

import express from 'express';
import { requires } from '../access.js';
import { query } from '../db.js';
import * as statusRepo from '../repositories/placeStatus.js';
import { runClosedCheck } from '../sources/closedCheck.js';
import { STATUSES } from '../domain/openStatus.js';
import { refreshRegionCounts } from '../repositories/library.js';
import { refreshAllBefore } from '../repositories/ringTables.js';
import { forget as forgetCollections } from '../desk/collections.js';

const router = express.Router();
const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';

router.get('/report', async (req, res, next) => {
  try {
    const running = await statusRepo.runningCheck();
    res.json({ running: running ? { id: running.id, startedAt: running.started_at } : null, ...(await statusRepo.report({ examples: 20 })) });
  } catch (err) { next(err); }
});

let inFlight = null;
router.post('/check', requires('manage_settings'), async (req, res, next) => {
  try {
    if (inFlight || await statusRepo.runningCheck()) return res.status(409).json({ error: 'running', message: 'A check is already running.' });
    const by = actorOf(req);
    inFlight = runClosedCheck({ by, dryRun: true })
      .catch((err) => console.warn(`closed check: ${String(err?.message ?? err).slice(0, 200)}`))
      .finally(() => { inFlight = null; });
    // The run records itself in `closed_checks` before its first read, so the
    // report can name it while it runs.
    await new Promise((r) => setTimeout(r, 50));
    const running = await statusRepo.runningCheck();
    res.status(202).json({ started: true, checkId: running?.id ?? null });
  } catch (err) { next(err); }
});

router.post('/apply', requires('manage_settings'), async (req, res, next) => {
  try {
    if (req.session?.kind !== 'device') {
      return res.status(403).json({ error: 'device_only', message: 'Only a signed-in device can apply the closed check — not an agent.' });
    }
    if (inFlight || await statusRepo.runningCheck()) return res.status(409).json({ error: 'running', message: 'Wait for the check to finish.' });
    const checkId = req.body?.checkId ? String(req.body.checkId) : null;
    const at = new Date().toISOString();
    const out = await statusRepo.applyProposed({ by: actorOf(req), checkId });
    // What families are counted from follows at once: the collections index is
    // forgotten, each county's published count recounted, and every ring
    // counted again behind the answer (free — our own tables only).
    forgetCollections();
    const { rows: regions } = await query('select slug from regions');
    for (const r of regions) await refreshRegionCounts(r.slug).catch(() => null);
    void refreshAllBefore({ before: at }).catch((err) => console.warn(`closed apply: rings: ${String(err?.message ?? err).slice(0, 120)}`));
    await query(
      `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
       values ($1,$2,'closed.apply','place_status',$3,'closed check',$4)`,
      [req.account?.id ?? null, actorOf(req), checkId ?? 'all', JSON.stringify(out)]).catch(() => null);
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/place', async (req, res, next) => {
  try {
    const ref = req.query.ref ? String(req.query.ref) : null;
    const status = await statusRepo.statusFor(ref, {
      wikidataId: req.query.wikidata ? String(req.query.wikidata) : null,
      atlasId: req.query.atlas ? String(req.query.atlas) : null,
    });
    res.json({ status });
  } catch (err) { next(err); }
});

router.post('/place', requires('manage_settings'), async (req, res, next) => {
  try {
    const ref = String(req.body?.ref ?? '');
    const status = String(req.body?.status ?? '');
    if (!ref || !STATUSES.includes(status)) return res.status(400).json({ error: 'bad_request', message: `ref and one of ${STATUSES.join(', ')}` });
    await statusRepo.setByPerson(ref, {
      status, reason: req.body?.reason ? String(req.body.reason).slice(0, 200) : null,
      successorRef: req.body?.successorRef ? String(req.body.successorRef) : null, by: actorOf(req),
    });
    res.json({ status: await statusRepo.statusFor(ref) });
  } catch (err) { next(err); }
});

export default router;
