/**
 * The trip's conversation, and the people who can be in it.
 *
 * One table for both threads (migration 068): `venue_ref` null is the trip's
 * own chat, anything else is that stop's Ask. They are one table because a
 * question asked on a stop *also* appears in the chat, with a pointer back to
 * the stop — two tables would mean two orderings of the same conversation and
 * a merge every time either was read.
 *
 * Nothing here is rented. A message is the household's own words, and
 * `venue_label` is the household's own name for the stop — the same exception
 * `trip_stops.venue_name` has held since 001, and for the same reason: it is
 * what they wrote, not what a provider called it.
 */

import { query } from '../db.js';

const on = (client) => (client ? (text, params) => client.query(text, params) : query);

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

/**
 * The thread, oldest first, with who said it and how many people have seen it.
 *
 * `scope` is null for the trip's chat — which returns every message, per-stop
 * Asks included, because that is what the chat shows — or a venue_ref for one
 * stop's thread, which returns only that stop's.
 */
export async function messagesOf(tripId, { venueRef = null, onlyStop = false, limit = 300 } = {}) {
  const params = [tripId, limit];
  let where = 'm.trip_id = $1';
  if (onlyStop) {
    if (venueRef == null) where += ' and m.venue_ref is null';
    else { params.push(venueRef); where += ` and m.venue_ref = $${params.length}`; }
  }
  const { rows } = await query(
    `select m.*,
            mem.name as member_name, mem.avatar_url as member_avatar,
            g.name as guest_name,
            (select count(*)::int from trip_message_reads r where r.message_id = m.id) as seen_by
       from trip_messages m
       left join members mem on mem.id = m.author_member_id
       left join trip_guests g on g.id = m.author_guest_id
      where ${where}
      order by m.created_at
      limit $2`,
    params,
  );
  return rows;
}

export async function insertMessage(tripId, m, client) {
  const { rows } = await on(client)(
    `insert into trip_messages (trip_id, venue_ref, venue_label, body, author_member_id, author_guest_id)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [tripId, m.venueRef ?? null, m.venueLabel ?? null, m.body, m.memberId ?? null, m.guestId ?? null],
  );
  return rows[0];
}

/**
 * Mark everything in a thread as seen by one person.
 *
 * Written for the sender too, the moment they send: "Seen by 3" on your own
 * bubble counts you, and a count that excluded the author would say 2 for a
 * message everybody has read.
 */
export async function markRead(tripId, { memberId = null, guestId = null, venueRef = undefined } = {}) {
  if (!memberId && !guestId) return 0;
  const params = [tripId, memberId, guestId];
  let scope = '';
  if (venueRef !== undefined) {
    if (venueRef === null) scope = ' and m.venue_ref is null';
    else { params.push(venueRef); scope = ` and m.venue_ref = $${params.length}`; }
  }
  const { rowCount } = await query(
    `insert into trip_message_reads (message_id, member_id, guest_id)
     select m.id, $2, $3 from trip_messages m where m.trip_id = $1${scope}
     on conflict do nothing`,
    params,
  );
  return rowCount;
}

/** How many messages this person has not seen, for the chat button's own count. */
export async function unreadCount(tripId, { memberId = null, guestId = null } = {}) {
  if (!memberId && !guestId) return 0;
  const { rows } = await query(
    `select count(*)::int as n from trip_messages m
      where m.trip_id = $1
        and not exists (
          select 1 from trip_message_reads r
           where r.message_id = m.id
             and (($2::uuid is not null and r.member_id = $2) or ($3::uuid is not null and r.guest_id = $3)))`,
    [tripId, memberId, guestId],
  );
  return rows[0]?.n ?? 0;
}

/** How many questions sit on each stop, for the Ask tab's own count. */
export async function askCounts(tripId) {
  const { rows } = await query(
    `select venue_ref, count(*)::int as n from trip_messages
      where trip_id = $1 and venue_ref is not null group by venue_ref`,
    [tripId],
  );
  return new Map(rows.map((r) => [r.venue_ref, r.n]));
}

// ---------------------------------------------------------------------------
// guests
// ---------------------------------------------------------------------------

export async function guestsOf(tripId) {
  const { rows } = await query(
    'select * from trip_guests where trip_id = $1 order by invited_at',
    [tripId],
  );
  return rows;
}

export async function guestById(tripId, guestId) {
  const { rows } = await query('select * from trip_guests where id = $1 and trip_id = $2', [guestId, tripId]);
  return rows[0] ?? null;
}

export async function guestByToken(token) {
  const { rows } = await query('select * from trip_guests where token = $1', [token]);
  return rows[0] ?? null;
}

export async function guestByContact(tripId, contact) {
  const { rows } = await query(
    'select * from trip_guests where trip_id = $1 and lower(contact) = lower($2)',
    [tripId, contact],
  );
  return rows[0] ?? null;
}

export async function insertGuest(tripId, g) {
  const { rows } = await query(
    `insert into trip_guests (trip_id, name, contact, contact_kind, token)
     values ($1,$2,$3,$4,$5)
     on conflict (trip_id, contact) do update set name = excluded.name, contact_kind = excluded.contact_kind
     returning *`,
    [tripId, g.name, g.contact ?? null, g.contactKind ?? null, g.token],
  );
  return rows[0];
}

export async function removeGuest(tripId, guestId) {
  const { rowCount } = await query('delete from trip_guests where id = $1 and trip_id = $2', [guestId, tripId]);
  return rowCount;
}

export async function markGuestJoined(guestId, accountId = null) {
  const { rows } = await query(
    `update trip_guests set status = 'joined', joined_at = coalesce(joined_at, now()), last_seen_at = now(),
            account_id = coalesce($2, account_id)
      where id = $1 returning *`,
    [guestId, accountId],
  );
  return rows[0] ?? null;
}

export async function touchGuest(guestId) {
  await query('update trip_guests set last_seen_at = now() where id = $1', [guestId]);
}

// ---------------------------------------------------------------------------
// the one-time code
// ---------------------------------------------------------------------------

export async function insertGuestCode(guestId, code, expiresAt) {
  const { rows } = await query(
    'insert into trip_guest_codes (guest_id, code, expires_at) values ($1,$2,$3) returning *',
    [guestId, code, expiresAt],
  );
  return rows[0];
}

/** The live code for this guest, if there is one and it has not been used. */
export async function liveGuestCode(guestId, code) {
  const { rows } = await query(
    `select * from trip_guest_codes
      where guest_id = $1 and code = $2 and used_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [guestId, code],
  );
  return rows[0] ?? null;
}

export async function useGuestCode(id) {
  await query('update trip_guest_codes set used_at = now() where id = $1', [id]);
}

// ---------------------------------------------------------------------------
// the share link
// ---------------------------------------------------------------------------

export async function setShareToken(tripId, token) {
  const { rows } = await query(
    'update trips set share_token = coalesce(share_token, $2) where id = $1 returning share_token',
    [tripId, token],
  );
  return rows[0]?.share_token ?? null;
}

export async function tripByShareToken(token) {
  const { rows } = await query('select * from trips where share_token = $1', [token]);
  return rows[0] ?? null;
}
