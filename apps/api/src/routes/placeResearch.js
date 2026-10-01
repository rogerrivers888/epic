/**
 * The Places explorer's two live-Google endpoints (owner, 29 Sep 2026), beside
 * the main Places router: "Research this place" (a streamed owned-data pipeline
 * for one place) and the ranked Google list (one live Text Search per
 * subcategory and area, its top twenty in Google's own order, paged).
 *
 * "Research this place" — the full owned-data pipeline for one place, now,
 * streamed to the page as it runs.
 *
 * The place page's "Ours beside theirs" tab already fills the Google column live
 * (routes/placeIndex.js `/place/compare`). This is the other button beside it:
 * it fills *our* column — the atlas/owned record — by running `sources/own.js`
 * `enrich` for this one place with `paid: true`, and streams which source it is
 * checking and what it found (open map, the venue's own page, Wikipedia,
 * Wikidata, the hygiene register), so the wait reads as work rather than a spinner.
 *
 * What it keeps and what it does not:
 *   · Everything the owned pipeline finds is ours and is kept — that is the
 *     point of the button (`place_records` / `place_facts`, via `enrich`).
 *   · Google is used only to identify the place and find its website, and its
 *     details and reviews are read **in memory for spotting** and never written
 *     down (owner, 29 Sep 2026; the data policy's licence line). The spotted
 *     candidates are offered to the verification hook, which answers them from
 *     owned sources — that answerer is a separate build, so today spotting is
 *     recorded as "read, verification pending" and nothing is stored from it.
 *
 * A device sign-in pressing the button is the household's approval for this one
 * place — no separate paid-hours grant (owner, 29 Sep 2026). It is still held to
 * the household's monthly Google bound and the collection ceiling: the worst-case
 * cost is reserved before a call goes out and the unspent part released after.
 *
 * Mounted under `/api/admin/place-index` beside the main Places router; it owns
 * its own leaf paths (`/research`, `/research/quote`) so nothing is shadowed.
 */

import express from 'express';
import { requires } from '../access.js';
import { query } from '../db.js';
import { currentHousehold } from './household.js';
import { enrich } from '../sources/own.js';
import { googleSource, rankedSlice } from '../sources/google.js';
import { matchesFor } from '../sources/providerMatch.js';
import { PRICE_PER_UNIT_USD, USD_TO_GBP } from '../domain/providerPrices.js';
import { roomToSpend, releaseSpend } from './placeIndex.js';
import { whySourceFailed } from '../sources/why.js';
import { recordProviderCall } from '../repositories/visits.js';

const router = express.Router();
const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });

/** Pence at the list price, to two places — the same arithmetic the rest of Places prices with. */
const gbpPence = (usd) => Math.round((Number(usd) || 0) * 100 * USD_TO_GBP * 100) / 100;
// A name and a type is a Pro call (Codex, 19 Sep 2026); a detail with reviews is
// the details tier. `enrich` buys at most two Pro requests — identify the place,
// find its page — and the reviews read for spotting are one details request.
const PRO_PENCE = gbpPence(PRICE_PER_UNIT_USD['google-pro']);
const DETAILS_PENCE = gbpPence(PRICE_PER_UNIT_USD['google-details']);
const money = (pence) => `£${(Math.max(0, pence) / 100).toFixed(2)}`;

/**
 * What researching this one place could spend, before the button is pressed.
 *
 * The worst case, minus what is plainly not needed: no identify call where we
 * already hold Google's id for the place, no page-finding call where we already
 * hold a website, and reviews read only where there is (or will be) an id to
 * read them by. Actual spend is often less — a place the free sources fully
 * identify never reaches the paid steps — so this is a ceiling, said as one.
 */
export async function quoteResearch(ref) {
  if (!googleSource.enabled()) return { pence: 0, off: true, breakdown: { identify: 0, findPage: 0, reviews: 0 } };
  const googleId = ref.startsWith('google:') ? ref.slice('google:'.length) : (await matchesFor([ref], 'google')).get(ref) ?? null;
  const { rows: [rec] } = await query('select website from place_records where venue_ref = $1', [ref]);
  const identify = googleId ? 0 : 1;              // one Pro call to work out which place this is
  const findPage = rec?.website ? 0 : 1;          // one Pro call to find their own page
  const reviews = (googleId || identify) ? 1 : 0; // one details call, read in memory for spotting
  const pence = Math.round(((identify + findPage) * PRO_PENCE + reviews * DETAILS_PENCE) * 100) / 100;
  return { pence, off: false, breakdown: { identify, findPage, reviews } };
}

/** One Server-Sent-Events frame: a named event and its JSON payload. */
export const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;

/**
 * The orchestration, with `run` and `google` injectable so it can be tested
 * without the network. `send(event, data)` writes one frame; it returns the
 * final research result.
 *
 * Order of events: `start`, then a `source` frame for every step the pipeline
 * reports (checking / found / nothing / failed), then `kept` (what our record
 * now holds), then — where there is a Google id — a `reviews` frame for the
 * in-memory spotting pass, then `done`. Any throw becomes a single `error` frame.
 */
export async function runResearchStream({ ref, householdId, sessionId, send, run = enrich, google = googleSource, recordCall = recordProviderCall } = {}) {
  send('start', { ref });
  // The pipeline itself, forced (the button means "look now"), paid, and allowed
  // its web search. Each source boundary is relayed straight to the page.
  const result = await run(ref, {
    householdId, sessionId, paid: true, search: true, force: true,
    onStep: (s) => send('source', s),
  });
  // What our record holds now — the fields that came back, as booleans, so the
  // atlas column can fill in without the page re-reading the record.
  send('kept', {
    state: result?.state ?? null,
    have: heldFrom(result?.fields ?? {}),
    problems: result?.problems ?? [],
  });

  // Google's details and reviews, read in memory for spotting — never stored.
  // Only where we have an id to read them by; and the candidates are handed to
  // the verification hook, which answers them from owned sources (a separate
  // build), so today this reports "read, verification pending".
  const googleId = ref.startsWith('google:') ? ref.slice('google:'.length) : (await matchesFor([ref], 'google').catch(() => new Map())).get(ref) ?? null;
  if (googleId && google.enabled?.()) {
    send('source', { source: 'reviews', state: 'checking' });
    const meter = {};
    try {
      const detail = await google.get(googleId, { meter });
      const reviews = Array.isArray(detail?.reviews) ? detail.reviews.length : 0;
      const hasSummary = Boolean(detail?.reviewSummary || detail?.aiSummary);
      // Spotting only: nothing from here is written down. The candidates would
      // be offered to the answerer here; it is a separate build, so the step
      // says so rather than pretending to have verified anything.
      send('source', { source: 'reviews', state: 'found', read: reviews, summary: hasSummary, verification: 'pending' });
    } catch (err) {
      send('source', { source: 'reviews', state: 'failed', why: whySourceFailed('google', err) });
    } finally {
      // The call is on the ledger whether or not it answered — it still went out.
      if (Object.keys(meter).length) await recordCall(householdId, 'google', 'admin.places.research.reviews', meter, `google:${googleId}`).catch(() => null);
    }
  }

  send('done', { state: result?.state ?? null });
  return result;
}

/** Which owned facts the record now holds, as booleans a screen can tick. */
function heldFrom(fields = {}) {
  const has = (k) => fields[k] != null && fields[k] !== '' && !(Array.isArray(fields[k]) && fields[k].length === 0);
  return {
    name: has('name'), what_it_is: has('summary'), where_to_go: has('address') || has('postcode') || has('lat'),
    hours: has('opening_hours'), website: has('website'), phone: has('phone'),
    menu: has('menu_url'), picture: has('image_url'), hygiene: has('fsa_rating'),
  };
}

/** GET /research/quote?ref= — what pressing the button could spend. */
router.get('/research/quote', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.');
    const q = await quoteResearch(ref);
    res.json({ ...q, human: q.off ? 'Google is not switched on here.' : `about ${money(q.pence)}` });
  } catch (err) { next(err); }
});

/**
 * POST /research?ref= — run the pipeline for this place and stream it.
 *
 * `manage_library`, because it spends. The worst-case cost is reserved against
 * the collection ceiling before any call, and the unspent part is released the
 * moment the run ends. The stream is a POST so it carries the caller's own token
 * (an EventSource cannot), which is also the sign-in the paid gate reads as the
 * household's approval for this one place.
 */
router.post('/research', requires('manage_library'), async (req, res, next) => {
  const ref = String(req.query.ref ?? req.body?.ref ?? '').trim();
  if (!ref) return next(bad('Which place? Pass its ref.'));
  let household;
  try {
    household = await currentHousehold();
    const { rows: [pi] } = await query('select venue_ref from place_index where venue_ref = $1', [ref]);
    if (!pi) return res.status(404).json({ error: 'not_indexed', message: 'Nothing indexed under that ref yet.' });
  } catch (err) { return next(err); }

  // Reserve the worst case before a call goes out; a run over the ceiling is
  // refused whole rather than half-done.
  const quote = await quoteResearch(ref);
  const room = await roomToSpend(Math.ceil(quote.pence), { holder: 'research' });
  if (!room.ok) {
    return res.status(422).json({
      error: 'over_the_ceiling',
      message: `That could spend ${money(quote.pence)} and there is ${money(room.leftPence)} left of this month's ${money(room.ceilingPence)}.`,
    });
  }

  // From here the answer is a stream. Headers first, then frames; the proxy is
  // told not to buffer (the same as the shortlist search stream).
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();
  const send = (event, data) => { if (!res.writableEnded) res.write(sse(event, data)); };
  // A heartbeat so a proxy does not close a quiet connection while a slow source
  // is being read.
  const beat = setInterval(() => send('waiting', { at: Date.now() }), 5000);
  try {
    await runResearchStream({ ref, householdId: household.id, sessionId: req.session?.id ?? null, send });
  } catch (err) {
    send('error', { message: err?.message ? String(err.message).slice(0, 200) : 'Research could not finish.', status: err?.status ?? 500 });
  } finally {
    clearInterval(beat);
    await releaseSpend(room.reservation);
    if (!res.writableEnded) res.end();
  }
});

// ---------------------------------------------------------------------------
// the ranked Google list
// ---------------------------------------------------------------------------

// One Text Search is one Pro request whatever it returns, so a page of twenty
// costs the same as a page of one.
const RANKED_PENCE = PRO_PENCE;

/**
 * A rectangle around a point, the same arithmetic `examplesOfType` uses in
 * google.js. We take a centre and a radius rather than a scope's reach ring on
 * purpose (agreed with the Places-index owner, 29 Sep 2026): the boards resolve
 * a ring to reachable places from the travel-time matrix, not to a rectangle, so
 * a bounding box is a looser, different shape — it must not be dressed up as the
 * ring. The frontend passes the area/viewport it is already showing.
 */
export function rectFromCenter({ lat, lng, radiusKm = 30 }) {
  const km = Math.min(Math.max(Number(radiusKm) || 30, 1), 50);
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180) || 1);
  return { minLat: lat - dLat, minLng: lng - dLng, maxLat: lat + dLat, maxLng: lng + dLng };
}

/**
 * Google's top twenty for this subcategory around this point, numbered from
 * `from` so "Next 20" carries on the count rather than restarting it. `slice`
 * is injectable for tests. Names are rented — returned for the screen, never
 * written down.
 */
export async function runRanked({ lat, lng, radiusKm = 30, query = null, includedType = null, from = 0, pageToken = null, slice = rankedSlice, meter = null } = {}) {
  const box = rectFromCenter({ lat, lng, radiusKm });
  const out = await slice({ box, includedType: includedType || null, query: query || null, pageToken: pageToken || null, meter });
  const places = (out.places || []).map((p, i) => ({ rank: from + i + 1, id: p.id, name: p.name ?? null, primaryType: p.primaryType ?? null }));
  return { places, nextPageToken: out.nextPageToken ?? null, requests: out.requests ?? 0, problem: out.problem ?? null };
}

/** GET /ranked/quote — what one page of the ranked list costs. */
router.get('/ranked/quote', requires('view_library'), (_req, res) => {
  const off = !googleSource.enabled();
  res.json({ pence: off ? 0 : RANKED_PENCE, off, human: off ? 'Google is not switched on here.' : `about ${money(RANKED_PENCE)} for twenty` });
});

/**
 * GET /ranked — one live Text Search: Google's top twenty for a subcategory
 * around a point, in its own order, "Next 20" via the returned page token.
 *
 * `manage_library`, because it spends; one Pro request is reserved before the
 * call and released after. Pass `lat`/`lng` (+ `radiusKm`), and either `type`
 * (a Google Table-A type) or `q` (the subcategory's search words); `from` is the
 * running number so the numbering does not restart on the next page, and
 * `pageToken` is Google's own next-page token.
 */
router.get('/ranked', requires('manage_library'), async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('Where? Pass ?lat=&lng= for the area.');
    if (!googleSource.enabled()) {
      return res.status(422).json({ error: 'not_switched_on', message: 'Google is not switched on here. The key is the owner\'s to add in Doppler.' });
    }
    const radiusKm = Number(req.query.radiusKm) || 30;
    const query = req.query.q ? String(req.query.q) : null;
    const includedType = req.query.type ? String(req.query.type) : null;
    const from = Math.max(0, Math.trunc(Number(req.query.from)) || 0);
    const pageToken = req.query.pageToken ? String(req.query.pageToken) : null;

    const room = await roomToSpend(Math.ceil(RANKED_PENCE), { holder: 'ranked' });
    if (!room.ok) {
      return res.status(422).json({
        error: 'over_the_ceiling',
        message: `That would spend ${money(RANKED_PENCE)} and there is ${money(room.leftPence)} left of this month's ${money(room.ceilingPence)}.`,
      });
    }
    const meter = {};
    try {
      const household = await currentHousehold();
      const out = await runRanked({ lat, lng, radiusKm, query, includedType, from, pageToken, meter });
      if (Object.keys(meter).length) await recordProviderCall(household.id, 'google', 'admin.places.ranked', meter, null).catch(() => null);
      res.json({ ...out, from });
    } finally {
      await releaseSpend(room.reservation);
    }
  } catch (err) { next(err); }
});

export default router;
