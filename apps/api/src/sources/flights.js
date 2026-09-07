/**
 * A flight number, a train service or a crossing, turned into as much as open
 * data actually knows — and honest about the rest.
 *
 * The handoff (5d) draws a resolved row: "LHR 07:35 → FCO 11:00 · British
 * Airways BA 548 · 2h 25m · Terminal 5". Three of those five facts can be had
 * without paying anybody:
 *
 *   · **the airline**, from the two-letter IATA designator the number leads
 *     with. That is a published register, not a schedule.
 *   · **the airports**, from OpenStreetMap — `aeroway=aerodrome` carries the
 *     IATA code, so LHR and FCO resolve to a name, a town and a point we may
 *     keep for good (Technical Constraints §13.10, the owned layer).
 *   · **the drive to the terminal**, from the household's home to that point.
 *
 * The two that cannot are the **times** and the **terminal**, because those are
 * a schedule, and every schedule feed is a paid one. Wiring a paid one is the
 * owner's to do (CLAUDE.md), so `scheduleProvider()` is the seam and it is off:
 * until a key exists, the screen fills in what we know, asks for the departure
 * and arrival, and says why in one plain sentence.
 *
 * Nothing here calls a provider that costs money, and nothing here is stored
 * that we are not allowed to keep.
 */

import { overpassQuery, UA } from './overpass.js';
import * as travelRepo from '../repositories/tripTravel.js';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * The airline designators a UK household actually meets, by IATA code.
 *
 * A name is a fact about a company, not a licensed place record, and the list
 * is the published IATA register. Short on purpose: an unknown code is answered
 * with the code itself rather than a wrong guess, and the household can type
 * the airline in. Adding one is a line here.
 */
const AIRLINES = {
  BA: 'British Airways', VS: 'Virgin Atlantic', U2: 'easyJet', EZY: 'easyJet', FR: 'Ryanair', RYR: 'Ryanair',
  W6: 'Wizz Air', LS: 'Jet2', TOM: 'TUI Airways', BY: 'TUI Airways', ZB: 'Wizz Air Malta',
  AF: 'Air France', KL: 'KLM', LH: 'Lufthansa', LX: 'Swiss', OS: 'Austrian Airlines', SN: 'Brussels Airlines',
  IB: 'Iberia', VY: 'Vueling', UX: 'Air Europa', TP: 'TAP Air Portugal', AZ: 'ITA Airways', AY: 'Finnair',
  SK: 'SAS', DY: 'Norwegian', D8: 'Norwegian Air Sweden', LO: 'LOT Polish Airlines', OK: 'Czech Airlines',
  TK: 'Turkish Airlines', A3: 'Aegean Airlines', EI: 'Aer Lingus', KM: 'Air Malta', OA: 'Olympic Air',
  EK: 'Emirates', QR: 'Qatar Airways', EY: 'Etihad Airways', SV: 'Saudia', MS: 'EgyptAir', RJ: 'Royal Jordanian',
  AA: 'American Airlines', DL: 'Delta Air Lines', UA: 'United Airlines', AC: 'Air Canada', WS: 'WestJet',
  B6: 'JetBlue', AS: 'Alaska Airlines', SQ: 'Singapore Airlines', CX: 'Cathay Pacific', JL: 'Japan Airlines',
  NH: 'ANA', QF: 'Qantas', NZ: 'Air New Zealand', ET: 'Ethiopian Airlines', SA: 'South African Airways',
  BE: 'Blue Islands', LM: 'Loganair', LOG: 'Loganair', T3: 'Eastern Airways', VA: 'Virgin Australia',
};

/**
 * The airports a resolve is most likely to be asked for, so the screen works
 * before Overpass has ever been reached — and on a Saturday when every mirror
 * is busy. Open data (OpenStreetMap), and the same rows Overpass would return.
 */
const SEED_AIRPORTS = [
  { code: 'LHR', name: 'Heathrow', locality: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.4700, lng: -0.4543 },
  { code: 'LGW', name: 'Gatwick', locality: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.1537, lng: -0.1821 },
  { code: 'STN', name: 'Stansted', locality: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.8860, lng: 0.2389 },
  { code: 'LTN', name: 'Luton', locality: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.8747, lng: -0.3683 },
  { code: 'LCY', name: 'London City', locality: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.5053, lng: 0.0553 },
  { code: 'SEN', name: 'Southend', locality: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.5714, lng: 0.6956 },
  { code: 'MAN', name: 'Manchester', locality: 'Manchester', country: 'United Kingdom', countryCode: 'GB', lat: 53.3650, lng: -2.2725 },
  { code: 'BHX', name: 'Birmingham', locality: 'Birmingham', country: 'United Kingdom', countryCode: 'GB', lat: 52.4539, lng: -1.7480 },
  { code: 'BRS', name: 'Bristol', locality: 'Bristol', country: 'United Kingdom', countryCode: 'GB', lat: 51.3827, lng: -2.7191 },
  { code: 'EDI', name: 'Edinburgh', locality: 'Edinburgh', country: 'United Kingdom', countryCode: 'GB', lat: 55.9500, lng: -3.3725 },
  { code: 'GLA', name: 'Glasgow', locality: 'Glasgow', country: 'United Kingdom', countryCode: 'GB', lat: 55.8642, lng: -4.4331 },
  { code: 'NCL', name: 'Newcastle', locality: 'Newcastle', country: 'United Kingdom', countryCode: 'GB', lat: 55.0375, lng: -1.6917 },
  { code: 'LPL', name: 'Liverpool John Lennon', locality: 'Liverpool', country: 'United Kingdom', countryCode: 'GB', lat: 53.3336, lng: -2.8497 },
  { code: 'LBA', name: 'Leeds Bradford', locality: 'Leeds', country: 'United Kingdom', countryCode: 'GB', lat: 53.8659, lng: -1.6606 },
  { code: 'BFS', name: 'Belfast International', locality: 'Belfast', country: 'United Kingdom', countryCode: 'GB', lat: 54.6575, lng: -6.2158 },
  { code: 'DUB', name: 'Dublin', locality: 'Dublin', country: 'Ireland', countryCode: 'IE', lat: 53.4213, lng: -6.2701 },
  { code: 'FCO', name: 'Fiumicino', locality: 'Rome', country: 'Italy', countryCode: 'IT', lat: 41.8003, lng: 12.2389 },
  { code: 'CIA', name: 'Ciampino', locality: 'Rome', country: 'Italy', countryCode: 'IT', lat: 41.7994, lng: 12.5949 },
  { code: 'MXP', name: 'Malpensa', locality: 'Milan', country: 'Italy', countryCode: 'IT', lat: 45.6306, lng: 8.7281 },
  { code: 'LIN', name: 'Linate', locality: 'Milan', country: 'Italy', countryCode: 'IT', lat: 45.4451, lng: 9.2767 },
  { code: 'VCE', name: 'Marco Polo', locality: 'Venice', country: 'Italy', countryCode: 'IT', lat: 45.5053, lng: 12.3519 },
  { code: 'NAP', name: 'Capodichino', locality: 'Naples', country: 'Italy', countryCode: 'IT', lat: 40.8860, lng: 14.2908 },
  { code: 'PSA', name: 'Pisa', locality: 'Pisa', country: 'Italy', countryCode: 'IT', lat: 43.6839, lng: 10.3927 },
  { code: 'FLR', name: 'Florence', locality: 'Florence', country: 'Italy', countryCode: 'IT', lat: 43.8100, lng: 11.2051 },
  { code: 'CDG', name: 'Charles de Gaulle', locality: 'Paris', country: 'France', countryCode: 'FR', lat: 49.0097, lng: 2.5479 },
  { code: 'ORY', name: 'Orly', locality: 'Paris', country: 'France', countryCode: 'FR', lat: 48.7233, lng: 2.3794 },
  { code: 'NCE', name: 'Nice Côte d\'Azur', locality: 'Nice', country: 'France', countryCode: 'FR', lat: 43.6584, lng: 7.2159 },
  { code: 'LYS', name: 'Lyon–Saint Exupéry', locality: 'Lyon', country: 'France', countryCode: 'FR', lat: 45.7256, lng: 5.0811 },
  { code: 'BCN', name: 'El Prat', locality: 'Barcelona', country: 'Spain', countryCode: 'ES', lat: 41.2974, lng: 2.0833 },
  { code: 'MAD', name: 'Barajas', locality: 'Madrid', country: 'Spain', countryCode: 'ES', lat: 40.4719, lng: -3.5626 },
  { code: 'AGP', name: 'Málaga', locality: 'Málaga', country: 'Spain', countryCode: 'ES', lat: 36.6749, lng: -4.4991 },
  { code: 'PMI', name: 'Palma de Mallorca', locality: 'Palma', country: 'Spain', countryCode: 'ES', lat: 39.5517, lng: 2.7388 },
  { code: 'ALC', name: 'Alicante–Elche', locality: 'Alicante', country: 'Spain', countryCode: 'ES', lat: 38.2822, lng: -0.5582 },
  { code: 'FAO', name: 'Faro', locality: 'Faro', country: 'Portugal', countryCode: 'PT', lat: 37.0144, lng: -7.9659 },
  { code: 'LIS', name: 'Humberto Delgado', locality: 'Lisbon', country: 'Portugal', countryCode: 'PT', lat: 38.7742, lng: -9.1342 },
  { code: 'OPO', name: 'Francisco Sá Carneiro', locality: 'Porto', country: 'Portugal', countryCode: 'PT', lat: 41.2481, lng: -8.6814 },
  { code: 'AMS', name: 'Schiphol', locality: 'Amsterdam', country: 'Netherlands', countryCode: 'NL', lat: 52.3105, lng: 4.7683 },
  { code: 'BRU', name: 'Brussels', locality: 'Brussels', country: 'Belgium', countryCode: 'BE', lat: 50.9014, lng: 4.4844 },
  { code: 'FRA', name: 'Frankfurt', locality: 'Frankfurt', country: 'Germany', countryCode: 'DE', lat: 50.0379, lng: 8.5622 },
  { code: 'MUC', name: 'Munich', locality: 'Munich', country: 'Germany', countryCode: 'DE', lat: 48.3538, lng: 11.7861 },
  { code: 'BER', name: 'Brandenburg', locality: 'Berlin', country: 'Germany', countryCode: 'DE', lat: 52.3667, lng: 13.5033 },
  { code: 'ZRH', name: 'Zurich', locality: 'Zurich', country: 'Switzerland', countryCode: 'CH', lat: 47.4647, lng: 8.5492 },
  { code: 'GVA', name: 'Geneva', locality: 'Geneva', country: 'Switzerland', countryCode: 'CH', lat: 46.2381, lng: 6.1090 },
  { code: 'VIE', name: 'Vienna', locality: 'Vienna', country: 'Austria', countryCode: 'AT', lat: 48.1103, lng: 16.5697 },
  { code: 'CPH', name: 'Copenhagen', locality: 'Copenhagen', country: 'Denmark', countryCode: 'DK', lat: 55.6180, lng: 12.6560 },
  { code: 'ARN', name: 'Arlanda', locality: 'Stockholm', country: 'Sweden', countryCode: 'SE', lat: 59.6519, lng: 17.9186 },
  { code: 'OSL', name: 'Gardermoen', locality: 'Oslo', country: 'Norway', countryCode: 'NO', lat: 60.1939, lng: 11.1004 },
  { code: 'HEL', name: 'Helsinki-Vantaa', locality: 'Helsinki', country: 'Finland', countryCode: 'FI', lat: 60.3172, lng: 24.9633 },
  { code: 'ATH', name: 'Athens', locality: 'Athens', country: 'Greece', countryCode: 'GR', lat: 37.9364, lng: 23.9445 },
  { code: 'IST', name: 'Istanbul', locality: 'Istanbul', country: 'Türkiye', countryCode: 'TR', lat: 41.2753, lng: 28.7519 },
  { code: 'JFK', name: 'John F. Kennedy', locality: 'New York', country: 'United States', countryCode: 'US', lat: 40.6413, lng: -73.7781 },
  { code: 'EWR', name: 'Newark Liberty', locality: 'New York', country: 'United States', countryCode: 'US', lat: 40.6895, lng: -74.1745 },
  { code: 'BOS', name: 'Logan', locality: 'Boston', country: 'United States', countryCode: 'US', lat: 42.3656, lng: -71.0096 },
  { code: 'LAX', name: 'Los Angeles', locality: 'Los Angeles', country: 'United States', countryCode: 'US', lat: 33.9416, lng: -118.4085 },
  { code: 'SFO', name: 'San Francisco', locality: 'San Francisco', country: 'United States', countryCode: 'US', lat: 37.6213, lng: -122.3790 },
  { code: 'MCO', name: 'Orlando', locality: 'Orlando', country: 'United States', countryCode: 'US', lat: 28.4312, lng: -81.3081 },
  { code: 'DXB', name: 'Dubai', locality: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', lat: 25.2532, lng: 55.3657 },
  { code: 'DOH', name: 'Hamad', locality: 'Doha', country: 'Qatar', countryCode: 'QA', lat: 25.2731, lng: 51.6081 },
];

const SEED = new Map(SEED_AIRPORTS.map((a) => [a.code, { ...a, kind: 'airport', attribution: OSM_ATTRIBUTION }]));

/**
 * Whether a paid schedule feed is wired up.
 *
 * Off, and deliberately: enabling a provider that spends money is the owner's
 * (CLAUDE.md, "Anything that holds a secret, spends money…"). The seam is here
 * so that turning one on is a key in Doppler and a `fetchSchedule` beneath this
 * line, not a change to any screen.
 */
export const scheduleProvider = () => (process.env.EPIC_FLIGHT_SCHEDULE_KEY ? 'configured' : null);

/** "ba548", "BA 548", "ba-548" → { airlineCode: 'BA', number: '548' }. */
export function parseFlightNumber(input) {
  const raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^([A-Z]{2}|[A-Z]\d|\d[A-Z]|[A-Z]{3})(\d{1,4})$/.exec(raw);
  if (!m) return null;
  return { airlineCode: m[1], number: m[2], normalised: `${m[1]} ${m[2]}` };
}

export const airlineName = (code) => AIRLINES[String(code ?? '').toUpperCase()] ?? null;

/**
 * One airport, by IATA code: from what we have already kept, then the seed,
 * then the open map.
 *
 * Overpass is asked for `aeroway=aerodrome` with that `iata` tag, and whatever
 * comes back is written to `travel_terminals` — open data, ours to keep, so the
 * second household to fly to Rome costs nothing.
 */
export async function airportByCode(code) {
  const iata = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata)) return null;

  const held = await travelRepo.terminalByCode(iata).catch(() => null);
  if (held) return held;

  const seed = SEED.get(iata);
  if (seed) return travelRepo.saveTerminal(seed).catch(() => ({ ...seed, code: iata }));

  try {
    const body = `[out:json][timeout:12];(nwr["iata"="${iata}"]["aeroway"="aerodrome"];);out center 1;`;
    const data = await overpassQuery(body, { userAgent: UA });
    const el = (data?.elements ?? [])[0];
    if (!el) return null;
    const t = el.tags ?? {};
    const found = {
      code: iata, kind: 'airport',
      name: t['name:en'] || t.name || iata,
      locality: t['addr:city'] || t.city || null,
      country: null,
      countryCode: (t['addr:country'] || '').toUpperCase() || null,
      lat: el.lat ?? el.center?.lat ?? null,
      lng: el.lon ?? el.center?.lon ?? null,
      attribution: OSM_ATTRIBUTION,
    };
    return await travelRepo.saveTerminal(found);
  } catch {
    // The open map being busy is not a reason to lose the flight number: the
    // code itself is a perfectly good label until it can be asked again.
    return null;
  }
}

/**
 * A station or a port by name, from the open map, kept the same way.
 *
 * Train and ferry legs are typed as names rather than codes — nobody says "I'm
 * on the 09:04 from BTH" — so this matches the name and stores whatever it
 * finds under an uppercase key of that name.
 */
export async function terminalByName(name, kind = 'station') {
  const text = String(name ?? '').trim();
  if (text.length < 3) return null;
  const key = `${kind === 'port' ? 'PORT' : 'STN'}:${text.toUpperCase()}`;
  const held = await travelRepo.terminalByCode(key).catch(() => null);
  if (held) return held;
  const filter = kind === 'port'
    ? `nwr["amenity"="ferry_terminal"]["name"~"${text.replace(/"/g, '')}",i];`
    : `nwr["railway"="station"]["name"~"${text.replace(/"/g, '')}",i];`;
  try {
    const data = await overpassQuery(`[out:json][timeout:12];(${filter});out center 1;`, { userAgent: UA });
    const el = (data?.elements ?? [])[0];
    if (!el) return null;
    const t = el.tags ?? {};
    return await travelRepo.saveTerminal({
      code: key, kind: kind === 'port' ? 'port' : 'station',
      name: t['name:en'] || t.name || text,
      locality: t['addr:city'] || null, country: null, countryCode: null,
      lat: el.lat ?? el.center?.lat ?? null, lng: el.lon ?? el.center?.lon ?? null,
      attribution: OSM_ATTRIBUTION,
    });
  } catch { return null; }
}

/**
 * What a service number resolves to.
 *
 * `known` is what open data could tell us; `asks` is what the household still
 * has to type, in the words the screen shows them. A resolve that finds nothing
 * is not a failure — it is a form with one field filled in.
 */
export async function resolveFlight(number, { fromCode = null, toCode = null } = {}) {
  const parsed = parseFlightNumber(number);
  if (!parsed) {
    return { ok: false, message: 'That does not look like a flight number. They are two letters and up to four digits — BA 548.' };
  }
  const [from, to] = await Promise.all([
    fromCode ? airportByCode(fromCode) : null,
    toCode ? airportByCode(toCode) : null,
  ]);
  const carrier = airlineName(parsed.airlineCode);
  const asks = ['departure and arrival times'];
  if (!from) asks.unshift('which airport you leave from');
  if (!to) asks.push('which airport you land at');
  return {
    ok: true,
    serviceNo: parsed.normalised,
    carrier,
    carrierKnown: Boolean(carrier),
    from: from ? publicTerminal(from) : null,
    to: to ? publicTerminal(to) : null,
    scheduled: false,
    asks,
    /**
     * Said once, in plain words, and never as a provider's error (owner,
     * 7 Sep 2026 — a raw failure belongs in the back office, not on a phone).
     */
    message: carrier
      ? `${carrier} ${parsed.number}. Epic knows the airline and the airports; the times come off your booking, so type them in.`
      : `Flight ${parsed.normalised}. Epic does not know that airline — type its name and the times off your booking.`,
  };
}

export const publicTerminal = (t) => (t ? {
  code: t.code, kind: t.kind, name: t.name, locality: t.locality ?? null,
  country: t.country ?? null, countryCode: t.country_code ?? t.countryCode ?? null,
  lat: t.lat ?? null, lng: t.lng ?? null, attribution: t.attribution ?? OSM_ATTRIBUTION,
} : null);

// ---------------------------------------------------------------------------
// the transfer at the far end
// ---------------------------------------------------------------------------

/**
 * Airport to hotel, as three estimates.
 *
 * Straight-line distance and a mode's own average speed, the same arithmetic
 * the rest of Epic uses when it has not paid for a route (domain/travel.js) —
 * so these are marked as estimates on screen and nobody is told a fare they
 * will be held to. A train is only offered where the two ends are somewhere a
 * train actually runs between, which for now means an airport with a rail link
 * in the open map; where there is none the cell says so rather than inventing
 * a Leonardo Express.
 */
/**
 * How far apart an airport and a bed can be before "airport to hotel" stops
 * being a transfer and starts being a second journey.
 *
 * A hundred and twenty kilometres is generous — Stansted to central London is
 * 50, Girona to Barcelona is 90 — and the guard matters because without it a
 * flight typed onto the wrong trip offers a €3,500 taxi with a straight face.
 * Past it the screen says the two are nowhere near each other instead.
 */
export const TRANSFER_LIMIT_KM = 120;

export function transferEstimates({ from, to, party = 2, currency = 'GBP', hasRail = false, nights = 0 }) {
  if (!from?.lat || !to?.lat) return [];
  const km = haversine(from, to);
  if (km > TRANSFER_LIMIT_KM) return [];
  const heads = Math.max(1, Number(party) || 1);
  const out = [];

  if (hasRail) {
    const minutes = Math.max(12, Math.round((km / 60) * 60) + 8);
    // A per-head airport rail fare, in the currency of where they landed.
    const perHead = 1400 + Math.round(km * 25);
    out.push({
      mode: 'train', label: 'Train', minutes,
      estCostPence: perHead * heads, currency,
      detail: `Airport rail link · about ${money(perHead * heads, currency)} for ${heads}`,
    });
  }

  const taxiMinutes = Math.max(10, Math.round((km / 45) * 60) + 6);
  out.push({
    mode: 'taxi', label: 'Taxi', minutes: taxiMinutes,
    estCostPence: Math.round(450 + km * 190), currency,
    detail: `About ${money(Math.round(450 + km * 190), currency)} for the car`,
  });

  const days = Math.max(1, Number(nights) || 1);
  out.push({
    mode: 'hire', label: 'Hire car', minutes: taxiMinutes + 15,
    estCostPence: Math.round(days * 4200), currency,
    detail: `${days} day${days === 1 ? '' : 's'} from about ${money(Math.round(days * 4200), currency)}`,
  });

  return out;
}

const SYMBOL = { GBP: '£', EUR: '€', USD: '$' };
export const money = (pence, currency = 'GBP') => `${SYMBOL[currency] ?? ''}${Math.round(pence / 100)}`;

function haversine(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * When to walk out of the front door, so the flight is not missed.
 *
 * Two hours at the airport, plus however long it takes to get there. The rule
 * is the handoff's ("flight 'leave home by' = departure − 2h − drive"); it is
 * arithmetic rather than a stored fact so that moving the flight moves it.
 */
export function leaveHomeBy(departAt, accessMinutes, { atTerminalMinutes = 120 } = {}) {
  if (!departAt || accessMinutes == null) return null;
  const [h, m] = String(departAt).slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = h * 60 + m - atTerminalMinutes - accessMinutes;
  // Before midnight is a real answer — a 06:00 flight from a two-hour drive
  // away is a 02:00 start — so it wraps rather than clamping to 00:00.
  const at = ((total % 1440) + 1440) % 1440;
  return {
    time: `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`,
    dayBefore: total < 0,
  };
}
