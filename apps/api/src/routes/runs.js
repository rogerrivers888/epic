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
    // The key is honoured rather than ignored: only the menu reader keeps this
    // list, and answering with the menus' failures for any other run was a
    // board that looked full of work belonging to something else (17 Sep 2026).
    if (String(req.params.key) !== 'menus') return res.json({ rows: [], keepsAList: false });
    res.json({
      rows: await runs.failing(String(req.query.cause ?? 'unknown'), { oursKind: req.query.ours ? String(req.query.ours) : null }),
      keepsAList: true,
    });
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
    // A number, or nothing happens.
    //
    // `Number(x) || 0` read a malformed body, a missing field or a negative as
    // nought — and a ceiling of nought stops every paid collection there is. A
    // stale client or a typo could have turned the budget off and said "saved"
    // (Codex, 18 Sep 2026).
    const asked = Number(req.body?.pence);
    if (!Number.isFinite(asked) || asked < 0) {
      throw Object.assign(new Error('A ceiling is a number of pence, and not less than nothing.'),
        { status: 400, code: 'bad_ceiling' });
    }
    const pence = Math.round(asked);
    const before = (await query("select value from app_settings where key = 'collect.ceiling_pence'")).rows[0]?.value ?? null;
    await query(
      `insert into app_settings (key, value, updated_at) values ('collect.ceiling_pence', $1::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(pence)]);
    await writeAudit({ ...actor(req), action: 'collect.ceiling', subjectType: 'setting', subjectId: 'collect.ceiling_pence', before: { pence: before }, after: { pence } });
    res.json({ pence });
  } catch (err) { next(err); }
});

export default router;
