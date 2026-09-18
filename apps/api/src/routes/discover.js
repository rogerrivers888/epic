import { Router } from 'express';
import crypto from 'node:crypto';
import * as impressions from '../repositories/impressions.js';
import * as searchLog from '../repositories/searches.js';
import * as placeIndex from '../repositories/placeIndex.js';
import * as visitsRepo from '../repositories/visits.js';
import { searchAllSources } from '../sources/index.js';
import { deriveCatchment, detourMinutes, isTravelMode, reachRadiusKm, TRAVEL_MODES } from '../domain/travel.js';
import { applyConstraints } from '../domain/ranking.js';
import { paceOf, travelLimitFor } from '../domain/pace.js';
import { currentHousehold, loadMembers, toAttendees, loadLearnedPreferences } from './household.js';

const router = Router();

/**
 * Time-based discovery (Epic 3) with optional along-route search (Epic 4 C2).
 *
 * The search is bounded by a catchment — the area reachable in the stated time
 * by the stated mode — never by a radius. Attending members' allergens exclude;
 * their dislikes only rank.
 */
router.post('/', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const members = await loadMembers(household.id);

    const {
      origin,
      destination = null,
      maxTravelMinutes = household.max_travel_minutes,
      mode = 'driving',
      attendingMemberIds,
      categories = [],
      query: searchQuery = '',
      includeEvents = false,
      outingStart = null,
      excludeSeen = false,
      sources = [],
    } = req.body || {};

    if (!origin || typeof origin.lat !== 'number' || typeof origin.lng !== 'number') {
      return res.status(400).json({ error: 'origin_required', message: 'origin must carry lat and lng' });
    }
    if (!isTravelMode(mode)) {
      return res.status(400).json({ error: 'invalid_mode', message: `mode must be one of ${TRAVEL_MODES.join(', ')}` });
    }

    // Epic 1 C3 / M1 — with no explicit selection every member attends, and a
    // one-member household never has to answer the question at all.
    const attendingIds = Array.isArray(attendingMemberIds) && attendingMemberIds.length
      ? new Set(attendingMemberIds)
      : new Set(members.map((m) => m.id));
    const attendees = toAttendees(members.filter((m) => attendingIds.has(m.id)));

    const { venues, degraded, sourcesQueried, units } = await searchAllSources({
      center: origin,
      radiusKm: reachRadiusKm(mode, maxTravelMinutes),
      categories,
      query: searchQuery.trim(),
      includeEvents,
      outingStart,
      sources,
    });
    // Every browse is attributed, whichever sources ran (Technical Constraints §14); it used to log Tripadvisor only.
    await visitsRepo.recordProviderCall(household.id, sourcesQueried.join('+') || 'none', 'discover', units);

    const pace = paceOf(household);
    let inCatchment = deriveCatchment({ origin, maxTravelMinutes, mode, venues }).filter((v) => v.travelMinutes <= Math.max(maxTravelMinutes, travelLimitFor(pace, v)));

    if (destination?.lat != null) {
      inCatchment = inCatchment.map((venue) => ({
        ...venue,
        detourMinutes: detourMinutes({ origin, destination, venue, mode }),
      }));
    }

    // The place ledger holds identifiers only, so "somewhere different" is a
    // client-side filter over fresh results (Technical Constraints §13.1).
    let ledgerFiltered = 0;
    if (excludeSeen) {
      const seen = new Set(await impressions.seenRefs(household.id));
      const before = inCatchment.length;
      inCatchment = inCatchment.filter((v) => !seen.has(`${v.source}:${v.sourcePlaceId}`));
      ledgerFiltered = before - inCatchment.length;
    }

    const learned = await loadLearnedPreferences(household.id);
    const { candidates, excluded } = applyConstraints({ venues: inCatchment, attendees, learned });

    // Attribution logging, from the first day (Epic 2 C5, Technical Constraints §2).
    const queryId = crypto.randomUUID();
    await impressions.recordImpressions(household.id, queryId, candidates);

    // The search itself, written down. Until 17 Sep 2026 `queryId` was made here,
    // handed to the client and never stored, so the where, the filters, the
    // counts and the outcome died with the response — and none of it can be
    // backfilled. A search that returned nothing is logged as loudly as one that
    // returned forty, because that is the one worth knowing about.
    const where = await searchLog.whereOf({ lat: origin.lat, lng: origin.lng });
    await searchLog.noteSearch({
      id: queryId, householdId: household.id, accountId: req.account?.id ?? null,
      sessionId: req.session?.id ?? null, surface: 'find',
      ...where, lat: origin.lat, lng: origin.lng,
      radiusKm: reachRadiusKm(mode, maxTravelMinutes), mode, minutes: maxTravelMinutes,
      // Counts and our own words only — never a provider's label, and never the
      // free text somebody typed.
      asked: { categories, party: attendees.length, events: Boolean(includeEvents), excludeSeen: Boolean(excludeSeen), typed: Boolean(searchQuery.trim()) },
      subject: Array.isArray(categories) && categories.length === 1 ? String(categories[0]) : null,
      shownTotal: candidates.length,
      shown: Object.entries(candidates.reduce((acc, c) => { const k = c.source ?? 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).map(([source, n]) => ({ source, n })),
      sourcesQueried, degraded,
    });
    await searchLog.noteShown(queryId, candidates.map((c, i) => ({
      ref: `${c.source}:${c.sourcePlaceId}`, position: i + 1, source: c.source,
    })));

    // And into the index, which is defined as every place any source has ever
    // seen — the words on the board are "however little we hold about it".
    //
    // A place a provider returned and we put in front of a household is one a
    // source has seen. It was recorded only as an impression and a log row,
    // neither of which the rebuild reads, so it stayed out of Places until
    // somebody happened to save it — and coverage, the source counts and
    // Collect all under-reported exactly the identified places the index exists
    // to hold (Codex, 18 Sep 2026).
    //
    // The reference, where it is, and who returned it. Never a name: that is
    // rented, and `noteMany` has nowhere to put one anyway (CLAUDE.md).
    // Best-effort, like the log: a household's search is never worth failing
    // over bookkeeping.
    const seen = candidates
      .filter((c) => c.sourcePlaceId && c.lat != null && c.lng != null)
      .map((c) => ({
        ref: `${c.source}:${c.sourcePlaceId}`,
        lat: c.lat, lng: c.lng,
        sourceId: String(c.sourcePlaceId),
        countryCode: c.countryCode ?? null,
        sources: [...new Set([c.source, ...(c.contributingSources ?? [])])].filter(Boolean),
      }));
    if (seen.length) await placeIndex.noteMany(seen, { source: 'live' }).catch(() => null);

    res.json({
      queryId,
      catchment: {
        origin,
        destination,
        mode,
        maxTravelMinutes,
        // Never claim a derived isochrone we have not actually derived.
        method: 'estimated-from-distance',
        estimated: true,
        note: 'Travel times are estimated. A timetabled transit isochrone requires the provider in Technical Constraints §6.2.',
      },
      attending: attendees.map((a) => ({ id: a.id, name: a.name })),
      candidates,
      excluded,
      counts: {
        returned: candidates.length,
        excludedByAllergen: excluded.length,
        filteredByLedger: ledgerFiltered,
      },
      sourcesQueried,
      degradedSources: degraded,
      attribution: sourcesQueried,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * What the household did to one of the results.
 *
 * The click stream between "shown" and "saved" did not exist, so the second and
 * third of the three faults — shown things and clicked none, clicked and never
 * tripped — could not be told apart from each other or from a search nobody
 * made. `queryId` is the search's own id now, which is also what
 * `source_impressions.query_id` has always claimed to be.
 */
router.post('/event', async (req, res, next) => {
  try {
    const { queryId, kind, venueRef = null, position = null, dwellMs = null } = req.body || {};
    const KINDS = ['open', 'dismiss', 'save', 'shortlist', 'add_to_trip', 'refine', 'close'];
    if (!queryId || !KINDS.includes(kind)) {
      return res.status(400).json({ error: 'kind_required', message: `kind must be one of ${KINDS.join(', ')}` });
    }
    // Only against this household's own search (Codex, 17 Sep 2026).
    const household = await currentHousehold();
    // What actually happened, not that we tried. `logEvent` answers null when
    // the write failed or the search is not this household's, and saying `ok`
    // anyway meant the client marked the open as counted and would never send
    // it again — a transient failure undercounting clicks for good (Codex,
    // 18 Sep 2026). The log cannot be backfilled, so an unrecorded event is
    // gone unless the client can try again.
    const noted = await searchLog.logEvent({ searchId: queryId, kind, venueRef, position, dwellMs, householdId: household.id });
    res.json({ ok: Boolean(noted) });
  } catch (err) { next(err); }
});

/**
 * What the screen actually drew.
 *
 * The answer is a pool; the screen filters it and draws part of it. Only the
 * screen knows which part, so it says so — and until it does the log holds the
 * pool, which is the safe direction: an over-count is a search we thought we
 * answered, an under-count is a coverage hole that does not exist.
 */
router.post('/drawn', async (req, res, next) => {
  try {
    const { queryId, refs = [] } = req.body || {};
    if (!queryId) return res.status(400).json({ error: 'query_id_required', message: 'Which search.' });
    const kept = (Array.isArray(refs) ? refs : []).map(String).filter(Boolean).slice(0, 500);
    const household = await currentHousehold();
    res.json({ ok: await searchLog.noteDrawn({ searchId: queryId, householdId: household.id, refs: kept }) });
  } catch (err) { next(err); }
});

/**
 * Record that the household chose a candidate (Epic 2 C6). This is the other
 * half of source attribution — without a recorded selection there is never
 * evidence that a source influenced a real decision, and no grounds to drop it.
 */
router.post('/select', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const { queryId, venueKey, status = 'saved' } = req.body || {};
    if (!queryId || !venueKey) return res.status(400).json({ error: 'query_id_and_venue_key_required' });
    if (!['saved', 'dismissed', 'visited'].includes(status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }

    const rows = await impressions.markSelected(queryId, venueKey);
    // Nothing recorded until the selection is real.
    //
    // A valid search id with a stale or malformed venue key answered 404 and
    // still moved that search's outcome — an outcome for something that was
    // never selected (Codex, 17 Sep 2026). And it went in without the
    // household, so it skipped the ownership check `logEvent` does.
    if (!rows.length) return res.status(404).json({ error: 'impression_not_found' });
    // The same act, in the search log: a saved place is an outcome, and the
    // outcome only ever moves forward.
    await searchLog.logEvent({
      searchId: queryId, venueRef: venueKey, householdId: household.id,
      kind: status === 'saved' ? 'save' : status === 'dismissed' ? 'dismiss' : 'open',
    });
    await visitsRepo.recordLedger(household.id, rows[0].source, rows[0].source_place_id, status);
    res.json({ recorded: true, venueKey, status, sources: rows.map((r) => r.source) });
  } catch (err) {
    next(err);
  }
});

/** Which sources are earning their place. Reads the evidence Epic 2 requires. */
router.get('/source-value', async (_req, res, next) => {
  try {
    const rows = await impressions.sourceValue();
    res.json({
      sources: rows.map((r) => ({
        source: r.source,
        impressions: Number(r.impressions),
        selections: Number(r.selections),
        selectionRate: Number(r.impressions) ? Number(r.selections) / Number(r.impressions) : 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
