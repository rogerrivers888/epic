/**
 * The census, read back — §6 of the big census brief, 20 Sep 2026.
 *
 * Four things to look at and one to label everything else with: places per
 * subcategory with their coverage, drawers that came back empty everywhere,
 * Google types that never answer, drawers furthest below their free ground
 * count, and what is still cut off. The work is in
 * `repositories/censusFindings.js`; this only decides who may look and what the
 * scope is.
 *
 * `view_library` throughout. Nothing here calls a provider, so there is nothing
 * to spend and nothing to quote — which is the policy's own rule for the area
 * board: it "cannot trigger a paid call" and shows the same numbers on every
 * visit until the census runs again.
 */

import express from 'express';
import { requires } from '../access.js';
import * as findings from '../repositories/censusFindings.js';
import { sweepOsm, sweepFhrs } from '../sources/groundCounts.js';

const router = express.Router();

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/**
 * The scope of a question about the census.
 *
 * An outcode, a list of them, or nothing at all — which means everywhere the
 * census has been, and is the honest default for a taxonomy decision: the whole
 * point of the run is that "golf clubs · 41 places" stops being a Berkshire
 * number.
 */
function scopeOf(req) {
  const raw = String(req.query.outcode ?? req.query.outcodes ?? '').trim();
  if (!raw) return { outcodes: null, label: 'everywhere censused' };
  const outcodes = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!outcodes.length) throw bad('an outcode scope needs at least one outcode');
  return { outcodes, label: outcodes.length === 1 ? outcodes[0] : `${outcodes.length} districts` };
}

/** Places per subcategory, with coverage, and why each drawer reads as it does. */
router.get('/subcategories', requires('view_library'), async (req, res, next) => {
  try {
    const { outcodes, label } = scopeOf(req);
    res.json({ scope: label, ...(await findings.subcategories({ outcodes })) });
  } catch (err) { next(err); }
});

/** Types that have never returned a place, and types no run has reached. */
router.get('/types', requires('view_library'), async (req, res, next) => {
  try {
    const { outcodes, label } = scopeOf(req);
    res.json({ scope: label, ...(await findings.silentTypes({ outcodes })) });
  } catch (err) { next(err); }
});

/** Where the census is furthest below what the free sources say is there. */
router.get('/gaps', requires('view_library'), async (req, res, next) => {
  try {
    const { outcodes, label } = scopeOf(req);
    const source = String(req.query.source ?? 'osm');
    res.json({ scope: label, ...(await findings.gaps({ outcodes, source })) });
  } catch (err) { next(err); }
});

/** What is still cut off at Google's ceiling, as a pacing signal. */
router.get('/saturation', requires('view_library'), async (req, res, next) => {
  try {
    const { outcodes, label } = scopeOf(req);
    res.json({ scope: label, ...(await findings.saturation({ outcodes })) });
  } catch (err) { next(err); }
});

/**
 * Ask the free sources about tiles the census has finished, now.
 *
 * `manage_library` rather than `view_library`: nothing here spends, but it does
 * make outbound calls to somebody else's machine, and that is a decision rather
 * than a page load. The loop in `server.js` does the same work slowly in the
 * background; this is for when a person wants the check on a particular area
 * before making a taxonomy decision about it.
 *
 * Bounded by time rather than by tiles, so the request answers rather than
 * hanging: what it did not reach this time, the loop will.
 */
router.post('/ground', requires('manage_library'), async (req, res, next) => {
  try {
    const source = String(req.body?.source ?? 'osm');
    if (!['osm', 'fhrs', 'both'].includes(source)) throw bad('the ground count is osm, fhrs or both');
    const tiles = Math.min(50, Math.max(1, Number(req.body?.tiles ?? 8)));
    const out = { costs: 'free' };
    if (source === 'osm' || source === 'both') out.osm = await sweepOsm({ limit: tiles, msBudget: 20_000 });
    if (source === 'fhrs' || source === 'both') out.fhrs = await sweepFhrs({ authorities: 1, msBudget: 20_000 });
    res.json(out);
  } catch (err) { next(err); }
});

/** The coverage of a scope on its own, for a screen that only needs the label. */
router.get('/coverage', requires('view_library'), async (req, res, next) => {
  try {
    const { outcodes, label } = scopeOf(req);
    res.json({ scope: label, coverage: await findings.coverageFor(outcodes) });
  } catch (err) { next(err); }
});

export default router;
