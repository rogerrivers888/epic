/**
 * The trip's conversation and the people in it (trip rebuild, 7 Sep 2026,
 * screens 5e, 3d and 3b).
 *
 * Three things, and they are one file because they are one idea: a trip is a
 * group of people, some of whom have Epic and some of whom have a link.
 *
 *   · **Chat** — the trip's own thread. Everything is in it, per-stop questions
 *     included, because a question asked on a stop is still something the group
 *     said to each other; it carries a pointer back to the stop.
 *   · **Ask** — one stop's thread, routed to whoever is organising.
 *   · **Share** — household members added to the trip, guests invited by mobile
 *     or email, and the link anybody can be sent.
 *
 * Guests post through `routes/shared.js`, which is the public door. Everything
 * here is the household's side and is behind the session, so a member never
 * needs a token to read their own trip.
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import * as trips from '../repositories/trips.js';
import * as chat from '../repositories/tripChat.js';
import * as chatRepo from '../repositories/chat.js';
import * as topics from './chat.js';
import { currentHousehold, currentMember } from './household.js';
import * as households from '../repositories/households.js';
import { accountsForHousehold } from '../repositories/accounts.js';
import { sendMail, mailConfigured, webUrl } from '../sources/mail.js';
import { sendSms, smsConfigured, normaliseMobile } from '../sources/sms.js';

const router = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const newToken = () => crypto.randomBytes(18).toString('base64url');

async function ownTrip(req) {
  const household = await currentHousehold();
  const trip = await trips.tripOfHouseholdFull(req.params.id, household.id);
  if (!trip) { const err = new Error('Trip not found'); err.status = 404; err.code = 'trip_not_found'; throw err; }
  return { household, trip };
}

// ---------------------------------------------------------------------------
// chat — the addresses the trip rebuild shipped, answered from the topic model
// ---------------------------------------------------------------------------
//
// The chat module (13 Sep 2026, `routes/chat.js`) replaced the flat river with
// topics and replies. These four endpoints keep their addresses — "same
// endpoint" (Chat screens README §3) — so a device still holding the old
// bundle, or a write queued in its outbox, lands in the same conversation.

async function tripCtx(req) {
  const { trip } = await ownTrip(req);
  const me = await currentMember();
  return topics.tripContext(trip, me ? { memberId: me.id, guestId: null, name: me.name, householdId: trip.household_id } : null);
}

/** GET /api/trips/:id/chat — the topic list, with the old flat `messages` and `people` alongside for a bundle that still reads them. */
router.get('/:id/chat', async (req, res, next) => {
  try { const ctx = await tripCtx(req); res.json(await topics.withLegacy(ctx, await topics.listPayload(ctx))); } catch (err) { next(err); }
});

/**
 * GET /api/trips/:id/asks/:venueRef — one stop's questions: the same list,
 * filtered to that stop's tag. The ref is a source-qualified identifier with a
 * colon in it, so it arrives encoded and Express hands it back decoded.
 */
router.get('/:id/asks/:venueRef', async (req, res, next) => {
  try {
    const ctx = await tripCtx(req);
    const all = await topics.listPayload(ctx);
    res.json({ ...(await topics.withLegacy(ctx, { ...all, topics: all.topics.filter((t) => t.tag.kind === 'stop' && t.tag.ref === req.params.venueRef) })), about: `stop:${req.params.venueRef}` });
  } catch (err) { next(err); }
});

/**
 * POST /api/trips/:id/chat — say something.
 *
 * `topicId` makes it a reply on that question; without one it starts a topic,
 * tagged to `venueRef` when there is one and to the whole trip otherwise, with
 * `audience` everyone unless said.
 */
router.post('/:id/chat', async (req, res, next) => {
  try {
    const ctx = await tripCtx(req);
    const b = req.body ?? {};
    // The old bundle reads `message` and the list back; the new one reads the topic. Both are here.
    if (b.topicId) {
      await topics.createReply(ctx, String(b.topicId), { body: b.body, quotesReplyId: b.quotesReplyId ?? null });
      const view = await topics.topicPayload(ctx, String(b.topicId));
      return res.status(201).json({ ...view, ...(await topics.withLegacy(ctx, await topics.listPayload(ctx))), topic: view.topic });
    }
    const tag = b.tag ?? (b.venueRef ? { kind: 'stop', ref: b.venueRef } : { kind: 'trip', ref: 'trip' });
    const t = await topics.createTopic(ctx, { title: b.title ?? b.body, body: b.title ? b.body : null, tag, audience: b.audience ?? 'everyone', notice: b.notice });
    const view = await topics.topicPayload(ctx, t.id);
    const list = await topics.withLegacy(ctx, await topics.listPayload(ctx));
    res.status(201).json({ ...view, ...list, topic: view.topic, message: list.messages.find((m) => m.id === t.id) ?? null });
  } catch (err) { next(err); }
});

/** POST /api/trips/:id/chat/read — everything on screen has been seen. */
router.post('/:id/chat/read', async (req, res, next) => {
  try {
    const ctx = await tripCtx(req);
    if (ctx.me) await chatRepo.markContextRead('trip', ctx.id, ctx.me);
    res.json({ unread: 0 });
  } catch (err) { next(err); }
});

/** Whoever is organising this trip — derived in routes/chat.js so the two never disagree. */
const organiserOf = topics.organiserOf;

// ---------------------------------------------------------------------------
// share
// ---------------------------------------------------------------------------

/**
 * GET /api/trips/:id/share — the sheet (3b): the household first, then guests,
 * then the link.
 *
 * Household rows are every member, whether or not they are on the trip, because
 * the sheet's right-hand control is Add or Remove and both need the row.
 */
router.get('/:id/share', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    res.json(await sharePayload(trip, household, req));
  } catch (err) { next(err); }
});

async function sharePayload(trip, household, req) {
  const [people, attending, guests, organiser, me] = await Promise.all([
    households.membersOf(household.id), trips.attendeeIds(trip.id), chat.guestsOf(trip.id), organiserOf(trip), currentMember(),
  ]);
  const on = new Set(attending.map((a) => a.member_id));
  return {
    household: people.map((m) => ({
      id: m.id, name: m.name, isMinor: m.is_minor, avatarUrl: m.avatar_url ?? null,
      going: on.has(m.id),
      organiser: organiser?.id === m.id,
      // "Organiser · you" is two facts, and only says "you" when it is you.
      status: organiser?.id === m.id
        ? (me?.id === m.id ? 'Organiser · you' : 'Organiser')
        : on.has(m.id) ? 'Going' : 'Not added',
    })),
    guests: guests.map((g) => ({
      id: g.id, name: g.name, contact: g.contact, contactKind: g.contact_kind, status: g.status,
      says: g.status === 'joined'
        ? 'Joined'
        : g.contact_kind === 'mobile'
          ? `Invited · opens once ${firstName(g.name)}'s number is confirmed`
          : `Invited · opens once ${firstName(g.name)}'s email is confirmed`,
      link: trip.share_token ? guestLink(req, trip.share_token, g.token) : null,
    })),
    /** Minted on the first look at this sheet, not when the trip was made. */
    link: shareLink(req, await ensureShareToken(trip)),
    /**
     * Whether an invite can actually be sent from here. Neither sender is
     * Epic's to switch on (CLAUDE.md), so when they are off the sheet says so
     * and the organiser sends the link themselves.
     */
    canSend: { sms: smsConfigured(), email: mailConfigured() },
  };
}

const firstName = (n) => String(n ?? '').trim().split(/\s+/)[0] || 'they';
const shareLink = (req, token) => `${webUrl(req)}/shared/${token}`;
const guestLink = (req, shareToken, guestToken) => `${webUrl(req)}/shared/${shareToken}?you=${guestToken}`;

async function ensureShareToken(trip) {
  if (trip.share_token) return trip.share_token;
  const token = newToken();
  const held = await chat.setShareToken(trip.id, token);
  trip.share_token = held ?? token;
  return trip.share_token;
}

/** PUT /api/trips/:id/share/household — who from the household is coming. */
router.put('/:id/share/household', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    const ids = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
    const people = await households.membersOf(household.id);
    const allowed = new Set(people.map((m) => m.id));
    await trips.clearAttendees(trip.id);
    for (const id of ids) if (allowed.has(id)) await trips.addAttendee(trip.id, id);
    res.json(await sharePayload(trip, household, req));
  } catch (err) { next(err); }
});

/**
 * POST /api/trips/:id/share/guests — invite somebody with no Epic account.
 *
 * A name and one way to reach them. The invite is sent where a sender is wired
 * up; where it is not, the row still exists with a link of its own, which the
 * organiser can send however they normally would — that is strictly better than
 * refusing to add the person.
 */
router.post('/:id/share/guests', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name_required', message: 'Give a name they will recognise.' });
    const raw = String(req.body?.contact ?? '').trim();
    if (!raw) return res.status(400).json({ error: 'contact_required', message: 'A mobile or an email, so they can be sent the link.' });
    const isEmail = EMAIL.test(raw);
    const contact = isEmail ? raw.toLowerCase() : normaliseMobile(raw);
    if (!contact) return res.status(400).json({ error: 'contact_invalid', message: 'That is not a mobile number or an email address.' });

    const guest = await chat.insertGuest(trip.id, {
      name, contact, contactKind: isEmail ? 'email' : 'mobile', token: newToken(),
    });
    const shareToken = await ensureShareToken(trip);
    await sendInvite(req, { trip, household, guest, shareToken });
    res.status(201).json(await sharePayload(trip, household, req));
  } catch (err) { next(err); }
});

router.post('/:id/share/guests/:guestId/resend', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    const guest = await chat.guestById(trip.id, req.params.guestId);
    if (!guest) return res.status(404).json({ error: 'guest_not_found' });
    const shareToken = await ensureShareToken(trip);
    const sent = await sendInvite(req, { trip, household, guest, shareToken });
    res.json({ sent, ...(await sharePayload(trip, household, req)) });
  } catch (err) { next(err); }
});

router.delete('/:id/share/guests/:guestId', async (req, res, next) => {
  try {
    const { trip, household } = await ownTrip(req);
    await chat.removeGuest(trip.id, req.params.guestId);
    res.json(await sharePayload(trip, household, req));
  } catch (err) { next(err); }
});

async function sendInvite(req, { trip, household, guest, shareToken }) {
  const url = guestLink(req, shareToken, guest.token);
  const what = trip.title || trip.place_label || trip.locality || 'a trip';
  const from = household.name || 'someone';
  try {
    if (guest.contact_kind === 'email' && mailConfigured()) {
      await sendMail({
        to: guest.contact,
        subject: `${from} has shared ${what} with you`,
        text: `${from} has shared ${what} with you on Epic.\n\nThe plan, who is coming and the chat are here — no account needed:\n${url}\n`,
        purpose: 'shared_trip',
      });
      return 'email';
    }
    if (guest.contact_kind === 'mobile' && smsConfigured()) {
      await sendSms({ to: guest.contact, text: `${from} shared ${what} with you on Epic. The plan and the chat: ${url}` });
      return 'sms';
    }
  } catch {
    // A sender that failed is not a reason to lose the guest: the row is there
    // and the organiser has a link they can send by hand.
    return null;
  }
  return null;
}

export { router };
