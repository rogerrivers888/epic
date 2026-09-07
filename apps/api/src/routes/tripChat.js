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
// the shape a message takes on the wire
// ---------------------------------------------------------------------------

/**
 * One message, drawn.
 *
 * `mine` is what decides which side of the thread a bubble sits on, and it is
 * computed per reader rather than stored: the same message is on the right for
 * whoever wrote it and on the left for everybody else.
 */
export function publicMessage(m, me) {
  const mine = Boolean(
    (me?.memberId && m.author_member_id === me.memberId)
    || (me?.guestId && m.author_guest_id === me.guestId),
  );
  return {
    id: m.id,
    body: m.body,
    at: m.created_at,
    mine,
    author: {
      name: m.member_name ?? m.guest_name ?? 'Someone',
      /** A guest is named as one in the thread: "Priya · guest". */
      guest: Boolean(m.author_guest_id),
      initial: (m.member_name ?? m.guest_name ?? '?').trim().charAt(0).toUpperCase(),
      memberId: m.author_member_id ?? null,
      guestId: m.author_guest_id ?? null,
    },
    /** Where it was asked, when it was asked on a stop rather than in the chat. */
    onStop: m.venue_ref ? { venueRef: m.venue_ref, label: m.venue_label ?? null } : null,
    seenBy: m.seen_by ?? 0,
  };
}

/** Everybody who can be in this conversation, for the header line and the counts. */
export async function peopleOf(tripId) {
  const [attendees, guests] = await Promise.all([trips.attendeesOf(tripId), chat.guestsOf(tripId)]);
  return {
    members: attendees.map((a) => ({ id: a.id, name: a.name, isMinor: a.is_minor, avatarUrl: a.avatar_url ?? null })),
    guests: guests.map((g) => ({
      id: g.id, name: g.name, contact: g.contact, contactKind: g.contact_kind,
      status: g.status, joinedAt: g.joined_at,
    })),
    count: attendees.length + guests.length,
  };
}

export async function chatPayload(tripId, me, { venueRef = undefined, onlyStop = false } = {}) {
  const [rows, people, unread, asks] = await Promise.all([
    chat.messagesOf(tripId, { venueRef, onlyStop }),
    peopleOf(tripId),
    chat.unreadCount(tripId, me ?? {}),
    chat.askCounts(tripId),
  ]);
  return {
    messages: rows.map((m) => publicMessage(m, me)),
    people,
    unread,
    askCounts: Object.fromEntries(asks),
  };
}

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

/** GET /api/trips/:id/chat — the whole thread, per-stop Asks included. */
router.get('/:id/chat', async (req, res, next) => {
  try {
    const { trip } = await ownTrip(req);
    const me = await currentMember();
    res.json(await chatPayload(trip.id, { memberId: me?.id ?? null }));
  } catch (err) { next(err); }
});

/**
 * GET /api/trips/:id/asks/:venueRef — one stop's thread.
 *
 * The ref is a source-qualified identifier with a colon in it, so it arrives
 * encoded and Express hands it back decoded.
 */
router.get('/:id/asks/:venueRef', async (req, res, next) => {
  try {
    const { trip } = await ownTrip(req);
    const me = await currentMember();
    res.json({
      ...(await chatPayload(trip.id, { memberId: me?.id ?? null }, { venueRef: req.params.venueRef, onlyStop: true })),
      /** Who a question here goes to. The organiser is whoever made the trip. */
      organiser: (await organiserOf(trip)) ?? null,
    });
  } catch (err) { next(err); }
});

/**
 * Whoever is organising this trip.
 *
 * Not stored, and derived rather than guessed at: the household's own account
 * holder, which is the person who made the trip and the person a question on a
 * stop should reach. Alphabetical order over the attendees was the obvious
 * shortcut and the wrong answer — it made Jules the organiser of Roger's trip,
 * and put "Organiser · you" on somebody else's row in the share sheet (3b).
 *
 * Falls back to the first adult attending for a household with no account yet,
 * which is every household that has only ever used the shared passcode.
 */
async function organiserOf(trip) {
  const people = await households.membersOf(trip.household_id);
  const accounts = await accountsForHousehold(trip.household_id).catch(() => []);
  const linked = accounts.find((a) => a.member_id && people.some((m) => m.id === a.member_id));
  if (linked) {
    const m = people.find((x) => x.id === linked.member_id);
    if (m) return { id: m.id, name: m.name };
  }
  const attending = await trips.attendeesOf(trip.id);
  const adult = attending.find((a) => !a.is_minor) ?? attending[0]
    ?? people.find((m) => !m.is_minor) ?? people[0];
  return adult ? { id: adult.id, name: adult.name } : null;
}

/**
 * POST /api/trips/:id/chat — say something.
 *
 * `venueRef` makes it an Ask on that stop; without one it is the trip's chat.
 * The sender's own read is written with the message, so "Seen by 3" counts them
 * and a count that said 2 for a message everybody has read is impossible.
 */
router.post('/:id/chat', async (req, res, next) => {
  try {
    const { trip } = await ownTrip(req);
    const me = await currentMember();
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'empty_message', message: 'Type something first.' });
    if (body.length > 2000) return res.status(400).json({ error: 'too_long', message: 'That is longer than a message — put it in a note on the trip.' });
    const message = await chat.insertMessage(trip.id, {
      body,
      venueRef: req.body?.venueRef ?? null,
      venueLabel: req.body?.venueLabel ?? null,
      memberId: me?.id ?? null,
    });
    if (me?.id) await chat.markRead(trip.id, { memberId: me.id });
    res.status(201).json({
      message: publicMessage({ ...message, member_name: me?.name ?? null, seen_by: 1 }, { memberId: me?.id }),
      ...(await chatPayload(trip.id, { memberId: me?.id ?? null })),
    });
  } catch (err) { next(err); }
});

/** POST /api/trips/:id/chat/read — everything on screen has been seen. */
router.post('/:id/chat/read', async (req, res, next) => {
  try {
    const { trip } = await ownTrip(req);
    const me = await currentMember();
    if (me?.id) await chat.markRead(trip.id, { memberId: me.id });
    res.json({ unread: 0 });
  } catch (err) { next(err); }
});

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
