/**
 * Hosts, their offers, the bookings on them and the reviews after (migration 079).
 *
 * Two audiences read these tables. The host sees everything about their own
 * offers, including who booked. A guest sees an offer, the host's public
 * profile, and their own bookings — never another guest's name or money. That
 * split is enforced in routes/hosting.js; the reads here are shaped to make it
 * easy to keep, so nothing here returns a roster unless asked for by host.
 */

import { query, withTransaction } from '../db.js';

const on = (client) => (client ? (t, p) => client.query(t, p) : query);

// ---------------------------------------------------------------------------
// hosts
// ---------------------------------------------------------------------------

export async function hostByHousehold(householdId) {
  const { rows } = await query('select * from hosts where household_id = $1', [householdId]);
  return rows[0] ?? null;
}

export async function hostById(id) {
  const { rows } = await query('select * from hosts where id = $1', [id]);
  return rows[0] ?? null;
}

export async function insertHost(householdId, h) {
  const { rows } = await query(
    `insert into hosts (household_id, account_id, name, type, local_kind, intro_text, location_label, lat, lng, country_code,
                        credentials, languages, children_ages, date_of_birth)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [householdId, h.accountId ?? null, h.name, h.type, h.localKind ?? null, h.introText ?? null, h.locationLabel ?? null,
      h.lat ?? null, h.lng ?? null, h.countryCode ?? null, JSON.stringify(h.credentials ?? []), JSON.stringify(h.languages ?? []),
      JSON.stringify(h.childrenAges ?? []), h.dateOfBirth ?? null],
  );
  return rows[0];
}

const HOST_COLUMNS = {
  name: 'name', type: 'type', localKind: 'local_kind', introText: 'intro_text', introVideoId: 'intro_video_id', photoId: 'photo_id',
  locationLabel: 'location_label', lat: 'lat', lng: 'lng', countryCode: 'country_code', idDocument: 'id_document',
  insuranceConfirmed: 'insurance_confirmed', taxReference: 'tax_reference', payoutStatus: 'payout_status', payoutLabel: 'payout_label',
  dateOfBirth: 'date_of_birth', trust: 'trust', checks: 'checks',
};
const HOST_JSON = { credentials: 'credentials', languages: 'languages', childrenAges: 'children_ages' };

/** A PATCH touches only what it names. */
export async function updateHost(id, patch) {
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(HOST_COLUMNS)) {
    if (patch[key] !== undefined) { params.push(patch[key]); sets.push(`${column} = $${params.length}`); }
  }
  for (const [key, column] of Object.entries(HOST_JSON)) {
    if (patch[key] !== undefined) { params.push(JSON.stringify(patch[key])); sets.push(`${column} = $${params.length}::jsonb`); }
  }
  if (!sets.length) return hostById(id);
  sets.push('updated_at = now()');
  const { rows } = await query(`update hosts set ${sets.join(', ')} where id = $1 returning *`, params);
  return rows[0];
}

/**
 * Hosts with something live near a point, nearest first. Distance is done in
 * SQL with the flat-earth approximation that is fine at the scale of a day
 * out; the route rounds it.
 */
export async function hostsNear({ lat, lng, km = 40, limit = 40 }) {
  const { rows } = await query(
    `select h.*, (select count(*) from host_offers o where o.host_id = h.id and o.state in ('live','paused')) as live_offers,
            sqrt(power((h.lat - $1) * 111.32, 2) + power((h.lng - $2) * 111.32 * cos(radians($1)), 2)) as km
       from hosts h
      where h.lat is not null
        and exists (select 1 from host_offers o where o.host_id = h.id and o.state in ('live','paused'))
        and sqrt(power((h.lat - $1) * 111.32, 2) + power((h.lng - $2) * 111.32 * cos(radians($1)), 2)) <= $3
      order by km asc
      limit $4`,
    [lat, lng, km, limit],
  );
  return rows;
}

/** The whole estate's hosts, for the back office. */
export async function allHosts() {
  const { rows } = await query(
    `select h.*, (select count(*) from host_offers o where o.host_id = h.id and o.state = 'live') as live_offers,
            (select count(*) from host_offers o where o.host_id = h.id and o.state = 'in_review') as in_review,
            (select count(*) from host_reports r where r.host_id = h.id and r.resolved_at is null) as open_reports
       from hosts h order by h.created_at desc`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// offers
// ---------------------------------------------------------------------------

export async function offersOfHost(hostId) {
  const { rows } = await query('select * from host_offers where host_id = $1 order by created_at desc', [hostId]);
  return rows;
}

export async function offerById(id) {
  const { rows } = await query('select * from host_offers where id = $1', [id]);
  return rows[0] ?? null;
}

export async function offerOfHost(id, hostId) {
  const { rows } = await query('select * from host_offers where id = $1 and host_id = $2', [id, hostId]);
  return rows[0] ?? null;
}

export async function insertOffer(hostId, shape, fields = {}) {
  const created = await query('insert into host_offers (host_id, shape) values ($1, $2) returning *', [hostId, shape]);
  return Object.keys(fields).length ? updateOffer(created.rows[0].id, fields) : created.rows[0];
}

const OFFER_COLUMNS = {
  shape: 'shape', state: 'state', pausedUntil: 'paused_until', visibility: 'visibility', title: 'title', description: 'description',
  whyYou: 'why_you', includes: 'includes', category: 'category', videoId: 'video_id',
  venue: 'venue', venueLabel: 'venue_label', venueArea: 'venue_area', venueLat: 'venue_lat', venueLng: 'venue_lng', venueCountry: 'venue_country',
  venueNotes: 'venue_notes', travelRadiusMin: 'travel_radius_min', travelChargePence: 'travel_charge_pence', onlinePlatform: 'online_platform',
  durationMin: 'duration_min', minCount: 'min_count', expectedCount: 'expected_count', maxCount: 'max_count', partyMax: 'party_max', ageLimit: 'age_limit',
  priceMode: 'price_mode', pricePence: 'price_pence', totalPence: 'total_pence', per: 'per', refundRule: 'refund_rule',
  startsOn: 'starts_on', startsAt: 'starts_at', weekday: 'weekday', firstDate: 'first_date', sessions: 'sessions', outcome: 'outcome', arc: 'arc',
  joinMode: 'join_mode', dropInPence: 'drop_in_pence', missedNote: 'missed_note', slotMin: 'slot_min',
  regulatedAnswer: 'regulated_answer', licenceNumber: 'licence_number', licenceExpiry: 'licence_expiry',
  reviewNote: 'review_note', reviewedAt: 'reviewed_at', submittedAt: 'submitted_at', publishedAt: 'published_at', cancelledAt: 'cancelled_at', cancelledNote: 'cancelled_note',
};
const OFFER_JSON = {
  photoIds: 'photo_ids', runningOrder: 'running_order', featuredPeople: 'featured_people', skippedDates: 'skipped_dates', weeks: 'weeks',
  availability: 'availability', reviewChecklist: 'review_checklist',
};

export async function updateOffer(id, patch, client) {
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(OFFER_COLUMNS)) {
    if (patch[key] !== undefined) { params.push(patch[key]); sets.push(`${column} = $${params.length}`); }
  }
  for (const [key, column] of Object.entries(OFFER_JSON)) {
    if (patch[key] !== undefined) { params.push(JSON.stringify(patch[key])); sets.push(`${column} = $${params.length}::jsonb`); }
  }
  if (!sets.length) return offerById(id);
  sets.push('updated_at = now()');
  const { rows } = await on(client)(`update host_offers set ${sets.join(', ')} where id = $1 returning *`, params);
  return rows[0];
}

export async function deleteOffer(id, hostId) {
  await query('delete from host_offers where id = $1 and host_id = $2', [id, hostId]);
}

/** A copy of a one-off on another date: the dashboard's "Add another date". */
export async function cloneOfferOnDate(offer, startsOn, startsAt) {
  const { rows } = await query(
    `insert into host_offers (host_id, shape, state, visibility, title, description, why_you, includes, category, photo_ids, video_id,
        venue, venue_label, venue_area, venue_lat, venue_lng, venue_country, venue_notes, duration_min, min_count, expected_count, max_count,
        party_max, age_limit, price_mode, price_pence, total_pence, per, refund_rule, starts_on, starts_at, running_order, featured_people,
        regulated_answer, licence_number, licence_expiry, published_at, submitted_at)
     select host_id, shape, state, visibility, title, description, why_you, includes, category, photo_ids, video_id,
        venue, venue_label, venue_area, venue_lat, venue_lng, venue_country, venue_notes, duration_min, min_count, expected_count, max_count,
        party_max, age_limit, price_mode, price_pence, total_pence, per, refund_rule, $2::date, coalesce($3::time, starts_at), running_order, featured_people,
        regulated_answer, licence_number, licence_expiry, now(), now()
       from host_offers where id = $1 returning *`,
    [offer.id, startsOn, startsAt ?? null],
  );
  return rows[0];
}

/**
 * Offers a guest can find: live (and paused, which still show but cannot be
 * booked) within reach of a point. `category` narrows to one passion.
 */
export async function offersNear({ lat, lng, km = 40, category = null, limit = 60 }) {
  const params = [lat, lng, km, limit];
  let where = '';
  if (category) { params.push(category); where = `and o.category = $${params.length}`; }
  const { rows } = await query(
    `select o.*, h.name as host_name, h.type as host_type, h.local_kind as host_local_kind, h.trust as host_trust, h.checks as host_checks,
            h.photo_id as host_photo_id, h.location_label as host_location, h.children_ages as host_children_ages,
            sqrt(power((coalesce(o.venue_lat, h.lat) - $1) * 111.32, 2) + power((coalesce(o.venue_lng, h.lng) - $2) * 111.32 * cos(radians($1)), 2)) as km
       from host_offers o join hosts h on h.id = o.host_id
      where o.state in ('live', 'paused') and o.visibility = 'public'
        and coalesce(o.venue_lat, h.lat) is not null
        and (o.shape <> 'oneoff' or o.starts_on >= current_date)
        and sqrt(power((coalesce(o.venue_lat, h.lat) - $1) * 111.32, 2) + power((coalesce(o.venue_lng, h.lng) - $2) * 111.32 * cos(radians($1)), 2)) <= $3
        ${where}
      order by o.state = 'live' desc, km asc, o.starts_on asc nulls last
      limit $4`,
    params,
  );
  return rows;
}

/** Everything waiting for a reviewer, oldest first. */
export async function offersInReview() {
  const { rows } = await query(
    `select o.*, h.name as host_name, h.type as host_type, h.trust as host_trust, h.household_id
       from host_offers o join hosts h on h.id = o.host_id
      where o.state = 'in_review' order by o.submitted_at asc nulls last`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// bookings
// ---------------------------------------------------------------------------

export async function bookingsOfOffer(offerId) {
  const { rows } = await query('select * from experience_bookings where offer_id = $1 order by created_at', [offerId]);
  return rows;
}

export async function bookingsOfOffers(offerIds) {
  if (!offerIds.length) return [];
  const { rows } = await query('select * from experience_bookings where offer_id = any($1::uuid[]) order by created_at', [offerIds]);
  return rows;
}

export async function bookingsOfHousehold(householdId) {
  const { rows } = await query(
    `select b.*, o.title, o.shape, o.starts_on, o.starts_at, o.first_date, o.sessions, o.skipped_dates, o.duration_min, o.venue, o.venue_area, o.venue_label,
            o.state as offer_state, o.cancelled_note as offer_cancelled_note, o.min_count, o.max_count,
            h.name as host_name, h.type as host_type, h.photo_id as host_photo_id,
            (select count(*) from host_reviews r where r.booking_id = b.id and r.side = 'guest') as reviewed
       from experience_bookings b
       join host_offers o on o.id = b.offer_id
       join hosts h on h.id = b.host_id
      where b.household_id = $1
      order by coalesce(o.starts_on, o.first_date, b.created_at::date) asc, b.created_at asc`,
    [householdId],
  );
  return rows;
}

export async function bookingById(id) {
  const { rows } = await query(
    `select b.*, o.title, o.shape, o.starts_on, o.starts_at, o.first_date, o.sessions, o.skipped_dates, o.duration_min, o.venue, o.venue_area, o.venue_label,
            o.venue_notes, o.online_platform, o.refund_rule, o.min_count, o.max_count, o.state as offer_state, o.cancelled_note as offer_cancelled_note,
            o.price_mode, o.price_pence, o.total_pence, o.per, o.expected_count, o.category,
            h.name as host_name, h.type as host_type, h.trust as host_trust, h.photo_id as host_photo_id, h.location_label as host_location,
            (select count(*) from host_reviews r where r.booking_id = b.id and r.side = 'guest') as reviewed
       from experience_bookings b
       join host_offers o on o.id = b.offer_id
       join hosts h on h.id = b.host_id
      where b.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function insertBooking(b, client) {
  const { rows } = await on(client)(
    `insert into experience_bookings (offer_id, host_id, household_id, account_id, booked_by, occurrence, party, heads, state, amount_pence,
                                      address, access_notes, note_to_host, decide_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [b.offerId, b.hostId, b.householdId, b.accountId ?? null, b.bookedBy ?? null, b.occurrence ?? null, JSON.stringify(b.party ?? []), b.heads,
      b.state, b.amountPence ?? 0, b.address ?? null, b.accessNotes ?? null, b.noteToHost ?? null, b.decideBy ?? null],
  );
  return rows[0];
}

export async function updateBooking(id, patch, client) {
  const map = {
    state: 'state', paymentStatus: 'payment_status', paidAt: 'paid_at', refundedAt: 'refunded_at', cancelledAt: 'cancelled_at', cancelledBy: 'cancelled_by',
    amountPence: 'amount_pence', decideBy: 'decide_by',
  };
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(map)) {
    if (patch[key] !== undefined) { params.push(patch[key]); sets.push(`${column} = $${params.length}`); }
  }
  if (!sets.length) return null;
  sets.push('updated_at = now()');
  const { rows } = await on(client)(`update experience_bookings set ${sets.join(', ')} where id = $1 returning *`, params);
  return rows[0];
}

/** Every booking on an offer is refunded and cancelled in one go: the host called it off. */
export async function cancelOfferAndRefund(offerId, note) {
  return withTransaction(async (client) => {
    const { rows: offers } = await client.query(
      `update host_offers set state = 'ended', cancelled_at = now(), cancelled_note = $2, updated_at = now() where id = $1 returning *`,
      [offerId, note ?? null],
    );
    const { rows: bookings } = await client.query(
      `update experience_bookings
          set state = 'cancelled', cancelled_at = now(), cancelled_by = 'host',
              payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end,
              refunded_at = case when payment_status = 'paid' then now() else refunded_at end,
              updated_at = now()
        where offer_id = $1 and state <> 'cancelled' returning *`,
      [offerId],
    );
    return { offer: offers[0], bookings };
  });
}

// ---------------------------------------------------------------------------
// reviews, broadcasts, reports
// ---------------------------------------------------------------------------

export async function insertReview(r) {
  const { rows } = await query(
    `insert into host_reviews (booking_id, offer_id, host_id, household_id, side, stars, chips, text, photo_id, publish_on)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (booking_id, side) do update set stars = excluded.stars, chips = excluded.chips, text = excluded.text, photo_id = excluded.photo_id, publish_on = excluded.publish_on
     returning *`,
    [r.bookingId, r.offerId, r.hostId, r.householdId, r.side ?? 'guest', r.stars, JSON.stringify(r.chips ?? []), r.text ?? null, r.photoId ?? null, r.publishOn],
  );
  return rows[0];
}

/** Published guest reviews of a host, newest first, and the figures a profile shows. */
export async function publishedReviews(hostId) {
  const { rows } = await query(
    `select r.stars, r.chips, r.text, r.publish_on, o.title
       from host_reviews r join host_offers o on o.id = r.offer_id
      where r.host_id = $1 and r.side = 'guest' and r.publish_on <= current_date
      order by r.publish_on desc limit 50`,
    [hostId],
  );
  return rows;
}

export async function ratingOf(hostId) {
  const { rows } = await query(
    `select count(*)::int as count, avg(stars)::numeric(3,2) as rating,
            (select coalesce(sum(heads), 0)::int from experience_bookings b where b.host_id = $1 and b.state = 'attended') as guests
       from host_reviews where host_id = $1 and side = 'guest' and publish_on <= current_date`,
    [hostId],
  );
  return { count: rows[0].count, rating: rows[0].rating == null ? null : Number(rows[0].rating), guests: rows[0].guests };
}

export async function insertBroadcast(offerId, body, sentTo, delivered) {
  const { rows } = await query('insert into host_broadcasts (offer_id, body, sent_to, delivered) values ($1,$2,$3,$4) returning *', [offerId, body, sentTo, delivered]);
  return rows[0];
}

export async function broadcastsOf(offerId) {
  const { rows } = await query('select * from host_broadcasts where offer_id = $1 order by created_at desc limit 20', [offerId]);
  return rows;
}

export async function insertReport({ hostId, offerId, householdId, reason }) {
  const { rows } = await query('insert into host_reports (host_id, offer_id, household_id, reason) values ($1,$2,$3,$4) returning *', [hostId, offerId ?? null, householdId ?? null, reason]);
  return rows[0];
}

export async function openReports() {
  const { rows } = await query(
    `select r.*, h.name as host_name, o.title from host_reports r join hosts h on h.id = r.host_id left join host_offers o on o.id = r.offer_id
      where r.resolved_at is null order by r.created_at desc`,
  );
  return rows;
}

export async function resolveReport(id) {
  await query('update host_reports set resolved_at = now() where id = $1', [id]);
}

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

export async function insertMedia({ householdId, kind, mime, bytes, durationS, madeBy = 'self' }) {
  const { rows } = await query(
    `insert into host_media (household_id, kind, mime, bytes, size, duration_s, made_by) values ($1,$2,$3,$4,$5,$6,$7)
     returning id, household_id, kind, mime, size, duration_s, trim_start_s, trim_end_s, made_by, created_at`,
    [householdId, kind, mime, bytes, bytes.length, durationS ?? null, madeBy],
  );
  return rows[0];
}

export async function mediaById(id) {
  const { rows } = await query('select * from host_media where id = $1', [id]);
  return rows[0] ?? null;
}

export async function mediaMeta(id) {
  const { rows } = await query('select id, household_id, kind, mime, size, duration_s, trim_start_s, trim_end_s, made_by, created_at from host_media where id = $1', [id]);
  return rows[0] ?? null;
}

export async function trimMedia(id, householdId, startS, endS) {
  const { rows } = await query(
    'update host_media set trim_start_s = $3, trim_end_s = $4 where id = $1 and household_id = $2 returning id, kind, mime, size, duration_s, trim_start_s, trim_end_s, made_by, created_at',
    [id, householdId, startS ?? null, endS ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteMedia(id, householdId) {
  await query('delete from host_media where id = $1 and household_id = $2', [id, householdId]);
}

// ---------------------------------------------------------------------------
// group trips: codes and the waiting list (G20, G24)
// ---------------------------------------------------------------------------

export async function insertSignInCode(accountId, codeHash, contact, expiresAt) {
  const { rows } = await query(
    'insert into sign_in_codes (account_id, code_hash, contact, expires_at) values ($1,$2,$3,$4) returning *',
    [accountId, codeHash, contact, expiresAt],
  );
  return rows[0];
}

export async function liveSignInCode(accountId, codeHash) {
  const { rows } = await query(
    `update sign_in_codes set attempts = attempts + 1
      where account_id = $1 and used_at is null and expires_at > now() and attempts < 6
      returning *`,
    [accountId],
  );
  return rows.find((r) => r.code_hash === codeHash) ?? null;
}

export async function useSignInCode(id) {
  await query('update sign_in_codes set used_at = now() where id = $1', [id]);
}

export async function joinWaitlist(groupId, contact, contactKind) {
  const { rows } = await query(
    `insert into group_waitlist (group_id, contact, contact_kind) values ($1,$2,$3)
     on conflict (group_id, contact) do update set contact_kind = excluded.contact_kind returning *`,
    [groupId, contact, contactKind ?? null],
  );
  return rows[0];
}

export async function waitlistOf(groupId) {
  const { rows } = await query('select * from group_waitlist where group_id = $1 order by created_at', [groupId]);
  return rows;
}
