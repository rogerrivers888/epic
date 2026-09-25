/**
 * Reach — the map worked out once, and read for ever after.
 *
 * Owner, 17 Sep 2026: "We could calculate the distance to all the other
 * postcodes within a 30-minute or 60-minute distance… instead of having to do
 * map distance calculations every time someone does a search, we will already
 * hold and know instantly which activities are within their particular area.
 * Please let me know whether that's doable."
 *
 * It is, and this is it. Three writes and three reads, behind the admin door.
 * The writes are slow and are the owner's to start; the reads are the point,
 * and answer from one index with no arithmetic in them at all.
 *
 * What this is not: a routing service. The times here are Epic's own estimate
 * from straight-line distance and a per-mode speed profile — the same function
 * every list in the app is already fenced with, deliberately, because a matrix
 * that disagreed with the fence would offer a place the next pass then threw
 * away. `method` on every row says `estimate`, and when a real road-network
 * build replaces a region's rows it will say `osrm` instead and the screens can
 * say which they are looking at.
 */

import express from 'express';
import { requires } from '../access.js';
import { CAP_MINUTES, EDGE_MINUTES, HORIZON_MINUTES, labelOf, sectorOf } from '../domain/reach.js';
import { travelMode } from '../domain/travel.js';
import * as reach from '../repositories/reach.js';
import { refreshAllBefore as recountRingsBefore } from '../repositories/ringTables.js';
import { query } from '../db.js';

const router = express.Router();

const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });

/**
 * What has been built.
 *
 * `needsRebuild` names the modes whose rows are short — built before the edge
 * allowance existed, or built before cells were added. It is said rather than
 * acted on: rebuilding is minutes of work over every cell, and doing it inside
 * somebody's read would turn one slow page into a stampede of them.
 */
router.get('/', requires('view_library'), async (req, res, next) => {
  try {
    res.json({ ...(await reach.state()), capMinutes: CAP_MINUTES, horizonMinutes: HORIZON_MINUTES, edgeMinutes: EDGE_MINUTES });
  } catch (err) { next(err); }
});

/**
 * GET /at?lat=&lng= — which cell a point falls in.
 *
 * Answers with the nearest cell we hold rather than nothing, because cells are
 * discovered from the places we have indexed: somewhere we know no places at
 * all has no sector of its own yet, and the honest answer is the nearest one we
 * do know with the distance to it said out loud.
 */
router.get('/at', requires('view_library'), async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('Pass lat and lng.');
    const cell = await reach.cellAt({ lat, lng });
    if (!cell) return res.status(404).json({ error: 'no_cell', message: 'No cell within 25 km of there yet — nothing has been indexed nearby.' });
    res.json({ cell: cell.code, label: labelOf(cell.code), km: cell.km, places: cell.places, exact: cell.km < 1 });
  } catch (err) { next(err); }
});

/**
 * GET /from?cell=&minutes=&mode= — everything within reach, and what is in it.
 *
 * `?places=1` joins through to the refs, which is what a search would do. Left
 * off by default because the cell list alone is what a count wants and it is
 * a thousand times smaller.
 */
router.get('/from', requires('view_library'), async (req, res, next) => {
  try {
    const cell = String(req.query.cell ?? '').trim();
    if (!cell) throw bad('Which cell? Pass one from /at.');
    const minutes = Math.min(CAP_MINUTES, Math.max(1, Number(req.query.minutes) || 30));
    // The screens say `drive` and `walk`; the table holds `driving` and
    // `walking`. Normalised here so a mode the app uses never comes back empty.
    const mode = travelMode(req.query.mode ?? 'driving');
    const cells = await reach.reachableCells(cell, { minutes, mode });
    const places = req.query.places === '1' ? await reach.placesWithin(cell, { minutes, mode }) : null;
    res.json({
      cell, label: labelOf(cell), minutes, mode,
      cells: cells.map((c) => ({ cell: c.to_cell, label: labelOf(c.to_cell), minutes: c.minutes, km: c.km })),
      counts: { cells: cells.length, places: places?.length ?? null },
      places: places?.map((p) => ({ ref: p.venue_ref, cell: p.cell, minutes: p.minutes })) ?? null,
      estimated: true,
      // Said out loud because the count is deliberately a little generous: the
      // matrix looks five minutes past what was asked so that a place at the
      // edge of its sector is offered, and the exact pass then fences it.
      edgeMinutes: EDGE_MINUTES,
      note: 'Travel times are estimated from distance, not routed, and the ring is widened by a few minutes so places at the edge of a postcode sector are not lost. The matrix is the filter; a list is still ordered by the exact distance to each place.',
    });
  } catch (err) { next(err); }
});

/** GET /sector?postcode= — the sector a postcode belongs to. Free, and pure. */
router.get('/sector', requires('view_library'), async (req, res, next) => {
  try {
    const sector = sectorOf(String(req.query.postcode ?? ''));
    if (!sector) throw bad('That is not a postcode we can read.');
    res.json({ sector, cell: `sector:${sector}` });
  } catch (err) { next(err); }
});

/**
 * POST /stamp — give every place we hold a postcode, and therefore a cell.
 *
 * In the background, because a full pass over the estate outlives the gateway:
 * the sweep learned this the hard way (14 Sep 2026) and the answer is the same
 * one. Resumable, so the deploy that interrupts it costs nothing.
 */
router.post('/stamp', requires('manage_library'), async (req, res, next) => {
  try {
    const limit = Math.min(50_000, Math.max(1, Number(req.body?.limit) || 2000));
    if (req.body?.wait === true) return res.json(await reach.stampPlaces({ limit }));
    res.json({ started: true, limit });
    void reach.stampPlaces({ limit }).catch(() => null);
  } catch (err) { next(err); }
});

/**
 * POST /refresh — bring the matrix up to date without rebuilding it.
 *
 * What a sweep leaves behind: a few hundred new places, a handful of new
 * sectors. This stamps them and works out only the cells that have no
 * neighbours yet, which is seconds rather than minutes. The sweep calls it
 * itself; this is here so it can be run by hand when something has gone in by
 * another door.
 */
router.post('/refresh', requires('manage_library'), async (req, res, next) => {
  try {
    const mode = travelMode(req.body?.mode ?? 'driving');
    if (req.body?.wait === true) return res.json(await reach.refresh({ mode }));
    res.json({ started: true, mode });
    void reach.refresh({ mode }).catch(() => null);
  } catch (err) { next(err); }
});

/**
 * POST /rings/refresh — count every ring again, by hand. What the matrix
 * refresh does by itself when it builds cells (repositories/reach.js), and
 * what the census does when a run finishes; here for when the census or the
 * sector table has moved by another door.
 */
router.post('/rings/refresh', requires('manage_library'), async (req, res, next) => {
  try {
    const { rows: [{ at }] } = await query('select now() as at');
    if (req.body?.wait === true) {
      const done = await recountRingsBefore({ before: at });
      return res.json({ rings: done.length, failed: done.filter((d) => d.error).length });
    }
    res.json({ started: true });
    void recountRingsBefore({ before: at }).catch(() => null);
  } catch (err) { next(err); }
});

/**
 * POST /build — work the matrix out.
 *
 * No network and no provider spend: it is arithmetic over the cells, and it can
 * be run as often as anybody likes. Rebuilt from scratch rather than patched,
 * so a cell added yesterday is not quietly missing from everybody else's
 * neighbours.
 */
router.post('/build', requires('manage_library'), async (req, res, next) => {
  try {
    // Built to the horizon rather than to the cap: the matrix has to hold the
    // edge allowance or the allowance does nothing at ninety minutes.
    const capMinutes = Math.min(180, Math.max(5, Number(req.body?.capMinutes) || HORIZON_MINUTES));
    const mode = travelMode(req.body?.mode ?? 'driving');
    if (req.body?.wait === true) return res.json(await reach.buildMatrix({ mode, capMinutes }));
    res.json({ started: true, mode, capMinutes });
    void reach.buildMatrix({ mode, capMinutes }).catch(() => null);
  } catch (err) { next(err); }
});

export default router;
