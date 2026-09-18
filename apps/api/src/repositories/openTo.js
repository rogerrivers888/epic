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
/**
 * The household's own entry, hidden or not.
 *
 * `hidden` is what keeps an entry out of the pool other people are matched
 * from; it is not a reason to tell its owner they have not written one. Filtered
 * here, the screen said "you have no entry" the moment moderation hid it, and
 * writing another violated the unique index on one active entry per scope
 * (Codex, 18 Sep 2026). The pool's own query is where hidden belongs, and it has
 * it.
 */
export async function entryFor(householdId, { scope = 'standing', tripId = null } = {}) {
  const { rows } = await query(
    `select * from open_entries where household_id = $1 and state = 'active' and scope = $2 and ($3::uuid is null or trip_id = $3::uuid) limit 1`,
    [householdId, scope, tripId],
  );
  return rows[0] ?? null;
}

export async function entriesOf(householdId) {
  // A moderator's rejection hides the entry from the pool *and* from the
  // household's own list, so it is not still sitting there looking live
  // (migration 147).
  const { rows } = await query(`select * from open_entries where household_id = $1 and state = 'active' and not hidden order by scope, created_at desc`, [householdId]);
  return rows;
}

/**
 * A new entry, written once with its final scope. It used to insert the
 * defaults and update afterwards, which meant a household's first trip entry
 * momentarily claimed to be a standing one — and if they already had a
 * standing entry, `open_entries_one_standing_idx` refused it outright
 * (Codex, 13 Sep 2026).
 */
export async function insertEntry(householdId, fields = {}, client) {
  const columns = ['household_id'];
  const params = [householdId];
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (fields[key] === undefined) continue;
    params.push(fields[key]);
    columns.push(column);
  }
  const { rows } = await on(client)(
    `insert into open_entries (${columns.join(', ')}) values (${params.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    params,
  );
  return rows[0];
}

export async function updateEntry(id, patch, client) {
  const sets = ['updated_at = now()'];
  // Saying it again is editing it, and an edited sentence is a new thing to
  // look at — which a change of preferences is not (migration 166). Where the
  // old words had been decided, the new ones wait out of sight (Codex, 18 Sep
  // 2026).
  if (patch.transcript !== undefined) {
    sets.push('rewritten_at = now()');
    sets.push(`hidden = case when exists (
      select 1 from content_queue q
       where q.subject_type = 'open_entry' and q.subject_id = open_entries.id::text and q.state <> 'waiting')
      then true else open_entries.hidden end`);
  }
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
    `select * from open_entries where state = 'active' and not hidden and scope = $1 and household_id <> $2 and kind = $3
       and (expires_at is null or expires_at > now())`,
    [wantScope, entry.household_id, entry.kind],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// introductions
// ---------------------------------------------------------------------------

/**
 * One introduction, by its address.
 *
 * An ended one is not readable. The list already dropped them; the point reads
 * did not, so somebody holding an existing link could still fetch a moderated
 * introduction and the private hello videos inside it after the offer behind it
 * had been rejected (Codex, 17 Sep 2026). A moderator's decision has to reach
 * the thing, and a URL somebody already has is the thing.
 *
 * `withEnded` is for the paths that have to see one to act on it — ending it,
 * or reading its state for the person who ended it.
 */
export async function matchById(id, client, { withEnded = false } = {}) {
  const { rows } = await on(client)(
    `select * from open_matches
      where id = $1 and ($2 or stage not in ('ended', 'lapsed'))`, [id, withEnded]);
  return rows[0] ?? null;
}

/**
 * Locked, because two answers can land together and the stage is decided from
 * both — and an ended introduction is not one of the things that can be
 * answered.
 *
 * `matchById` has always refused an ended or lapsed match; this did not, and
 * every path that *changes* a match goes through here. So a rejected offer's
 * introduction could be brought back to life by whoever still had the URL:
 * answering it moved the stage from `ended` to `guest_asked`, and the two of
 * them went on swapping videos (Codex, 18 Sep 2026).
 *
 * `withEnded` is for the paths that have to see one to act on it — reading its
 * state for the person who ended it, or failing an identity check on it.
 */
export async function lockMatch(id, client, { withEnded = false } = {}) {
  const { rows } = await client.query(
    `select * from open_matches
      where id = $1 and ($2 or stage not in ('ended', 'lapsed')) for update`, [id, withEnded]);
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

// ---------------------------------------------------------------------------
// the one ID check (migration 096)
// ---------------------------------------------------------------------------

/** This side's check on this match, if it has started one. */
export async function idCheckFor(matchId, side, client) {
  const { rows } = await on(client)('select * from open_id_checks where match_id = $1 and side = $2', [matchId, side]);
  return rows[0] ?? null;
}

/** Both sides' checks on one match — what the match payload needs to know whose turn it is. */
export async function idChecksOf(matchId) {
  const { rows } = await query('select * from open_id_checks where match_id = $1', [matchId]);
  return rows;
}

/**
 * Start or correct this side's check. A person may replace either image while
 * it is still a draft or has been sent back; once it is passed it is done.
 */
export async function saveIdCheck({ matchId, householdId, side, docMediaId, selfieMediaId, state }, client) {
  const { rows } = await on(client)(
    `insert into open_id_checks (match_id, household_id, side, doc_media_id, selfie_media_id, state)
     values ($1, $2, $3, $4, $5, coalesce($6, 'draft'))
     on conflict (match_id, side) do update set
       doc_media_id = coalesce($4, open_id_checks.doc_media_id),
       selfie_media_id = coalesce($5, open_id_checks.selfie_media_id),
       state = coalesce($6, open_id_checks.state),
       updated_at = now()
     returning *`,
    [matchId, householdId, side, docMediaId ?? null, selfieMediaId ?? null, state ?? null],
  );
  return rows[0];
}

export async function submitIdCheck(id, client) {
  const { rows } = await on(client)(
    `update open_id_checks set state = 'pending', submitted_at = now(), note = null, updated_at = now() where id = $1 returning *`,
    [id],
  );
  return rows[0] ?? null;
}

/** The back office's queue: everything waiting on a decision, oldest first. */
export async function pendingIdChecks() {
  const { rows } = await query(
    `select c.*, m.stage, m.interests, m.kind, h.name as household_name
       from open_id_checks c
       join open_matches m on m.id = c.match_id
       left join households h on h.id = c.household_id
      where c.state = 'pending'
      order by c.submitted_at`,
  );
  return rows;
}

export async function idCheckById(id, client) {
  const { rows } = await on(client)('select * from open_id_checks where id = $1 for update', [id]);
  return rows[0] ?? null;
}

/**
 * The decision, and the end of the images. "We check it and keep nothing but
 * the result" — so the bytes go the moment somebody has looked, pass or fail.
 */
export async function decideIdCheck(id, { state, note, by }, client) {
  const run = on(client);
  const before = (await run('select * from open_id_checks where id = $1', [id])).rows[0];
  if (!before) return null;
  const { rows } = await run(
    `update open_id_checks set state = $2, note = $3, decided_by = $4, decided_at = now(),
       doc_media_id = null, selfie_media_id = null, updated_at = now()
     where id = $1 returning *`,
    [id, state, note ?? null, by ?? null],
  );
  for (const mediaId of [before.doc_media_id, before.selfie_media_id]) {
    if (mediaId) await run('delete from host_media where id = $1', [mediaId]);
  }
  return rows[0] ?? null;
}

/** One check, read without locking it — the back office looking at an image. */
export async function idCheckOf(id) {
  const { rows } = await query('select * from open_id_checks where id = $1', [id]);
  return rows[0] ?? null;
}
