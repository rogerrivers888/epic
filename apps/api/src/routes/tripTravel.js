/**
 * Getting there (trip rebuild, 7 Sep 2026, screen 5d).
 *
 * One screen per trip: a mode strip — Fly · Train · Drive · Ferry — over an
 * outbound leg and a return one, and beneath them the transfer from the far
 * terminal to the bed. Everything derived is derived here and nothing derived
 * is stored, so moving the flight moves "leave home by 05:20" with it.
 *
 * No provider is called that costs anything. The airline comes from the IATA
 * register, the airports from the open map, the drive from Epic's own
 * arithmetic, and the times from the household's booking — which is what
 * `sources/flights.js` says out loud rather than pretending to a schedule.
 */

import { Router } from 'express';
import * as trips from '../repositories/trips.js';
import * as travel from '../repositories/tripTravel.js';
import { currentHousehold } from './household.js';
import { estimateTravelMinutes } from '../domain/travel.js';
import {
  airportByCode, leaveHomeBy, money, publicTerminal, resolveFlight, scheduleProvider,
  terminalByName, transferEstimates, parseFlightNumber, airlineName, TRANSFER_LIMIT_KM,
} from '../sources/flights.js';
import { nightsOf } from './trips.js';
import { directions, routingEnabled } from '../sources/routing.js';
import { kmBetween } from '../domain/travel.js';
import { wallToUtc, DEFAULT_TZ } from '../domain/time.js';

const router = Router();

const bad = (res, code, message) => res.status(400).json({ error: code, message });

async function ownTrip(req) {
  const household = await currentHousehold();
  const trip = await trips.tripOfHouseholdFull(req.params.id, household.id);
  if (!trip) { const err = new Error('Trip not found'); err.status = 404; err.code = 'trip_not_found'; throw err; }
  return { household, trip };
}

const hhmm = (v) => (v == null || v === '' ? null : String(v).slice(0, 5));
const homeOf = (h) => (h.home_lat != null ? { label: h.home_label, lat: h.home_lat, lng: h.home_lng } : null);

/**
 * The whole answer for the Getting there screen: both legs, both drawn out with
 * their derived lines, and the three transfer estimates.
 */
export async function travelPayload(trip, household) {
  const [legs, transfers, party] = await Promise.all([
    travel.legsOf(trip.id), travel.transfersOf(trip.id), trips.partyOf(trip.id),
  ]);
  const home = homeOf(household);
  const outbound = legs.find((l) => l.direction === 'outbound');
  const arrival = outbound?.to_code ? await travelRow(outbound.to_code) : null;
  const bed = trip.base_lat != null ? { lat: trip.base_lat, lng: trip.base_lng } : null;

  const drawn = await Promise.all(legs.map(async (l) => {
    const [from, to] = await Promise.all([
      l.from_code ? travelRow(l.from_code) : null,
      l.to_code ? travelRow(l.to_code) : null,
    ]);
    // "Leave home by" needs the drive to the terminal. Stored where it has been
    // worked out; otherwise estimated now from home, which is the honest
    // straight-line answer and is marked as one.
    let access = l.access_minutes;
    let estimated = false;
    if (access == null && home && from?.lat != null && l.direction === 'outbound') {
      access = estimateTravelMinutes(home, from, 'driving');
      estimated = true;
    }
    const leave = l.direction === 'outbound' && l.mode !== 'drive'
      ? leaveHomeBy(l.depart_at, access, { atTerminalMinutes: atTerminal(l.mode) })
      : null;
    return {
      id: l.id,
      direction: l.direction,
      mode: l.mode,
      onDate: l.on_date,
      from: { code: l.from_code, label: l.from_label ?? from?.name ?? l.from_code, point: from ? publicTerminal(from) : null },
      to: { code: l.to_code, label: l.to_label ?? l.to_code },
      departAt: hhmm(l.depart_at),
      arriveAt: hhmm(l.arrive_at),
      carrier: l.carrier,
      serviceNo: l.service_no,
      terminal: l.terminal,
      /**
       * How long it takes, but only where the two clocks agree.
       *
       * A departure and an arrival are both local times, so subtracting them
       * across a border gives the wrong answer: LHR 07:35 → FCO 11:00 is 2h 25m
       * and reads as 3h 25m, because Rome is an hour ahead. Epic knows the two
       * airports but not their offsets on that date, so where they are in
       * different countries the row simply does not claim a duration. A wrong
       * number is worse than a missing one on a screen somebody is planning a
       * morning around.
       */
      durationMinutes: l.duration_minutes
        ?? (sameClock(from, to) ? durationBetween(l.depart_at, l.arrive_at) : null),
      bookingRef: l.booking_ref,
      note: l.note,
      source: l.source,
      accessMinutes: access ?? null,
      accessEstimated: estimated,
      /** "Leave home by 05:20 · 40 min drive" — the Moss line under the row. */
      leaveHome: leave && access != null
        ? { time: leave.time, dayBefore: leave.dayBefore, minutes: access, estimated }
        : null,
      /** What is still missing before the row can say anything useful. */
      resolved: Boolean(l.depart_at && l.from_code && l.to_code),
    };
  }));

  return {
    legs: drawn,
    transfers: transfers.map((t) => ({
      id: t.id, mode: t.mode, label: t.label, detail: t.detail, minutes: t.minutes,
      estCost: t.est_cost_pence == null ? null : money(t.est_cost_pence, t.currency),
      estCostPence: t.est_cost_pence, currency: t.currency, chosen: t.chosen,
    })),
    party: party.length || 1,
    from: home?.label ?? null,
    /** Which tabs the strip draws. Ferry is gone (owner, 7 Sep 2026). */
    modes: modesFor({
      home,
      destination: trip.base_lat != null ? { lat: trip.base_lat, lng: trip.base_lng }
        : trip.destination_lat != null ? { lat: trip.destination_lat, lng: trip.destination_lng } : null,
      sameCountry: Boolean(household.home_country_code && trip.country_code
        && String(household.home_country_code).toUpperCase() === String(trip.country_code).toUpperCase()),
    }),
    /** Whether Epic can look a journey up at all, so the screen says which it is. */
    canRoute: routingEnabled(),
    /**
     * Why there are no cells, when there are none. An airport 1,800 km from the
     * bed is not a transfer, and three empty boxes explain nothing — this is the
     * sentence the screen draws instead (`TRANSFER_LIMIT_KM`).
     */
    transferNote: transfers.length ? null
      : !arrival ? 'Say which airport you land at and Epic will work out the ways across.'
        : !bed ? 'Say where you are staying and Epic will work out the ways across.'
          : farApart(arrival, bed)
            ? `${arrival.name} is a long way from where you are staying — too far to call it a transfer. Check the airport, or the address.`
            : 'Say where you land and where you are staying and Epic will work out the three ways across.',
    /**
     * What Epic can and cannot fill in, said once so the screen can say it in
     * its own words instead of guessing (owner: never a provider's error).
     */
    lookup: {
      schedules: Boolean(scheduleProvider()),
      says: scheduleProvider()
        ? 'Times come from the schedule feed.'
        : 'Epic fills in the airline and the airports; the times come off your booking.',
    },
  };
}

/**
 * Whether two terminals can be assumed to keep the same clock.
 *
 * Same country is the test, and it is deliberately conservative: it is right
 * for every domestic flight, and it declines to guess for everything else
 * rather than being right for France and wrong for Portugal.
 */
function sameClock(a, b) {
  const x = a?.country_code ?? a?.countryCode ?? null;
  const y = b?.country_code ?? b?.countryCode ?? null;
  return Boolean(x && y && x === y);
}

/** Whether these two are so far apart that "airport to hotel" is a second journey. */
function farApart(a, b) {
  if (a?.lat == null || b?.lat == null) return false;
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s))) > TRANSFER_LIMIT_KM;
}

/**
 * What the journey is, in the words somebody would use.
 *
 * Counting every leg as a train was wrong the first time it ran: the second
 * half of Sunningdale → Reading town centre is a bus, and calling it "2 trains"
 * is the kind of small lie that makes everything else on the screen suspect.
 * So the vehicles are counted by what they actually are.
 */
function transitWords(rides, minutes) {
  if (!rides.length) return `About ${minutes} min door to door`;
  const counts = new Map();
  for (const r of rides) {
    const what = (r.transit?.vehicle || 'train').toLowerCase();
    counts.set(what, (counts.get(what) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([what, n]) => `${n} ${what}${n === 1 ? '' : 's'}`);
  const changes = rides.length - 1;
  return [
    parts.join(' and '),
    changes ? `${changes} change${changes === 1 ? '' : 's'}` : null,
    `about ${minutes} min door to door`,
  ].filter(Boolean).join(' · ');
}

/** Two hours at an airport, forty minutes at a station, an hour at a port. */
const atTerminal = (mode) => (mode === 'fly' ? 120 : mode === 'ferry' ? 60 : 30);

const durationBetween = (a, b) => {
  if (!a || !b) return null;
  const [ah, am] = String(a).slice(0, 5).split(':').map(Number);
  const [bh, bm] = String(b).slice(0, 5).split(':').map(Number);
  if ([ah, am, bh, bm].some((n) => !Number.isFinite(n))) return null;
  const d = (bh * 60 + bm) - (ah * 60 + am);
  return d >= 0 ? d : d + 1440;
};

async function travelRow(code) {
  if (!code) return null;
  if (/^[A-Z]{3}$/.test(code)) return airportByCode(code);
  return null;
}

// ---------------------------------------------------------------------------
// the screen
// ---------------------------------------------------------------------------

router.get('/:id/travel', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    res.json(await travelPayload(trip, household));
  } catch (err) { next(err); }
});

/**
 * PUT /api/trips/:id/travel/legs/:direction
 *
 * One leg, typed or resolved. The mode comes in the body because the strip is
 * per leg: a household that flies out and takes the train back is two rows.
 */
router.put('/:id/travel/legs/:direction', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    const direction = req.params.direction;
    if (!travel.DIRECTIONS.includes(direction)) return bad(res, 'invalid_direction', 'A leg is outbound or return.');
    const b = req.body || {};
    const mode = b.mode ?? 'fly';
    if (!travel.MODES.includes(mode)) return bad(res, 'invalid_mode', 'Fly, train, drive or ferry.');

    // A flight number is worth expanding before it is stored: the airline and
    // the two airports are open data, and the household should not have to
    // type "British Airways" under a field that already says BA.
    let carrier = b.carrier ?? null;
    let serviceNo = b.serviceNo ?? null;
    if (mode === 'fly' && b.serviceNo) {
      const parsed = parseFlightNumber(b.serviceNo);
      if (parsed) { serviceNo = parsed.normalised; carrier = carrier ?? airlineName(parsed.airlineCode); }
    }
    const [from, to] = await Promise.all([
      b.fromCode ? airportByCode(b.fromCode) : null,
      b.toCode ? airportByCode(b.toCode) : null,
    ]);
    const home = homeOf(household);
    const accessMinutes = b.accessMinutes ?? (home && from?.lat != null && direction === 'outbound'
      ? estimateTravelMinutes(home, from, 'driving') : null);

    await travel.upsertLeg(trip.id, {
      direction, mode,
      onDate: b.onDate ?? (direction === 'outbound' ? trip.start_date : trip.end_date),
      fromCode: b.fromCode ? String(b.fromCode).toUpperCase() : null,
      fromLabel: b.fromLabel ?? from?.name ?? null,
      toCode: b.toCode ? String(b.toCode).toUpperCase() : null,
      toLabel: b.toLabel ?? to?.name ?? null,
      departAt: hhmm(b.departAt), arriveAt: hhmm(b.arriveAt),
      carrier, serviceNo, terminal: b.terminal ?? null,
      /**
       * Only what was given. Deriving it here from the two local times was the
       * same mistake as deriving it on the way out, and worse: it got written
       * down, so an hour of Rome's time zone became a fact about the flight.
       */
      durationMinutes: b.durationMinutes ?? null,
      bookingRef: b.bookingRef ?? null, accessMinutes, note: b.note ?? null,
      source: b.source ?? 'typed',
    });

    // The far end changed, so the three estimates under it are stale.
    if (direction === 'outbound') await refreshTransfers(trip, household);
    res.json(await travelPayload(trip, household));
  } catch (err) { next(err); }
});

router.delete('/:id/travel/legs/:legId', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    await travel.deleteLeg(trip.id, req.params.legId);
    res.json(await travelPayload(trip, household));
  } catch (err) { next(err); }
});

/**
 * GET /api/trips/:id/travel/flight?no=BA548
 *
 * What a flight number resolves to, before anything is saved: the airline, the
 * airports if they were given, and — said plainly — what is still to type.
 */
router.get('/:id/travel/flight', async (req, res, next) => {
  try {
    await ownTrip(req);
    res.json(await resolveFlight(req.query.no, {
      fromCode: req.query.from ?? null, toCode: req.query.to ?? null,
    }));
  } catch (err) { next(err); }
});

/** Typeahead for the from/to fields: airports by code, stations and ports by name. */
router.get('/:id/travel/terminals', async (req, res, next) => {
  try {
    await ownTrip(req);
    const q = String(req.query.q ?? '').trim();
    const kind = ['airport', 'station', 'port'].includes(req.query.kind) ? req.query.kind : 'airport';
    if (!q) return res.json({ terminals: [] });
    // Three letters typed at an airport field is a code, and the code is the
    // fastest and most certain answer there is.
    if (kind === 'airport' && /^[A-Za-z]{3}$/.test(q)) {
      const hit = await airportByCode(q);
      if (hit) return res.json({ terminals: [publicTerminal(hit)] });
    }
    const held = await travel.searchTerminals(q, kind);
    if (held.length) return res.json({ terminals: held.map(publicTerminal) });
    if (kind !== 'airport') {
      const found = await terminalByName(q, kind);
      if (found) return res.json({ terminals: [publicTerminal(found)] });
    }
    res.json({ terminals: [] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the journey Epic can work out for itself
// ---------------------------------------------------------------------------

/**
 * Which ways of getting there are worth offering at all.
 *
 * The owner, 7 Sep 2026: "obviously, for the ferry, only when applicable, and
 * drive only when applicable" — and, on the ferry, "I think you can remove
 * ferry, to be honest. That's a bit of a nonsense." So there is no ferry, and
 * the other three are offered only where they mean something:
 *
 *   fly    far enough that nobody drives it, or across a border
 *   train  anywhere the open transit graph will route between
 *   drive  anywhere on the same landmass, which for a household in Britain
 *          means the same country unless they are getting on a boat
 *
 * A mode nobody would take is not a tab; it is a tab somebody has to read and
 * dismiss.
 */
export function modesFor({ home, destination, sameCountry }) {
  if (!home?.lat || !destination?.lat) return ['fly', 'train', 'drive'];
  const km = kmBetween(home, destination);
  const out = [];
  if (!sameCountry || km > 350) out.push('fly');
  if (km < 900) out.push('train');
  if (sameCountry && km < 900) out.push('drive');
  // Never nothing: an island in the Atlantic still has to be flown to.
  return out.length ? out : ['fly'];
}

/**
 * GET /api/trips/:id/travel/suggest?mode=train — the journey, worked out.
 *
 * The owner, 7 Sep 2026: "if we know where they're going from (home) and we
 * know where they're going to (the destination), then surely it should just
 * show the train, not plan out the trip." He is right, and it needs no new
 * provider: Google Routes is already wired for the trip's directions drawer,
 * and its TRANSIT mode answers with the line, the stations and the times.
 *
 * What comes back is a *proposal*, not a saved leg — the household taps it onto
 * the trip, or types their own booking over it.
 */
router.get('/:id/travel/suggest', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    const mode = req.params.mode ?? req.query.mode;
    if (!['train', 'drive'].includes(mode)) return bad(res, 'invalid_mode', 'Epic can work out a train or a drive.');
    const home = homeOf(household);
    const to = trip.base_lat != null ? { lat: trip.base_lat, lng: trip.base_lng, label: trip.base_label }
      : trip.destination_lat != null ? { lat: trip.destination_lat, lng: trip.destination_lng, label: trip.destination_label } : null;
    if (!home || !to) {
      return res.json({ ok: false, message: 'Set a home address and say where you are going, and Epic will work the journey out.' });
    }
    if (!routingEnabled()) {
      return res.json({ ok: false, message: 'Epic cannot look up live times just now. Type what you have booked and it will do the rest.' });
    }

    // Leave at the trip's own start, in the household's own zone.
    const date = String(trip.start_date ?? '').slice(0, 10);
    const departAt = date ? wallToUtc(date, '08:00', trip.timezone || DEFAULT_TZ) : null;
    const found = await directions({ from: home, to, mode: mode === 'train' ? 'transit' : 'driving', departAt });
    if (!found) {
      return res.json({ ok: false, message: mode === 'train' ? 'No train Epic can find between those two. Type what you have booked.' : 'No road route Epic can find. Type what you have booked.' });
    }

    const rides = (found.steps ?? []).filter((s) => s.transit);
    const first = rides[0]?.transit ?? null;
    const last = rides[rides.length - 1]?.transit ?? null;
    res.json({
      ok: true,
      mode,
      minutes: found.minutes,
      /** Every leg, in the words a person would use, so the screen can list them. */
      legs: (found.steps ?? []).filter((s) => s.transit || s.minutes >= 3).map((s) => ({
        mode: s.travelMode, minutes: s.minutes, text: s.text,
        transit: s.transit ?? null,
      })),
      changes: Math.max(0, rides.length - 1),
      from: first?.from ?? home.label,
      to: last?.to ?? to.label,
      departAt: first?.departs ?? null,
      arriveAt: last?.arrives ?? null,
      carrier: first?.agency ?? null,
      serviceNo: first?.line ?? null,
      /** Google's answer, so it is marked as a live look-up rather than our arithmetic. */
      estimated: false,
      says: mode === 'train' ? transitWords(rides, found.minutes) : `About ${found.minutes} min at the wheel`,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// airport to hotel
// ---------------------------------------------------------------------------

async function refreshTransfers(trip, household) {
  const legs = await travel.legsOf(trip.id);
  const out = legs.find((l) => l.direction === 'outbound');
  if (!out?.to_code) return travel.replaceTransfers(trip.id, null, []);
  const arrival = await travelRow(out.to_code);
  const bed = trip.base_lat != null ? { lat: trip.base_lat, lng: trip.base_lng, label: trip.base_label } : null;
  if (!arrival?.lat || !bed) return travel.replaceTransfers(trip.id, out.id, []);
  const party = (await trips.partyOf(trip.id)).length || 1;
  /**
   * An airport a long way from the bed is not a transfer, and saying so is more
   * use than a fare nobody would pay (`TRANSFER_LIMIT_KM`). The screen draws the
   * reason rather than three empty cells.
   */
  const options = transferEstimates({
    from: arrival, to: bed, party,
    // The currency of where they landed, not of where they live: a fare in
    // Rome is in euros and saying it in pounds would be a different number.
    currency: currencyFor(arrival.country_code ?? arrival.countryCode),
    hasRail: RAIL_LINKED.has(String(out.to_code).toUpperCase()),
    nights: nightsOf(trip),
  });
  return travel.replaceTransfers(trip.id, out.id, options);
}

/**
 * Airports with a rail link into the city, in the open map.
 *
 * Kept as a list rather than derived, because "is there a train" is a question
 * about a service and not about a piece of track: Gatwick has a station and so
 * does Luton, and only one of them puts you on a platform inside the terminal.
 * A code that is not here simply has no train cell, which is the truthful
 * answer until somebody adds it.
 */
const RAIL_LINKED = new Set([
  'LHR', 'LGW', 'STN', 'LTN', 'MAN', 'BHX', 'EDI', 'GLA', 'NCL', 'LPL',
  'FCO', 'MXP', 'CDG', 'ORY', 'AMS', 'BRU', 'FRA', 'MUC', 'BER', 'ZRH', 'GVA',
  'VIE', 'CPH', 'ARN', 'OSL', 'HEL', 'BCN', 'MAD', 'LIS', 'OPO', 'ATH', 'DUB',
]);

const CURRENCY = { GB: 'GBP', IE: 'EUR', IT: 'EUR', FR: 'EUR', ES: 'EUR', PT: 'EUR', DE: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', GR: 'EUR', FI: 'EUR', US: 'USD' };
const currencyFor = (code) => CURRENCY[String(code ?? '').toUpperCase()] ?? 'EUR';

router.post('/:id/travel/transfers/refresh', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    await refreshTransfers(trip, household);
    res.json(await travelPayload(trip, household));
  } catch (err) { next(err); }
});

/**
 * POST /api/trips/:id/travel/transfer — "Train picked · added to the plan at 11:40".
 *
 * Picking one puts it on the day as a stop, so the transfer is in the plan
 * rather than in a panel somebody has to remember. Tapping the chosen one again
 * takes it back off.
 */
router.post('/:id/travel/transfer', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    const mode = req.body?.mode;
    const before = await travel.transfersOf(trip.id);
    const already = before.find((t) => t.chosen)?.mode ?? null;
    if (mode && !travel.TRANSFER_MODES.includes(mode)) return bad(res, 'invalid_transfer', 'Train, taxi or hire car.');

    if (!mode || mode === already) {
      await travel.clearTransferChoice(trip.id);
      await removeTransferStop(trip.id);
      return res.json(await travelPayload(trip, household));
    }
    await travel.chooseTransfer(trip.id, mode);
    await putTransferOnTheDay(trip, mode);
    res.json(await travelPayload(trip, household));
  } catch (err) { next(err); }
});

/** The transfer's own ref: not a place, so it never reaches the atlas or a ledger. */
const TRANSFER_REF = (tripId) => `transfer:${tripId}`;

async function removeTransferStop(tripId) {
  const stops = await trips.stopsOf(tripId);
  for (const s of stops.filter((x) => x.venue_ref === TRANSFER_REF(tripId))) {
    await trips.deleteStop(tripId, s.id);
  }
}

async function putTransferOnTheDay(trip, mode) {
  const [legs, transfers, days] = await Promise.all([
    travel.legsOf(trip.id), travel.transfersOf(trip.id), trips.daysOf(trip.id),
  ]);
  const out = legs.find((l) => l.direction === 'outbound');
  const picked = transfers.find((t) => t.mode === mode);
  if (!out?.arrive_at || !picked || !days.length) return;
  const day = days.find((d) => String(d.date).slice(0, 10) === String(out.on_date ?? '').slice(0, 10)) ?? days[0];
  await removeTransferStop(trip.id);
  const [h, m] = String(out.arrive_at).slice(0, 5).split(':').map(Number);
  const at = h * 60 + m + 40; // off the plane, through the hall, on the platform
  const startTime = `${String(Math.floor((at % 1440) / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
  await trips.insertStop(trip.id, day.id, {
    slot: at < 12 * 60 ? 'morning' : at < 17 * 60 ? 'afternoon' : 'evening',
    startTime, position: await trips.nextStopPosition(day.id),
    venueRef: TRANSFER_REF(trip.id),
    name: `${picked.label ?? mode} to ${trip.base_label ?? 'where you are staying'}`,
    lat: null, lng: null, dwellMinutes: picked.minutes ?? 45,
  });
}

export { router };
