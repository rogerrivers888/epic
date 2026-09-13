/**
 * What people are up for, and the introductions between them (migration 095).
 *
 * Two audiences read these rows and they are not the same. A household sees
 * its own entry whole. The other side of a match sees only what
 * `domain/openTo.js` lets it: no verdict until both are in, no video until
 * both have recorded, and never a surname, a photograph or a contact. The
 * reads here are shaped so routes/openTo.js can keep that easily.
 */

import { query, withTransaction } from '../db.js';

const on = (client) => (client ? (t, p) => client.query(t, p) : query);

const COLUMNS = {
  scope: 'scope', tripId: 'trip_id', interests: 'interests', level: 'level', whenChips: 'when_chips',
  whereLabel: 'where_label', whereMiles: 'where_miles', languages: 'languages', money: 'money',
  prefAge: 'pref_age', prefCompany: 'pref_company', prefFluency: 'pref_fluency',
  kind: 'kind', childAgeBands: 'child_age_bands', transcript: 'transcript', state: 'state',
  reviewDueAt: 'review_due_at', expiresAt: 'expires_at',
};

export async function entryById(id, client) {
  const { rows } = await on(client)('select * from open_entries where id = $1', [id]);
  return rows[0] ?? null;
}

/** This household's live entry for a scope: its standing one, or the one for a trip. */
export async function entryFor(householdId, { scope = 'standing', tripId = null } = {}) {
  const { rows } = await query(
    `select * from open_entries where household_id = $1 and state = 'active' and scope = $2 and ($3::uuid is null or trip_id = $3::uuid) limit 1`,
    [householdId, scope, tripId],
  );
  return rows[0] ?? null;
}

export async function entriesOf(householdId) {
  const { rows } = await query(`select * from open_entries where household_id = $1 and state = 'active' order by scope, created_at desc`, [householdId]);
  return rows;
}

export async function insertEntry(householdId, fields = {}) {
  const { rows } = await query('insert into open_entries (household_id) values ($1) returning *', [householdId]);
  return Object.keys(fields).length ? updateEntry(rows[0].id, fields) : rows[0];
}

export async function updateEntry(id, patch, client) {
  const sets = ['updated_at = now()'];
  const params = [id];
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  const { rows } = await on(client)(`update open_entries set ${sets.join(', ')} where id = $1 returning *`, params);
  return rows[0] ?? null;
}

export async function endEntry(id) {
  await query(`update open_entries set state = 'ended', updated_at = now() where id = $1`, [id]);
}

/** Every entry a new one could be introduced to: live, another household, the opposite scope. */
export async function candidatesFor(entry) {
  const wantScope = entry.scope === 'standing' ? 'trip' : 'standing';
  const { rows } = await query(
    `select * from open_entries where state = 'active' and scope = $1 and household_id <> $2 and kind = $3
       and (expires_at is null or expires_at > now())`,
    [wantScope, entry.household_id, entry.kind],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// introductions
// ---------------------------------------------------------------------------

export async function matchById(id, client) {
  const { rows } = await on(client)('select * from open_matches where id = $1', [id]);
  return rows[0] ?? null;
}

/** Locked, because two answers can land together and the stage is decided from both. */
export async function lockMatch(id, client) {
  const { rows } = await client.query('select * from open_matches where id = $1 for update', [id]);
  return rows[0] ?? null;
}

export async function insertMatch({ hostEntryId, guestEntryId, interests, kind, lapsesAt }) {
  const { rows } = await query(
    `insert into open_matches (host_entry_id, guest_entry_id, interests, kind, lapses_at)
     values ($1, $2, $3, $4, coalesce($5, now() + interval '7 days'))
     on conflict (host_entry_id, guest_entry_id) do nothing returning *`,
    [hostEntryId, guestEntryId, interests ?? [], kind ?? 'adult', lapsesAt ?? null],
  );
  return rows[0] ?? null;
}

const MATCH_COLUMNS = {
  stage: 'stage', hostWhere: 'host_where', hostNote: 'host_note',
  hostVerdict: 'host_verdict', guestVerdict: 'guest_verdict',
  hostAnsweredAt: 'host_answered_at', guestAnsweredAt: 'guest_answered_at',
  hostVideoId: 'host_video_id', guestVideoId: 'guest_video_id',
  hostVideoYes: 'host_video_yes', guestVideoYes: 'guest_video_yes', videosDeletedAt: 'videos_deleted_at',
  hostVerifiedAt: 'host_verified_at', guestVerifiedAt: 'guest_verified_at',
  nudgedAt: 'nudged_at', lapsesAt: 'lapses_at',
};

export async function updateMatch(id, patch, client) {
  const sets = ['updated_at = now()'];
  const params = [id];
  for (const [key, column] of Object.entries(MATCH_COLUMNS)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  const { rows } = await on(client)(`update open_matches set ${sets.join(', ')} where id = $1 returning *`, params);
  return rows[0] ?? null;
}

/** Every introduction this household is part of, on either side of it. */
export async function matchesOf(householdId) {
  const { rows } = await query(
    `select m.*, he.household_id as host_household_id, ge.household_id as guest_household_id
       from open_matches m
       join open_entries he on he.id = m.host_entry_id
       join open_entries ge on ge.id = m.guest_entry_id
      where he.household_id = $1 or ge.household_id = $1
      order by m.created_at desc`,
    [householdId],
  );
  return rows;
}

/** One match with both its entries, for a screen that has to obey the reveal rules. */
export async function matchWithEntries(id, client) {
  const { rows } = await on(client)(
    `select m.*, row_to_json(he) as host_entry, row_to_json(ge) as guest_entry
       from open_matches m
       join open_entries he on he.id = m.host_entry_id
       join open_entries ge on ge.id = m.guest_entry_id
      where m.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Introductions nobody has answered: the ones to nudge once, and the ones to let go. */
export async function openIntroductions() {
  const { rows } = await query(
    `select * from open_matches where stage in ('host_asked', 'guest_asked', 'videos') order by created_at`,
  );
  return rows;
}

/**
 * How many live introductions each of these entries is part of — the people
 * Epic has already asked on their behalf. It is a count and never a list: the
 * card says "three people in Lisbon are up for chess" and nothing more.
 */
export async function liveMatchCounts(entryIds = []) {
  const out = new Map();
  if (!entryIds.length) return out;
  const { rows } = await query(
    `select id, count(*)::int as n from (
       select host_entry_id as id from open_matches where stage in ('host_asked', 'guest_asked', 'videos', 'both_yes', 'verified', 'chat') and host_entry_id = any($1::uuid[])
       union all
       select guest_entry_id as id from open_matches where stage in ('guest_asked', 'videos', 'both_yes', 'verified', 'chat') and guest_entry_id = any($1::uuid[])
     ) t group by id`,
    [entryIds],
  );
  for (const r of rows) out.set(r.id, Number(r.n));
  return out;
}

/** Standing entries whose three months are up, so they can be asked again. */
export async function dueForReview(now = new Date()) {
  const { rows } = await query(
    `select * from open_entries where state = 'active' and scope = 'standing' and review_due_at is not null and review_due_at <= $1`,
    [now],
  );
  return rows;
}

/** Trip entries whose trip has been and gone. */
export async function expiredEntries(now = new Date()) {
  const { rows } = await query(
    `select * from open_entries where state = 'active' and expires_at is not null and expires_at <= $1`,
    [now],
  );
  return rows;
}

export { withTransaction };
