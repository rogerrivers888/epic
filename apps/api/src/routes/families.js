/**
 * /api/families — families who have visited are one of our own sources
 * (back-office handover 4.7, C42). Backend only: the in-app question is a
 * separate design brief, so nothing in the app calls these yet.
 *
 *   GET  /question?ref=&visit=  at most `askPerVisit` questions for this
 *                               household about a place it has visited,
 *                               only facts that matter to it, never one it
 *                               has been asked before
 *   POST /answer                { ref, fact, answer: yes | no | didnt_notice }
 *
 * Which household answered what is never shown anywhere.
 */

import { Router } from 'express';
import { currentHousehold } from './household.js';
import * as pipeline from '../desk/pipeline.js';

export const familyRoutes = Router();

familyRoutes.get('/question', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    if (!household) return res.status(400).json({ error: 'no_household' });
    const ref = String(req.query.ref ?? '');
    if (!ref) return res.status(400).json({ error: 'ref_required' });
    res.json({ questions: await pipeline.questionFor({ householdId: household.id, ref, visitId: req.query.visit ? String(req.query.visit) : null }) });
  } catch (err) { next(err); }
});

familyRoutes.post('/answer', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    if (!household) return res.status(400).json({ error: 'no_household' });
    const ref = String(req.body?.ref ?? '');
    const fact = String(req.body?.fact ?? '');
    const answer = String(req.body?.answer ?? '');
    if (!ref || !fact) return res.status(400).json({ error: 'ref_and_fact_required' });
    const out = await pipeline.familyAnswer({ householdId: household.id, ref, fact, answer });
    // The settlement is not the household's business; the answer is recorded.
    res.json({ recorded: out.recorded });
  } catch (err) { next(err); }
});

export default familyRoutes;
