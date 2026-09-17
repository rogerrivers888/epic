/**
 * Runs — the monitor.
 *
 * Starting a collection run happens on Places, where the gap is. This page only
 * watches. It exists because runs take hours, spend money and die when a deploy
 * lands mid-flight, so one page has to answer "what is going, what did it cost,
 * what failed" without the operator having to remember which county they were in.
 */

import express from 'express';
import { requires } from '../access.js';
import * as runs from '../repositories/runs.js';
import { writeAudit } from '../repositories/roles.js';
import { query } from '../db.js';

const router = express.Router();
const actor = (req) => ({ actorId: req.account?.id ?? null, actorLabel: req.account?.email ?? 'the owner (passcode)' });

/** BO3a / BO3c — every run, its cost, its cap, its state and its history. */
router.get('/', requires('view_library'), async (_req, res, next) => {
  try {
    res.json({ ...(await runs.list()), stranded: await runs.stranded() });
  } catch (err) { next(err); }
});

/** BO3b — one run's failures, ours kept separate from theirs. */
router.get('/:key/failures', requires('view_library'), async (req, res, next) => {
  try { res.json(await runs.failures(String(req.params.key))); } catch (err) { next(err); }
});

/** The places behind one cause, so a row of work is a link you can send somebody. */
router.get('/:key/failing', requires('view_library'), async (req, res, next) => {
  try {
    res.json({ rows: await runs.failing(String(req.query.cause ?? 'unknown'), { oursKind: req.query.ours ? String(req.query.ours) : null }) });
  } catch (err) { next(err); }
});

/** What each run last did. */
router.get('/:key/history', requires('view_library'), async (req, res, next) => {
  try { res.json({ rows: await runs.history(String(req.params.key)) }); } catch (err) { next(err); }
});

/**
 * The ceiling. Nothing spends past it, and it is set here rather than in an
 * environment variable so the number on the screen is the number in force.
 */
router.put('/ceiling', requires('manage_settings'), async (req, res, next) => {
  try {
    const pence = Math.max(0, Math.round(Number(req.body?.pence) || 0));
    const before = (await query("select value from app_settings where key = 'collect.ceiling_pence'")).rows[0]?.value ?? null;
    await query(
      `insert into app_settings (key, value, updated_at) values ('collect.ceiling_pence', $1::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(pence)]);
    await writeAudit({ ...actor(req), action: 'collect.ceiling', subjectType: 'setting', subjectId: 'collect.ceiling_pence', before: { pence: before }, after: { pence } });
    res.json({ pence });
  } catch (err) { next(err); }
});

export default router;
