/**
 * "Just say what you are up for" — the intake, the pool, and the introductions
 * (owner, 13 Sep 2026, `Casual meet ups`; migration 095; rules in
 * `domain/openTo.js`).
 *
 * Nothing here is listed. There is no search, no profile page and no way to
 * ask who is in the pool: the only thing that ever comes out of it is an
 * introduction Epic makes, to the host first, and only when both sides'
 * preferences admit the other. Every read is shaped by what that side is
 * allowed to know at that stage, so a screen cannot leak by drawing more than
 * it should.
 */

import express from 'express';
import * as repo from '../repositories/openTo.js';
import * as hostRepo from '../repositories/hosting.js';
import { tripById } from '../repositories/trips.js';
import { query, withTransaction } from '../db.js';

const householdById = async (id) => (await query('select * from households where id = $1', [id])).rows[0] ?? null;
import {
  AGE_PREFS, COMPANY, FLUENCY, HELLO_SECONDS, HEARD_SCHEMA, HEARD_SYSTEM, KINDS,
  fits, hasLapsed, introductionOf, livesUntil, nextStage, nudgeDue, partyOf,
  sharedLanguage, unverifiablePrefs, verdictFor, videoVisible, waitingOn,
} from '../domain/openTo.js';
import { extract as extractWith, openaiEnabled } from '../sources/openai.js';
import { currentHousehold, loadMembers } from './household.js';

const router = express.Router();

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });
const str = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const int = (v) => (v == null || v === '' ? null : Math.max(0, Math.round(Number(v))) || null);
const list = (v, max = 40) => (Array.isArray(v) ? v.slice(0, max) : []);
const words = (v, max = 24, each = 60) => list(v, max).map((s) => str(s, each)).filter(Boolean);
const oneOf = (all, v) => (all.includes(v) ? v : null);

/** The languages a household speaks, as the pool holds them: a name and how well. */
const languagesOf = (v) => list(v, 8).map((l) => ({ name: str(l?.name ?? l, 40), level: oneOf(FLUENCY, l?.level) ?? 'fluent' })).filter((l) => l.name);

/** How old the adults are, for the "a similar age" rule. Nothing else reads this. */
function ageOf(members = []) {
  const years = members
    .filter((m) => !m.is_minor && !m.isMinor)
    .map((m) => (m.birth_year ? new Date().getFullYear() - Number(m.birth_year) : m.age ?? null))
    .filter((n) => n != null && n > 0);
  return years.length ? Math.round(years.reduce((a, b) => a + b, 0) / years.length) : null;
}

/** Where a household is when it is at home, and where it is when it is away. */
async function placeOf(entry, household) {
  if (entry.scope === 'trip' && entry.trip_id) {
    const trip = await tripById(entry.trip_id).catch(() => null);
    if (trip) return { lat: trip.base_lat ?? trip.destination_lat, lng: trip.base_lng ?? trip.destination_lng, label: trip.place_label ?? trip.destination_label ?? trip.title };
  }
  return { lat: household?.home_lat ?? null, lng: household?.home_lng ?? null, label: entry.where_label ?? household?.home_label ?? null };
}

/** Everything the matching rules need about one side, gathered once. */
async function sideOf(entry) {
  const household = await householdById(entry.household_id);
  const members = await loadMembers(entry.household_id).catch(() => []);
  return { entry, party: partyOf(members), age: ageOf(members), near: await placeOf(entry, household), household, members };
}

const entryPayload = (e, asked = 0) => ({
  id: e.id, scope: e.scope, tripId: e.trip_id, kind: e.kind,
  interests: e.interests ?? [], level: e.level ?? [], when: e.when_chips ?? [],
  where: e.where_label, miles: e.where_miles, languages: e.languages ?? [], money: e.money,
  prefs: { age: e.pref_age, company: e.pref_company ?? [], fluency: e.pref_fluency },
  /** Preferences Epic cannot act on, so the screen can say so rather than imply it filtered. */
  cannotHonour: unverifiablePrefs(e.pref_company),
  childAgeBands: e.child_age_bands ?? [],
  transcript: e.transcript, state: e.state,
  /** How many people Epic has already asked on this entry's behalf. A count, never a list. */
  asked,
  reviewDueAt: e.review_due_at, expiresAt: e.expires_at, updatedAt: e.updated_at,
});

// ---------------------------------------------------------------------------
// the intake
// ---------------------------------------------------------------------------

/** What this household is up for, both scopes, and what the flow will ask. */
router.get('/open', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const entries = await repo.entriesOf(household.id);
    const members = await loadMembers(household.id).catch(() => []);
    const asked = await repo.liveMatchCounts(entries.map((e) => e.id));
    res.json({
      entries: entries.map((e) => entryPayload(e, asked.get(e.id) ?? 0)),
      you: { party: partyOf(members), languages: [], home: household.home_label ?? null, miles: household.home_radius_miles ?? null },
      config: { helloSeconds: HELLO_SECONDS, company: COMPANY, agePrefs: AGE_PREFS, fluency: FLUENCY, listening: openaiEnabled() },
    });
  } catch (err) { next(err); }
});

/**
 * What we heard, from what was said. The words go to the listener and come
 * back as chips the person confirms — they never proof-read a transcript.
 * Without the key the screen says so in one sentence and they type instead.
 */
router.post('/open/heard', async (req, res, next) => {
  try {
    await currentHousehold();
    const said = str(req.body?.transcript, 4000);
    if (!said) throw refuse(400, 'nothing_said', 'There is nothing to read yet.');
    if (!openaiEnabled()) throw refuse(503, 'no_listener', "Epic can't listen yet — the owner adds the transcription key. Type what you are up for instead.");
    const { parsed } = await extractWith({ system: HEARD_SYSTEM, input: said, schema: HEARD_SCHEMA, name: 'up_for' });
    res.json({
      heard: {
        interests: words(parsed?.interests, 12), level: words(parsed?.level, 6),
        when: words(parsed?.when, 6), languages: words(parsed?.languages, 6),
      },
      transcript: said,
    });
  } catch (err) { next(err); }
});

/** Save what somebody is up for, standing or for a trip, and look for introductions. */
router.post('/open', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const scope = oneOf(['standing', 'trip'], req.body?.scope) ?? 'standing';
    const tripId = scope === 'trip' ? str(req.body?.tripId, 64) : null;
    if (scope === 'trip' && !tripId) throw refuse(400, 'trip_required', 'Say which trip this is for.');
    const trip = tripId ? await tripById(tripId) : null;
    if (tripId && (!trip || trip.household_id !== household.id)) throw refuse(404, 'no_trip', 'That trip is not one of yours.');

    const members = await loadMembers(household.id).catch(() => []);
    const kind = oneOf(KINDS, req.body?.kind) ?? (partyOf(members) === 'families' ? 'family' : 'adult');
    const interests = words(req.body?.interests, 12);
    if (!interests.length) throw refuse(400, 'nothing_yet', 'Say at least one thing you are up for.');
    const lives = livesUntil({ scope, tripEnd: trip?.end_date ?? trip?.return_at ?? null });

    const existing = await repo.entryFor(household.id, { scope, tripId });
    const fields = {
      scope, tripId, interests, kind,
      level: words(req.body?.level, 6),
      whenChips: words(req.body?.when, 6),
      whereLabel: str(req.body?.where, 120) ?? (trip ? trip.place_label ?? trip.destination_label ?? trip.title : household.home_label),
      whereMiles: int(req.body?.miles) ?? household.home_radius_miles ?? null,
      languages: JSON.stringify(languagesOf(req.body?.languages)),
      money: 'free',
      childAgeBands: words(req.body?.childAgeBands, 6),
      transcript: str(req.body?.transcript, 4000),
      reviewDueAt: lives.reviewDueAt, expiresAt: lives.expiresAt,
    };
    const entry = existing ? await repo.updateEntry(existing.id, fields) : await repo.insertEntry(household.id, fields);
    const made = await findIntroductions(entry);
    res.status(existing ? 200 : 201).json({ entry: entryPayload(entry), introduced: made });
  } catch (err) { next(err); }
});

/** Who you would rather meet (O11). Age, company and language — nothing else is accepted. */
router.patch('/open/:id/who', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const entry = await repo.entryById(req.params.id);
    if (!entry || entry.household_id !== household.id) throw refuse(404, 'not_yours', 'That is not one of yours.');
    const company = words(req.body?.company, 5).map((c) => String(c).toLowerCase()).filter((c) => COMPANY.includes(c));
    const saved = await repo.updateEntry(entry.id, {
      prefAge: oneOf(AGE_PREFS, req.body?.age) ?? entry.pref_age,
      prefCompany: company.length ? company : ['anyone'],
      prefFluency: oneOf(FLUENCY, req.body?.fluency) ?? entry.pref_fluency,
      languages: req.body?.languages ? JSON.stringify(languagesOf(req.body.languages)) : undefined,
    });
    res.json({ entry: entryPayload(saved) });
  } catch (err) { next(err); }
});

/** Take yourself out of the pool. Nothing was scheduled, so there is nothing to cancel. */
router.delete('/open/:id', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const entry = await repo.entryById(req.params.id);
    if (!entry || entry.household_id !== household.id) throw refuse(404, 'not_yours', 'That is not one of yours.');
    await repo.endEntry(entry.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the pool: introductions are made, never searched for
// ---------------------------------------------------------------------------

/**
 * Look for people this entry could be introduced to, and make the
 * introduction — to the host first. Nobody can ask who is in the pool; this is
 * the only thing that reads it, and it runs when somebody saves what they are
 * up for.
 */
export async function findIntroductions(entry) {
  const mine = await sideOf(entry);
  const candidates = await repo.candidatesFor(entry);
  let made = 0;
  for (const other of candidates) {
    const theirs = await sideOf(other);
    // The local, standing entry is always the host, whichever side just saved.
    const [host, guest] = entry.scope === 'standing' ? [mine, theirs] : [theirs, mine];
    const verdict = fits(host, guest);
    if (!verdict.ok) continue;
    const row = await repo.insertMatch({
      hostEntryId: host.entry.id, guestEntryId: guest.entry.id,
      interests: verdict.interests, kind: host.entry.kind,
    });
    if (row) made += 1;
  }
  return made;
}

/**
 * Where an entry is coming from and going to. A standing entry is one place —
 * home — so there is no journey to draw; a trip has both ends and a month, and
 * the boards read "Lisbon → Reading" and "visiting Reading from Lisbon in
 * October" off exactly that.
 */
async function journeyOf(entry) {
  if (entry?.scope !== 'trip' || !entry.trip_id) return null;
  const trip = await tripById(entry.trip_id).catch(() => null);
  if (!trip) return null;
  return {
    from: trip.origin_label ?? null,
    to: trip.place_label ?? trip.destination_label ?? trip.title ?? entry.where_label ?? null,
    when: trip.start_date ? String(trip.start_date).slice(0, 10) : trip.depart_at ? String(trip.depart_at).slice(0, 10) : null,
  };
}

/** Which side of a match this household is on, or null when it is neither. */
async function sideFor(match, householdId) {
  const host = await repo.entryById(match.host_entry_id);
  const guest = await repo.entryById(match.guest_entry_id);
  if (host?.household_id === householdId) return { side: 'host', host, guest };
  if (guest?.household_id === householdId) return { side: 'guest', host, guest };
  return null;
}

/**
 * What one side may see of an introduction. The guest is told nothing at all
 * until the host has said yes — not even that it exists.
 */
async function matchPayload(match, side, host, guest) {
  const theirs = side === 'host' ? guest : host;
  const yours = side === 'host' ? host : guest;
  const members = await loadMembers(theirs.household_id).catch(() => []);
  const name = members.find((m) => !m.is_minor && !m.isMinor)?.name ?? 'Somebody';
  // Your own first name and journey: the screens speak to you in your own words
  // ("I am Ana, over from Lisbon…"), and the header names the direction you are
  // travelling. None of this is anything the other side is told.
  const own = await loadMembers(yours.household_id).catch(() => []);
  const you = {
    name: String(own.find((m) => !m.is_minor && !m.isMinor)?.name ?? '').trim().split(/\s+/)[0] || null,
    journey: await journeyOf(yours),
  };
  const language = sharedLanguage(host.languages, guest.languages);
  const verdict = verdictFor(match, side);
  const video = videoVisible(match, side);
  const base = {
    id: match.id, stage: match.stage, kind: match.kind, side,
    interests: match.interests ?? [],
    waitingOn: waitingOn(match) === side ? 'you' : waitingOn(match) ? 'them' : null,
    lapsesAt: match.lapses_at,
    // The videos are for one decision: what you may watch, and never a stored face.
    video: { mine: video.mine, theirs: video.theirs, waiting: video.waiting, seconds: HELLO_SECONDS, gone: Boolean(match.videos_deleted_at) },
    verdict,
    verified: { you: Boolean(side === 'host' ? match.host_verified_at : match.guest_verified_at), them: Boolean(side === 'host' ? match.guest_verified_at : match.host_verified_at) },
    // The language the two of you share, and how well you speak it — the one
    // thing about the other side that is true from the moment they match.
    language: language ? { name: language.name, level: language.mine } : null,
    you,
  };
  if (side === 'host') {
    // The host is asked first, and sees only where the visitor is coming to,
    // where from and roughly when — never an address and never a name.
    const journey = await journeyOf(theirs);
    return {
      ...base,
      from: journey?.to ?? theirs.where_label,
      origin: journey?.from ?? null,
      when: journey?.when ?? null,
      childAgeBands: match.kind === 'family' ? theirs.child_age_bands ?? [] : [],
      detail: { where: match.host_where, note: match.host_note },
      // Their name only once they have said yes as well.
      name: match.guest_verdict === 'yes' ? name : null,
    };
  }
  // The guest reads an introduction: a first name, a town, the shared things,
  // what the host added for them, and how well they speak the shared language.
  return { ...base, introduction: introductionOf({ match, host, hostName: name, language }) };
}

/** Every introduction this household is part of — and a guest sees none before the host answers. */
router.get('/open/matches', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const rows = await repo.matchesOf(household.id);
    const out = [];
    for (const m of rows) {
      const side = m.host_household_id === household.id ? 'host' : 'guest';
      if (side === 'guest' && m.host_verdict !== 'yes') continue;
      if (['lapsed', 'ended'].includes(m.stage)) continue;
      const host = await repo.entryById(m.host_entry_id);
      const guest = await repo.entryById(m.guest_entry_id);
      out.push(await matchPayload(m, side, host, guest));
    }
    res.json({ matches: out });
  } catch (err) { next(err); }
});

router.get('/open/matches/:id', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const match = await repo.matchById(req.params.id);
    if (!match) throw refuse(404, 'not_found', 'There is no introduction at that address.');
    const found = await sideFor(match, household.id);
    if (!found) throw refuse(404, 'not_found', 'There is no introduction at that address.');
    if (found.side === 'guest' && match.host_verdict !== 'yes') throw refuse(404, 'not_found', 'There is no introduction at that address.');
    res.json({ match: await matchPayload(match, found.side, found.host, found.guest) });
  } catch (err) { next(err); }
});

/**
 * The host answers first and adds the detail that makes the introduction worth
 * reading. "Not this time" is silent: the match ends and the visitor is never
 * told they were turned down — as far as they know, nothing ever happened.
 */
router.post('/open/matches/:id/host', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const answer = oneOf(['yes', 'no'], req.body?.answer);
    if (!answer) throw refuse(400, 'answer_required', 'Say yes or not this time.');
    const out = await withTransaction(async (client) => {
      const match = await repo.lockMatch(req.params.id, client);
      if (!match) throw refuse(404, 'not_found', 'There is no introduction at that address.');
      const host = await repo.entryById(match.host_entry_id, client);
      if (host?.household_id !== household.id) throw refuse(404, 'not_found', 'There is no introduction at that address.');
      if (match.host_verdict) throw refuse(409, 'answered', 'You have already answered this one.');
      const stage = nextStage(match, { hostVerdict: answer });
      return repo.updateMatch(match.id, {
        hostVerdict: answer, hostAnsweredAt: new Date(), stage,
        hostWhere: str(req.body?.where, 200), hostNote: str(req.body?.note, 600),
      }, client);
    });
    const found = await sideFor(out, household.id);
    res.json({ match: await matchPayload(out, 'host', found.host, found.guest) });
  } catch (err) { next(err); }
});

/** The guest answers the introduction. A no ends it, silently, both ways. */
router.post('/open/matches/:id/guest', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const answer = oneOf(['yes', 'no'], req.body?.answer);
    if (!answer) throw refuse(400, 'answer_required', 'Say whether you are interested.');
    const out = await withTransaction(async (client) => {
      const match = await repo.lockMatch(req.params.id, client);
      if (!match) throw refuse(404, 'not_found', 'There is no introduction at that address.');
      const guest = await repo.entryById(match.guest_entry_id, client);
      if (guest?.household_id !== household.id) throw refuse(404, 'not_found', 'There is no introduction at that address.');
      if (match.host_verdict !== 'yes') throw refuse(404, 'not_found', 'There is no introduction at that address.');
      if (match.guest_verdict) throw refuse(409, 'answered', 'You have already answered this one.');
      return repo.updateMatch(match.id, { guestVerdict: answer, guestAnsweredAt: new Date(), stage: nextStage(match, { guestVerdict: answer }) }, client);
    });
    const found = await sideFor(out, household.id);
    res.json({ match: await matchPayload(out, 'guest', found.host, found.guest) });
  } catch (err) { next(err); }
});

/**
 * Twenty seconds of hello. Held server-side and unseen until both are in — the
 * point of the swap is that neither records one having seen the other's.
 */
router.post('/open/matches/:id/hello', express.raw({ type: ['video/*', 'audio/*', 'application/octet-stream'], limit: '30mb' }), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const match = await repo.matchById(req.params.id);
    if (!match) throw refuse(404, 'not_found', 'There is no introduction at that address.');
    const found = await sideFor(match, household.id);
    if (!found) throw refuse(404, 'not_found', 'There is no introduction at that address.');
    if (!['guest_asked', 'videos'].includes(match.stage) && match.stage !== 'videos') throw refuse(409, 'not_yet', 'Not at this stage.');
    if (!req.body?.length) throw refuse(400, 'no_video', 'Nothing was recorded.');
    const seconds = Number(req.query.seconds) || null;
    if (seconds && seconds > HELLO_SECONDS + 2) throw refuse(400, 'too_long', `Twenty seconds is the limit.`);
    const media = await hostRepo.insertMedia({ householdId: household.id, kind: 'video', mime: str(req.headers['content-type'], 80) ?? 'video/webm', bytes: req.body, durationS: seconds });
    const patch = found.side === 'host' ? { hostVideoId: media.id } : { guestVideoId: media.id };
    const saved = await repo.updateMatch(match.id, { ...patch, stage: nextStage({ ...match, ...(found.side === 'host' ? { host_video_id: media.id } : { guest_video_id: media.id }) }, {}) });
    res.status(201).json({ match: await matchPayload(saved, found.side, found.host, found.guest) });
  } catch (err) { next(err); }
});

/**
 * Having watched theirs, say whether to be introduced. The other side's answer
 * is not reported until both are in, and only a pair of yeses is ever reported
 * at all: nobody is told they were turned down.
 */
router.post('/open/matches/:id/decide', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const yes = req.body?.answer === 'yes' ? true : req.body?.answer === 'no' ? false : null;
    if (yes == null) throw refuse(400, 'answer_required', 'Say whether you would like to be introduced.');
    const out = await withTransaction(async (client) => {
      const match = await repo.lockMatch(req.params.id, client);
      if (!match) throw refuse(404, 'not_found', 'There is no introduction at that address.');
      const host = await repo.entryById(match.host_entry_id, client);
      const guest = await repo.entryById(match.guest_entry_id, client);
      const side = host?.household_id === household.id ? 'host' : guest?.household_id === household.id ? 'guest' : null;
      if (!side) throw refuse(404, 'not_found', 'There is no introduction at that address.');
      // You may only decide once both videos are in: the decision is about theirs.
      if (!match.host_video_id || !match.guest_video_id) throw refuse(409, 'not_yet', 'Both videos have to be in first.');
      const already = side === 'host' ? match.host_video_yes : match.guest_video_yes;
      if (already != null) throw refuse(409, 'answered', 'You have already answered this one.');
      const patch = side === 'host' ? { hostVideoYes: yes } : { guestVideoYes: yes };
      const stage = nextStage(match, side === 'host' ? { hostVideoYes: yes } : { guestVideoYes: yes });
      // The videos were for this decision. Once both have decided they go.
      const both = (side === 'host' ? match.guest_video_yes : match.host_video_yes) != null;
      return repo.updateMatch(match.id, { ...patch, stage, ...(both ? { videosDeletedAt: new Date() } : {}) }, client);
    });
    const hostHousehold = (await repo.entryById(out.host_entry_id))?.household_id ?? null;
    const guestHousehold = (await repo.entryById(out.guest_entry_id))?.household_id ?? null;
    if (out.videos_deleted_at && (out.host_video_id || out.guest_video_id)) {
      // Deleted, not merely unlinked: they are never on a profile and never searchable.
      await Promise.all([[out.host_video_id, hostHousehold], [out.guest_video_id, guestHousehold]].filter(([id]) => id).map(([id, hh]) => hostRepo.deleteMedia(id, hh).catch(() => null)));
      await repo.updateMatch(out.id, { hostVideoId: null, guestVideoId: null });
    }
    const found = await sideFor(out, household.id);
    res.json({ match: await matchPayload({ ...out, host_video_id: null, guest_video_id: null }, found.side, found.host, found.guest) });
  } catch (err) { next(err); }
});

/** The ID check: once each, after two yeses, before anything is exchanged. */
router.post('/open/matches/:id/verify', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const out = await withTransaction(async (client) => {
      const match = await repo.lockMatch(req.params.id, client);
      if (!match) throw refuse(404, 'not_found', 'There is no introduction at that address.');
      const host = await repo.entryById(match.host_entry_id, client);
      const guest = await repo.entryById(match.guest_entry_id, client);
      const side = host?.household_id === household.id ? 'host' : guest?.household_id === household.id ? 'guest' : null;
      if (!side) throw refuse(404, 'not_found', 'There is no introduction at that address.');
      if (!['both_yes', 'verified'].includes(match.stage)) throw refuse(409, 'not_yet', 'Not at this stage.');
      const patch = side === 'host' ? { hostVerifiedAt: new Date() } : { guestVerifiedAt: new Date() };
      const stage = nextStage(match, side === 'host' ? { hostVerified: new Date() } : { guestVerified: new Date() });
      return repo.updateMatch(match.id, { ...patch, stage: stage === 'chat' ? 'chat' : 'verified' }, client);
    });
    const found = await sideFor(out, household.id);
    res.json({ match: await matchPayload(out, found.side, found.host, found.guest) });
  } catch (err) { next(err); }
});

/**
 * The sweep: nudge an unanswered introduction once, let it go after a week,
 * clear a trip entry when the trip has been, and ask a standing one again
 * after three months. Nobody is told an introduction lapsed because of them.
 */
export async function sweepOpenTo(now = new Date()) {
  const out = { nudged: 0, lapsed: 0, cleared: 0, due: 0 };
  for (const match of await repo.openIntroductions()) {
    if (hasLapsed(match, now)) { await repo.updateMatch(match.id, { stage: 'lapsed' }); out.lapsed += 1; continue; }
    if (nudgeDue(match, now)) { await repo.updateMatch(match.id, { nudgedAt: now }); out.nudged += 1; }
  }
  for (const entry of await repo.expiredEntries(now)) { await repo.endEntry(entry.id); out.cleared += 1; }
  out.due = (await repo.dueForReview(now)).length;
  return out;
}

let loop = null;
export function startOpenToLoop(everyMs = 60 * 60 * 1000) {
  if (loop) return loop;
  const run = () => sweepOpenTo().catch(() => null);
  run();
  loop = setInterval(run, everyMs);
  loop.unref?.();
  return loop;
}

export default router;
