/**
 * The score, with its working shown.
 *
 * Owner, 17 Sep 2026: "I thought we were going to be taking all the providers'
 * stars and come up with our own rating, which we can retain. I should be able
 * to then run an order of how that's calculated, even if that means hitting the
 * same APIs again to recalculate it. Show me the calculation logic."
 *
 * Two reads. `/weights` is the arithmetic itself — every constant in
 * `domain/scoring.js`, read out of the module rather than retyped into a screen,
 * because a weight that can drift from the code is worse than no screen at all.
 * `/?ref=` is one place: what went in, what each part was worth, what it
 * contributed, and the two numbers out.
 *
 * What is deliberately absent: a provider's star rating. It is turned into one
 * of four words at the moment of the call and the figure is discarded there
 * (`crowdBand`), so "what the crowd said" reads `top` on this screen and there
 * is nothing behind it to show. That is not a gap in the screen; it is the
 * licence, and `ownedScore` — the same ranking with the crowd taken out
 * entirely — is the column that proves Epic's ordering does not depend on it.
 */

import express from 'express';
import { requires } from '../access.js';
import { workings } from '../domain/scoring.js';
import { scoringInputsFor } from '../repositories/scout.js';
import { chainScale } from '../domain/chains.js';

const router = express.Router();

/** The arithmetic, as constants. Free, and the same numbers the code uses. */
router.get('/weights', requires('view_library'), async (req, res, next) => {
  try {
    // Asked of an empty place, because `workings` carries the weights whatever
    // it is given and inventing a plausible place to read them off would be a
    // second source of truth.
    res.json({ weights: workings({}).weights });
  } catch (err) { next(err); }
});

/**
 * GET /?ref= — one place's score, and how it got there.
 *
 * A place the sweep has never scored still answers: the parts it has evidence
 * for are worked out and the rest are marked as not held, which is the more
 * useful reading anyway — "this is 3.1 because we know four things about it"
 * is the sentence the whole screen exists to make possible.
 */
router.get('/', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw Object.assign(new Error('Which place? Pass its ref.'), { status: 400, code: 'ref_required' });
    const row = await scoringInputsFor(ref);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Nothing held for that ref — it has not been swept or claimed.' });

    const name = row.record_name ?? row.sweep_name ?? null;
    // The scale the sweep stored, not one re-derived here: a national group
    // whose name the list does not know would come back as a small chain and be
    // weighted differently from the score this page is meant to explain.
    const scale = row.chain_scale ?? chainScale({ name, sites: row.sites ?? (row.chain ? 2 : 1) }).scale;
    const input = {
      crowd: row.crowd_band, count: row.count_band,
      accolades: row.accolades ?? [],
      menuItems: row.menu_state === 'read' ? (row.item_count ?? 0) : 0,
      cuisines: row.record_cuisines?.length ? row.record_cuisines : (row.sweep_cuisines ?? []),
      // The sweep's own website first, because `rescore()` reads
      // `scout_places.website` and this page has to explain the score that was
      // actually calculated — not a better one it could have had. An owned
      // record's website is the answer only for a place the sweep never saw.
      website: row.sweep_website ?? row.record_website ?? null,
      summary: row.summary, openingHours: row.opening_hours,
      chainScale: scale,
    };
    const out = workings(input);
    res.json({
      ref, name,
      ...out,
      // What is on the row against what this recalculation says. They differ
      // whenever a menu has been read or an accolade found since the sweep, and
      // that difference is the reason `rescore` exists and is free.
      stored: { epicScore: row.epic_score, ownedScore: row.owned_score, at: row.scored_at },
      drifted: row.epic_score != null && Math.abs(row.epic_score - out.epicScore) >= 0.1,
      area: row.area_code ?? null,
    });
  } catch (err) { next(err); }
});

export default router;
