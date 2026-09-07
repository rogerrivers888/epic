/**
 * Somebody else's door into one trip (trip rebuild, 7 Sep 2026, screen 3b).
 *
 * "Anyone with the link sees the plan, people and chat as a guest — no account
 * needed." So this router is public, and everything in it is resolved from the
 * link rather than from a session: there is no account in the air here, and
 * `currentHousehold()` must never be reached from inside it (auth.js, and the
 * warning on `currentHousehold` itself).
 *
 * A guest is confirmed by a one-time code sent to the contact they give,
 * because a link that has been forwarded twice is not proof of anything. Where
 * neither sender is wired up — which is the owner's to do, not Epic's — the one
 * person who can still be let in is somebody the organiser wrote down by hand,
 * because that *is* the vouching a code would otherwise establish. Everybody
 * else is told, in one sentence, to ask for their own link.
 *
 * What a guest may do is deliberately small: read the plan and the people, and
 * post in the chat and the Asks. They cannot change the trip, they cannot see
 * the household's atlas, and nothing here writes to it.
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import * as trips from '../repositories/trips.js';
import * as chat from '../repositories/tripChat.js';
import * as travel from '../repositories/tripTravel.js';
import { householdOf } from './household.js';
import { newToken, publicMessage } from './tripChat.js';
import { sendMail, mailConfigured } from '../sources/mail.js';
import { sendSms, smsConfigured, normaliseMobile } from '../sources/sms.js';
import { nightsOf } from './trips.js';

const router = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_MINUTES = 15;

async function tripOfLink(req) {
  const trip = await chat.tripByShareToken(req.params.token);
  if (!trip) { const err = new Error('That link does not open anything.'); err.status = 404; err.code = 'no_such_trip'; throw err; }
  return trip;
}

/** Who is holding the link, if they have already been let in on this device. */
async function guestOf(req, trip) {
  const token = req.query.you ?? req.body?.you ?? null;
  if (!token) return null;
  const guest = await chat.guestByToken(String(token));
  return guest && guest.trip_id === trip.id ? guest : null;
}

const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : null);

/**
 * The trip as a guest sees it.
 *
 * The plan, laid out — because a guest's whole reason for opening the link is
 * "what are we doing and when" — the people, and nothing else. No shortlist (it
 * is the household thinking aloud), no budget, no spend, no atlas.
 */
async function guestPayload(trip, guest) {
  const [days, stops, attendees, guests, legs, household] = await Promise.all([
    trips.daysOf(trip.id), trips.stopsOf(trip.id), trips.attendeesOf(trip.id),
    chat.guestsOf(trip.id), travel.legsOf(trip.id), householdOf(trip.household_id),
  ]);
  const byDay = new Map();
  for (const s of stops) {
    const list = byDay.get(s.day_id) ?? [];
    list.push(s);
    byDay.set(s.day_id, list);
  }
  return {
    trip: {
      id: trip.id,
      title: trip.title || trip.place_label || trip.locality || 'A trip',
      where: trip.place_label ?? trip.locality ?? trip.destination_label ?? trip.base_label ?? null,
      startDate: trip.start_date,
      endDate: trip.end_date,
      datesFixed: trip.dates_fixed !== false,
      nights: nightsOf(trip),
      dates: trip.dates_fixed === false ? 'Date not fixed'
        : trip.start_date === trip.end_date ? fmtDate(trip.start_date)
          : `${fmtDate(trip.start_date)} – ${fmtDate(trip.end_date)}`,
      /** Whose trip it is, in the name they use, so the page is not anonymous. */
      from: household?.name ?? null,
    },
    days: days.map((d) => ({
      id: d.id,
      date: d.date,
      label: fmtDate(d.date),
      stops: (byDay.get(d.id) ?? [])
        .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.position - b.position)
        .map((s) => ({
          id: s.id, venueRef: s.venue_ref, name: s.venue_name,
          startTime: s.start_time?.slice(0, 5) ?? null, dwellMinutes: s.dwell_minutes,
        })),
    })),
    travel: legs.map((l) => ({
      direction: l.direction, mode: l.mode, onDate: l.on_date,
      from: l.from_label ?? l.from_code, to: l.to_label ?? l.to_code,
      departAt: l.depart_at?.slice(0, 5) ?? null, arriveAt: l.arrive_at?.slice(0, 5) ?? null,
      carrier: l.carrier, serviceNo: l.service_no,
    })),
    people: {
      members: attendees.map((a) => ({ name: a.name, initial: a.name.trim().charAt(0).toUpperCase() })),
      guests: guests.filter((g) => g.status === 'joined').map((g) => ({ name: g.name, initial: g.name.trim().charAt(0).toUpperCase() })),
    },
    you: guest ? { id: guest.id, name: guest.name, joined: guest.status === 'joined' } : null,
  };
}

// ---------------------------------------------------------------------------
// the door
// ---------------------------------------------------------------------------

/** GET /api/shared/:token — what the link opens. `?you=` says who is holding it. */
router.get('/:token', async (req, res, next) => {
  try {
    const trip = await tripOfLink(req);
    const guest = await guestOf(req, trip);
    if (guest) await chat.touchGuest(guest.id);
    res.json({
      ...(await guestPayload(trip, guest)),
      /** Whether a code can be sent at all. The page says so rather than failing silently. */
      canSend: { sms: smsConfigured(), email: mailConfigured() },
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/shared/:token/enter — a mobile or an email, and a name.
 *
 * Somebody the organiser already wrote down is matched to their row rather than
 * given a second one; anybody else joins as a new guest, because that is what
 * "anyone with the link" means.
 */
router.post('/:token/enter', async (req, res, next) => {
  try {
    const trip = await tripOfLink(req);
    const raw = String(req.body?.contact ?? '').trim();
    if (!raw) return res.status(400).json({ error: 'contact_required', message: 'A mobile number or an email address.' });
    const isEmail = EMAIL.test(raw);
    const contact = isEmail ? raw.toLowerCase() : normaliseMobile(raw);
    if (!contact) return res.status(400).json({ error: 'contact_invalid', message: 'That is not a mobile number or an email address.' });

    const known = await chat.guestByContact(trip.id, contact);
    const name = String(req.body?.name ?? '').trim() || known?.name;
    if (!name) return res.status(400).json({ error: 'name_required', message: 'And a name, so everybody knows who is talking.' });

    const guest = known ?? await chat.insertGuest(trip.id, {
      name, contact, contactKind: isEmail ? 'email' : 'mobile', token: newToken(),
    });

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const sender = isEmail ? mailConfigured() : smsConfigured();
    if (sender) {
      await chat.insertGuestCode(guest.id, code, new Date(Date.now() + CODE_MINUTES * 60_000));
      const what = trip.title || trip.place_label || 'the trip';
      try {
        if (isEmail) await sendMail({ to: contact, subject: `Your code for ${what}`, text: `Your code is ${code}. It works for ${CODE_MINUTES} minutes.` });
        else await sendSms({ to: contact, text: `Epic: your code for ${what} is ${code}. It works for ${CODE_MINUTES} minutes.` });
      } catch {
        return res.json({ guestId: guest.id, sent: null, message: "That code couldn't be sent. Ask whoever shared the trip to send you your own link." });
      }
      return res.json({ guestId: guest.id, sent: isEmail ? 'email' : 'sms', message: `Code sent to ${isEmail ? contact : 'your phone'}. It works for ${CODE_MINUTES} minutes.` });
    }

    // No sender wired up. The one person who can still be let in is somebody
    // the organiser added by hand — the vouching a code would have established
    // has already happened.
    if (known) {
      const joined = await chat.markGuestJoined(guest.id);
      /**
       * `token` rather than `you`: the payload already carries a `you`, which is
       * who the reader *is*, and spreading it over the token silently replaced
       * the one thing this answer exists to hand back.
       */
      return res.json({ guestId: guest.id, sent: null, token: joined.token, ...(await guestPayload(trip, joined)) });
    }
    res.json({
      guestId: guest.id, sent: null,
      message: "Epic can't send you a code yet. Ask whoever shared this trip to add you — they can send you a link of your own.",
    });
  } catch (err) { next(err); }
});

/** POST /api/shared/:token/verify — the six digits. */
router.post('/:token/verify', async (req, res, next) => {
  try {
    const trip = await tripOfLink(req);
    const guest = await chat.guestById(trip.id, String(req.body?.guestId ?? ''));
    if (!guest) return res.status(404).json({ error: 'no_such_guest', message: 'Start again from the link.' });
    const code = String(req.body?.code ?? '').replace(/\D/g, '');
    const live = await chat.liveGuestCode(guest.id, code);
    if (!live) return res.status(400).json({ error: 'bad_code', message: "That code has expired or isn't right. Ask for another." });
    await chat.useGuestCode(live.id);
    const joined = await chat.markGuestJoined(guest.id);
    res.json({ token: joined.token, ...(await guestPayload(trip, joined)) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the conversation, from outside
// ---------------------------------------------------------------------------

async function requireGuest(req, trip, res) {
  const guest = await guestOf(req, trip);
  if (!guest || guest.status !== 'joined') {
    res.status(403).json({ error: 'not_in', message: 'Say who you are first.' });
    return null;
  }
  return guest;
}

router.get('/:token/chat', async (req, res, next) => {
  try {
    const trip = await tripOfLink(req);
    const guest = await requireGuest(req, trip, res);
    if (!guest) return;
    const venueRef = req.query.stop ? String(req.query.stop) : undefined;
    const rows = await chat.messagesOf(trip.id, { venueRef, onlyStop: venueRef !== undefined });
    await chat.markRead(trip.id, { guestId: guest.id, ...(venueRef !== undefined ? { venueRef } : {}) });
    res.json({ messages: rows.map((m) => publicMessage(m, { guestId: guest.id })) });
  } catch (err) { next(err); }
});

router.post('/:token/chat', async (req, res, next) => {
  try {
    const trip = await tripOfLink(req);
    const guest = await requireGuest(req, trip, res);
    if (!guest) return;
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'empty_message', message: 'Type something first.' });
    if (body.length > 2000) return res.status(400).json({ error: 'too_long', message: 'That is longer than a message.' });
    await chat.insertMessage(trip.id, {
      body,
      venueRef: req.body?.venueRef ?? null,
      venueLabel: req.body?.venueLabel ?? null,
      guestId: guest.id,
    });
    await chat.markRead(trip.id, { guestId: guest.id });
    const venueRef = req.body?.venueRef ?? undefined;
    const rows = await chat.messagesOf(trip.id, { venueRef, onlyStop: venueRef !== undefined });
    res.status(201).json({ messages: rows.map((m) => publicMessage(m, { guestId: guest.id })) });
  } catch (err) { next(err); }
});

export { router };
