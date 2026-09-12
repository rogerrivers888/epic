/**
 * Hosts and events (Events & Hosts brief v4/v5; build handoff, 12 Sep 2026).
 *
 * Three doors, three audiences:
 *
 *   /api/host…          the host's own side — household-scoped like the rest
 *                       of the API. Their profile, their offers, who booked,
 *                       the money, a broadcast, calling one off.
 *   /api/experiences…   the guest's side. An experience page and a host
 *   /api/hosts/:id      profile are public — "must work logged-out; account
 *                       creation happens after the tap" — so they are resolved
 *                       from the id alone and never reach currentHousehold().
 *                       Booking needs a session, because a booking is a
 *                       household's.
 *   /api/admin/hosting  pitch review and the trust ladder, behind the admin
 *                       door. A host can never set their own trust level.
 *
 * Money: public experiences are Epic-collects only, and Epic has no payment
 * provider (the key is the owner's). A booking is therefore *recorded* — the
 * agreed sum, the party, the date — and every screen says that nothing has
 * left anybody's account. When a provider exists, `payment_status` becomes
 * 'paid' here and nowhere else changes.
 *
 * Licence: nothing rented. Every byte here was written or recorded by a host
 * or a guest.
 */

import express, { Router } from 'express';
import crypto from 'node:crypto';
import * as repo from '../repositories/hosting.js';
import * as accountsRepo from '../repositories/accounts.js';
import { withTransaction } from '../db.js';
import { runOutsideRequest } from '../context.js';
import { currentHousehold, loadMembers } from './household.js';
import { currentAccount } from '../context.js';
import { requires } from '../access.js';
import { mailConfigured, sendMail } from '../sources/mail.js';
import { sendSms, smsConfigured } from '../sources/sms.js';
import {
  ADULT_AGE, AGE_LIMITS, DAY_PARTS, HOST_TYPES, JOIN_MODES, LOCAL_KINDS, MEDIA_MAX_BYTES, PASSIONS, PHOTO_MAX_BYTES, PRICE_MODES, REFUND_RULES,
  REGULATED_COUNTRIES, REVIEW_CHIPS, SHAPES, TRUST_LEVELS, VENUES, VIDEO_MAX_S,
  ageGate, anytimeSlots, decideBy, isRegulated, occurrenceDate, passionLabel, payoutOf, pitchChecklist, priceFor, publishBlockers,
  readsLikeCommentary, reviewPublishOn, seriesDates, standing, takingsAt, ymd,
} from '../domain/hosting.js';

export const router = Router();
export const publicRouter = Router();
export const adminRouter = Router();

const refuse = (status, code, message) => { const e = new Error(message); e.status = status; e.code = code; return e; };
const str = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const int = (v) => (v == null || v === '' ? null : Math.max(0, Math.round(Number(v))) || null);
const oneOf = (all, v) => (all.includes(v) ? v : null);
const list = (v, max = 40) => (Array.isArray(v) ? v.slice(0, max) : []);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Which build of "you can take money" this estate is on. Nothing yet: it says so. */
export const paymentsConfig = () => ({ provider: null, ready: false, note: 'Epic cannot take cards yet — its payment provider is not connected. Nothing is charged; bookings are recorded and honoured.' });

// ---------------------------------------------------------------------------
// payloads
// ---------------------------------------------------------------------------

const mediaRef = (id) => (id ? `/api/media/${id}` : null);

function publicHost(h, rating = { rating: null, count: 0, guests: 0 }, extra = {}) {
  return {
    id: h.id, name: h.name, type: h.type, localKind: h.local_kind, trust: h.trust, checks: h.checks,
    introText: h.intro_text, introVideo: mediaRef(h.intro_video_id), photo: mediaRef(h.photo_id),
    location: h.location_label, lat: h.lat, lng: h.lng, countryCode: h.country_code,
    credentials: h.credentials ?? [], languages: h.languages ?? [], childrenAges: h.children_ages ?? [],
    rating: rating.rating, reviewCount: rating.count, guests: rating.guests,
    // "New on Epic" is not a fourth level: Verified with no reviews yet.
    isNew: rating.count === 0,
    since: h.created_at,
    ...extra,
  };
}

/** The host's own view of themselves adds what a guest must never see. */
function ownHost(h) {
  return {
    ...publicHost(h),
    idDocument: h.id_document, insuranceConfirmed: h.insurance_confirmed,
    taxReference: h.tax_reference ? `••••${String(h.tax_reference).slice(-3)}` : null,
    payoutStatus: h.payout_status, payoutLabel: h.payout_label, dateOfBirth: h.date_of_birth,
  };
}

/**
 * An offer as a guest sees it. `revealed` is whether this reader has a
 * booking on it, which is what decides whether the exact address is shown.
 */
function publicOffer(o, bookings = [], { revealed = false, host = null } = {}) {
  const st = standing(o, bookings);
  const dates = o.shape === 'series' ? seriesDates(o) : [];
  const taken = new Set(bookings.filter((b) => b.state !== 'cancelled').map((b) => b.occurrence));
  return {
    id: o.id, hostId: o.host_id, shape: o.shape, state: o.state, pausedUntil: ymd(o.paused_until), visibility: o.visibility,
    title: o.title, description: o.description, whyYou: o.why_you, includes: o.includes, category: o.category,
    photos: (o.photo_ids ?? []).map(mediaRef), video: mediaRef(o.video_id),
    venue: o.venue, venueArea: o.venue_area, venueLabel: revealed || o.venue === 'out_about' ? o.venue_label : null,
    venueLat: revealed || o.venue === 'out_about' ? o.venue_lat : null, venueLng: revealed || o.venue === 'out_about' ? o.venue_lng : null,
    venueCountry: o.venue_country, venueNotes: o.venue_notes, travelRadiusMin: o.travel_radius_min, travelChargePence: o.travel_charge_pence, onlinePlatform: o.online_platform,
    durationMin: o.duration_min, minCount: o.min_count, expectedCount: o.expected_count, maxCount: o.max_count, partyMax: o.party_max, ageLimit: o.age_limit,
    priceMode: o.price_mode, pricePence: o.price_pence, totalPence: o.total_pence, per: o.per, refundRule: o.refund_rule,
    startsOn: ymd(o.starts_on), startsAt: o.starts_at?.slice(0, 5) ?? null, runningOrder: o.running_order ?? [],
    featuredPeople: (o.featured_people ?? []).map((p) => ({ name: p.name, role: p.role, photo: mediaRef(p.photoId) })),
    weekday: o.weekday, firstDate: ymd(o.first_date), sessions: o.sessions, skippedDates: (o.skipped_dates ?? []).map(ymd), dates,
    outcome: o.outcome, arc: o.arc, weeks: o.weeks ?? [], joinMode: o.join_mode, dropInPence: o.drop_in_pence, missedNote: o.missed_note,
    availability: o.availability ?? {}, slots: o.shape === 'anytime' ? anytimeSlots(o, { taken }) : [],
    standing: st,
    price: priceFor(o, { heads: 1, headsNow: st.heads }),
    regulated: isRegulated(o.venue_country) ? { country: REGULATED_COUNTRIES[o.venue_country.toUpperCase()], answer: o.regulated_answer } : null,
    cancelledNote: o.cancelled_note,
    host,
  };
}

/** The host's own offer adds the roster, the money and what stands between it and Publish. */
function ownOffer(o, host, bookings, broadcasts = []) {
  const live = bookings.filter((b) => b.state !== 'cancelled');
  const collected = live.filter((b) => b.payment_status === 'paid').reduce((n, b) => n + b.amount_pence, 0);
  const recorded = live.filter((b) => b.payment_status === 'recorded').reduce((n, b) => n + b.amount_pence, 0);
  const refunded = bookings.filter((b) => b.payment_status === 'refunded').reduce((n, b) => n + b.amount_pence, 0);
  const runsOn = occurrenceDate(o, null);
  const payoutOn = runsOn ? ymd(new Date(new Date(`${runsOn}T12:00:00Z`).getTime() + 3 * 86400000)) : null;
  return {
    ...publicOffer(o, bookings, { revealed: true }),
    venueLabel: o.venue_label, venueLat: o.venue_lat, venueLng: o.venue_lng,
    blockers: publishBlockers(o, host),
    checklist: pitchChecklist(o),
    licenceNumber: o.licence_number, licenceExpiry: ymd(o.licence_expiry),
    reviewNote: o.review_note, reviewChecklist: o.review_checklist, reviewedAt: o.reviewed_at, submittedAt: o.submitted_at, publishedAt: o.published_at,
    money: {
      collectedPence: collected, recordedPence: recorded, refundedPence: refunded, payoutOn,
      atMinimum: takingsAt(o, o.min_count), atExpected: takingsAt(o, o.expected_count), fee: payoutOf(takingsAt(o, o.expected_count) ?? 0),
    },
    bookings: bookings.map((b) => ({
      id: b.id, name: b.booked_by, heads: b.heads, party: b.party ?? [], occurrence: b.occurrence, state: b.state, paymentStatus: b.payment_status,
      amountPence: b.amount_pence, note: b.note_to_host, address: b.address, accessNotes: b.access_notes, bookedAt: b.created_at,
    })),
    broadcasts: broadcasts.map((b) => ({ id: b.id, body: b.body, sentTo: b.sent_to, delivered: b.delivered, at: b.created_at })),
  };
}

function bookingPayload(b) {
  const offer = { shape: b.shape, starts_on: b.starts_on, first_date: b.first_date, sessions: b.sessions, skipped_dates: b.skipped_dates };
  const on = occurrenceDate(offer, b.occurrence);
  const today = ymd(new Date());
  return {
    id: b.id, offerId: b.offer_id, hostId: b.host_id, title: b.title, shape: b.shape, occurrence: b.occurrence, on,
    startsAt: b.shape === 'anytime' ? b.occurrence?.slice(11, 16) ?? null : b.starts_at?.slice(0, 5) ?? null,
    durationMin: b.duration_min, venue: b.venue, venueArea: b.venue_area,
    // The exact spot is theirs once the booking stands.
    venueLabel: ['confirmed', 'pending', 'attended'].includes(b.state) ? b.venue_label : null,
    venueNotes: b.venue_notes, onlinePlatform: b.online_platform, refundRule: b.refund_rule,
    party: b.party ?? [], heads: b.heads, state: b.state, paymentStatus: b.payment_status, amountPence: b.amount_pence,
    paidAt: b.paid_at, refundedAt: b.refunded_at, cancelledAt: b.cancelled_at, cancelledBy: b.cancelled_by,
    address: b.address, accessNotes: b.access_notes, noteToHost: b.note_to_host, decideBy: ymd(b.decide_by),
    offerState: b.offer_state, offerCancelledNote: b.offer_cancelled_note, minCount: b.min_count, maxCount: b.max_count,
    host: { id: b.host_id, name: b.host_name, type: b.host_type, trust: b.host_trust ?? null, photo: mediaRef(b.host_photo_id), location: b.host_location ?? null },
    isPast: Boolean(on && on < today),
    reviewed: Number(b.reviewed ?? 0) > 0,
    bookedAt: b.created_at,
  };
}

// ---------------------------------------------------------------------------
// the host's own side
// ---------------------------------------------------------------------------

async function myHost() {
  const household = await currentHousehold();
  const host = await repo.hostByHousehold(household.id);
  return { household, host };
}

/** Whether the pitch checks have passed: a first listing is read; after that a host publishes straight to live. */
const hasBeenRead = (offers) => offers.some((o) => o.reviewed_at && o.state !== 'in_review');

/**
 * GET /api/host — the Host tab.
 * Not yet a host: the invitation, with the people already hosting nearby.
 * A host: the dashboard — offers as a menu with their states, bookings, money.
 */
router.get('/host', async (req, res, next) => {
  try {
    const { household, host } = await myHost();
    const account = currentAccount();
    const home = household.home_lat != null ? { lat: household.home_lat, lng: household.home_lng } : null;
    const nearbyRows = home ? await repo.hostsNear({ lat: home.lat, lng: home.lng, km: 60, limit: 12 }) : [];
    const nearby = await Promise.all(nearbyRows.filter((h) => !host || h.id !== host.id).map(async (h) => publicHost(h, await repo.ratingOf(h.id), { km: Math.round(Number(h.km)), liveOffers: Number(h.live_offers) })));
    const config = { payments: paymentsConfig(), passions: PASSIONS.map((key) => ({ key, label: passionLabel(key) })), regulated: REGULATED_COUNTRIES, videoMaxSeconds: VIDEO_MAX_S };
    if (!host) {
      return res.json({ host: null, offers: [], stats: null, nearby, config, you: { name: account?.name ?? null, email: account?.email ?? null } });
    }
    const offers = await repo.offersOfHost(host.id);
    const bookings = await repo.bookingsOfOffers(offers.map((o) => o.id));
    const byOffer = (id) => bookings.filter((b) => b.offer_id === id);
    const rating = await repo.ratingOf(host.id);
    const live = bookings.filter((b) => b.state !== 'cancelled');
    res.json({
      host: { ...ownHost(host), rating: rating.rating, reviewCount: rating.count, guests: rating.guests, isNew: rating.count === 0 },
      offers: offers.map((o) => ownOffer(o, host, byOffer(o.id))),
      stats: {
        live: offers.filter((o) => o.state === 'live').length,
        booked: live.reduce((n, b) => n + b.heads, 0),
        toComePence: live.filter((b) => b.payment_status !== 'refunded').reduce((n, b) => n + b.amount_pence, 0),
        joinedThisWeek: live.filter((b) => Date.now() - new Date(b.created_at).getTime() < 7 * 86400000).length,
        nextPayoutOn: offers.filter((o) => o.state === 'live').map((o) => occurrenceDate(o, null)).filter(Boolean).sort()[0] ?? null,
      },
      nearby, config,
      firstListingRead: hasBeenRead(offers),
    });
  } catch (err) { next(err); }
});

const hostBody = (b) => ({
  name: str(b.name, 120), type: oneOf(HOST_TYPES, b.type), localKind: oneOf(LOCAL_KINDS, b.localKind),
  introText: str(b.introText, 1200), locationLabel: str(b.locationLabel, 200), lat: b.lat == null ? null : Number(b.lat), lng: b.lng == null ? null : Number(b.lng),
  countryCode: str(b.countryCode, 2)?.toUpperCase() ?? null,
  credentials: list(b.credentials, 20).map((c) => str(c, 80)).filter(Boolean),
  languages: list(b.languages, 12).map((c) => str(c, 40)).filter(Boolean),
  childrenAges: list(b.childrenAges, 8).map(int).filter((n) => n != null),
  dateOfBirth: b.dateOfBirth ? ymd(b.dateOfBirth) : null,
});

const ageFromDob = (dob) => { if (!dob) return null; const b = new Date(dob); const n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a -= 1; return a; };

/** POST /api/host — become a host. Step 1 of onboarding: who you are and what kind of host. */
router.post('/host', async (req, res, next) => {
  try {
    const { household, host } = await myHost();
    if (host) return res.status(409).json({ error: 'already_host', message: 'This household already hosts on Epic.' });
    const b = hostBody(req.body ?? {});
    if (!b.name) throw refuse(400, 'name_required', 'Say who you are.');
    if (!b.type) throw refuse(400, 'type_required', 'Pick what kind of host you are.');
    if (b.type === 'local' && !b.localKind) throw refuse(400, 'local_kind_required', 'Say what kind of Local you are.');
    // Hosts are 18+ (brief §9), and the form is not the boundary: no date of birth, no host.
    if (!b.dateOfBirth) throw refuse(400, 'dob_required', 'Your date of birth — hosts on Epic are eighteen or over.');
    const age = ageFromDob(b.dateOfBirth);
    if (age == null || age < ADULT_AGE) throw refuse(400, 'too_young', 'Hosts on Epic are eighteen or over.');
    const account = currentAccount();
    const created = await repo.insertHost(household.id, { ...b, accountId: account?.id ?? null });
    res.status(201).json({ host: ownHost(created) });
  } catch (err) { next(err); }
});

router.patch('/host', async (req, res, next) => {
  try {
    const { host } = await myHost();
    if (!host) throw refuse(404, 'not_a_host', 'You are not hosting yet.');
    const b = req.body ?? {};
    const patch = {};
    const fields = hostBody(b);
    for (const k of ['name', 'type', 'localKind', 'introText', 'locationLabel', 'lat', 'lng', 'countryCode', 'dateOfBirth']) if (b[k] !== undefined) patch[k] = fields[k];
    for (const k of ['credentials', 'languages', 'childrenAges']) if (b[k] !== undefined) patch[k] = fields[k];
    if (b.introVideoId !== undefined) patch.introVideoId = b.introVideoId ? await ownMedia(host.household_id, b.introVideoId, 'video') : null;
    if (b.photoId !== undefined) patch.photoId = b.photoId ? await ownMedia(host.household_id, b.photoId, 'photo') : null;
    if (b.idDocument !== undefined) patch.idDocument = oneOf(['passport', 'driving_licence'], b.idDocument);
    if (b.insuranceConfirmed !== undefined) patch.insuranceConfirmed = Boolean(b.insuranceConfirmed);
    if (b.taxReference !== undefined) patch.taxReference = str(b.taxReference, 20);
    if (b.payoutStatus !== undefined) {
      // 'connected' is what Stripe says back, and Stripe is not here yet.
      if (b.payoutStatus === 'connected' && !paymentsConfig().ready) throw refuse(409, 'payments_not_ready', paymentsConfig().note);
      patch.payoutStatus = oneOf(['not_connected', 'connected'], b.payoutStatus) ?? 'not_connected';
    }
    if (patch.dateOfBirth && ageFromDob(patch.dateOfBirth) < ADULT_AGE) throw refuse(400, 'too_young', 'Hosts on Epic are eighteen or over.');
    // A host may never raise their own trust; that is the back office's.
    delete patch.trust; delete patch.checks;
    const updated = await repo.updateHost(host.id, patch);
    res.json({ host: ownHost(updated) });
  } catch (err) { next(err); }
});

/** A media id is only usable by the household that uploaded it, and only for what it is. */
async function ownMedia(householdId, id, kind) {
  const m = await repo.mediaMeta(id);
  if (!m || m.household_id !== householdId || (kind && m.kind !== kind)) throw refuse(400, 'bad_media', 'That file is not one of yours.');
  return m.id;
}

// --- media -----------------------------------------------------------------

const mediaMeta = (m) => ({ id: m.id, url: mediaRef(m.id), kind: m.kind, mime: m.mime, size: m.size, durationS: m.duration_s, trimStartS: m.trim_start_s, trimEndS: m.trim_end_s, madeBy: m.made_by });

/**
 * POST /api/host/media?kind=video|photo&duration=38 — the bytes, raw.
 * A self-shot clip from the browser's recorder, or a photograph. Held in the
 * database (host_media) because the disk does not survive a deploy.
 */
router.post('/host/media', express.raw({ type: () => true, limit: '41mb' }), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const kind = oneOf(['video', 'photo'], String(req.query.kind ?? ''));
    if (!kind) throw refuse(400, 'kind_required', 'Say whether this is a video or a photo.');
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    if (!bytes?.length) throw refuse(400, 'empty', 'Nothing was uploaded.');
    const cap = kind === 'video' ? MEDIA_MAX_BYTES : PHOTO_MAX_BYTES;
    if (bytes.length > cap) throw refuse(413, 'too_big', kind === 'video' ? 'That video is too big. Thirty to sixty seconds is plenty.' : 'That photo is too big.');
    const mime = String(req.headers['content-type'] || (kind === 'video' ? 'video/webm' : 'image/jpeg')).split(';')[0].trim();
    if (kind === 'video' && !mime.startsWith('video/')) throw refuse(400, 'bad_type', 'That is not a video.');
    if (kind === 'photo' && !mime.startsWith('image/')) throw refuse(400, 'bad_type', 'That is not a picture.');
    const durationS = int(req.query.duration);
    if (kind === 'video' && durationS && durationS > VIDEO_MAX_S) throw refuse(413, 'too_long', `A video can be up to ${VIDEO_MAX_S} seconds. Thirty to sixty is plenty.`);
    const m = await repo.insertMedia({ householdId: household.id, kind, mime, bytes, durationS });
    res.status(201).json({ media: mediaMeta(m) });
  } catch (err) { next(err); }
});

/** PATCH /api/host/media/:id — the simple trim: two marks, no re-encoding. */
router.patch('/host/media/:id', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const m = await repo.trimMedia(req.params.id, household.id, int(req.body?.trimStartS) ?? 0, int(req.body?.trimEndS));
    if (!m) throw refuse(404, 'not_found', 'That file is not one of yours.');
    res.json({ media: mediaMeta(m) });
  } catch (err) { next(err); }
});

router.delete('/host/media/:id', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    await repo.deleteMedia(req.params.id, household.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

/** GET /api/media/:id — the bytes. Public: the page it plays on is public, and the id is unguessable. */
publicRouter.get('/media/:id', async (req, res, next) => {
  try {
    const m = await repo.mediaById(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.setHeader('content-type', m.mime);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('accept-ranges', 'bytes');
    // A video element asks for ranges; answer them so it can seek.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && m.kind === 'video') {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), m.size - 1) : m.size - 1;
      if (start >= m.size) return res.status(416).end();
      res.status(206);
      res.setHeader('content-range', `bytes ${start}-${end}/${m.size}`);
      res.setHeader('content-length', end - start + 1);
      return res.end(m.bytes.subarray(start, end + 1));
    }
    res.setHeader('content-length', m.size);
    res.end(m.bytes);
  } catch (err) { next(err); }
});

// --- offers ----------------------------------------------------------------

async function myOffer(id) {
  const { household, host } = await myHost();
  if (!host) throw refuse(404, 'not_a_host', 'You are not hosting yet.');
  const offer = await repo.offerOfHost(id, host.id);
  if (!offer) throw refuse(404, 'offer_not_found', 'That offer is not one of yours.');
  return { household, host, offer };
}

async function ownOfferPayload(offer, host) {
  const [bookings, broadcasts] = await Promise.all([repo.bookingsOfOffer(offer.id), repo.broadcastsOf(offer.id)]);
  return ownOffer(offer, host, bookings, broadcasts);
}

/** POST /api/host/offers — a draft, of one shape. Step 1 is the fork. */
router.post('/host/offers', async (req, res, next) => {
  try {
    const { host } = await myHost();
    if (!host) throw refuse(404, 'not_a_host', 'Become a host first.');
    const shape = oneOf(SHAPES, req.body?.shape);
    if (!shape) throw refuse(400, 'shape_required', 'Pick a shape: one-off, series or anytime.');
    const offer = await repo.insertOffer(host.id, shape, { ageLimit: host.local_kind === 'night_out' ? 18 : null });
    res.status(201).json({ offer: await ownOfferPayload(offer, host) });
  } catch (err) { next(err); }
});

router.get('/host/offers/:id', async (req, res, next) => {
  try {
    const { host, offer } = await myOffer(req.params.id);
    res.json({ offer: await ownOfferPayload(offer, host) });
  } catch (err) { next(err); }
});

/** What the wizard may write. Anything else on the row is the API's to set. */
function offerBody(b, current) {
  const p = {};
  const set = (k, v) => { if (b[k] !== undefined) p[k] = v; };
  set('shape', oneOf(SHAPES, b.shape) ?? current.shape);
  set('title', str(b.title, 120)); set('description', str(b.description, 4000)); set('whyYou', str(b.whyYou, 2000)); set('includes', str(b.includes, 400));
  set('category', b.category == null ? null : (PASSIONS.includes(b.category) ? b.category : str(b.category, 40)));
  set('venue', oneOf(VENUES, b.venue) ?? current.venue);
  set('venueLabel', str(b.venueLabel, 240)); set('venueArea', str(b.venueArea, 120));
  set('venueLat', b.venueLat == null ? null : Number(b.venueLat)); set('venueLng', b.venueLng == null ? null : Number(b.venueLng));
  set('venueCountry', str(b.venueCountry, 2)?.toUpperCase() ?? null); set('venueNotes', str(b.venueNotes, 600));
  set('travelRadiusMin', int(b.travelRadiusMin)); set('travelChargePence', int(b.travelChargePence)); set('onlinePlatform', str(b.onlinePlatform, 80));
  set('durationMin', int(b.durationMin));
  set('minCount', int(b.minCount)); set('expectedCount', int(b.expectedCount)); set('maxCount', int(b.maxCount)); set('partyMax', int(b.partyMax));
  set('ageLimit', b.ageLimit == null ? null : (AGE_LIMITS.includes(Number(b.ageLimit)) ? Number(b.ageLimit) : null));
  set('priceMode', oneOf(PRICE_MODES, b.priceMode) ?? current.price_mode); set('pricePence', int(b.pricePence)); set('totalPence', int(b.totalPence));
  set('per', oneOf(['person', 'household'], b.per) ?? current.per); set('refundRule', oneOf(REFUND_RULES, b.refundRule) ?? current.refund_rule);
  set('startsOn', b.startsOn ? ymd(b.startsOn) : null); set('startsAt', b.startsAt ? String(b.startsAt).slice(0, 5) : null);
  set('runningOrder', list(b.runningOrder, 24).map((r) => ({ time: str(r.time, 8), title: str(r.title, 120), detail: str(r.detail, 200) })).filter((r) => r.title));
  set('featuredPeople', list(b.featuredPeople, 12).map((r) => ({ name: str(r.name, 80), role: str(r.role, 120), photoId: r.photoId ?? null })).filter((r) => r.name));
  set('weekday', b.weekday == null ? null : Math.min(6, Math.max(0, Number(b.weekday))));
  set('firstDate', b.firstDate ? ymd(b.firstDate) : null); set('sessions', int(b.sessions));
  set('skippedDates', list(b.skippedDates, 52).map(ymd).filter(Boolean));
  set('outcome', str(b.outcome, 600)); set('arc', str(b.arc, 1200));
  set('weeks', list(b.weeks, 52).map((w, i) => ({ n: int(w.n) ?? i + 1, title: str(w.title, 160) })).filter((w) => w.title));
  set('joinMode', oneOf(JOIN_MODES, b.joinMode)); set('dropInPence', int(b.dropInPence)); set('missedNote', str(b.missedNote, 300));
  set('availability', { days: list(b.availability?.days, 7).map(Number).filter((n) => n >= 0 && n <= 6), parts: list(b.availability?.parts, 3).filter((x) => DAY_PARTS.includes(x)) });
  set('slotMin', int(b.slotMin));
  set('regulatedAnswer', oneOf(['no_commentary', 'licensed'], b.regulatedAnswer)); set('licenceNumber', str(b.licenceNumber, 60)); set('licenceExpiry', b.licenceExpiry ? ymd(b.licenceExpiry) : null);
  set('visibility', oneOf(['public', 'link'], b.visibility) ?? current.visibility);
  return p;
}

router.patch('/host/offers/:id', async (req, res, next) => {
  try {
    const { household, host, offer } = await myOffer(req.params.id);
    const b = req.body ?? {};
    const patch = offerBody(b, offer);
    if (b.videoId !== undefined) patch.videoId = b.videoId ? await ownMedia(household.id, b.videoId, 'video') : null;
    if (b.photoIds !== undefined) patch.photoIds = await Promise.all(list(b.photoIds, 8).map((id) => ownMedia(household.id, id, 'photo')));
    // Free is free: clear the figures rather than leaving a ghost price.
    if (patch.priceMode === 'free') { patch.pricePence = null; patch.totalPence = null; }
    // A night out stays 18+ whatever the form sends.
    if (host.local_kind === 'night_out') patch.ageLimit = 18;
    const updated = await repo.updateOffer(offer.id, patch);
    res.json({ offer: await ownOfferPayload(updated, host) });
  } catch (err) { next(err); }
});

router.delete('/host/offers/:id', async (req, res, next) => {
  try {
    const { host, offer } = await myOffer(req.params.id);
    const bookings = await repo.bookingsOfOffer(offer.id);
    if (bookings.some((b) => b.state !== 'cancelled')) throw refuse(409, 'has_bookings', 'People have booked this. Call it off instead, so they are told and refunded.');
    await repo.deleteOffer(offer.id, host.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * POST /api/host/offers/:id/submit — publish.
 * A host's first listing is read (the pitch review, 48 hours); after one has
 * been read and passed, the rest go live at once. Nothing goes live with a
 * blocker standing.
 */
router.post('/host/offers/:id/submit', async (req, res, next) => {
  try {
    const { host, offer } = await myOffer(req.params.id);
    const blockers = publishBlockers(offer, host);
    if (blockers.length) return res.status(422).json({ error: 'not_ready', message: blockers[0], blockers });
    const offers = await repo.offersOfHost(host.id);
    const straightToLive = hasBeenRead(offers);
    const updated = await repo.updateOffer(offer.id, {
      state: straightToLive ? 'live' : 'in_review',
      submittedAt: new Date(),
      publishedAt: straightToLive ? new Date() : null,
      reviewChecklist: pitchChecklist(offer),
    });
    res.json({ offer: await ownOfferPayload(updated, host), inReview: !straightToLive });
  } catch (err) { next(err); }
});

/** POST …/pause {until} — paused must not read as gone; it keeps its place and says when it is back. */
router.post('/host/offers/:id/pause', async (req, res, next) => {
  try {
    const { host, offer } = await myOffer(req.params.id);
    if (!['live', 'paused'].includes(offer.state)) throw refuse(409, 'not_live', 'Only a live offer can be paused.');
    const updated = await repo.updateOffer(offer.id, { state: 'paused', pausedUntil: req.body?.until ? ymd(req.body.until) : null });
    res.json({ offer: await ownOfferPayload(updated, host) });
  } catch (err) { next(err); }
});

router.post('/host/offers/:id/resume', async (req, res, next) => {
  try {
    const { host, offer } = await myOffer(req.params.id);
    if (offer.state !== 'paused') throw refuse(409, 'not_paused', 'This offer is not paused.');
    const updated = await repo.updateOffer(offer.id, { state: 'live', pausedUntil: null });
    res.json({ offer: await ownOfferPayload(updated, host) });
  } catch (err) { next(err); }
});

/** POST …/cancel {note} — call it off: everyone is told and refunded. */
router.post('/host/offers/:id/cancel', async (req, res, next) => {
  try {
    const { host, offer } = await myOffer(req.params.id);
    const note = str(req.body?.note, 300) ?? `${host.name} called this off.`;
    const { offer: ended, bookings } = await repo.cancelOfferAndRefund(offer.id, note);
    const told = await tellBooked(bookings, `${offer.title ?? 'Your booking'} has been called off. ${note} Anything paid is refunded to the card it was paid with.`);
    res.json({ offer: await ownOfferPayload(ended, host), told });
  } catch (err) { next(err); }
});

/** POST …/broadcast {body} — one message to everyone booked. */
router.post('/host/offers/:id/broadcast', async (req, res, next) => {
  try {
    const { host, offer } = await myOffer(req.params.id);
    const body = str(req.body?.body, 1000);
    if (!body) throw refuse(400, 'body_required', 'Say something.');
    const bookings = (await repo.bookingsOfOffer(offer.id)).filter((b) => b.state !== 'cancelled');
    const told = await tellBooked(bookings, `${host.name}, about ${offer.title ?? 'your booking'}: ${body}`);
    await repo.insertBroadcast(offer.id, body, told.sentTo, told.delivered);
    res.json({ offer: await ownOfferPayload(offer, host), told });
  } catch (err) { next(err); }
});

/** POST …/dates {startsOn, startsAt} — another date of the same one-off. */
router.post('/host/offers/:id/dates', async (req, res, next) => {
  try {
    const { host, offer } = await myOffer(req.params.id);
    if (offer.shape !== 'oneoff') throw refuse(409, 'not_oneoff', 'Only a one-off gets another date; a series has its weeks and an anytime offer its diary.');
    const startsOn = req.body?.startsOn ? ymd(req.body.startsOn) : null;
    if (!startsOn) throw refuse(400, 'date_required', 'Pick the date.');
    const copy = await repo.cloneOfferOnDate(offer, startsOn, req.body?.startsAt ? String(req.body.startsAt).slice(0, 5) : null);
    res.status(201).json({ offer: await ownOfferPayload(copy, host) });
  } catch (err) { next(err); }
});

/**
 * Reach everyone booked, by whatever contact their account has. A sender is a
 * key and keys are the owner's; with none configured the message is recorded
 * and the host is told how many it could not reach, never that it was sent.
 */
async function tellBooked(bookings, text) {
  const households = [...new Set(bookings.map((b) => b.household_id))];
  let delivered = 0;
  for (const householdId of households) {
    const accounts = await accountsRepo.accountsForHousehold(householdId);
    const a = accounts[0];
    if (!a) continue;
    try {
      // The senders answer `{ sent }` rather than throwing; only a delivered one counts.
      if (a.email && mailConfigured()) { if ((await sendMail({ to: a.email, subject: 'From your Epic host', text })).sent) delivered += 1; }
      else if (a.mobile && smsConfigured()) { if ((await sendSms({ to: a.mobile, text: `Epic: ${text}` })).sent) delivered += 1; }
    } catch { /* recorded below as not delivered */ }
  }
  return { sentTo: households.length, delivered, channel: mailConfigured() || smsConfigured() ? 'sender' : 'none' };
}

// ---------------------------------------------------------------------------
// the guest's side
// ---------------------------------------------------------------------------

/** A public host with its rating and its offer menu. */
async function hostPage(h) {
  const [rating, offers, reviews] = await Promise.all([repo.ratingOf(h.id), repo.offersOfHost(h.id), repo.publishedReviews(h.id)]);
  const shown = offers.filter((o) => ['live', 'paused'].includes(o.state) && o.visibility === 'public');
  const bookings = await repo.bookingsOfOffers(shown.map((o) => o.id));
  return {
    host: publicHost(h, rating),
    offers: shown.map((o) => publicOffer(o, bookings.filter((b) => b.offer_id === o.id))),
    reviews: reviews.map((r) => ({ stars: r.stars, chips: r.chips ?? [], text: r.text, on: ymd(r.publish_on), title: r.title })),
  };
}

/** GET /api/hosts/:id — the profile. Public. */
publicRouter.get('/hosts/:id', async (req, res, next) => {
  try {
    const h = await repo.hostById(req.params.id);
    if (!h) return res.status(404).json({ error: 'not_found', message: 'There is no host at that address.' });
    res.json(await hostPage(h));
  } catch (err) { next(err); }
});

/** POST /api/hosts/:id/report {reason} — on every profile and every page. Public, rate-limited with everything else. */
publicRouter.post('/hosts/:id/report', async (req, res, next) => {
  try {
    const h = await repo.hostById(req.params.id);
    if (!h) return res.status(404).json({ error: 'not_found' });
    const reason = str(req.body?.reason, 1000);
    if (!reason) throw refuse(400, 'reason_required', 'Say what is wrong.');
    const offer = req.body?.offerId ? await repo.offerById(req.body.offerId) : null;
    await repo.insertReport({ hostId: h.id, offerId: offer?.host_id === h.id ? offer.id : null, householdId: currentAccount()?.household_id ?? null, reason });
    res.status(201).json({ ok: true, message: 'Thank you. Somebody at Epic reads every report.' });
  } catch (err) { next(err); }
});

/** GET /api/experiences/:id — the page. Public; never the exact address of their place. */
publicRouter.get('/experiences/:id', async (req, res, next) => {
  // `/experiences/near` is a list for the signed-in app (below), not a page.
  if (req.params.id === 'near' || req.params.id === 'passions') return next();
  try {
    const o = await repo.offerById(req.params.id);
    if (!o || o.state === 'draft' || o.state === 'in_review') return res.status(404).json({ error: 'not_found', message: 'There is no experience at that address yet.' });
    const h = await repo.hostById(o.host_id);
    const [bookings, rating] = await Promise.all([repo.bookingsOfOffer(o.id), repo.ratingOf(h.id)]);
    const others = (await repo.offersOfHost(h.id)).filter((x) => x.id !== o.id && x.state === 'live' && x.visibility === 'public').length;
    res.json({ offer: publicOffer(o, bookings, { host: publicHost(h, rating, { otherOffers: others }) }), payments: paymentsConfig() });
  } catch (err) { next(err); }
});

/** GET /api/experiences/:id/mine — this household's bookings on it, so the page can reveal what booking earns. */
router.get('/experiences/:id/mine', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const rows = (await repo.bookingsOfHousehold(household.id)).filter((b) => b.offer_id === req.params.id);
    const members = await loadMembers(household.id);
    res.json({
      bookings: rows.map(bookingPayload),
      party: members.map((m) => ({ id: m.id, name: m.name, age: m.age, child: m.isMinor || (m.age != null && m.age < ADULT_AGE), avatarUrl: m.avatarUrl })),
      you: currentAccount()?.name ?? members.find((m) => !m.isMinor)?.name ?? household.name,
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/experiences/near?lat&lng&km&love — cards for Inspire and for the
 * passion-led surface. People, with faces and type chips, not a catalogue.
 */
router.get('/experiences/near', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat); const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw refuse(400, 'where', 'Say where to look.');
    const km = Math.min(200, Math.max(2, Number(req.query.km) || 40));
    const love = req.query.love ? String(req.query.love) : null;
    const rows = await repo.offersNear({ lat, lng, km, category: love });
    const bookings = await repo.bookingsOfOffers(rows.map((o) => o.id));
    const ratings = new Map();
    for (const o of rows) if (!ratings.has(o.host_id)) ratings.set(o.host_id, await repo.ratingOf(o.host_id));
    const cards = rows.map((o) => ({
      ...publicOffer(o, bookings.filter((b) => b.offer_id === o.id), {
        host: publicHost({ id: o.host_id, name: o.host_name, type: o.host_type, local_kind: o.host_local_kind, trust: o.host_trust, checks: o.host_checks, photo_id: o.host_photo_id, location_label: o.host_location, children_ages: o.host_children_ages, credentials: [], languages: [] }, ratings.get(o.host_id)),
      }),
      km: Math.round(Number(o.km) * 10) / 10,
    }));
    // The passions with somebody near: "Painting · 7 people".
    const all = love ? await repo.offersNear({ lat, lng, km }) : rows;
    const passions = {};
    for (const o of all) { if (!o.category) continue; (passions[o.category] ??= new Set()).add(o.host_id); }
    res.json({
      cards,
      passions: Object.entries(passions).map(([key, hosts]) => ({ key, label: passionLabel(key), people: hosts.size })).sort((a, b) => b.people - a.people),
      allPassions: PASSIONS.map((key) => ({ key, label: passionLabel(key) })),
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/experiences/:id/book — a place.
 * The party is named from the household, the age gate is applied plainly, the
 * price is this API's arithmetic and never the browser's, and the booking is
 * held until the minimum is met where one applies.
 */
router.post('/experiences/:id/book', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const o = await repo.offerById(req.params.id);
    if (!o || o.state !== 'live') throw refuse(409, 'not_bookable', o?.state === 'paused' ? `This is paused${o.paused_until ? ` — back ${ymd(o.paused_until)}` : ''}. It is not taking bookings just now.` : 'This experience is not taking bookings.');
    const host = await repo.hostById(o.host_id);
    if (host.household_id === household.id) throw refuse(409, 'own_offer', 'You cannot book your own experience.');
    const b = req.body ?? {};
    const party = list(b.party, 12).map((p) => ({ name: str(p.name, 80), age: p.age == null ? null : int(p.age), child: Boolean(p.child) })).filter((p) => p.name);
    if (!party.length) throw refuse(400, 'party_required', 'Say who is coming.');
    const gate = ageGate(o, party);
    if (gate.blocked.length) throw refuse(400, 'age_limit', `Over ${gate.limit} only — ${gate.blocked.map((p) => p.name).join(', ')} cannot come to this one.`);
    // Guests booking alone are 18+; under-18s come as named party members with an adult.
    if (!gate.hasAdult) throw refuse(400, 'adult_required', 'A booking needs an adult in the party.');
    if (o.party_max && party.length > o.party_max) throw refuse(400, 'party_too_big', `The most one booking can bring is ${o.party_max}.`);
    if (o.venue === 'your_place' && !str(b.address, 300)) throw refuse(400, 'address_required', `${host.name} comes to you, so we need the address and how to get in.`);

    const today = ymd(new Date());
    // Which instance. Nothing in the past is bookable, whatever the page still shows.
    let occurrence = null;
    if (o.shape === 'oneoff') {
      occurrence = ymd(o.starts_on);
      if (!occurrence || occurrence < today) throw refuse(409, 'past', 'This one has already happened.');
    } else if (o.shape === 'series') {
      const dates = seriesDates(o);
      occurrence = b.occurrence === 'whole' || !b.occurrence ? 'whole' : ymd(b.occurrence);
      if (occurrence === 'whole' && o.join_mode === 'drop_in') throw refuse(400, 'drop_in_only', 'This series is drop-in only: pick a session.');
      if (occurrence !== 'whole' && (o.join_mode === 'whole' || !dates.includes(occurrence))) throw refuse(400, 'whole_only', 'This series is booked as a whole run.');
      if (occurrence === 'whole' ? !dates.some((d) => d >= today) : occurrence < today) throw refuse(409, 'past', 'That session has already happened.');
    } else {
      occurrence = String(b.occurrence ?? '');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(occurrence)) throw refuse(400, 'slot_required', 'Pick a time.');
    }

    /**
     * The count, the decision and the row are one transaction with the offer
     * locked: two guests booking the last places at once would otherwise each
     * read the same count and each be let in (Codex, 12 Sep 2026).
     */
    const booking = await withTransaction(async (client) => {
      await repo.lockOffer(o.id, client);
      const existing = await repo.bookingsOfOffer(o.id, client);
      if (o.shape === 'anytime') {
        const taken = new Set(existing.filter((x) => x.state !== 'cancelled').map((x) => x.occurrence));
        const ok = anytimeSlots(o, { taken }).some((d) => occurrence.startsWith(d.date) && d.times.includes(occurrence.slice(11, 16)));
        if (!ok) throw refuse(409, 'slot_gone', 'That time is not free any more. Pick another.');
      }
      const st = standing(o, existing, occurrence);
      const heads = party.length;
      const price = priceFor(o, { heads, occurrence, headsNow: st.heads + heads });
      const full = Boolean(o.max_count && st.heads + heads > o.max_count);
      const state = full ? 'waitlisted' : (!o.min_count || st.heads + heads >= o.min_count) ? 'confirmed' : 'pending';
      const made = await repo.insertBooking({
        offerId: o.id, hostId: host.id, householdId: household.id, accountId: currentAccount()?.id ?? null,
        bookedBy: str(b.bookedBy, 80) ?? currentAccount()?.name ?? party.find((p) => !p.child)?.name ?? null,
        occurrence, party, heads, state, amountPence: price.pence,
        address: str(b.address, 300), accessNotes: str(b.accessNotes, 400), noteToHost: str(b.noteToHost, 600),
        decideBy: state === 'pending' ? decideBy(o, occurrence) : null,
      }, client);
      // Reaching the minimum confirms whoever was held — each on their own
      // instance's count, now that this booking is in. A whole-run booking
      // sits in every session, so it can tip a Thursday over the line; it
      // cannot confirm a drop-in on a Thursday that is still short.
      if (state === 'confirmed' && o.min_count) {
        const now = [...existing, made];
        for (const held of existing.filter((x) => x.state === 'pending')) {
          if (standing(o, now, held.occurrence).minimumMet) await repo.updateBooking(held.id, { state: 'confirmed', decideBy: null }, client);
        }
      }
      return made;
    });
    const row = await repo.bookingById(booking.id);
    res.status(201).json({ booking: bookingPayload(row), payments: paymentsConfig() });
  } catch (err) { next(err); }
});

/** GET /api/bookings — Trips › Booked with hosts. */
router.get('/bookings', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const rows = await repo.bookingsOfHousehold(household.id);
    res.json({ bookings: rows.map(bookingPayload) });
  } catch (err) { next(err); }
});

async function myBooking(id) {
  const household = await currentHousehold();
  const b = await repo.bookingById(id);
  if (!b || b.household_id !== household.id) throw refuse(404, 'not_found', 'That booking is not one of yours.');
  return { household, booking: b };
}

router.get('/bookings/:id', async (req, res, next) => {
  try {
    const { booking } = await myBooking(req.params.id);
    res.json({ booking: bookingPayload(booking), payments: paymentsConfig() });
  } catch (err) { next(err); }
});

/** POST /api/bookings/:id/cancel — any time while held; within the refund rule once confirmed. */
router.post('/bookings/:id/cancel', async (req, res, next) => {
  try {
    const { booking } = await myBooking(req.params.id);
    if (booking.state === 'cancelled') return res.json({ booking: bookingPayload(booking) });
    const on = occurrenceDate(booking, booking.occurrence);
    const hours = on ? (new Date(`${on}T${booking.starts_at ?? '12:00'}:00`).getTime() - Date.now()) / 3600000 : Infinity;
    const window = booking.refund_rule === '7d' ? 24 * 7 : booking.refund_rule === 'none' ? Infinity : 24;
    const refundable = booking.state === 'pending' || booking.state === 'waitlisted' || (booking.refund_rule !== 'none' && hours >= window);
    const updated = await repo.updateBooking(booking.id, {
      state: 'cancelled', cancelledAt: new Date(), cancelledBy: 'guest',
      paymentStatus: booking.payment_status === 'paid' && refundable ? 'refunded' : booking.payment_status,
      refundedAt: booking.payment_status === 'paid' && refundable ? new Date() : null,
    });
    res.json({ booking: bookingPayload(await repo.bookingById(updated.id)), refunded: refundable });
  } catch (err) { next(err); }
});

/** POST /api/bookings/:id/review {stars, chips, text, photoId} — after it ran. Published a fortnight later, both sides together. */
router.post('/bookings/:id/review', async (req, res, next) => {
  try {
    const { household, booking } = await myBooking(req.params.id);
    const on = occurrenceDate(booking, booking.occurrence);
    if (!on || on >= ymd(new Date())) throw refuse(409, 'not_yet', 'You can rate it once it has happened.');
    if (booking.state === 'cancelled') throw refuse(409, 'cancelled', 'This one was called off, so there is nothing to rate.');
    // Only somebody who was in can rate it: a place that was held and never
    // decided, or on the waiting list, was not there.
    if (!['confirmed', 'attended'].includes(booking.state)) throw refuse(409, 'not_attended', 'This booking never had a place, so there is nothing to rate.');
    const stars = int(req.body?.stars);
    if (!stars || stars > 5) throw refuse(400, 'stars_required', 'Give it one to five stars.');
    const chips = list(req.body?.chips, 3).filter((c) => REVIEW_CHIPS.includes(c));
    const photoId = req.body?.photoId ? await ownMedia(household.id, req.body.photoId, 'photo') : null;
    const offer = await repo.offerById(booking.offer_id);
    const review = await repo.insertReview({
      bookingId: booking.id, offerId: booking.offer_id, hostId: booking.host_id, householdId: household.id, side: 'guest',
      stars, chips, text: str(req.body?.text, 1200), photoId, publishOn: reviewPublishOn(offer, booking.occurrence),
    });
    if (booking.state !== 'attended') await repo.updateBooking(booking.id, { state: 'attended' });
    res.status(201).json({ review: { id: review.id, stars, chips, text: review.text, publishOn: ymd(review.publish_on) }, booking: bookingPayload(await repo.bookingById(booking.id)) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the back office: pitch review and the trust ladder
// ---------------------------------------------------------------------------

adminRouter.get('/', requires('view_hosting'), async (_req, res, next) => {
  try {
    const [inReview, hosts, reports] = await Promise.all([repo.offersInReview(), repo.allHosts(), repo.openReports()]);
    res.json({
      inReview: inReview.map((o) => ({
        ...publicOffer(o, [], { revealed: true }), venueLabel: o.venue_label,
        hostName: o.host_name, hostType: o.host_type, hostTrust: o.host_trust, submittedAt: o.submitted_at,
        checklist: pitchChecklist(o), commentary: isRegulated(o.venue_country) && readsLikeCommentary(`${o.title} ${o.description}`),
      })),
      hosts: hosts.map((h) => ({ ...ownHost(h), liveOffers: Number(h.live_offers), inReview: Number(h.in_review), openReports: Number(h.open_reports) })),
      reports: reports.map((r) => ({ id: r.id, hostId: r.host_id, hostName: r.host_name, offerId: r.offer_id, title: r.title, reason: r.reason, at: r.created_at })),
      trustLevels: TRUST_LEVELS,
    });
  } catch (err) { next(err); }
});

/** POST /api/admin/hosting/offers/:id/decide {decision: 'live' | 'changes', note, checklist} */
adminRouter.post('/offers/:id/decide', requires('manage_hosting'), async (req, res, next) => {
  try {
    const o = await repo.offerById(req.params.id);
    if (!o || o.state !== 'in_review') throw refuse(404, 'not_in_review', 'That offer is not waiting to be read.');
    const decision = oneOf(['live', 'changes'], req.body?.decision);
    if (!decision) throw refuse(400, 'decision_required', 'Pass it, or ask for changes.');
    const note = str(req.body?.note, 1000);
    if (decision === 'changes' && !note) throw refuse(400, 'note_required', 'Say what would make it stronger — coaching, not rejection.');
    const checklist = req.body?.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : pitchChecklist(o);
    const updated = await repo.updateOffer(o.id, {
      state: decision === 'live' ? 'live' : 'draft',
      publishedAt: decision === 'live' ? new Date() : null,
      reviewedAt: new Date(), reviewNote: note, reviewChecklist: checklist,
    });
    res.json({ offer: publicOffer(updated, [], { revealed: true }) });
  } catch (err) { next(err); }
});

/** PATCH /api/admin/hosting/hosts/:id {trust, checks} — the ladder is climbed here and only here. */
adminRouter.patch('/hosts/:id', requires('manage_hosting'), async (req, res, next) => {
  try {
    const h = await repo.hostById(req.params.id);
    if (!h) throw refuse(404, 'not_found', 'No such host.');
    const patch = {};
    if (req.body?.trust !== undefined) { patch.trust = oneOf(TRUST_LEVELS, req.body.trust); if (!patch.trust) throw refuse(400, 'bad_trust', 'Verified, Checked or Epic Trusted.'); }
    if (req.body?.checks !== undefined) { patch.checks = oneOf(['running', 'passed'], req.body.checks); if (!patch.checks) throw refuse(400, 'bad_checks', 'Running or passed.'); }
    const updated = await repo.updateHost(h.id, patch);
    res.json({ host: ownHost(updated) });
  } catch (err) { next(err); }
});

adminRouter.post('/reports/:id/resolve', requires('manage_hosting'), async (req, res, next) => {
  try { await repo.resolveReport(req.params.id); res.status(204).end(); } catch (err) { next(err); }
});

/**
 * Held bookings are decided on their day (G1: "Decides Fri 11 Oct"). Twice an
 * hour, every pending booking whose decide-by has come is confirmed if its
 * instance has reached the minimum by then, and otherwise cancelled — nothing
 * taken, the guest told — so nothing is left held past the day it ran.
 */
export async function settleHeldBookings() {
  const due = await repo.heldBookingsDue();
  let confirmed = 0; let cancelled = 0;
  const offers = new Map();
  for (const due_ of due) {
    // The same lock a booking takes, and the row read again under it: a
    // booking landing at the same moment may already have confirmed this one
    // (Codex, 12 Sep 2026).
    const outcome = await withTransaction(async (client) => {
      const o = await repo.lockOffer(due_.offer_id, client);
      if (!o) return null;
      const all = await repo.bookingsOfOffer(o.id, client);
      const b = all.find((x) => x.id === due_.id);
      if (!b || b.state !== 'pending') return null;
      const st = standing(o, all, b.occurrence);
      if (o.state === 'live' && st.minimumMet) {
        await repo.updateBooking(b.id, { state: 'confirmed', decideBy: null }, client);
        return { o, b, confirmed: true };
      }
      await repo.updateBooking(b.id, { state: 'cancelled', cancelledAt: new Date(), cancelledBy: 'epic', paymentStatus: b.payment_status === 'paid' ? 'refunded' : b.payment_status, refundedAt: b.payment_status === 'paid' ? new Date() : null }, client);
      return { o, b, confirmed: false };
    });
    if (!outcome) continue;
    if (outcome.confirmed) confirmed += 1;
    else {
      await tellBooked([outcome.b], `${outcome.o.title ?? 'Your booking'} did not reach the ${outcome.o.min_count} it needed, so it is not running. Nothing has been taken from you.`);
      cancelled += 1;
    }
  }
  void offers;
  return { due: due.length, confirmed, cancelled };
}

export function startHostingLoop() {
  const run = () => runOutsideRequest(() => settleHeldBookings()).catch((err) => console.error('held bookings sweep failed', err.message));
  setTimeout(run, 20_000);
  return setInterval(run, 30 * 60_000);
}

export const codeHash = sha;
export default router;
