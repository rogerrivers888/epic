/**
 * How the household is getting there, and how they get from the far terminal to
 * the bed: `trip_travel_legs` and `trip_transfers` (migration 068).
 *
 * Nothing derived is stored. "Leave home by 05:20" is the departure minus two
 * hours minus the drive, and it is worked out at read time from the leg and the
 * household's home — so changing the flight changes the sentence, and a leg
 * whose access time we do not know yet simply says less.
 */

import { query } from '../db.js';

const on = (client) => (client ? (text, params) => client.query(text, params) : query);

export const DIRECTIONS = ['outbound', 'return'];
export const MODES = ['fly', 'train', 'drive', 'ferry'];
export const TRANSFER_MODES = ['train', 'taxi', 'hire'];

export async function legsOf(tripId) {
  const { rows } = await query(
    `select * from trip_travel_legs where trip_id = $1
      order by case direction when 'outbound' then 0 else 1 end, on_date nulls last, depart_at nulls last`,
    [tripId],
  );
  return rows;
}

export async function legById(tripId, legId) {
  const { rows } = await query('select * from trip_travel_legs where id = $1 and trip_id = $2', [legId, tripId]);
  return rows[0] ?? null;
}

/**
 * One leg per direction per mode, replaced rather than duplicated.
 *
 * Somebody who types the same flight number twice means "this one", not "two of
 * these", and a return leg edited after the fact is the same leg. The unique
 * key does the deciding; every field is coalesced so a partial edit — just the
 * terminal, just the time — keeps what was already known.
 */
export async function upsertLeg(tripId, leg, client) {
  const { rows } = await on(client)(
    `insert into trip_travel_legs
       (trip_id, direction, mode, on_date, from_code, from_label, to_code, to_label,
        depart_at, arrive_at, carrier, service_no, terminal, duration_minutes, booking_ref, access_minutes, note, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::time,$10::time,$11,$12,$13,$14,$15,$16,$17,$18)
     on conflict (trip_id, direction, mode) do update set
       on_date          = coalesce(excluded.on_date, trip_travel_legs.on_date),
       from_code        = coalesce(excluded.from_code, trip_travel_legs.from_code),
       from_label       = coalesce(excluded.from_label, trip_travel_legs.from_label),
       to_code          = coalesce(excluded.to_code, trip_travel_legs.to_code),
       to_label         = coalesce(excluded.to_label, trip_travel_legs.to_label),
       depart_at        = coalesce(excluded.depart_at, trip_travel_legs.depart_at),
       arrive_at        = coalesce(excluded.arrive_at, trip_travel_legs.arrive_at),
       carrier          = coalesce(excluded.carrier, trip_travel_legs.carrier),
       service_no       = coalesce(excluded.service_no, trip_travel_legs.service_no),
       terminal         = coalesce(excluded.terminal, trip_travel_legs.terminal),
       duration_minutes = coalesce(excluded.duration_minutes, trip_travel_legs.duration_minutes),
       booking_ref      = coalesce(excluded.booking_ref, trip_travel_legs.booking_ref),
       access_minutes   = coalesce(excluded.access_minutes, trip_travel_legs.access_minutes),
       note             = coalesce(excluded.note, trip_travel_legs.note),
       source           = excluded.source
     returning *`,
    [tripId, leg.direction, leg.mode, leg.onDate ?? null, leg.fromCode ?? null, leg.fromLabel ?? null,
      leg.toCode ?? null, leg.toLabel ?? null, leg.departAt ?? null, leg.arriveAt ?? null,
      leg.carrier ?? null, leg.serviceNo ?? null, leg.terminal ?? null, leg.durationMinutes ?? null,
      leg.bookingRef ?? null, leg.accessMinutes ?? null, leg.note ?? null, leg.source ?? 'typed'],
  );
  return rows[0];
}

export async function deleteLeg(tripId, legId) {
  const { rowCount } = await query('delete from trip_travel_legs where id = $1 and trip_id = $2', [legId, tripId]);
  return rowCount;
}

/** Every leg goes when the mode strip changes: Fly and Train are not two plans, they are one. */
export async function clearLegs(tripId, client) {
  await on(client)('delete from trip_travel_legs where trip_id = $1', [tripId]);
}

// ---------------------------------------------------------------------------
// airport to hotel
// ---------------------------------------------------------------------------

export async function transfersOf(tripId) {
  const { rows } = await query(
    `select * from trip_transfers where trip_id = $1
      order by case mode when 'train' then 0 when 'taxi' then 1 else 2 end`,
    [tripId],
  );
  return rows;
}

export async function replaceTransfers(tripId, legId, options, client) {
  const run = on(client);
  // The estimates are recomputed whenever the leg or the party changes, so the
  // three cells are rewritten together — but which one was *picked* is the
  // household's answer and survives.
  const { rows: had } = await run('select mode, chosen from trip_transfers where trip_id = $1', [tripId]);
  const picked = had.find((r) => r.chosen)?.mode ?? null;
  await run('delete from trip_transfers where trip_id = $1', [tripId]);
  for (const o of options) {
    await run(
      `insert into trip_transfers (trip_id, leg_id, mode, label, detail, minutes, est_cost_pence, currency, chosen)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tripId, legId ?? null, o.mode, o.label ?? null, o.detail ?? null, o.minutes ?? null,
        o.estCostPence ?? null, o.currency ?? 'GBP', o.mode === picked],
    );
  }
  return transfersOf(tripId);
}

export async function chooseTransfer(tripId, mode) {
  await query('update trip_transfers set chosen = (mode = $2) where trip_id = $1', [tripId, mode]);
  return transfersOf(tripId);
}

export async function clearTransferChoice(tripId) {
  await query('update trip_transfers set chosen = false where trip_id = $1', [tripId]);
  return transfersOf(tripId);
}

// ---------------------------------------------------------------------------
// terminals: airports, stations and ports, from the open map
// ---------------------------------------------------------------------------

export async function terminalByCode(code) {
  const { rows } = await query('select * from travel_terminals where code = $1', [String(code).toUpperCase()]);
  return rows[0] ?? null;
}

export async function saveTerminal(t) {
  const { rows } = await query(
    `insert into travel_terminals (code, kind, name, locality, country, country_code, lat, lng, attribution)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (code) do update set
       kind = excluded.kind, name = excluded.name, locality = excluded.locality,
       country = excluded.country, country_code = excluded.country_code,
       lat = excluded.lat, lng = excluded.lng, attribution = excluded.attribution, fetched_at = now()
     returning *`,
    [String(t.code).toUpperCase(), t.kind, t.name, t.locality ?? null, t.country ?? null,
      t.countryCode ?? null, t.lat ?? null, t.lng ?? null, t.attribution ?? null],
  );
  return rows[0];
}

/** Terminals whose name matches what somebody typed, for the from/to fields. */
export async function searchTerminals(text, kind = null, limit = 8) {
  const like = `%${String(text).toLowerCase()}%`;
  const params = [like, limit];
  let where = '(lower(name) like $1 or lower(coalesce(locality, \'\')) like $1 or lower(code) like $1)';
  if (kind) { params.push(kind); where += ` and kind = $${params.length}`; }
  const { rows } = await query(
    `select * from travel_terminals where ${where} order by length(name) limit $2`,
    params,
  );
  return rows;
}
