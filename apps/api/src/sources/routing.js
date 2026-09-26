import { bump, noteFault } from './meter.js';
import { sourceOff } from './switches.js';
import { admitPaid } from './paidGate.js';
import { wallClock, wallToUtc } from '../domain/time.js';
// Real travel times via the Google Routes API, with the distance-based
// estimate as the fallback when there is no key (domain/travel.js).
//
// Two calls are used: a route matrix for "how long from the base to each
// candidate" (one request, many elements) and a single route for the journey
// from home to the base, which also yields the polyline for search-along-route.
// Nothing is stored beyond the session; Google's terms forbid caching results.

const KEY = () => process.env.GOOGLE_MAPS_API_KEY?.trim();
const ROUTES = 'https://routes.googleapis.com';

const MODE = { driving: 'DRIVE', walking: 'WALK', cycling: 'BICYCLE', transit: 'TRANSIT' };

// ---------------------------------------------------------------------------
// The day's quota, once it is gone (owner, 4 Sep 2026: "we've already breached
// the API calls for Google Routes, and we need to wait for a data pass").
//
// Google answers an exhausted quota with 429 RESOURCE_EXHAUSTED, and there is
// nothing to do about it until the quota resets — which for a daily one is
// midnight Pacific, whatever timezone the household is in. So the first refusal
// stops every caller asking again until then: no screen waits on a call that
// cannot succeed, and no more requests are spent finding that out. Every caller
// already falls back to the distance estimate and says that it has.
//
// The pause is per method, because the quotas are: a spent route matrix must
// not take the Directions drawer down with it.
// ---------------------------------------------------------------------------
const QUOTA_TZ = 'America/Los_Angeles';
const MATRIX = '/distanceMatrix/v2:computeRouteMatrix';
const ROUTE = '/directions/v2:computeRoutes';
const exhausted = new Map();

// A refusal does not say which quota was hit. A per-minute one passes in
// moments; a daily one lasts until midnight Pacific. So the wait starts short
// and lengthens each time it is refused again — a minute's limit costs one
// wasted call, a day's costs a handful — and never runs past the daily reset.
const BACKOFF_MINUTES = (process.env.EPIC_ROUTES_BACKOFF || '5,15,60,240').split(',').map((n) => Number(n.trim())).filter((n) => n > 0);

/** When a daily quota next resets, as an instant. */
function nextQuotaReset(now = new Date()) {
  const there = wallClock(now, QUOTA_TZ);
  const tomorrow = new Date(new Date(`${there.dateStr}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return wallToUtc(tomorrow, '00:00', QUOTA_TZ);
}

/**
 * Null when this method is available; otherwise when it is expected back.
 * `method` is 'matrix' (how long to each of these places) or 'route' (one
 * journey, and the directions drawer).
 */
export function routingPaused(method = 'matrix') {
  const path = method === 'route' ? ROUTE : MATRIX;
  const state = exhausted.get(path);
  if (!state) return null;
  // The wait is over: the next call tries, and its outcome decides whether the
  // wait starts again longer or the count goes back to nothing.
  if (Date.now() >= state.until.getTime()) return null;
  return { until: state.until.toISOString(), reason: 'quota', method, refusals: state.refusals };
}

/** For an owner who has raised the quota and wants it tried again now. */
export const resumeRouting = () => exhausted.clear();

const isExhausted = (status, body) => status === 429 || /RESOURCE_EXHAUSTED/.test(String(body));
function pause(path) {
  const previous = exhausted.get(path);
  const refusals = (previous && Date.now() < previous.until.getTime() + 3600_000 ? previous.refusals : 0) + 1;
  const wait = BACKOFF_MINUTES[Math.min(refusals - 1, BACKOFF_MINUTES.length - 1)];
  const reset = nextQuotaReset();
  const until = new Date(Math.min(Date.now() + wait * 60_000, reset.getTime()));
  exhausted.set(path, { until, refusals });
  console.warn(`Google Routes: quota refused ${path} (${refusals} in a row); not asking again for ${wait} min, until ${until.toISOString()}`);
  return new Error('Google Routes has no quota left just now — travel times are worked out from the distance until it lets us back in.');
}

/** A call that worked means the quota is back: the wait starts from nothing again. */
const clearPause = (path) => { if (exhausted.has(path)) exhausted.delete(path); };

/**
 * Whether Routes may be asked at all: a key, and Google not switched off in
 * Settings › Providers. Routes is billed to the same Google account and sits
 * under the same switch (owner, 26 Sep 2026: "Routes gets the same cap and
 * Settings switch"); every caller already falls back to the distance estimate
 * when this is false. Quota is a separate question: routingPaused().
 */
export const routingEnabled = () => Boolean(KEY()) && !sourceOff('google');

/**
 * `elements` is what Google bills this request for — one a journey, one per
 * origin × destination pair in a matrix — and what the household's Google
 * bound is charged. Refused at the same door as Places (sources/paidGate.js):
 * a household and a signed-in session, or nothing goes out.
 */
async function post(path, body, fieldMask, { elements = 1, meter = null } = {}) {
  if (sourceOff('google')) { noteFault(meter, 'switched_off'); throw Object.assign(new Error('Google is switched off in Settings › Providers'), { code: 'switched_off' }); }
  if (routingPaused(path === ROUTE ? 'route' : 'matrix')) throw new Error('Google Routes has no quota left today — travel times are worked out from the distance until it resets.');
  await admitPaid({ meter, requests: elements });
  // On the meter once it is admitted, so a refused request is not counted as one Google billed.
  bump(meter, 'google-routes', elements);
  // A caller with no meter writes no ledger row, and a request admitted into
  // this process's count alone is forgotten at the next deploy — the bound
  // would then let the month run past it (Codex, 26 Sep 2026). So the door
  // writes that row itself, against whoever it admitted.
  if (!meter) await recordUnmetered(elements);
  const res = await fetch(`${ROUTES}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': fieldMask },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (isExhausted(res.status, text)) throw pause(path);
    throw new Error(`Google Routes ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // A spent quota also arrives as a 200 whose rows carry an error instead of a
  // route, so the body has to be read as well as the status.
  // Even one row carrying RESOURCE_EXHAUSTED means the quota answered, not the
  // road: a matrix can come back 200 with its elements refused one by one.
  if (Array.isArray(data) && data.some((r) => r?.error) && isExhausted(null, JSON.stringify(data).slice(0, 4000))) throw pause(path);
  clearPause(path);
  return data;
}

async function recordUnmetered(elements) {
  const [{ record }, { currentSpender }] = await Promise.all([import('../repositories/providerCalls.js'), import('../context.js')]);
  const { householdId, sessionId } = currentSpender();
  await record(householdId, 'google-routes', 'routes.unmetered', { 'google-routes': elements }, sessionId).catch(() => null);
}

const wp = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
const secondsToMinutes = (s) => Math.round(Number(String(s || '0s').replace('s', '')) / 60);

/**
 * Minutes for every origin × destination pair, in the given mode, at departAt.
 * Returns rows[origin][destination], null where no route exists. Billed per
 * element, so the caller keeps the two sides small.
 */
export async function routeMatrixMinutes({ origins, destinations, mode = 'driving', departAt = null, meter = null }) {
  if (!routingEnabled() || routingPaused('matrix') || !origins.length || !destinations.length) return null;
  const out = origins.map(() => new Array(destinations.length).fill(null));
  // The matrix allows up to 625 elements; keep batches small so one failure is cheap.
  const perBatch = Math.max(1, Math.floor(100 / origins.length));
  for (let i = 0; i < destinations.length; i += perBatch) {
    const batch = destinations.slice(i, i + perBatch);
    const body = {
      origins: origins.map((o) => ({ waypoint: wp(o) })),
      destinations: batch.map((d) => ({ waypoint: wp(d) })),
      travelMode: MODE[mode] || 'DRIVE',
      ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
      ...(departAt && new Date(departAt) > new Date() ? { departureTime: new Date(departAt).toISOString() } : {}),
    };
    // Billed per origin × destination element, and counted as it is admitted.
    const rows = await post('/distanceMatrix/v2:computeRouteMatrix', body, 'originIndex,destinationIndex,duration,distanceMeters,condition', { elements: batch.length * origins.length, meter });
    for (const r of rows) {
      // A zero index is left out of the JSON, so both must be read as optional:
      // reading destinationIndex as undefined silently dropped every first column.
      if (r.condition === 'ROUTE_EXISTS') out[r.originIndex ?? 0][i + (r.destinationIndex ?? 0)] = { minutes: secondsToMinutes(r.duration), meters: r.distanceMeters ?? null };
    }
  }
  return out;
}

/** Minutes from one origin to many destinations. Null entries where no route. */
export async function travelMatrixMinutes({ origin, destinations, mode = 'driving', departAt = null, meter = null }) {
  const rows = await routeMatrixMinutes({ origins: [origin], destinations, mode, departAt, meter });
  return rows ? rows[0] : null;
}

/** One journey: minutes, distance and the encoded polyline (for search-along-route). */
export async function routeBetween({ from, to, mode = 'driving', departAt = null, meter = null }) {
  if (!routingEnabled() || routingPaused('route')) return null;
  const body = {
    origin: wp(from), destination: wp(to), travelMode: MODE[mode] || 'DRIVE',
    ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    ...(departAt && new Date(departAt) > new Date() ? { departureTime: new Date(departAt).toISOString() } : {}),
    ...(mode === 'transit' ? { transitPreferences: { routingPreference: 'FEWER_TRANSFERS' } } : {}),
  };
  const data = await post('/directions/v2:computeRoutes', body, 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline', { meter });
  const r = data.routes?.[0];
  return r ? { minutes: secondsToMinutes(r.duration), meters: r.distanceMeters ?? null, encodedPolyline: r.polyline?.encodedPolyline ?? null, estimated: false } : null;
}

/**
 * Step-by-step directions for one leg, for the trip's "Directions" drawer:
 * walking turns, driving, or public transport with the line, headsign, stops
 * and departure time. Fetched when the drawer opens, never stored.
 */
export async function directions({ from, to, mode = 'walking', departAt = null, meter = null }) {
  if (!routingEnabled() || routingPaused('route')) return null;
  const body = {
    origin: wp(from), destination: wp(to), travelMode: MODE[mode] || 'WALK',
    ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    ...(departAt && new Date(departAt) > new Date() ? { departureTime: new Date(departAt).toISOString() } : {}),
    ...(mode === 'transit' ? { transitPreferences: { routingPreference: 'FEWER_TRANSFERS' } } : {}),
  };
  const mask = [
    'routes.duration', 'routes.distanceMeters', 'routes.polyline.encodedPolyline',
    'routes.legs.steps.navigationInstruction.instructions', 'routes.legs.steps.distanceMeters', 'routes.legs.steps.staticDuration', 'routes.legs.steps.travelMode',
    'routes.legs.steps.transitDetails.stopDetails', 'routes.legs.steps.transitDetails.localizedValues', 'routes.legs.steps.transitDetails.headsign',
    'routes.legs.steps.transitDetails.transitLine', 'routes.legs.steps.transitDetails.stopCount',
  ].join(',');
  const data = await post('/directions/v2:computeRoutes', body, mask, { meter });
  const r = data.routes?.[0];
  if (!r) return null;
  const steps = (r.legs || []).flatMap((leg) => leg.steps || []).map((s) => {
    const t = s.transitDetails;
    const line = t?.transitLine;
    return {
      text: s.navigationInstruction?.instructions ?? (t ? `${line?.vehicle?.name?.text ?? 'Transit'} towards ${t.headsign ?? ''}`.trim() : ''),
      minutes: secondsToMinutes(s.staticDuration), meters: s.distanceMeters ?? null, travelMode: (s.travelMode || 'WALK').toLowerCase(),
      transit: t ? {
        line: line?.nameShort || line?.name || null, agency: line?.agencies?.[0]?.name ?? null, vehicle: line?.vehicle?.name?.text ?? null, color: line?.color ?? null, textColor: line?.textColor ?? null,
        headsign: t.headsign ?? null, stopCount: t.stopCount ?? null,
        from: t.stopDetails?.departureStop?.name ?? null, to: t.stopDetails?.arrivalStop?.name ?? null,
        departs: t.localizedValues?.departureTime?.time?.text ?? null, arrives: t.localizedValues?.arrivalTime?.time?.text ?? null,
      } : null,
    };
  });
  return { minutes: secondsToMinutes(r.duration), meters: r.distanceMeters ?? null, encodedPolyline: r.polyline?.encodedPolyline ?? null, steps, estimated: false };
}
