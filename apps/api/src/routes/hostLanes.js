/**
 * Four ways to host — the API behind the v7 create flows (Epic hosting v7,
 * "Supporting docs/Host/Host v3"; RULINGS.md over the README).
 *
 *   GET    /api/host/lanes                     the Host home: config, drafts, who you are
 *   POST   /api/host/lanes/offers              a draft in one lane
 *   GET    /api/host/lanes/offers/:id          one draft, with its checklist
 *   PATCH  /api/host/lanes/offers/:id          a step saved ("Save and finish later" is every save)
 *   POST   /api/host/lanes/extract             Say it / Paste: words → the lane's fields
 *   POST   /api/host/lanes/read                Upload it: a file, a photo or a note → the lane's fields
 *   PATCH  /api/host/lanes/profile             the host profile sheet (date of birth: 18+)
 *   POST   /api/host/lanes/tax                 NI number or UTR
 *   POST   /api/host/lanes/checked             DBS, insurance, two references
 *   POST   /api/host/lanes/payouts             Stripe Connect hosted onboarding → a URL
 *   POST   /api/host/lanes/verify              Stripe Identity → a URL
 *   POST   /api/host/lanes/offers/:id/video    the offer video's choices
 *   POST   /api/host/lanes/offers/:id/sync     back from Stripe: read what it says now
 *   POST   /api/host/lanes/offers/:id/publish  send the invites, or send for review
 *   POST   /api/stripe/webhook                 (webhookRouter, public, raw body)
 *
 * Guest booking and payment, and host management, are their own briefs; the
 * tables they will write are laid down in migration 365.
 */

import express, { Router } from 'express';
import * as repo from '../repositories/hosting.js';
import * as providerCalls from '../repositories/providerCalls.js';
import { pool, query, withTransaction } from '../db.js';
import { currentAccount } from '../context.js';
import { currentHousehold } from './household.js';
import { assertWithinBounds } from '../claude.js';
import { extract as extractWith, openaiEnabled, tokenCost, transcribe, minuteCost } from '../sources/openai.js';
import { pdfText } from '../sources/menuRead.js';
import { bankHolidays } from '../sources/bankHolidays.js';
import * as stripe from '../sources/stripe.js';
import * as hostingSettings from '../repositories/hostingSettings.js';
import { cancelSessions, changeDate, CANCEL_REASONS } from '../sources/bookingMoney.js';
import { linkUrl, mediaRef, ownHost, sendInvites } from './hosting.js';
import {
  LANES, SEQ, SHAPE_OF, PROMPTS, VENUE_KINDS, PRICE_MODES, REFUND_POLICIES, DIET_TICKS, hostingConfig, holidaySet, sessionsFor, decidesOn,
  checklist, sendBlockers, publishAction, chargesFor, refundWords, missingSteps, isPaid, paidThroughEpic, ageOn, dow, ymd, plusDays,
  needsChecked, laneGaps, CHECK_WORDS, courseRun, weeklyRun, asksParentsOnWho, localInstant, localDay,
} from '../domain/lanes.js';

export const router = Router();
export const webhookRouter = Router();

const refuse = (status, code, message, details = null) => { const e = new Error(message); e.status = status; e.code = code; if (details) e.details = details; return e; };
const str = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const whole = (v, { min = 0, max = 1_000_000 } = {}) => { const n = num(v); return n == null ? null : Math.min(max, Math.max(min, Math.round(n))); };
const oneOf = (all, v) => (all.includes(v) ? v : null);
const list = (v, max = 40) => (Array.isArray(v) ? v.slice(0, max) : []);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (v) => { const s = str(v, 5); return s && TIME.test(s) ? s : null; };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day: 30 February is refused, not rolled into March. */
const date = (v) => { const s = str(v, 10); if (!s || !DATE.test(s)) return null; const d = new Date(`${s}T12:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null; };
/**
 * Where, from whose side. The set-up asks the host ("Your place: they come to you";
 * "Their place: you go to them"); everything else in Epic — the guest page, booking,
 * the address a guest gives — reads `venue` from the guest's side, where `their_place`
 * is the host's home and `your_place` is the guest's (Codex, 2 Oct 2026). Translated
 * here, at the door, both ways.
 */
const HOST_SIDE = { your_place: 'their_place', their_place: 'your_place' };
const toStored = (v) => HOST_SIDE[v] ?? v;
const toHostSide = (v) => HOST_SIDE[v] ?? v;
const appUrl = () => (process.env.EPIC_APP_URL || process.env.APP_URL || 'https://epic.day').replace(/\/$/, '');
const pubUrl = (offerId) => `${appUrl()}/experiences/${offerId}`;
const accountPro = (account) => account?.plan === 'pro' && account?.status !== 'suspended';
/**
 * Pro, for hosting: the account's own plan, or a Pro subscription this household joined from
 * the checklist and has not cancelled (Codex, 2 Oct 2026). The account's billing plan is
 * billing's to change and is never touched here — a test-mode card must not make anyone Pro
 * across Epic — so hosting reads its own record of the subscription.
 */
async function hostingPro(account, householdId) {
  if (accountPro(account)) return true;
  if (!householdId) return false;
  const { rows: [r] } = await query("select 1 from hosting_payments where household_id = $1 and kind = 'pro' and state = 'succeeded' limit 1", [householdId]);
  return Boolean(r);
}
// HMRC's shape: the second letter is never O, and BG, GB, KN, NK, NT, TN and ZZ are never issued (Codex, 2 Oct 2026).
const NI_SHAPE = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/;
const NI_NEVER = new Set(['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']);
const NI = { test: (v) => { const x = String(v).toUpperCase().replace(/\s+/g, ''); return NI_SHAPE.test(x) && !NI_NEVER.has(x.slice(0, 2)); } };
const UTR = /^\d{10}$/;

async function me() {
  const household = await currentHousehold();
  const account = currentAccount();
  const host = await repo.hostByHousehold(household.id);
  return { household, account, host };
}

/** The host row exists from the first save, so every step has somewhere to land; its name is the account's until the profile says otherwise. */
async function ensureHost(household, account) {
  return (await repo.hostByHousehold(household.id))
    ?? repo.insertHost(household.id, { name: account?.name ?? household.name ?? 'A host', type: null, accountId: account?.id ?? null });
}

/** The set-up's write lock: the same one publishing holds, then the row, and only a draft is written. */
async function lockDraft(client, id) {
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${id}`]);
  const { rows: [now] } = await client.query('select state from host_offers where id = $1 for update', [id]);
  if (now?.state !== 'draft') throw refuse(409, 'already_sent', 'This one is out already.');
}

async function myLaneOffer(id) {
  const ctx = await me();
  if (!ctx.host) throw refuse(404, 'not_a_host', 'You are not hosting yet.');
  const offer = await repo.offerOfHost(id, ctx.host.id);
  if (!offer || !offer.lane) throw refuse(404, 'offer_not_found', 'That is not one of your offers.');
  return { ...ctx, offer };
}

async function holidaysFor(householdId) {
  return holidaySet(await bankHolidays({ householdId }));
}

// ---------------------------------------------------------------------------
// payloads
// ---------------------------------------------------------------------------

/** The host as the checklist and its sheets read them. Never a tax number in full, never an id document. */
function hostSheet(host, account) {
  if (!host) return { name: account?.name ?? null, line: null, photo: null, dateOfBirth: null, identity: 'none', payouts: 'none', checked: 'none', tax: null, email: account?.email ?? null, mobile: account?.mobile ?? null };
  return {
    name: host.name, line: host.intro_text, photo: mediaRef(host.photo_id), photoId: host.photo_id, dateOfBirth: ymd(host.date_of_birth),
    identity: host.identity_state ?? 'none', payouts: host.payouts_state ?? 'none', checked: host.checked_state ?? 'none',
    tax: host.tax_reference ? `••••${String(host.tax_reference).slice(-3)}` : null,
    referees: (host.referees ?? []).map((r) => ({ name: r.name, email: r.email })), dbs: host.dbs_number ? `••••${String(host.dbs_number).slice(-4)}` : null,
    insurance: Boolean(host.insurance_media_id),
    email: account?.email ?? null, mobile: account?.mobile ?? null,
  };
}

const ITEM_WORDS = {
  email: (h) => ({ t: 'Email', s: h.email ?? 'Add your email' }),
  phone: (h) => ({ t: 'Phone', s: h.mobile ?? 'Add your mobile' }),
  profile: () => ({ t: 'Your host profile', s: 'Name, photo, a line about you' }),
  verified: (h) => ({ t: 'Verified', s: h.identity === 'verified' ? 'ID · by Stripe' : h.identity === 'pending' ? 'Stripe is checking it' : 'Your passport · once, for every host' }),
  video: () => ({ t: 'Offer video', s: 'Record it, or let Epic make it' }),
  checked: (h) => ({ t: 'Checked', s: h.checked === 'submitted' ? 'Sent for checking' : 'DBS, insurance, references · for children' }),
  payouts: (h) => ({ t: 'Payouts', s: h.payouts === 'ready' ? 'Paid out by Stripe' : h.payouts === 'pending' ? 'Stripe is finishing it' : 'Bank details · through Stripe' }),
  tax: (h) => ({ t: 'Tax details', s: h.tax ? 'Added' : 'Before your first payout' }),
  review: () => ({ t: 'Review', s: 'We reply within 48 hours · sent when you publish' }),
};

/** One offer in a lane, as its set-up reads it. */
async function lanePayload(offer, host, account, { holidays } = {}) {
  const cfg = hostingConfig();
  const hol = holidays ?? await holidaysFor(host?.household_id ?? null);
  const [cohosts, invites, rating, sessions] = await Promise.all([
    repo.cohostsOf(offer.id), repo.invitesOf(offer.id), host ? repo.ratedEventsOf(host.id) : { ratedEvents: 0, avg: null }, repo.sessionsOf(offer.id),
  ]);
  const sheet = hostSheet(host, account);
  const items = checklist(offer, { host, account }, cfg);
  const pro = await hostingPro(account, host?.household_id ?? null);
  const run = offer.lane === 'course' ? courseRun(offer, hol, cfg) : offer.lane === 'weekly' ? weeklyRun(offer, hol, { weeks: cfg.weeklyHorizonWeeks }) : null;
  return {
    id: offer.id, lane: offer.lane, state: offer.state, visibility: offer.who_chosen ? offer.visibility : null, money: offer.money ?? 'free',
    draftStep: offer.draft_step, draftSource: offer.draft_source, steps: SEQ[offer.lane], missing: missingSteps(offer, hostingConfig()),
    whatCategory: offer.what_category, whatLabel: offer.what_label, title: offer.title, line: offer.summary, lineSuggested: Boolean(offer.line_suggested),
    photos: (offer.photo_ids ?? []).map((id) => ({ id, url: mediaRef(id) })),
    startsOn: ymd(offer.starts_on), startsAt: offer.starts_at?.slice(0, 5) ?? null, endsAt: offer.ends_at?.slice(0, 5) ?? null,
    multiDay: Boolean(offer.multi_day), endsOn: ymd(offer.ends_on), runningOrder: offer.running_order ?? [],
    cohosts: cohosts.map((c) => ({ id: c.id, name: c.name, role: c.role, accountId: c.account_id, contactId: c.contact_id, canEdit: c.can_edit, canMessage: c.can_message, shownOnPage: c.shown_on_page, withPhoto: c.with_photo, seesGuests: c.sees_guests })),
    venue: toHostSide(offer.venue), venueLabel: offer.venue_label, venueArea: offer.venue_area, venueRef: offer.venue_ref ?? null, venueNotes: offer.venue_notes,
    travelRadiusMin: offer.travel_radius_min, travelChargePence: offer.travel_charge_pence, onlineMode: offer.online_mode, onlineLink: offer.online_link, timeZone: offer.time_zone,
    guestQuestions: offer.guest_questions ?? {},
    weekdays: offer.weekdays ?? [], firstDate: ymd(offer.first_date), durationMin: offer.duration_min, sessions: offer.sessions,
    excludeBankHolidays: offer.exclude_bank_holidays !== false, skippedDates: (offer.skipped_dates ?? []).map(ymd),
    run: run ? { dates: run.dates, skipped: run.skipped } : null,
    outcome: offer.outcome, topics: offer.weeks ?? [], parents: offer.parents, whyYou: offer.why_you,
    freeHours: offer.free_hours ?? {}, sessionLengths: offer.session_lengths ?? [], noticeHours: offer.notice_hours ?? cfg.onRequest.noticeHours, perWeekMax: offer.per_week_max ?? cfg.onRequest.perWeek,
    priceMode: offer.price_mode, pricePence: offer.price_pence, childPence: offer.child_pence, totalPence: offer.total_pence, per: offer.per,
    minCount: offer.min_count, maxCount: offer.max_count,
    dropInPence: offer.drop_in_pence, bookAheadPence: offer.book_ahead_pence,
    dropInGroupPct: offer.drop_in_group_pct, dropInGroupMin: offer.drop_in_group_min, bookAheadGroupPct: offer.book_ahead_group_pct, bookAheadGroupMin: offer.book_ahead_group_min,
    decidesOn: ymd(offer.decides_on), decidesOnDefault: decidesOn({ ...offer, decides_on: null }, hol, cfg),
    refundPolicy: offer.refund_policy, refundWords: offer.refund_policy ? refundWords(offer.refund_policy, cfg) : null,
    waitlistOn: offer.waitlist_on === true, addressHidden: offer.address_hidden !== false, chosenDates: offer.chosen_dates ?? [],
    ageMin: offer.age_min, ageMax: offer.age_max, asksParents: asksParentsOnWho(offer, cfg), needsChecked: needsChecked(offer, cfg),
    privatePlan: offer.private_plan ?? (pro ? 'pro' : 'event'), privateFeeState: offer.private_fee_state,
    video: {
      id: offer.video_id, url: mediaRef(offer.video_id), madeBy: offer.video_made_by, coverS: offer.video_cover_s == null ? null : Number(offer.video_cover_s),
      onProfile: offer.video_on_profile !== false, photoIds: offer.video_photo_ids ?? [], helloId: offer.hello_video_id,
      seconds: offer.video_id ? (await repo.mediaMeta(offer.video_id))?.duration_s ?? null : null,
      helloSeconds: offer.hello_video_id ? (await repo.mediaMeta(offer.hello_video_id))?.duration_s ?? null : null,
    },
    invites: invites.map((i) => ({ id: i.id, name: i.name, contact: i.contact, contactKind: i.contact_kind, heads: i.heads, rsvp: i.rsvp, rsvpHeads: i.rsvp_heads ?? null, sentAt: i.sent_at })),
    inviteUrl: linkUrl(offer.link_token), pageUrl: pubUrl(offer.id),
    sessionRows: sessions.map((s) => ({
      id: s.id, n: s.n, onDate: ymd(s.on_date), startsAt: s.starts_at?.slice(0, 5) ?? null, endsAt: s.ends_at?.slice(0, 5) ?? null, topic: s.topic, state: s.state,
      booked: s.booked_heads ?? 0, decidesAt: s.decides_at ?? null, decided: s.decided_outcome ?? null,
      changedFrom: s.changed_from ? { date: s.changed_from.onDate ?? null, time: s.changed_from.startsAt ?? null } : null, late: Boolean(s.late),
    })),
    checklist: items.map((i) => ({ ...i, ...ITEM_WORDS[i.key](sheet) })),
    blockers: sendBlockers(items),
    action: publishAction(offer, items, { isPro: pro }, cfg),
    charges: chargesFor(offer, { rating, isPro: pro }, cfg),
    paid: isPaid(offer), throughEpic: paidThroughEpic(offer),
    submittedAt: offer.submitted_at, publishedAt: offer.published_at, updatedAt: offer.updated_at,
  };
}

/** What the screens need to know before anything is drawn: prices, terms, defaults, and the bank holidays. */
function configPayload(holidays) {
  const cfg = hostingConfig();
  return {
    privateEventPence: cfg.privateEventPence, proMonthlyPence: cfg.proMonthlyPence, privateCollectPct: cfg.privateCollectPct,
    publicShare: cfg.publicShare, refunds: REFUND_POLICIES.map((key) => ({ key, words: refundWords(key, cfg) })),
    decidesDaysBefore: cfg.decidesDaysBefore, weeklyDecidesHoursBefore: cfg.weeklyDecidesHoursBefore,
    onRequest: cfg.onRequest, reviewHours: cfg.reviewHours, hostMinAge: cfg.hostMinAge, adultAge: cfg.adultAge,
    oneoffMaxDays: cfg.oneoffMaxDays, courseSessions: cfg.courseSessions, videoSeconds: cfg.videoSeconds, epicVideoPhotos: cfg.epicVideoPhotos,
    seq: SEQ, prompts: PROMPTS, diet: DIET_TICKS,
    bankHolidays: holidays,
    stripe: stripe.stripeStatus(), listening: openaiEnabled(),
  };
}

// ---------------------------------------------------------------------------
// home and drafts
// ---------------------------------------------------------------------------

router.get('/host/lanes', async (req, res, next) => {
  try {
    const { household, account, host } = await me();
    const holidays = await bankHolidays({ householdId: household.id });
    const drafts = host ? await repo.laneDraftsOf(host.id) : [];
    res.json({
      config: configPayload(holidays),
      drafts: drafts.map((o) => ({ id: o.id, lane: o.lane, title: o.title, whatLabel: o.what_label, step: o.draft_step, updatedAt: o.updated_at, missing: missingSteps(o, hostingConfig()).length })),
      host: hostSheet(host, account), isPro: await hostingPro(account, household.id),
    });
  } catch (err) { next(err); }
});

/**
 * POST /host/lanes/offers {lane, ...fields} — a draft. Made on the first save
 * (leaving step 1, or Say it / Upload it building one), never on opening a
 * lane, so looking does not leave empty drafts behind.
 */
router.post('/host/lanes/offers', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const lane = oneOf(LANES, req.body?.lane);
    if (!lane) throw refuse(400, 'lane_required', 'Pick one of the four: one-off, weekly, course or on request.');
    // Everything is checked before the row exists, so a refused first save leaves no empty draft behind (Codex, 2 Oct 2026).
    const blank = { lane, state: 'draft', visibility: 'invite', money: 'free', price_mode: 'free', age_min: hostingConfig().adultAge, venue: 'out_about', venue_ref: null };
    const patch = laneBody(req.body ?? {}, blank);
    const derived = Object.keys(patch).length ? derive(patch, blank) : {};
    // The photo picked on step 1 travels with the first save.
    const photoIds = req.body?.photoIds !== undefined ? await ownMediaList(household.id, req.body.photoIds, 'photo', 8) : null;
    const cohosts = req.body?.cohosts !== undefined ? await ownCohosts(household.id, req.body.cohosts) : null;
    const host = await ensureHost(household, account);
    let offer = await repo.insertOffer(host.id, SHAPE_OF[lane], { lane, state: 'draft', visibility: 'invite', money: 'free', priceMode: 'free', ageMin: hostingConfig().adultAge, ...(lane === 'course' ? { joinMode: 'whole' } : {}) });
    if (Object.keys(derived).length || photoIds) offer = await repo.updateOffer(offer.id, { ...derived, ...(photoIds ? { photoIds } : {}) });
    if (cohosts) await repo.setCohosts(offer.id, cohosts);
    res.status(201).json({ offer: await lanePayload(offer, host, account) });
  } catch (err) { next(err); }
});

router.get('/host/lanes/offers/:id', async (req, res, next) => {
  try {
    const { host, account, offer } = await myLaneOffer(req.params.id);
    res.json({ offer: await lanePayload(offer, host, account) });
  } catch (err) { next(err); }
});

router.patch('/host/lanes/offers/:id', async (req, res, next) => {
  try {
    const { host, account, offer } = await myLaneOffer(req.params.id);
    // The set-up edits drafts only: an approved one waiting on Checked is what was approved (Codex, 2 Oct 2026),
    // and a published one changes through its own page (E8).
    if (offer.state !== 'draft') {
      throw refuse(409, 'already_sent', offer.state === 'in_review' ? 'This one is with us for review. We’ll be back to you within 48 hours.' : offer.state === 'approved' ? 'This one is approved and goes live once Checked is done.' : 'This one is out already.');
    }
    const b = req.body ?? {};
    const patch = derive(laneBody(b, offer), offer);
    if (b.photoIds !== undefined) patch.photoIds = await ownMediaList(host.household_id, b.photoIds, 'photo', 8);
    const cohosts = b.cohosts !== undefined ? await ownCohosts(host.household_id, b.cohosts) : null;
    // Written under the row's lock, and only while it is still a draft: an edit that arrives as
    // the offer is being sent never changes what went out (Codex, 2 Oct 2026).
    const updated = await withTransaction(async (client) => {
      await lockDraft(client, offer.id);
      const row = Object.keys(patch).length ? await repo.updateOffer(offer.id, patch, client) : offer;
      if (cohosts) await repo.setCohosts(offer.id, cohosts, client);
      return row;
    });
    res.json({ offer: await lanePayload(updated, host, account) });
  } catch (err) { next(err); }
});

router.delete('/host/lanes/offers/:id', async (req, res, next) => {
  try {
    const { host, offer } = await myLaneOffer(req.params.id);
    if (offer.state !== 'draft') throw refuse(409, 'not_a_draft', 'Only a draft can be thrown away.');
    await withTransaction(async (client) => {
      await lockDraft(client, offer.id);
      await client.query('delete from host_offers where id = $1 and host_id = $2 and state = $3', [offer.id, host.id, 'draft']);
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

async function ownMediaList(householdId, ids, kind, max) {
  const out = [];
  for (const id of list(ids, max)) {
    const m = await repo.mediaMeta(id);
    if (!m || m.household_id !== householdId || m.kind !== kind) throw refuse(400, 'not_your_media', 'That picture is not one of yours.');
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// what a step may write
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOr = (v) => { const x = str(v, 40); return x && UUID.test(x) ? x : null; };
/** A co-host's link to an Epic contact is kept only when the contact is this household's own (Codex, 2 Oct 2026). */
async function ownCohosts(householdId, raw) {
  const rows = cohostList(raw);
  const mine = new Set((await repo.contactsOf(householdId)).map((c) => c.id));
  return rows.map((c) => ({ ...c, contactId: c.contactId && mine.has(c.contactId) ? c.contactId : null, accountId: null }));
}
const cohostList = (v) => list(v, 12).map((c) => ({
  name: str(c?.name, 80), role: oneOf(['cohost', 'helper'], c?.role) ?? 'helper', accountId: uuidOr(c?.accountId), contactId: uuidOr(c?.contactId),
  canEdit: Boolean(c?.canEdit), canMessage: Boolean(c?.canMessage), shownOnPage: c?.shownOnPage !== false, withPhoto: c?.withPhoto !== false, seesGuests: Boolean(c?.seesGuests),
})).filter((c) => c.name);

const ID = /^[a-z0-9-]{1,40}$/i;
function guestQuestions(q) {
  if (!q || typeof q !== 'object') return {};
  const on = (x) => Boolean(x?.on);
  return {
    plusOne: { on: on(q.plusOne) },
    diet: { on: on(q.diet), ticks: list(q.diet?.ticks, 6).filter((t) => DIET_TICKS.includes(t)) },
    kids: { on: on(q.kids), askAges: q.kids?.askAges !== false, askNeeds: Boolean(q.kids?.askNeeds), mostPerFamily: whole(q.kids?.mostPerFamily, { min: 1, max: 12 }) ?? 4 },
    bring: { on: on(q.bring), items: list(q.bring?.items, 30).map((i, n) => ({ id: ID.test(String(i?.id ?? '')) ? String(i.id) : `i${n + 1}`, name: str(i?.name, 80) ?? '', qty: whole(i?.qty, { min: 1, max: 999 }) ?? 1 })) },
    stay: {
      on: on(q.stay), nights: list(q.stay?.nights, 6).map(date).filter(Boolean),
      places: list(q.stay?.places, 12).map((p, n) => ({ id: ID.test(String(p?.id ?? '')) ? String(p.id) : `p${n + 1}`, name: str(p?.name, 120) ?? '', note: str(p?.note, 160) })),
    },
  };
}

function freeHours(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (let d = 0; d <= 6; d += 1) {
    const ranges = list(v[d] ?? v[String(d)], 6).map((r) => [time(r?.[0]), time(r?.[1])]).filter(([a, b]) => a && b && a < b);
    if (ranges.length) out[d] = ranges;
  }
  return out;
}

/** An IANA time zone this server knows, or a refusal — never one that breaks publishing later (Codex, 2 Oct 2026). */
const zone = (v) => {
  const z = str(v, 60);
  try { new Intl.DateTimeFormat('en-GB', { timeZone: z }); return z; } catch { throw refuse(400, 'bad_time_zone', 'That isn’t a time zone Epic knows.'); }
};
const pence = (v) => whole(v, { min: 0, max: 10_000_000 });

/** The fields a v7 step may send, checked one by one. A key not sent is left as it is. */
export function laneBody(b, current) {
  const p = {};
  const set = (k, v) => { if (b[k] !== undefined) p[k] = v; };
  set('title', str(b.title, 120));
  if (b.line !== undefined) p.summary = str(b.line, 300);   // "Under the title" is the offer's short line
  set('whatCategory', str(b.whatCategory, 80)); set('whatLabel', str(b.whatLabel, 80)); set('lineSuggested', Boolean(b.lineSuggested));
  set('startsOn', date(b.startsOn)); set('startsAt', time(b.startsAt)); set('endsAt', time(b.endsAt)); set('multiDay', Boolean(b.multiDay)); set('endsOn', date(b.endsOn));
  set('runningOrder', list(b.runningOrder, 60).map((r) => ({ day: whole(r?.day, { min: 0, max: 3 }) ?? 0, time: time(r?.time), title: str(r?.title, 120), detail: str(r?.detail, 200) })).filter((r) => r.title));
  set('venue', b.venue == null ? null : toStored(oneOf(VENUE_KINDS, b.venue))); set('venueLabel', str(b.venueLabel, 240)); set('venueArea', str(b.venueArea, 120)); set('venueNotes', str(b.venueNotes, 600));
  if (b.venueRef === null || (typeof b.venueRef === 'string' && /^(osm|google|atlas|own):[\w/.:-]{1,200}$/.test(b.venueRef))) p.venueRef = b.venueRef;
  if (b.venueLabel !== undefined) p.venueLabelFrom = (b.venueRef !== undefined ? b.venueRef : current.venue_ref) ? 'place' : 'host';
  set('venueLat', num(b.venueLat)); set('venueLng', num(b.venueLng));
  set('travelRadiusMin', whole(b.travelRadiusMin, { min: 1, max: 200 })); set('travelChargePence', pence(b.travelChargePence));
  set('onlineMode', oneOf(['epic', 'own'], b.onlineMode)); set('onlineLink', str(b.onlineLink, 300)); set('timeZone', b.timeZone == null ? null : zone(b.timeZone));
  if (b.guestQuestions !== undefined) p.guestQuestions = guestQuestions(b.guestQuestions);
  set('weekdays', [...new Set(list(b.weekdays, 7).map((d) => whole(d, { min: 0, max: 6 })).filter((d) => d != null))].sort());
  set('firstDate', date(b.firstDate)); set('durationMin', whole(b.durationMin, { min: 5, max: 24 * 60 }));
  set('sessions', whole(b.sessions, { min: 1, max: 52 })); set('excludeBankHolidays', b.excludeBankHolidays !== false);
  set('skippedDates', [...new Set(list(b.skippedDates, 60).map(date).filter(Boolean))].sort());
  set('outcome', str(b.outcome, 600)); set('whyYou', str(b.whyYou, 2000));
  // The session plan: one topic per session, by number; an empty row is simply not written.
  if (b.topics !== undefined) p.weeks = list(b.topics, 52).map((w, i) => ({ n: whole(w?.n, { min: 1, max: 52 }) ?? i + 1, title: str(w?.title, 160) })).filter((w) => w.title);
  set('parents', b.parents === null ? null : oneOf(['stay', 'drop_off'], b.parents));
  if (b.freeHours !== undefined) p.freeHours = freeHours(b.freeHours);
  set('sessionLengths', [...new Set(list(b.sessionLengths, 8).map((m) => whole(m, { min: 15, max: 12 * 60 })).filter(Boolean))].sort((x, y) => x - y));
  set('noticeHours', whole(b.noticeHours, { min: 0, max: 24 * 30 })); set('perWeekMax', whole(b.perWeekMax, { min: 1, max: 100 }));
  set('priceMode', oneOf(PRICE_MODES, b.priceMode)); set('pricePence', pence(b.pricePence)); set('childPence', pence(b.childPence)); set('totalPence', pence(b.totalPence));
  set('per', oneOf(['person', 'booking'], b.per));
  set('minCount', whole(b.minCount, { min: 1, max: 100_000 })); set('maxCount', whole(b.maxCount, { min: 1, max: 100_000 }));
  set('dropInPence', pence(b.dropInPence)); set('bookAheadPence', pence(b.bookAheadPence));
  set('dropInGroupPct', whole(b.dropInGroupPct, { min: 1, max: 90 })); set('dropInGroupMin', whole(b.dropInGroupMin, { min: 2, max: 100_000 }));
  set('bookAheadGroupPct', whole(b.bookAheadGroupPct, { min: 1, max: 90 })); set('bookAheadGroupMin', whole(b.bookAheadGroupMin, { min: 2, max: 100_000 }));
  set('decidesOn', date(b.decidesOn)); set('refundPolicy', oneOf(REFUND_POLICIES, b.refundPolicy));
  // Hosting v4: the waiting list (default off), the address kept back until booked (default on).
  if (b.waitlistOn !== undefined) p.waitlistOn = b.waitlistOn === true;
  if (b.addressHidden !== undefined) p.addressHidden = b.addressHidden !== false;
  // Choose dates: blocks of picked dates, each block its own list; kept as the host left them.
  if (b.chosenDates !== undefined) p.chosenDates = list(b.chosenDates, 12).map((blk) => [...new Set(list(blk?.dates, 62).map(date).filter(Boolean))].sort()).filter((d) => d.length).map((dates) => ({ dates }));
  set('money', oneOf(['epic', 'direct'], b.money));
  set('visibility', oneOf(['invite', 'public'], b.visibility));
  if (p.visibility) p.whoChosen = true;
  set('ageMin', whole(b.ageMin, { min: 0, max: 120 })); set('ageMax', whole(b.ageMax, { min: 0, max: 120 }));
  set('privatePlan', oneOf(['event', 'pro'], b.privatePlan));
  set('draftStep', SEQ[current.lane]?.includes(b.draftStep) || ['publish', 'say', 'upload', 'draft'].includes(b.draftStep) ? b.draftStep : null);
  set('draftSource', oneOf(['typed', 'said', 'uploaded'], b.draftSource));
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return p;
}

/**
 * What follows from what was sent, so a reader of the old shapes and the
 * rules agree: the shape, the weekday, the money axis, and nothing left
 * standing that the answer takes away.
 */
export function derive(patch, current) {
  const p = { ...patch };
  const next = { ...current, ...snake(p) };
  if (next.age_min != null && next.age_max != null && Number(next.age_min) > Number(next.age_max)) throw refuse(400, 'ages_backwards', 'The youngest age is above the oldest.');
  if (next.min_count != null && next.max_count != null && Number(next.min_count) > Number(next.max_count)) throw refuse(400, 'min_over_max', 'The minimum is above the maximum.');
  const sAt = (next.starts_at ?? '').slice(0, 5); const eAt = (next.ends_at ?? '').slice(0, 5);
  if (current.lane === 'oneoff' && !next.multi_day && sAt && eAt && eAt <= sAt && (p.startsAt !== undefined || p.endsAt !== undefined)) throw refuse(400, 'ends_before_start', 'It ends before it starts.');
  if (next.multi_day && next.starts_on && next.ends_on && next.ends_on <= next.starts_on) throw refuse(400, 'ends_before_start', 'The end date is before the start.');
  // The configured limits hold however the answer arrived — typed, said or read off a flyer (Codex, 2 Oct 2026).
  const cfg = hostingConfig();
  if (p.sessions != null && current.lane === 'course') p.sessions = Math.min(cfg.courseSessions.max, Math.max(cfg.courseSessions.min, p.sessions));
  if (next.multi_day && next.starts_on && next.ends_on && next.ends_on > plusDays(next.starts_on, cfg.oneoffMaxDays - 1)) {
    throw refuse(400, 'too_many_days', `A one-off runs over at most ${cfg.oneoffMaxDays} days.`);
  }
  // A course is booked for the whole run, never one session of it (Codex, 2 Oct 2026).
  if (current.lane === 'course' && current.join_mode !== 'whole') p.joinMode = 'whole';
  // Decides by comes before the first session, or it decides nothing (Codex, 2 Oct 2026).
  const startDay = current.lane === 'oneoff' ? ymd(next.starts_on) : current.lane === 'course' ? ymd(next.first_date) : null;
  if (p.decidesOn && startDay && p.decidesOn >= startDay) throw refuse(400, 'decides_after_start', 'Decides by has to be before the first session.');
  if (p.decidesOn && p.decidesOn < localDay(new Date(), next.time_zone ?? current.time_zone ?? 'Europe/London')) throw refuse(400, 'decides_in_past', 'Decides by can’t be a day that has gone.');
  if (p.firstDate !== undefined && current.lane === 'course') p.weekday = p.firstDate ? dow(p.firstDate) : null;
  if (p.weekdays !== undefined && current.lane === 'weekly') p.weekday = p.weekdays[0] ?? null;
  // Prices: free clears every figure; Weekly's four boxes keep the old readers' one price in step.
  if (current.lane === 'weekly') {
    if (p.dropInPence !== undefined || p.bookAheadPence !== undefined) {
      const paid = Boolean(next.drop_in_pence || next.book_ahead_pence);
      p.priceMode = paid ? 'same_each' : 'free';
      p.pricePence = next.book_ahead_pence || next.drop_in_pence || null;
      p.joinMode = next.drop_in_pence && next.book_ahead_pence ? 'both' : next.drop_in_pence ? 'drop_in' : 'whole';
    }
  }
  const mode = p.priceMode ?? current.price_mode;
  if (p.priceMode === 'free' && current.lane !== 'weekly') { p.pricePence = null; p.childPence = null; p.totalPence = null; }
  if (p.priceMode === 'same_each') p.totalPence = null;
  if (p.priceMode === 'by_numbers') { p.pricePence = null; p.childPence = null; p.per = 'person'; }
  if (p.priceMode === 'free' && current.lane !== 'weekly') p.per = 'person';
  // Money: free is free; public and paid is Epic-collects only; paid defaults to Epic.
  const paid = isPaid({ ...next, price_mode: mode, lane: current.lane });
  if (!paid) { if (current.money !== 'free' || p.money) p.money = 'free'; p.refundPolicy = p.refundPolicy ?? (current.refund_policy ? null : undefined); }
  else if ((p.visibility ?? current.visibility) === 'public') p.money = 'epic';
  else if (!p.money && (current.money ?? 'free') === 'free') p.money = 'epic';
  if (p.refundPolicy === undefined) delete p.refundPolicy;
  // The children's path: Anyone has none, and an upper age of 18 or over has none outside Course.
  if ((p.ageMin !== undefined || p.ageMax !== undefined) && current.lane !== 'course' && !asksParentsOnWho({ ...next, lane: current.lane })) p.parents = null;
  // Where: the parts of other kinds of place do not stay behind.
  if (p.venue && p.venue !== current.venue) {
    // A new kind of place starts clean: the old address or area never stands in for the new one (Codex, 2 Oct 2026).
    for (const k of ['venueLabel', 'venueArea', 'venueRef', 'venueLat', 'venueLng', 'venueNotes']) if (p[k] === undefined) p[k] = null;
    if (p.venue !== 'online') { p.onlineMode = p.onlineMode ?? null; p.onlineLink = p.onlineLink ?? null; }
    if (p.venue === 'online') { p.venueLabel = null; p.venueArea = null; p.venueRef = null; p.venueLat = null; p.venueLng = null; p.travelRadiusMin = null; p.travelChargePence = null; }
    // `your_place` here is stored from the guest's side: the host travelling to them.
    if (p.venue !== 'your_place') { p.travelRadiusMin = p.travelRadiusMin ?? null; p.travelChargePence = p.travelChargePence ?? null; }
  }
  if (p.multiDay === false) p.endsOn = null;
  return p;
}

const SNAKE = {
  startsAt: 'starts_at', endsAt: 'ends_at', firstDate: 'first_date',
  ageMin: 'age_min', ageMax: 'age_max', minCount: 'min_count', maxCount: 'max_count', multiDay: 'multi_day', startsOn: 'starts_on', endsOn: 'ends_on',
  dropInPence: 'drop_in_pence', bookAheadPence: 'book_ahead_pence', priceMode: 'price_mode', visibility: 'visibility', money: 'money', parents: 'parents',
};
const snake = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => SNAKE[k]).map(([k, v]) => [SNAKE[k], v]));

// ---------------------------------------------------------------------------
// Say it, Paste, Upload: words → the lane's fields
// ---------------------------------------------------------------------------

const nullable = (type) => ({ type: [type, 'null'] });
const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['whatLabel', 'title', 'line', 'startsOn', 'startsAt', 'endsAt', 'endsOn', 'runningOrder', 'venue', 'place', 'weekdays', 'firstDate', 'durationMin', 'sessions', 'outcome', 'topics', 'whyYou', 'freeHours', 'sessionLengths', 'priceMode', 'pricePence', 'childPence', 'totalPence', 'minCount', 'maxCount', 'dropInPence', 'bookAheadPence', 'visibility', 'ageMin', 'ageMax', 'parents', 'otherHosts'],
  properties: {
    whatLabel: nullable('string'), title: nullable('string'), line: nullable('string'),
    startsOn: nullable('string'), startsAt: nullable('string'), endsAt: nullable('string'), endsOn: nullable('string'),
    runningOrder: { type: ['array', 'null'], items: { type: 'object', additionalProperties: false, required: ['time', 'title'], properties: { time: nullable('string'), title: { type: 'string' } } } },
    venue: { type: ['string', 'null'], enum: ['out_about', 'your_place', 'their_place', 'online', null] }, place: nullable('string'),
    weekdays: { type: ['array', 'null'], items: { type: 'integer' } }, firstDate: nullable('string'), durationMin: nullable('integer'), sessions: nullable('integer'),
    outcome: nullable('string'), topics: { type: ['array', 'null'], items: { type: 'string' } }, whyYou: nullable('string'),
    freeHours: { type: ['array', 'null'], items: { type: 'object', additionalProperties: false, required: ['weekday', 'from', 'to'], properties: { weekday: { type: 'integer' }, from: { type: 'string' }, to: { type: 'string' } } } },
    sessionLengths: { type: ['array', 'null'], items: { type: 'integer' } },
    priceMode: { type: ['string', 'null'], enum: ['free', 'same_each', 'by_numbers', null] }, pricePence: nullable('integer'), childPence: nullable('integer'), totalPence: nullable('integer'),
    minCount: nullable('integer'), maxCount: nullable('integer'), dropInPence: nullable('integer'), bookAheadPence: nullable('integer'),
    visibility: { type: ['string', 'null'], enum: ['invite', 'public', null] }, ageMin: nullable('integer'), ageMax: nullable('integer'),
    parents: { type: ['string', 'null'], enum: ['stay', 'drop_off', null] },
    otherHosts: { type: ['array', 'null'], items: { type: 'string' } },
  },
};

/** Which extracted fields belong to which step: on later steps the header mic fills only the current step's. */
export const STEP_FIELDS = {
  what: ['whatLabel', 'title', 'line'], when: ['startsOn', 'startsAt', 'endsAt', 'endsOn'], order: ['runningOrder'], cohosts: ['otherHosts'],
  where: ['venue', 'place'], rsvp: [], price: ['priceMode', 'pricePence', 'childPence', 'totalPence', 'minCount', 'maxCount'],
  who: ['visibility', 'ageMin', 'ageMax', 'parents'], weekly: ['weekdays', 'firstDate', 'startsAt', 'durationMin'],
  wprice: ['dropInPence', 'bookAheadPence', 'minCount', 'maxCount'], run: ['firstDate', 'startsAt', 'durationMin', 'sessions'],
  outcome: ['outcome'], sessions: ['topics'], staydrop: ['parents'], why: ['whyYou'], avail: ['freeHours', 'sessionLengths'],
};

function extractSystem(lane, step, today) {
  const scope = step ? `Only these fields matter now: ${STEP_FIELDS[step].join(', ')}. Leave every other field null.` : 'Fill every field the words give.';
  return [
    'You turn a host\'s own words — spoken, pasted, or read off an invite, a flyer or a note — into the set-up of something they are hosting on Epic.',
    `It is a ${{ oneoff: 'one-off event (one date, or several days in a row)', weekly: 'weekly thing (the same slot every week, ongoing)', course: 'course (a fixed number of weekly sessions)', onrequest: 'thing people book on request (no fixed date; booked from the host\'s free hours)' }[lane]}.`,
    `Today is ${today}. Dates are YYYY-MM-DD, the next such date on or after today when no year is said; times are HH:MM, 24-hour.`,
    'Never invent anything. A field the words do not give is null. Plain British English.',
    'whatLabel: what kind of thing it is in two or three words (Birthday party, Yoga class, Swimming lessons, Cooking lesson). title: at most 60 characters, the host\'s own name for it. line: one sentence a guest reads under the title.',
    'venue: out_about (a venue, a park, a hall), your_place (guests come to the host\'s home), their_place (the host goes to them), online. place: the address or place named.',
    'weekdays: 0 Sunday … 6 Saturday. durationMin: minutes per session. sessions: how many in a course. topics: a course\'s session plan, in order.',
    'freeHours: on request, each free weekday and its hours. sessionLengths: minutes a session can last.',
    'Money in pence. priceMode: free, same_each (everyone pays the same), or by_numbers (a fixed total split between whoever comes; totalPence). minCount / maxCount: fewest and most people.',
    'visibility: invite (only people they invite) or public (anyone on Epic). ageMin / ageMax: an age range if one is said. parents: stay or drop_off, for children.',
    'otherHosts: names of anyone else running it with them.',
    scope,
  ].join('\n');
}

/** The model's answer, as a patch the step can save: only fields that are said, and in the lane's own terms. */
export function patchFromExtract(lane, x, { step = null } = {}) {
  const allowed = new Set(step ? STEP_FIELDS[step] ?? [] : Object.values(STEP_FIELDS).flat());
  const p = {}; const found = [];
  const take = (key, value, field = key) => { if (!allowed.has(key) || value == null || (Array.isArray(value) && !value.length) || value === '') return; p[field] = value; found.push(key); };
  take('whatLabel', str(x.whatLabel, 80)); take('title', str(x.title, 120)); take('line', str(x.line, 300));
  take('startsOn', date(x.startsOn)); take('startsAt', time(x.startsAt)); take('endsAt', time(x.endsAt));
  const maxDays = hostingConfig().oneoffMaxDays;
  if (date(x.endsOn) && date(x.startsOn) && x.endsOn > x.startsOn && x.endsOn <= plusDays(x.startsOn, maxDays - 1)) { take('endsOn', date(x.endsOn)); if (p.endsOn) p.multiDay = true; }
  take('runningOrder', list(x.runningOrder, 24).map((r) => ({ day: 0, time: time(r?.time), title: str(r?.title, 120) })).filter((r) => r.title));
  take('venue', oneOf(VENUE_KINDS, x.venue));
  if (str(x.place, 240) && allowed.has('place')) { if ((p.venue ?? x.venue) === 'their_place') p.venueArea = str(x.place, 120); else p.venueLabel = str(x.place, 240); found.push('place'); }
  if (lane === 'weekly' || lane === 'course') take('firstDate', date(x.firstDate));
  if (lane === 'weekly') take('weekdays', list(x.weekdays, 7).map((d) => whole(d, { min: 0, max: 6 })).filter((d) => d != null));
  if (lane === 'weekly' || lane === 'course') take('startsAt', time(x.startsAt));
  take('durationMin', whole(x.durationMin, { min: 5, max: 1440 }));
  if (lane === 'course') { take('sessions', whole(x.sessions, { min: hostingConfig().courseSessions.min, max: hostingConfig().courseSessions.max })); take('outcome', str(x.outcome, 600)); take('topics', list(x.topics, 20).map((t, i) => ({ n: i + 1, title: str(t, 160) })).filter((t) => t.title)); }
  if (lane === 'onrequest') {
    take('whyYou', str(x.whyYou, 2000));
    const fh = {};
    for (const r of list(x.freeHours, 21)) { const d = whole(r?.weekday, { min: 0, max: 6 }); const a = time(r?.from); const b = time(r?.to); if (d != null && a && b && a < b) (fh[d] ??= []).push([a, b]); }
    if (Object.keys(fh).length) take('freeHours', fh);
    take('sessionLengths', list(x.sessionLengths, 6).map((m) => whole(m, { min: 15, max: 720 })).filter(Boolean));
  }
  if (lane === 'weekly') { take('dropInPence', pence(x.dropInPence)); take('bookAheadPence', pence(x.bookAheadPence)); }
  else { take('priceMode', oneOf(PRICE_MODES, x.priceMode)); take('pricePence', pence(x.pricePence)); take('childPence', pence(x.childPence)); take('totalPence', pence(x.totalPence)); }
  take('minCount', whole(x.minCount, { min: 1, max: 100000 })); take('maxCount', whole(x.maxCount, { min: 1, max: 100000 }));
  take('visibility', oneOf(['invite', 'public'], x.visibility)); take('ageMin', whole(x.ageMin, { min: 0, max: 120 })); take('ageMax', whole(x.ageMax, { min: 0, max: 120 }));
  take('parents', oneOf(['stay', 'drop_off'], x.parents));
  if (allowed.has('otherHosts') && list(x.otherHosts, 8).length) { p.cohosts = list(x.otherHosts, 8).map((name) => ({ name: str(name, 80), role: 'cohost' })).filter((c) => c.name); found.push('otherHosts'); }
  if (p.minCount && p.maxCount && p.minCount > p.maxCount) { delete p.minCount; }
  if (p.ageMin != null && p.ageMax != null && p.ageMin > p.ageMax) { delete p.ageMin; delete p.ageMax; }
  return { patch: p, found };
}

/**
 * Run the words through the model, paid for out of the household's own bound
 * and written to the ledger against this session (F15). `input` is text, or
 * the Responses API's content list when a photo is being read.
 */
async function readWords({ household, lane, step, input }) {
  if (!openaiEnabled()) throw refuse(503, 'no_listener', 'Epic can’t read it for you yet. Type it in instead — it takes a minute.');
  await assertWithinBounds({ householdId: household.id });
  const today = localDay(new Date());
  const started = Date.now();
  try {
    const out = await extractWith({ system: extractSystem(lane, step, today), input, schema: EXTRACT_SCHEMA, name: 'host_draft' });
    await providerCalls.recordMetered({ householdId: household.id, provider: 'openai', purpose: step ? 'host.draft.step' : 'host.draft.extract', units: { 'openai-requests': 1 }, costUsd: tokenCost(out.model, out.usage), ok: true, ms: Date.now() - started });
    return out.parsed;
  } catch (err) {
    await providerCalls.recordFailure({ householdId: household.id, provider: 'openai', purpose: step ? 'host.draft.step' : 'host.draft.extract', ms: Date.now() - started, fault: err.code ?? 'error' });
    throw err.status ? err : refuse(503, 'read_failed', 'Epic couldn’t read that just now. Try again, or type it in.');
  }
}

/**
 * Apply what was found. On a fresh draft everything found is written; on an
 * existing one only empty fields are filled — the host's own answers are never
 * overwritten by a re-read — unless the header mic was used on a step, in which
 * case that step's fields take what was just said.
 */
async function applyFound({ household, account, lane, offerId, step, patch, found, source }) {
  const host = await ensureHost(household, account);
  let offer = offerId ? await repo.offerOfHost(offerId, host.id) : null;
  if (offerId && (!offer || offer.lane !== lane)) throw refuse(404, 'offer_not_found', 'That is not one of your offers.');
  if (offer && offer.state !== 'draft') throw refuse(409, 'already_sent', 'This one is out already.');
  if (!offer) offer = await repo.insertOffer(host.id, SHAPE_OF[lane], { lane, state: 'draft', visibility: 'invite', money: 'free', priceMode: 'free', ageMin: hostingConfig().adultAge, ...(lane === 'course' ? { joinMode: 'whole' } : {}) });
  const current = await lanePayload(offer, host, account);
  const keep = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'cohosts') continue;
    const now = k === 'line' ? current.line : current[k];
    const empty = now == null || now === '' || (Array.isArray(now) && !now.length) || (typeof now === 'object' && !Array.isArray(now) && !Object.keys(now).length) || (k === 'priceMode' && now === 'free') || (k === 'venue' && !current.venueLabel && !current.venueArea && !current.onlineMode)
      // Adults is where a draft starts, not an answer: a said or read age range replaces it.
      || ((k === 'ageMin' || k === 'ageMax') && current.ageMin === hostingConfig().adultAge && current.ageMax == null && !offer.who_chosen);
    if (step || empty) keep[k] = v;
  }
  if (keep.line) keep.lineSuggested = false;
  keep.draftSource = source;
  const body = laneBody(keep, offer);
  const derived = derive(body, offer);
  const cohosts = patch.cohosts && (step === 'cohosts' || !current.cohosts.length) ? await ownCohosts(household.id, patch.cohosts) : null;
  // Under the same lock as every other set-up write, and only to a draft (Codex, 2 Oct 2026).
  const updated = await withTransaction(async (client) => {
    await lockDraft(client, offer.id);
    const row = await repo.updateOffer(offer.id, derived, client);
    if (cohosts) await repo.setCohosts(offer.id, cohosts, client);
    return row;
  });
  return { offer: await lanePayload(updated, host, account), found };
}

/** POST /host/lanes/extract {lane, offerId?, step?, text, source} — the transcript of Say it, or pasted words. */
router.post('/host/lanes/extract', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const lane = oneOf(LANES, req.body?.lane);
    if (!lane) throw refuse(400, 'lane_required', 'Which kind of hosting is this?');
    const step = req.body?.step && SEQ[lane].includes(req.body.step) && req.body.step !== 'what' ? req.body.step : null;
    const text = str(req.body?.text, 12_000);
    if (!text) throw refuse(400, 'nothing_said', 'Nothing came through. Try again, or type it in.');
    const x = await readWords({ household, lane, step, input: text });
    const { patch, found } = patchFromExtract(lane, x, { step });
    res.json(await applyFound({ household, account, lane, offerId: str(req.body?.offerId, 40), step, patch, found, source: req.body?.source === 'pasted' ? 'uploaded' : 'said' }));
  } catch (err) { next(err); }
});

// What the model can look at: JPEG, PNG, WebP, GIF. An iPhone's HEIC is turned away
// before any call is paid for, with a plain way round it (Codex, 2 Oct 2026).
const READ_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|gif)|text\/plain)$/;
/**
 * POST /host/lanes/read?lane=&offerId=&name= — Upload it: the file as the
 * body. A PDF's text is read here; a photo is read by the model; a text file or
 * a note is words. Nothing uploaded is kept: what is found goes into the draft,
 * and the bytes are dropped.
 */
router.post('/host/lanes/read', express.raw({ type: () => true, limit: '12mb' }), async (req, res, next) => {
  try {
    const { household, account } = await me();
    const lane = oneOf(LANES, req.query.lane);
    if (!lane) throw refuse(400, 'lane_required', 'Which kind of hosting is this?');
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    if (!bytes?.length) throw refuse(400, 'empty', 'That file is empty.');
    if (/^image\/hei[cf]$/.test(mime)) throw refuse(415, 'heic', 'Epic can’t read that photo format. Take a screenshot of it and upload that instead.');
    if (!READ_TYPES.test(mime)) throw refuse(415, 'unreadable', 'Epic can read a PDF, a photo or a text note.');
    let input;
    if (mime === 'application/pdf') {
      const text = (await pdfText(bytes).catch(() => '')) ?? '';
      if (!text.trim()) throw refuse(422, 'no_text', 'That PDF has no words Epic can read. Try a photo of it instead.');
      input = text.slice(0, 12_000);
    } else if (mime === 'text/plain') {
      input = bytes.toString('utf8').slice(0, 12_000);
    } else {
      input = [{ role: 'user', content: [{ type: 'input_text', text: 'Read this invite, flyer or note.' }, { type: 'input_image', image_url: `data:${mime};base64,${bytes.toString('base64')}` }] }];
    }
    const x = await readWords({ household, lane, step: null, input });
    const { patch, found } = patchFromExtract(lane, x, {});
    res.json(await applyFound({ household, account, lane, offerId: str(req.query.offerId, 40), step: null, patch, found, source: 'uploaded' }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the checklist's sheets
// ---------------------------------------------------------------------------

/** PATCH /host/lanes/profile {name, line, photoId, dateOfBirth, mobile} — the host profile sheet. Date of birth is always asked; the host must be 18 or over. */
router.patch('/host/lanes/profile', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const host = await ensureHost(household, account);
    const b = req.body ?? {};
    const cfg = hostingConfig();
    const patch = {};
    if (b.name !== undefined) { patch.name = str(b.name, 120); if (!patch.name) throw refuse(400, 'name_required', 'Give the name guests will see.'); }
    if (b.line !== undefined) patch.introText = str(b.line, 300);
    if (b.photoId !== undefined) patch.photoId = b.photoId ? (await ownMediaList(household.id, [b.photoId], 'photo', 1))[0] : null;
    if (b.dateOfBirth !== undefined) {
      const dob = date(b.dateOfBirth);
      if (!dob) throw refuse(400, 'dob_required', 'Your date of birth — day, month and year.');
      if ((ageOn(dob) ?? 0) < cfg.hostMinAge) throw refuse(422, 'too_young', `Hosts on Epic are ${cfg.hostMinAge} or over.`);
      patch.dateOfBirth = dob;
    }
    // The mobile first: if it is taken nothing else is written, so a refused save changes nothing (Codex, 2 Oct 2026).
    let acct = account;
    if (b.mobile !== undefined && account?.id) {
      const mobile = str(b.mobile, 30)?.replace(/[^\d+]/g, '') ?? null;
      if (!mobile || mobile.replace(/\D/g, '').length < 10) throw refuse(400, 'bad_mobile', 'That doesn’t look like a mobile number.');
      try {
        const { rows } = await query('update accounts set mobile = $2 where id = $1 returning *', [account.id, mobile]);
        acct = rows[0] ?? account;
      } catch (e) {
        if (e.code === '23505') throw refuse(409, 'mobile_taken', 'That number is already on another Epic account.');
        throw e;
      }
    }
    const updated = Object.keys(patch).length ? await repo.updateHost(host.id, patch) : host;
    res.json({ host: hostSheet(updated, acct) });
  } catch (err) { next(err); }
});

/** POST /host/lanes/tax {reference} — NI number or UTR, needed before the first payout (DAC7). Held as given; shown back only masked. */
router.post('/host/lanes/tax', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const host = await ensureHost(household, account);
    const ref = String(req.body?.reference ?? '').toUpperCase().replace(/\s+/g, '');
    if (!NI.test(ref) && !UTR.test(ref)) throw refuse(400, 'bad_tax_reference', 'That isn’t a National Insurance number (QQ 12 34 56 C) or a ten-digit UTR.');
    const updated = await repo.updateHost(host.id, { taxReference: ref });
    res.json({ host: hostSheet(updated, account) });
  } catch (err) { next(err); }
});

/**
 * POST /host/lanes/checked {dbsNumber, insuranceMediaId, referees: [{name, email}] × 2}
 * — sent for checking. Passing it is the back office's, never the host's.
 */
router.post('/host/lanes/checked', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const host = await ensureHost(household, account);
    const dbs = String(req.body?.dbsNumber ?? '').replace(/\s+/g, '');
    if (!/^\d{12}$/.test(dbs)) throw refuse(400, 'bad_dbs', 'A DBS certificate number is twelve digits.');
    const insurance = req.body?.insuranceMediaId ? await ownDoc(household.id, req.body.insuranceMediaId) : host.insurance_media_id;
    if (!insurance) throw refuse(400, 'insurance_required', 'Upload your insurance certificate.');
    const referees = list(req.body?.referees, 2).map((r) => ({ name: str(r?.name, 80), email: str(r?.email, 120) })).filter((r) => r.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email ?? ''));
    if (referees.length < 2) throw refuse(400, 'two_referees', 'Two references, each with a name and an email.');
    // A pass is for the evidence that was read: anything changed goes back to be read again (Codex, 2 Oct 2026).
    const same = host.checked_state === 'passed' && host.dbs_number === dbs && host.insurance_media_id === insurance
      && JSON.stringify(host.referees ?? []) === JSON.stringify(referees);
    const updated = await repo.updateHost(host.id, { dbsNumber: dbs, insuranceMediaId: insurance, referees, checkedState: same ? 'passed' : 'submitted', checkedSubmittedAt: new Date() });
    res.json({ host: hostSheet(updated, account) });
  } catch (err) { next(err); }
});

async function ownDoc(householdId, id) {
  const m = await repo.mediaMeta(id);
  if (!m || m.household_id !== householdId || !['doc', 'photo'].includes(m.kind)) throw refuse(400, 'not_your_media', 'That file is not one of yours.');
  return id;
}

/**
 * The host's Stripe account, made once (L6): Accounts v2, pre-filled from what Epic holds, manual payouts. Called
 * under the per-host payouts lock. An account from before register L is left for the owner's void and refused.
 */
async function ensureStripeAccount(host, { account, household }) {
  // An account from before this build (no model) took money the old way. It is voided by the owner's own action
  // (G7), which keeps its id; until then it is left exactly as it is, and set-up waits rather than replacing it
  // (owner, 3 Oct 2026: void the old, recreate under the new model). Once voided, a new one is made the L1 way.
  if (host.stripe_account_id && host.stripe_account_model !== 'v2') throw refuse(409, 'old_stripe_account', 'Payouts are being moved to a new set-up. Try again shortly.');
  if (host.stripe_account_id) return host;
  const a = await stripe.createConnectAccount({
    email: account?.email, householdId: household.id, hostId: host.id,
    legalName: host.legal_name, dateOfBirth: host.date_of_birth, displayName: host.name,
  });
  return repo.updateHost(host.id, {
    stripeAccountId: a.id, stripeMode: 'test', stripeAccountModel: 'v2', stripePersonId: a.personId,
    ...stripe.hostPatchFromAccount(a.account),
  });
}

/** POST /host/lanes/payouts {offerId} — Stripe's hosted onboarding. Returns the URL to send the host to; they come back to the checklist. */
router.post('/host/lanes/payouts', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const first = await ensureHost(household, account);
    // One Connect account per host, however many taps: created under a per-host lock, re-read inside it (Codex, 2 Oct 2026).
    const lockClient = await pool.connect();
    try {
    await lockClient.query('select pg_advisory_lock(hashtext($1))', [`host-payouts:${first.id}`]);
    const host = await repo.hostById(first.id);
    const back = `${appUrl()}/host/offers/${encodeURIComponent(str(req.body?.offerId, 40) ?? '')}/publish?back=payouts`;
    // The passport first, then Stripe's form (L7; owner, 3 Oct 2026: "Keep the order: create account → passport and
    // selfie → Stripe's form"). Once Stripe's form has been opened it no longer lets the check be tied to the host's
    // Person, so a host who hasn't started it is sent to it first. A check under way is already tied.
    if (!['verified', 'pending'].includes(host.identity_state)) throw refuse(409, 'verify_first', 'Verify your identity first — then Stripe asks only for your bank details.');
    const ready = await ensureStripeAccount(host, { account, household });
    const accountId = ready.stripe_account_id;
    const link = await stripe.accountLink({ accountId, refreshUrl: back, returnUrl: back, householdId: household.id });
    // From here Stripe no longer lets an Identity check be tied to the account's Person (L7).
    if (!host.stripe_link_made_at) await repo.updateHost(host.id, { stripeLinkMadeAt: new Date() });
    res.json({ url: link.url });
    } finally {
      await lockClient.query('select pg_advisory_unlock(hashtext($1))', [`host-payouts:${first.id}`]).catch(() => null);
      lockClient.release();
    }
  } catch (err) { next(err); }
});

/** POST /host/lanes/verify {offerId} — Stripe Identity: a passport (a UK licence only while that setting is on), plus a selfie. Epic sees the result, never the document. */
router.post('/host/lanes/verify', async (req, res, next) => {
  try {
    const { household, account } = await me();
    const first = await ensureHost(household, account);
    // One identity check at a time per host: two taps at once never open two sessions (Codex, 2 Oct 2026).
    const lockClient = await pool.connect();
    try {
    await lockClient.query('select pg_advisory_lock(hashtext($1))', [`host-verify:${first.id}`]);
    const host = await repo.hostById(first.id);
    if (host.identity_state === 'verified') return res.json({ url: null, verified: true });
    const back = `${appUrl()}/host/offers/${encodeURIComponent(str(req.body?.offerId, 40) ?? '')}/publish?back=verified`;
    // Explicit consent to the selfie match, which is biometric data (L7), logged with its date — before a check is
    // started, and before one already open is carried on (Codex, 3 Oct 2026). The request carries the host's yes.
    if (req.body?.consent !== true) throw refuse(400, 'consent_required', 'Agree to the face match first.');
    await hostingSettings.logChange({ subjectKind: 'host', subjectId: host.id, field: 'identity_consent', after: { biometric: true, at: new Date().toISOString() }, by: account?.id ?? null, byLabel: 'host' });
    // One open check at a time: a second tap carries on with the first session rather than
    // orphaning it, so finishing either one counts (Codex, 2 Oct 2026).
    if (host.identity_session_id && host.identity_state === 'pending') {
      const open = await stripe.retrieveIdentity(host.identity_session_id, { householdId: household.id }).catch(() => null);
      if (open?.status === 'verified') { await repo.updateHost(host.id, { identityState: 'verified', identityVerifiedAt: new Date() }); return res.json({ url: null, verified: true }); }
      if (open?.status === 'requires_input' && open.url) return res.json({ url: open.url });
      // Stripe is still reading what was sent: wait for it, never start a second check (Codex, 2 Oct 2026).
      if (open?.status === 'processing') return res.json({ url: null, processing: true });
    }
    // A host who will take money through Epic gets their Stripe account now, before the check, so the check can be tied
    // to the account's Person (create account → passport and selfie → Stripe's form). A free-event host gets none (L6).
    let me2 = host;
    const offerId = str(req.body?.offerId, 40);
    const offer = offerId && /^[0-9a-f-]{36}$/i.test(offerId) ? await repo.offerById(offerId) : null;
    if (offer && offer.host_id === host.id && paidThroughEpic(offer) && stripe.stripeStatus().ready) {
      await lockClient.query('select pg_advisory_lock(hashtext($1))', [`host-payouts:${host.id}`]);
      try { me2 = await ensureStripeAccount(await repo.hostById(host.id), { account, household }); }
      finally { await lockClient.query('select pg_advisory_unlock(hashtext($1))', [`host-payouts:${host.id}`]).catch(() => null); }
    }
    const cfg = await hostingSettings.current();
    // Tied to the host's Stripe Person when there is one and Stripe still allows it — before the hosted form was first
    // opened — so the same check satisfies Stripe's own and the host is never asked for ID twice (L7). A free-event
    // host has no account, and the check stands on its own.
    const relatedPerson = me2.stripe_account_model === 'v2' && me2.stripe_account_id && me2.stripe_person_id && !me2.stripe_link_made_at
      ? { account: me2.stripe_account_id, person: me2.stripe_person_id } : null;
    const s = await stripe.identitySession({ returnUrl: back, hostId: host.id, householdId: household.id, relatedPerson, allowDrivingLicence: cfg.identity_driving_licence === true });
    await repo.updateHost(host.id, { identitySessionId: s.id, identityState: 'pending', stripeMode: 'test' });
    res.json({ url: s.url });
    } finally {
      await lockClient.query('select pg_advisory_unlock(hashtext($1))', [`host-verify:${first.id}`]).catch(() => null);
      lockClient.release();
    }
  } catch (err) { next(err); }
});

/** POST …/sync — back from Stripe: ask it what it now says about payouts, identity and the £10, rather than trusting the return URL. */
router.post('/host/lanes/offers/:id/sync', async (req, res, next) => {
  try {
    const { household, account, offer } = await myLaneOffer(req.params.id);
    let host = await repo.hostByHousehold(household.id);
    let current = offer;
    if (stripe.stripeStatus().ready) {
      if (host.stripe_account_id && host.stripe_account_model === 'v2' && host.payouts_state !== 'ready') {
        const a = await stripe.retrieveAccount(host.stripe_account_id, { householdId: household.id });
        host = await repo.updateHost(host.id, stripe.hostPatchFromAccount(a));
      }
      if (host.identity_session_id && host.identity_state !== 'verified') {
        const s = await stripe.retrieveIdentity(host.identity_session_id, { householdId: household.id });
        const state = stripe.identityState(s);
        host = await repo.updateHost(host.id, { identityState: state, identityVerifiedAt: state === 'verified' ? new Date() : null });
      }
      if (offer.private_fee_ref && offer.private_fee_state === 'pending') {
        const c = await stripe.retrieveCheckout(offer.private_fee_ref, { householdId: household.id });
        if (stripe.checkoutPaid(c)) current = await markFeePaid(offer, c, household, account);
      }
    }
    res.json({ offer: await lanePayload(current, host, account) });
  } catch (err) { next(err); }
});

/**
 * POST …/video {videoId, coverS, onProfile} — the offer video, recorded or uploaded by the
 * host. Epic does not make one for them (owner, 2 Oct 2026: "They need to make their own video").
 */
router.post('/host/lanes/offers/:id/video', async (req, res, next) => {
  try {
    const { household, host, account, offer } = await myLaneOffer(req.params.id);
    // A video that has been sent for review, or reviewed, is not swapped from here (Codex, 2 Oct 2026).
    if (offer.state !== 'draft') throw refuse(409, 'already_sent', offer.state === 'live' ? 'This one is out already.' : 'This one is with us for review.');
    const b = req.body ?? {};
    const cfg = hostingConfig();
    const patch = {};
    if (b.videoId !== undefined) patch.videoId = b.videoId ? (await ownMediaList(household.id, [b.videoId], 'video', 1))[0] : null;
    // The length the checklist shows is the take's own, and it is held to the configured
    // range here, not only on the device. Two seconds' grace either way for a recorder that
    // stops a beat late.
    if (patch.videoId) {
      const m = await repo.mediaMeta(patch.videoId); const secs = Number(m?.duration_s);
      if (!(Number.isFinite(secs) && secs >= cfg.videoSeconds.min - 2 && secs <= cfg.videoSeconds.max + 2)) throw refuse(400, 'video_length', `The video should be ${cfg.videoSeconds.min} to ${cfg.videoSeconds.max} seconds.`);
    }
    if (b.videoId !== undefined) { patch.videoMadeBy = patch.videoId ? 'self' : null; patch.videoPhotoIds = []; patch.helloVideoId = null; }
    if (b.coverS !== undefined) patch.videoCoverS = num(b.coverS);
    if (b.onProfile !== undefined) patch.videoOnProfile = Boolean(b.onProfile);
    const updated = await withTransaction(async (client) => { await lockDraft(client, offer.id); return repo.updateOffer(offer.id, patch, client); });
    // The profile shows this offer's video only while the toggle says so, and the current take,
    // never one replaced since (Codex, 2 Oct 2026).
    const wasThis = host.intro_video_id && host.intro_video_id === offer.video_id;
    if (updated.video_on_profile && updated.video_id && (!host.intro_video_id || wasThis)) await repo.updateHost(host.id, { introVideoId: updated.video_id });
    else if (wasThis && (!updated.video_on_profile || !updated.video_id)) await repo.updateHost(host.id, { introVideoId: null });
    res.json({ offer: await lanePayload(updated, host, account) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

async function markFeePaid(offer, checkoutSession, household, account) {
  const kind = checkoutSession?.metadata?.epic_kind === 'pro' ? 'pro' : 'private_fee';
  const existing = await repo.paymentByRef(checkoutSession.id, kind);
  if (existing && existing.state !== 'succeeded') await repo.updatePayment(existing.id, { state: 'succeeded' });
  // Which subscription this is, so its later events change this row and no other (Codex, 2 Oct 2026).
  if (existing && kind === 'pro' && checkoutSession.subscription) await query('update hosting_payments set reason = $2 where id = $1', [existing.id, `sub:${checkoutSession.subscription}`]);
  // Joining Pro here is recorded against this offer and the payment row; the
  // account's plan is billing's to change, and a test-mode card must never make
  // anybody Pro for real.
  void account; void household;
  return repo.updateOffer(offer.id, { privateFeeState: kind === 'pro' ? 'included' : 'paid' });
}

/** Lay the sessions down: dated rows, each deciding by its own date when there is a minimum. */
async function laySessions(offer, holidays, client) {
  const cfg = hostingConfig();
  const rows = sessionsFor(offer, holidays, cfg);
  const deciding = decidesOn(offer, holidays, cfg);
  const withDecide = rows.map((s) => ({
    ...s,
    decidesAt: offer.lane === 'weekly' && offer.min_count
      ? new Date(localInstant(s.onDate, s.startsAt ?? '00:00', offer.time_zone ?? 'Europe/London').getTime() - cfg.weeklyDecidesHoursBefore * 3600_000)
      : deciding ? localInstant(deciding, '23:59', offer.time_zone ?? 'Europe/London') : null,
  }));
  return repo.replaceSessions(offer.id, withDecide, client);
}

/**
 * POST /host/lanes/offers/:id/publish {plan?}
 *
 * Private: everything blocking "send" must be done; then the host pays £10 or
 * joins Pro through Stripe's hosted Checkout (an existing Pro subscriber pays
 * nothing more), and on return the invites go. Public: blocking items done,
 * the sessions laid down, the state `in_review`, and the video's automatic
 * check started. Checked (drop off) blocks going live, not sending.
 */
router.post('/host/lanes/offers/:id/publish', async (req, res, next) => {
  try {
    const { household, account, offer: o } = await myLaneOffer(req.params.id);
    // One thing at a time on an offer while it is being sent: publishing holds this lock across
    // its checks, the Stripe call and the state change, and every set-up write (an edit, the
    // video, a delete) takes the same lock and then finds it no longer a draft (Codex, 2 Oct 2026).
    const lockClient = await pool.connect();
    try {
      await lockClient.query('select pg_advisory_lock(hashtext($1))', [`host-publish:${o.id}`]);
      await publishLocked(req, res, household, account, o.id);
    } finally {
      await lockClient.query('select pg_advisory_unlock(hashtext($1))', [`host-publish:${o.id}`]).catch(() => null);
      lockClient.release();
    }
  } catch (err) { next(err); }
});

async function publishLocked(req, res, household, account, offerId) {
  {
    const host = await repo.hostByHousehold(household.id);
    // Read again under the lock: every check below is made on the offer as it is now (Codex, 2 Oct 2026).
    let offer = (await repo.offerOfHost(offerId, host.id));
    if (!offer) throw refuse(404, 'offer_not_found', 'That is not one of your offers.');
    if (offer.state !== 'draft') throw refuse(409, 'already_sent', offer.state === 'live' ? 'This one is out already.' : 'This one is with us for review.');
    const cfg = hostingConfig();
    const gaps = laneGaps(offer, cfg);
    if (gaps.length) throw refuse(422, 'not_ready', gaps[0], { steps: missingSteps(offer, cfg) });
    const items = checklist(offer, { host, account }, cfg);
    const blocking = sendBlockers(items);
    if (blocking.length) throw refuse(422, 'checklist', CHECK_WORDS[blocking[0]], { blocking });
    const holidays = await holidaysFor(household.id);
    // Nothing is sent, paid for or reviewed for a date that has gone (Codex, 2 Oct 2026). A
    // weekly class rolls on, so only a one-off or a course is held to its first date.
    const first = offer.lane === 'oneoff' || offer.lane === 'course' ? sessionsFor(offer, holidays, cfg)[0]?.onDate : null;
    if (first && first < localDay(new Date(), offer.time_zone ?? 'Europe/London')) throw refuse(422, 'in_the_past', 'That date has gone. Pick a new one and send it then.', { steps: [offer.lane === 'oneoff' ? 'when' : 'run'] });

    if (offer.visibility === 'invite') {
      // One publish at a time per offer: two presses at once must not each open a Checkout
      // (Codex, 2 Oct 2026). The lock is a session-level advisory one, held across the Stripe
      // call and released however this ends.
      return await publishPrivate();
    }
    async function publishPrivate() {
      let pro = await hostingPro(account, household.id);
      const plan = oneOf(['event', 'pro'], req.body?.plan) ?? offer.private_plan ?? (pro ? 'pro' : 'event');
      if (plan !== offer.private_plan) offer = await repo.updateOffer(offer.id, { privatePlan: plan });
      // 'included' is Pro's, and counts only while Pro does (Codex, 2 Oct 2026).
      const feeDone = pro || offer.private_fee_state === 'paid';
      if (!feeDone && offer.private_fee_state === 'pending' && offer.private_fee_ref) {
        // One Checkout per offer and plan: a retry, or a host back from cancelling, gets the
        // same session — never a second one that could also be paid (Codex, 2 Oct 2026).
        const open = await stripe.retrieveCheckout(offer.private_fee_ref, { householdId: household.id });
        if (stripe.checkoutPaid(open)) {
          offer = await markFeePaid(offer, open, household, account);
          // Paid just now: read Pro again, so this press sends rather than opening a second subscription (Codex, 2 Oct 2026).
          pro = await hostingPro(account, household.id);
        } else {
          const samePlan = (open?.metadata?.epic_kind === 'pro') === (plan === 'pro');
          if (open?.status === 'open' && samePlan && open.url) return res.json({ pay: { url: open.url } });
          if (open?.status === 'open') await stripe.expireCheckout(open.id, { householdId: household.id });
          const old = await repo.paymentByRef(offer.private_fee_ref, open?.metadata?.epic_kind === 'pro' ? 'pro' : 'private_fee');
          if (old && old.state === 'pending') await repo.updatePayment(old.id, { state: 'cancelled' });
        }
      }
      if (offer.private_fee_state !== 'paid' && !pro) {
        // The £10, or joining Pro: Stripe's hosted Checkout, test mode only.
        const amount = plan === 'pro' ? cfg.proMonthlyPence : cfg.privateEventPence;
        const back = `${appUrl()}/host/offers/${offer.id}/publish?back=paid`;
        // Idempotent per offer, plan and attempt: a lost answer retried gets the same session
        // back; only a session closed by switching plan lets a new one be made (Codex, 2 Oct 2026).
        const { rows: [tries] } = await query("select count(*)::int as n from hosting_payments where offer_id = $1 and kind = $2 and state = 'cancelled'", [offer.id, plan === 'pro' ? 'pro' : 'private_fee']);
        const session = await stripe.checkout({
          idempotencyKey: `fee-${offer.id}-${plan}-${tries.n}`,
          kind: plan === 'pro' ? 'pro' : 'event', amountPence: amount, name: plan === 'pro' ? 'Epic Pro' : `Private event · ${offer.title ?? 'Epic'}`,
          successUrl: back, cancelUrl: `${appUrl()}/host/offers/${offer.id}/publish`, email: account?.email, householdId: household.id, offerId: offer.id,
        });
        await repo.insertPayment({ kind: plan === 'pro' ? 'pro' : 'private_fee', offerId: offer.id, hostId: host.id, householdId: household.id, amountPence: amount, epicPence: amount, stripeRef: session.id, mode: 'test' });
        await repo.updateOffer(offer.id, { privateFeeState: 'pending', privateFeeRef: session.id });
        return res.json({ pay: { url: session.url } });
      }
      const sent = await withTransaction(async (client) => {
        await laySessions(offer, holidays, client);
        return repo.updateOffer(offer.id, { state: 'live', submittedAt: new Date(), publishedAt: new Date(), privateFeeState: pro && offer.private_fee_state !== 'paid' ? 'included' : offer.private_fee_state, draftStep: null }, client);
      });
      const told = await sendInvites(host, sent, (await repo.invitesOf(sent.id)).filter((i) => !i.sent_at));
      return res.json({ offer: await lanePayload(sent, host, account, { holidays }), ending: { kind: 'invites', invited: (await repo.invitesOf(sent.id)).reduce((n, i) => n + (i.heads ?? 1), 0), told } });
    }


    const sentForReview = await withTransaction(async (client) => {
      // One publish at a time: the row is locked and read again, so a second press finds it
      // already sent rather than laying the sessions down twice (Codex, 2 Oct 2026).
      const { rows: [now] } = await client.query('select state from host_offers where id = $1 for update', [offer.id]);
      if (now?.state !== 'draft') throw refuse(409, 'already_sent', 'This one is with us for review.');
      await laySessions(offer, holidays, client);
      return repo.updateOffer(offer.id, { state: 'in_review', submittedAt: new Date(), reviewAi: { state: offer.video_id ? 'queued' : 'not_needed' }, draftStep: null }, client);
    });
    if (sentForReview.video_id) void checkVideo(sentForReview, household.id).catch(() => null);
    const stillToDo = items.filter((i) => (i.blocks === 'live' || i.blocks === 'payout') && !i.done).map((i) => i.key);
    res.json({ offer: await lanePayload(sentForReview, host, account, { holidays }), ending: { kind: 'review', reviewHours: cfg.reviewHours, stillToDo } });
  }
}

/**
 * The 48-hour review's first pass (RULINGS: "AI checks the offer video and
 * flags the ones that need a person"). The video is transcribed and read
 * against the listing; anything off — a different activity, contact details,
 * money off-platform, anything unsafe around children — flags it for a person.
 * It never passes an offer by itself: a person in the back office still does.
 */
async function checkVideo(offer, householdId) {
  const m = await repo.mediaById(offer.video_id);
  if (!m || !openaiEnabled()) { await repo.updateOffer(offer.id, { reviewAi: { state: 'skipped', reason: openaiEnabled() ? 'no_video' : 'no_listener' } }); return; }
  try {
    await assertWithinBounds({ householdId });
    const heard = await transcribe({ audio: m.bytes, mime: m.mime, filename: 'offer.webm' });
    const seconds = Number(m.duration_s) || 60;
    await providerCalls.recordMetered({ householdId, provider: 'openai', purpose: 'host.review.transcribe', units: { 'openai-minutes': Math.round((seconds / 60) * 1000) / 1000 }, costUsd: minuteCost(heard.model, seconds), ok: true });
    const schema = { type: 'object', additionalProperties: false, required: ['needsPerson', 'reasons'], properties: { needsPerson: { type: 'boolean' }, reasons: { type: 'array', items: { type: 'string' } } } };
    const system = 'You check a host\'s offer video before a person reviews it. Flag it (needsPerson true) if what is said does not match the listing, shares a phone number, email or social handle, asks for payment outside Epic, is unsafe or inappropriate (especially around children), or is not the host speaking about this offer. Otherwise needsPerson false. reasons: short phrases, empty when nothing is wrong.';
    const out = await extractWith({ system, input: `Listing: ${offer.title ?? ''} — ${offer.summary ?? ''}\n\nVideo transcript: ${heard.text ?? ''}`, schema, name: 'video_check' });
    await providerCalls.recordMetered({ householdId, provider: 'openai', purpose: 'host.review.check', units: { 'openai-requests': 1 }, costUsd: tokenCost(out.model, out.usage), ok: true });
    // Written only if the offer still shows the video that was checked (Codex, 2 Oct 2026).
    const result = { state: 'done', videoId: offer.video_id, needsPerson: Boolean(out.parsed.needsPerson), reasons: list(out.parsed.reasons, 6).map((r) => str(r, 160)).filter(Boolean), at: new Date().toISOString() };
    await query('update host_offers set review_ai = $2::jsonb, transcript = $3, updated_at = now() where id = $1 and video_id = $4', [offer.id, JSON.stringify(result), heard.text ?? null, offer.video_id]);
  } catch (err) {
    await query('update host_offers set review_ai = $2::jsonb, updated_at = now() where id = $1 and video_id = $3', [offer.id, JSON.stringify({ state: 'failed', videoId: offer.video_id, reason: err.code ?? 'error', needsPerson: true }), offer.video_id]);
  }
}

// ---------------------------------------------------------------------------
// Stripe's webhook: a second way to hear what the return trip already asked
// ---------------------------------------------------------------------------

webhookRouter.post('/stripe/webhook', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!stripe.verifyWebhook(raw, req.headers['stripe-signature'])) return res.status(400).json({ error: 'bad_signature' });
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad_body' }); }
  if (event?.livemode) return res.status(200).json({ ignored: 'live' });
  if (typeof event?.id !== 'string' || !event.id.startsWith('evt_')) return res.status(400).json({ error: 'bad_body' });
  // Once per event: Stripe delivers at least once, so a second delivery of one already applied is a no-op.
  // A delivery that failed half-way is not marked processed, so Stripe's retry runs it again. Two deliveries
  // arriving at once can both run: everything applyStripeEvent does is itself safe to do twice.
  try {
    const { rows: [seen] } = await query(
      `insert into stripe_events (id, type, account, livemode) values ($1, $2, $3, false)
       on conflict (id) do update set received_at = stripe_events.received_at returning processed_at`,
      [event.id, String(event.type ?? '').slice(0, 100), typeof event.account === 'string' ? event.account : null],
    );
    if (seen?.processed_at) return res.json({ received: true, duplicate: true });
    await applyStripeEvent(event);
    await query('update stripe_events set processed_at = now(), fault = null where id = $1', [event.id]);
    res.json({ received: true });
  } catch (err) {
    await query('update stripe_events set fault = $2 where id = $1', [event.id, String(err.code ?? err.message ?? 'error').slice(0, 200)]).catch(() => null);
    res.status(500).json({ error: 'not_recorded' });
  }
});

/** What one Stripe event changes. Exported for the tests; the route above is the only caller. */
export async function applyStripeEvent(event) {
    const obj = event?.data?.object ?? {};
    if (event.type === 'account.updated' && obj.id) {
      const host = await repo.hostByStripeAccount(obj.id);
      if (host) {
        await repo.updateHost(host.id, stripe.hostPatchFromAccount(obj));
        // Stripe asking for ID from a host whose passport check passed: the owner is told, and the host is not sent round
        // again (brief §3, L7: "never asked for ID twice").
        const asks = stripe.asksForIdAgain(obj);
        if (asks.length && host.identity_state === 'verified') {
          const { alertOwner } = await import('../sources/ownerAlert.js');
          await alertOwner({
            key: `stripe-asks-id:${host.id}:${asks.sort().join(',')}`, subjectId: host.id,
            subject: `Stripe is asking ${host.name ?? 'a host'} for ID again`,
            text: [`Stripe's onboarding lists ${asks.join(', ')} for ${host.name ?? 'a host'} (${obj.id}), although their passport check passed on ${host.identity_verified_at ? new Date(host.identity_verified_at).toISOString().slice(0, 10) : 'an earlier date'}.`,
              'The host has not been asked to do anything. Epic hosting › the host, or the Stripe sandbox dashboard, shows the account.'].join('\n\n'),
          });
          // A failure to send is not caught: the event is then not marked processed, and Stripe's retry sends it (Codex, 3 Oct 2026).
        }
      }
    } else if ((event.type === 'payout.paid' || event.type === 'payout.failed') && obj.id && typeof event.account === 'string') {
      // A released payout reaching the host's bank, or bouncing: the host's own account's event (Connect endpoint).
      const { markPayoutOutcome } = await import('../repositories/hostingLedger.js');
      await markPayoutOutcome({ stripePayout: obj.id, accountId: event.account, paid: event.type === 'payout.paid', failure: obj.failure_code ?? null, payoutId: obj.metadata?.epic_payout_id ?? null });
    } else if ((event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') && obj.payment_intent) {
      // A chargeback is the guest's bank's decision (L3); while it is open the booking's payout waits, like a complaint.
      const { markDispute } = await import('../repositories/hostingLedger.js');
      await markDispute({ paymentIntent: obj.payment_intent, open: event.type === 'charge.dispute.created', status: obj.status ?? null });
    } else if (event.type?.startsWith('identity.verification_session.') && obj.id) {
      const host = await repo.hostByIdentitySession(obj.id);
      if (host) { const state = stripe.identityState(obj); await repo.updateHost(host.id, { identityState: state, identityVerifiedAt: state === 'verified' ? new Date() : null }); }
    } else if (event.type === 'customer.subscription.updated' && obj.metadata?.epic_kind === 'pro' && obj.metadata?.epic_household_id) {
      // A renewal that failed (past due, unpaid) stops Pro counting; paid again, it counts again (Codex, 2 Oct 2026).
      const live = ['active', 'trialing'].includes(obj.status);
      await query("update hosting_payments set state = $2, updated_at = now() where household_id = $1 and kind = 'pro' and reason = $3 and state in ('succeeded', 'cancelled')", [obj.metadata.epic_household_id, live ? 'succeeded' : 'cancelled', `sub:${obj.id}`]);
    } else if (event.type === 'customer.subscription.deleted' && obj.metadata?.epic_kind === 'pro' && obj.metadata?.epic_household_id) {
      // Pro cancelled or lapsed: it stops counting for hosting from now.
      await query("update hosting_payments set state = 'cancelled', updated_at = now() where household_id = $1 and kind = 'pro' and reason = $2 and state = 'succeeded'", [obj.metadata.epic_household_id, `sub:${obj.id}`]);
    } else if (event.type?.startsWith('payment_intent.') && obj.object === 'payment_intent' && obj.id) {
      // Hosting v4: a guest's booking or tip. Read back from Stripe rather than trusting the event body's state.
      const { applyPaymentIntent } = await import('./guestBookings.js');
      const pi = await stripe.retrievePaymentIntent(obj.id, { householdId: obj.metadata?.epic_household_id ?? null }).catch(() => obj);
      await applyPaymentIntent(pi);
    } else if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && obj.id && stripe.checkoutPaid(obj)) {
      const kind = obj.metadata?.epic_kind === 'pro' ? 'pro' : 'private_fee';
      let pay = await repo.paymentByRef(obj.id, kind);
      // Stripe can say it was paid before Epic has written the session down: rebuild the row from the
      // Checkout's own details, so a payment is never lost to the race (Codex, 2 Oct 2026).
      if (!pay && obj.metadata?.epic_offer_id) {
        const offer = await repo.offerById(obj.metadata.epic_offer_id);
        if (offer && (!obj.metadata.epic_household_id || (await repo.hostById(offer.host_id))?.household_id === obj.metadata.epic_household_id)) {
          pay = await repo.insertPayment({ kind, offerId: offer.id, hostId: offer.host_id, householdId: obj.metadata.epic_household_id ?? null, amountPence: obj.amount_total ?? 0, epicPence: obj.amount_total ?? 0, stripeRef: obj.id, mode: 'test', state: 'pending' });
          await repo.updateOffer(offer.id, { privateFeeRef: obj.id });
        }
      }
      if (pay && pay.state !== 'succeeded') {
        await repo.updatePayment(pay.id, { state: 'succeeded' });
        if (kind === 'pro' && obj.subscription) await query('update hosting_payments set reason = $2 where id = $1', [pay.id, `sub:${obj.subscription}`]);
        if (pay.offer_id) await repo.updateOffer(pay.offer_id, { privateFeeState: kind === 'pro' ? 'included' : 'paid' });
      }
    }
}

// ---------------------------------------------------------------------------
// Hosting v4: once it is out — change a date, cancel (handover §5)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An event that is out: a draft changes its dates in the set-up, not here. */
async function myOutOffer(id) {
  const ctx = await myLaneOffer(id);
  if (ctx.offer.state === 'draft') throw refuse(409, 'still_a_draft', 'Finish setting it up first; a draft’s dates change in the set-up.');
  return ctx;
}

/**
 * POST /host/lanes/offers/:id/change-date {sessionId, toDate, toTime?, scope, preview?}
 * `preview` answers what would move — old → new, guests booked, whether it is
 * late — and writes nothing; the sheet shows it before the host confirms.
 */
router.post('/host/lanes/offers/:id/change-date', async (req, res, next) => {
  try {
    const { offer, host, account } = await myOutOffer(req.params.id);
    const b = req.body ?? {};
    if (!UUID_RE.test(String(b.sessionId ?? ''))) throw refuse(400, 'bad_session', 'Pick a session.');
    const out = await changeDate({
      offerId: offer.id, hostId: host.id, sessionId: b.sessionId, toDate: b.toDate, toTime: b.toTime ?? null,
      scope: b.scope ?? 'this', by: account?.id ?? null, dryRun: b.preview === true,
    });
    res.json({ ...out, preview: b.preview === true });
  } catch (err) { next(err); }
});

/** POST /host/lanes/offers/:id/cancel {sessionIds?, reason, note?} — no sessionIds: the whole event. */
router.post('/host/lanes/offers/:id/cancel', async (req, res, next) => {
  try {
    const { offer, host, account } = await myOutOffer(req.params.id);
    const b = req.body ?? {};
    let ids = null;
    if (b.sessionIds != null) {
      if (!Array.isArray(b.sessionIds) || !b.sessionIds.length || b.sessionIds.length > 200 || !b.sessionIds.every((x) => UUID_RE.test(String(x)))) throw refuse(400, 'bad_session', 'Pick the sessions to cancel.');
      ids = [...new Set(b.sessionIds)];
    }
    if (!CANCEL_REASONS.includes(b.reason)) throw refuse(400, 'reason_required', 'Choose why first.');
    if (b.reason === 'other' && !str(b.note, 300)) throw refuse(400, 'reason_required', 'Say what happened.');
    const out = await cancelSessions({ offerId: offer.id, hostId: host.id, sessionIds: ids, reason: b.reason, note: str(b.note, 300), by: account?.id ?? null });
    res.json(out);
  } catch (err) { next(err); }
});

export default router;
