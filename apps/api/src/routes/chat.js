/**
 * The chat module (owner, 13 Sep 2026 — "Supporting docs/Chat screens").
 *
 * One component, two contexts. `/api/chat/trip/:id` is a trip's conversation
 * and `/api/chat/offer/:id` a hosted offer's; nothing else differs, which is
 * why one router answers both and every rule lives in `domain/chat.js`.
 *
 * The handlers are exported as plain functions over a resolved *context* and
 * a *person*, because three doors open onto the same rooms:
 *
 *   · this router, behind the session — a household member;
 *   · `routes/shared.js`, public — a guest holding a trip's share link, who
 *     sees `everyone` topics only and can never set `host_only` (README §12);
 *   · `routes/tripChat.js`, the addresses the trip rebuild shipped —
 *     `/api/trips/:id/chat` and `/asks/:ref` — which keep answering, now
 *     from the topic model ("same endpoint", README §3).
 *
 * Money and keys: none. Delivery of a ping goes through `sources/chatNotify`,
 * which records what it could not send as honestly as what it could.
 */

import { Router } from 'express';
import * as chat from '../repositories/chat.js';
import * as trips from '../repositories/trips.js';
import * as tripChat from '../repositories/tripChat.js';
import * as hosting from '../repositories/hosting.js';
import * as households from '../repositories/households.js';
import { accountsForHousehold } from '../repositories/accounts.js';
import { currentHousehold, currentMember } from './household.js';
import { withTransaction } from '../db.js';
import { tell } from '../sources/chatNotify.js';
import { seriesDates, ymd } from '../domain/hosting.js';
import {
  AUDIENCES, DEFAULT_PREFS, OFFER_ASPECTS, QUICK_REACTIONS, COMMON_REACTIONS, SHOWING, SUGGEST_PUBLISH_AT, TAG_KINDS, TRIP_ANCHORS,
  askCount, authorOf, canSee, isNearDuplicate, legacyMessages, legacyPeople, matchesShowing, menuFor, mentionsIn, normaliseQuestion, notificationText,
  rateLimited, samePerson, whoIsTold,
} from '../domain/chat.js';

export const router = Router();
export const publicRouter = Router();

const refuse = (status, code, message) => { const e = new Error(message); e.status = status; e.code = code; return e; };
const str = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const today = () => ymd(new Date());
const fmtDay = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : null);
const firstName = (n) => String(n ?? '').trim().split(/\s+/)[0] || 'Someone';
const initialOf = (n) => (String(n ?? '?').trim().charAt(0) || '?').toUpperCase();

// ---------------------------------------------------------------------------
// contexts
// ---------------------------------------------------------------------------

/**
 * Whoever is organising a trip: the household's own account holder, falling
 * back to the first adult attending. The same derivation `routes/tripChat.js`
 * has used since the trip rebuild, so the two never disagree about who holds
 * the host role.
 */
export async function organiserOf(trip) {
  const people = await households.membersOf(trip.household_id);
  const accounts = await accountsForHousehold(trip.household_id).catch(() => []);
  const linked = accounts.find((a) => a.member_id && people.some((m) => m.id === a.member_id));
  if (linked) {
    const m = people.find((x) => x.id === linked.member_id);
    if (m) return { id: m.id, name: m.name };
  }
  const attending = await trips.attendeesOf(trip.id);
  const adult = attending.find((a) => !a.is_minor) ?? attending[0] ?? people.find((m) => !m.is_minor) ?? people[0];
  return adult ? { id: adult.id, name: adult.name } : null;
}

/** A trip as a chat context, for a member of the household that owns it or a guest with the link. */
export async function tripContext(trip, me) {
  const [days, stops, attendees, guests, organiser] = await Promise.all([
    trips.daysOf(trip.id), trips.stopsOf(trip.id), trips.attendeesOf(trip.id), tripChat.guestsOf(trip.id), organiserOf(trip),
  ]);
  const joined = guests.filter((g) => g.status === 'joined');
  const people = [
    ...attendees.map((a) => ({ memberId: a.id, guestId: null, name: a.name, avatarUrl: a.avatar_url ?? null, householdId: trip.household_id, isHost: organiser?.id === a.id })),
    ...joined.map((g) => ({ memberId: null, guestId: g.id, name: g.name, contact: g.contact, contactKind: g.contact_kind, isHost: false })),
  ];
  // The organiser is in the conversation whether or not they are on the trip's attendee list.
  if (organiser && !people.some((p) => p.memberId === organiser.id)) {
    const m = (await households.membersOf(trip.household_id)).find((x) => x.id === organiser.id);
    if (m) people.unshift({ memberId: m.id, guestId: null, name: m.name, avatarUrl: m.avatar_url ?? null, householdId: trip.household_id, isHost: true });
  }
  const byDay = new Map();
  for (const s of stops) { const l = byDay.get(s.day_id) ?? []; l.push(s); byDay.set(s.day_id, l); }
  const dayAnchors = days.map((d) => {
    const on = (byDay.get(d.id) ?? []).sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.position - b.position);
    return { kind: 'day', ref: d.id, label: `${fmtDay(d.date)} · ${on[0]?.venue_name ?? 'free day'}`, date: ymd(d.date), sub: on.length ? on.map((s) => s.venue_name).join(', ') : 'Nothing booked' };
  });
  const dayOf = new Map(days.map((d) => [d.id, ymd(d.date)]));
  const stopAnchors = stops.map((s) => ({ kind: 'stop', ref: s.venue_ref, label: s.venue_name, date: dayOf.get(s.day_id) ?? null, sub: fmtDate(dayOf.get(s.day_id)) ?? null, dayId: s.day_id }));
  const name = trip.title || trip.place_label || trip.locality || 'the trip';
  const dates = trip.dates_fixed === false ? null : { start: ymd(trip.start_date), end: ymd(trip.end_date) };
  const meRow = me ? { ...me, isHost: Boolean(me.memberId && organiser?.id === me.memberId), booked: true, contextType: 'trip' } : null;
  return {
    type: 'trip', id: trip.id, name, dates,
    host: organiser ? { id: organiser.id, name: organiser.name, role: 'organiser' } : null,
    people, me: meRow,
    anchors: { level: TRIP_ANCHORS.map((a) => ({ kind: 'trip', ref: a.ref, label: a.label })), days: dayAnchors, stops: stopAnchors },
    sub: `${people.length} ${people.length === 1 ? 'person' : 'people'}`,
    subtitle: dates ? `${fmtDate(dates.start)}${dates.end !== dates.start ? ` – ${fmtDate(dates.end)}` : ''}` : 'Date not fixed',
  };
}

/** A hosted offer as a chat context, for its host or somebody booked on it. */
export async function offerContext(offer, me, { household } = {}) {
  const [host, rows] = await Promise.all([hosting.hostById(offer.host_id), chat.offerPeople(offer.id)]);
  const people = rows.map((r) => ({
    memberId: r.member_id, guestId: null, name: r.name, avatarUrl: r.avatar_url ?? null, householdId: r.household_id,
    isHost: Boolean(r.is_host), occurrences: r.occurrences ?? [], bookedAt: r.booked_at,
  }));
  const hostMember = people.find((p) => p.isHost) ?? null;
  const isHost = Boolean(me && host && household && host.household_id === household.id);
  /**
   * Somebody asking from the listing before booking (C7) is in the
   * conversation too — theirs, privately, with the host — so a reply or an
   * answer reaches them. They are not counted as booked (Codex, 13 Sep 2026).
   */
  if (me && !isHost && !people.some((p) => p.memberId === me.memberId)) {
    people.push({ memberId: me.memberId, guestId: null, name: me.name, avatarUrl: null, householdId: me.householdId ?? null, isHost: false, occurrences: [], bookedAt: null, unbooked: true });
  }
  const mine = me ? people.find((p) => p.memberId === me.memberId) : null;
  const meRow = me ? {
    ...me, isHost, contextType: 'offer',
    booked: isHost || Boolean(mine && mine.occurrences.length),
    occurrences: mine?.occurrences ?? [],
    bookedAt: mine?.bookedAt ?? null,
  } : null;
  const level = OFFER_ASPECTS.map((a) => ({ kind: 'offer_aspect', ref: a.ref, label: a.label }));
  const more = [];
  if (offer.shape === 'series') {
    for (const w of offer.weeks ?? []) more.push({ kind: 'offer_aspect', ref: `week:${w.n}`, label: `Week ${w.n}${w.title ? ` · ${w.title}` : ''}` });
    for (const d of seriesDates(offer)) more.push({ kind: 'offer_aspect', ref: `date:${d}`, label: fmtDate(d), date: d });
  } else if (offer.shape === 'oneoff' && offer.starts_on) {
    more.push({ kind: 'offer_aspect', ref: `date:${ymd(offer.starts_on)}`, label: fmtDate(offer.starts_on), date: ymd(offer.starts_on) });
  }
  const booked = people.filter((p) => !p.isHost && !p.unbooked);
  return {
    type: 'offer', id: offer.id, name: offer.title || 'this', dates: offer.starts_on ? { start: ymd(offer.starts_on), end: ymd(offer.starts_on) } : null,
    host: host ? { id: hostMember?.memberId ?? null, hostId: host.id, name: host.name, role: 'host' } : null,
    people, me: meRow,
    anchors: { level, days: [], stops: more },
    sub: `${booked.length} booked · ${firstName(host?.name)} hosting`,
    subtitle: offer.starts_on ? fmtDate(offer.starts_on) : offer.shape === 'series' ? 'A series' : 'Anytime',
    offer,
  };
}

/** The context an address names, for the signed-in household. */
async function resolve(type, id) {
  const household = await currentHousehold();
  const member = await currentMember();
  const me = member ? { memberId: member.id, guestId: null, name: member.name, householdId: household.id } : null;
  if (type === 'trip') {
    const trip = await trips.tripOfHouseholdFull(id, household.id);
    if (!trip) throw refuse(404, 'trip_not_found', 'Trip not found');
    return tripContext(trip, me);
  }
  if (type === 'offer') {
    const offer = await hosting.offerById(id);
    if (!offer || offer.state === 'draft') throw refuse(404, 'offer_not_found', 'There is no experience at that address.');
    const ctx = await offerContext(offer, me, { household });
    // A public offer may be asked about before booking (C7); a private one may not be read into at all.
    if (!ctx.me?.booked && offer.visibility === 'invite') throw refuse(403, 'not_booked', 'This one is invitation only.');
    return ctx;
  }
  throw refuse(404, 'no_such_context', 'Not a conversation.');
}

// ---------------------------------------------------------------------------
// the shape things take on the wire
// ---------------------------------------------------------------------------

const personOf = (row, ctx) => {
  const name = row.member_name ?? row.guest_name ?? 'Someone';
  const memberId = row.author_member_id ?? null;
  return {
    name, guest: Boolean(row.author_guest_id), initial: initialOf(name), memberId, guestId: row.author_guest_id ?? null,
    avatarUrl: row.member_avatar ?? null,
    isHost: Boolean(memberId && ctx.host?.id === memberId),
  };
};

const tagOf = (t, ctx) => {
  const all = [...ctx.anchors.level, ...ctx.anchors.days, ...ctx.anchors.stops];
  const known = all.find((a) => a.kind === t.tag_kind && String(a.ref) === String(t.tag_ref));
  return { kind: t.tag_kind, ref: t.tag_ref, label: known?.label ?? t.tag_label ?? null, date: known?.date ?? null };
};

/** "of 12": how many people a topic could reach. */
function audienceCount(t, ctx) {
  if (t.audience === 'host_only') return 2;
  const people = ctx.people.filter((p) => !p.unbooked);
  if (ctx.type === 'offer' && t.occurrence) return people.filter((p) => p.isHost || (p.occurrences ?? []).includes(t.occurrence)).length;
  return people.length;
}

const groupReactions = (rows, me) => {
  const by = new Map();
  for (const r of rows) {
    const g = by.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (samePerson({ memberId: r.member_id, guestId: r.guest_id }, me)) g.mine = true;
    by.set(r.emoji, g);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
};

function publicTopic(t, ctx, me, { replies = [], reactions = [], following = false, opened = true, unreadReplies = 0 } = {}) {
  const author = personOf(t, ctx);
  const answer = t.answer_reply_id ? replies.find((r) => r.id === t.answer_reply_id) ?? null : null;
  const withReplies = { ...t, replies };
  return {
    id: t.id, title: t.title, body: t.body,
    tag: tagOf(t, ctx), audience: t.audience, occurrence: t.occurrence ?? null,
    state: t.state, pinned: t.pinned,
    author, at: t.created_at, lastAt: t.last_at ?? t.created_at,
    replyCount: t.reply_count ?? replies.length, seenBy: t.seen_by ?? 0, audienceCount: audienceCount(t, ctx),
    answer: answer ? { replyId: answer.id, by: personOf(answer, ctx).name, at: answer.created_at } : null,
    mine: samePerson(authorOf(t), me), following, opened, unreadReplies,
    reactions: groupReactions(reactions, me),
    /** Each Showing value this topic passes, so the list filters without a second copy of the rules. */
    flags: Object.fromEntries(SHOWING.map((s) => [s, matchesShowing(withReplies, s, me)])),
  };
}

function publicReply(r, ctx, me, { all = [], reactions = [], request = null } = {}) {
  const quoted = r.quotes_reply_id ? all.find((q) => q.id === r.quotes_reply_id) : null;
  return {
    id: r.id, body: r.body, at: r.created_at, isAnswer: r.is_answer,
    author: personOf(r, ctx), mine: samePerson(authorOf(r), me), seenBy: r.seen_by ?? 0,
    quotes: quoted ? { id: quoted.id, by: personOf(quoted, ctx).name, body: quoted.body } : null,
    reactions: groupReactions(reactions, me),
    publishRequest: request ? { id: request.id, destination: request.destination, decision: request.decision, decidedAt: request.decided_at } : null,
  };
}

/** The context, as the header draws it: name, dates, who, and what this person may do. */
function publicContext(ctx) {
  const me = ctx.me;
  return {
    type: ctx.type, id: ctx.id, name: ctx.name, subtitle: ctx.subtitle, sub: ctx.sub, dates: ctx.dates,
    host: ctx.host ? { name: ctx.host.name, role: ctx.host.role, memberId: ctx.host.id } : null,
    me: me ? { memberId: me.memberId ?? null, guestId: me.guestId ?? null, name: me.name, isHost: Boolean(me.isHost), guest: Boolean(me.guestId), booked: me.booked !== false, occurrences: me.occurrences ?? [] } : null,
    can: {
      ask: Boolean(me),
      /** A guest on the link has no account to hold a private thread against. */
      private: Boolean(me && !me.guestId),
      notice: Boolean(me?.isHost),
      answer: Boolean(me?.isHost),
    },
    people: {
      count: ctx.people.filter((p) => !p.unbooked).length,
      members: ctx.people.filter((p) => p.memberId && !p.unbooked).map((p) => ({ id: p.memberId, name: p.name, avatarUrl: p.avatarUrl ?? null, isHost: p.isHost })),
      guests: ctx.people.filter((p) => p.guestId).map((p) => ({ id: p.guestId, name: p.name })),
    },
    anchors: {
      level: ctx.anchors.level.map((a) => ({ key: `${a.kind}:${a.ref}`, ...a })),
      days: ctx.anchors.days.map((a) => ({ key: `${a.kind}:${a.ref}`, ...a })),
      stops: ctx.anchors.stops.map((a) => ({ key: `${a.kind}:${a.ref}`, ...a })),
    },
  };
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/** What this person may see of the context's topics. */
function visibleTopics(rows, ctx) {
  const me = ctx.me;
  return rows.filter((t) => {
    if (!canSee(t, me)) return false;
    if (ctx.type === 'offer' && me) {
      // Somebody who has not booked sees their own questions and nothing else.
      if (me.booked === false && !samePerson(authorOf(t), me)) return false;
      // "Everyone booked on that date": a topic on one occurrence is that date's.
      if (!me.isHost && t.occurrence && me.occurrences?.length && !me.occurrences.includes(t.occurrence) && !samePerson(authorOf(t), me)) return false;
    }
    return true;
  });
}

/** GET the list (D3). */
export async function listPayload(ctx) {
  const me = ctx.me;
  const rows = await chat.topicsOf(ctx.type, ctx.id);
  const visible = visibleTopics(rows, ctx);
  const ids = visible.map((t) => t.id);
  const [replies, follows, unread, prefs] = await Promise.all([
    chat.repliesAcross(ids), chat.followsIn(ids, me ?? {}), chat.unreadOf(ctx.type, ctx.id, me ?? {}), me ? chat.prefsOf(ctx.type, ctx.id, me) : null,
  ]);
  const byTopic = new Map();
  for (const r of replies) { const l = byTopic.get(r.topic_id) ?? []; l.push(r); byTopic.set(r.topic_id, l); }
  const topics = visible.map((t) => publicTopic(t, ctx, me, {
    replies: byTopic.get(t.id) ?? [], following: follows.has(t.id),
    opened: unread.opened?.has(t.id) ?? true, unreadReplies: unread.replies?.get(t.id) ?? 0,
  }));
  const out = {
    context: publicContext(ctx),
    topics,
    prefs: { ...DEFAULT_PREFS, ...(prefs ? pickPrefs(prefs) : {}) },
    unread: topics.reduce((n, t) => n + (t.opened ? 0 : 1) + t.unreadReplies, 0),
  };
  if (ctx.type === 'trip') {
    // How many questions sit on each stop, for the Ask tab's count (3d).
    out.askCounts = Object.fromEntries(await chat.askCounts(ctx.id));
    out.organiser = ctx.host ? { id: ctx.host.id, name: ctx.host.name } : null;
  }
  if (ctx.type === 'offer') {
    // "Three answers came with this booking" (C8).
    out.faqFromEarlier = me?.bookedAt ? await chat.faqPublishedBefore(ctx.id, me.bookedAt) : 0;
    out.faqCount = (await chat.faqOf(ctx.id)).length;
  }
  return out;
}

/**
 * The list with the flat river the trip rebuild's bundle still reads
 * (`messages`, `people`) riding alongside. For the addresses that predate the
 * topic model; the new ones do not carry it.
 */
export async function withLegacy(ctx, list) {
  const rows = await chat.repliesAcross(list.topics.map((t) => t.id));
  const replies = rows.map((r) => ({ id: r.id, topicId: r.topic_id, body: r.body, at: r.created_at, mine: samePerson(authorOf(r), ctx.me), author: personOf(r, ctx), seenBy: r.seen_by ?? 0 }));
  return { ...list, messages: legacyMessages(list.topics, replies), people: legacyPeople(list.context) };
}

const pickPrefs = (p) => ({ started: p.started, anchors: p.anchors, from_host: p.from_host, every_topic: p.every_topic, mentions: p.mentions, digest: p.digest });

/** One topic, open (E1, C2). Opening it marks every reply in it seen. */
export async function topicPayload(ctx, topicId) {
  const me = ctx.me;
  const t = await chat.topicById(topicId);
  if (!t || t.context_type !== ctx.type || t.context_id !== ctx.id) throw refuse(404, 'topic_not_found', 'That question is not here.');
  if (!visibleTopics([t], ctx).length) throw refuse(404, 'topic_not_found', 'That question is not here.');
  if (me) await chat.markTopicRead(t.id, me);
  const fresh = await chat.topicById(t.id);
  const [replies, requests, follows, mostUsed] = await Promise.all([
    chat.repliesOf(t.id), chat.publishRequestsOf(t.id), chat.followsIn([t.id], me ?? {}), me ? chat.mostUsedBy(me) : [],
  ]);
  const reactions = await chat.reactionsOn([t.id, ...replies.map((r) => r.id)]);
  const on = (id) => reactions.filter((r) => r.target_id === id);
  const topic = publicTopic(fresh, ctx, me, { replies, reactions: on(t.id), following: follows.has(t.id) });
  const mine = samePerson(authorOf(t), me);
  return {
    context: publicContext(ctx),
    topic,
    replies: replies.map((r) => publicReply(r, ctx, me, { all: replies, reactions: on(r.id), request: requests.find((q) => q.reply_id === r.id) ?? null })),
    /** The asker's decision to make (D2), when the host has asked. */
    publishRequests: requests.filter((q) => !q.decision).map((q) => ({
      id: q.id, replyId: q.reply_id, destination: q.destination, forMe: mine,
      askedBy: ctx.host?.name ?? null,
      /** Shown exactly as it would be published — the normalised question, never their wording. */
      preview: { question: normaliseQuestion(t.title), answer: replies.find((r) => r.id === q.reply_id)?.body ?? '' },
    })),
    menu: menuFor({ ...fresh, seenBy: fresh.seen_by, audienceCount: audienceCount(fresh, ctx) }, me, { following: follows.has(t.id) }),
    /** For the host: how many times this has been asked across the offer's dates, for the nudge (D1). */
    askCount: ctx.type === 'offer' && me?.isHost ? askCount(t.title, (await chat.topicsOf('offer', ctx.id)).map((x) => x.title)) : null,
    suggestPublishAt: SUGGEST_PUBLISH_AT,
    picker: { quick: QUICK_REACTIONS, mostUsed: mostUsed.length ? mostUsed : COMMON_REACTIONS, yours: mostUsed.length > 0 },
  };
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

async function guardRate(me) {
  const said = rateLimited(await chat.recentCounts(me));
  if (said) throw refuse(429, 'too_many', said);
}

/** The tag as the composer sent it, checked against the context's anchors. */
function tagFrom(body, ctx) {
  const tag = body?.tag ?? {};
  const kind = TAG_KINDS.includes(tag.kind) ? tag.kind : null;
  if (!kind) throw refuse(400, 'tag_required', 'Say what it is about first.');
  const ref = str(tag.ref, 200);
  const all = [...ctx.anchors.level, ...ctx.anchors.days, ...ctx.anchors.stops];
  const known = all.find((a) => a.kind === kind && String(a.ref) === String(ref));
  if (!known) throw refuse(400, 'tag_unknown', 'That is not on this trip.');
  return { kind, ref, label: known.label };
}

async function notify(ctx, event) {
  const [prefRows, followers] = await Promise.all([chat.prefsAcross(ctx.type, ctx.id), event.topic ? chat.followersOf(event.topic.id) : []]);
  const prefsOf = (p) => prefRows.find((r) => (p.memberId && r.member_id === p.memberId) || (p.guestId && r.guest_id === p.guestId)) ?? null;
  const topic = { ...event.topic, context_type: ctx.type, context_dates: ctx.dates, tag_date: tagOf(event.topic, ctx).date };
  const told = whoIsTold({ ...event, topic }, { people: ctx.people, prefsOf, followersOf: () => followers, today: today() });
  const text = notificationText({ ...event, topic }, { contextName: ctx.name });
  for (const { person, reason } of told) {
    const p = prefsOf(person);
    const settings = person.memberId ? await chat.settingsOf(person.memberId) : null;
    await tell(person, {
      kind: reason === 'mention' ? 'mention' : event.kind, text, topicId: event.topic.id, replyId: event.reply?.id ?? null,
      digest: Boolean(p?.digest), settings,
    });
  }
  return told.length;
}

/** POST a topic (D6–D8). */
export async function createTopic(ctx, body) {
  const me = ctx.me;
  if (!me) throw refuse(403, 'not_in', 'Say who you are first.');
  const title = str(body?.title ?? body?.body, 500);
  if (!title) throw refuse(400, 'empty', 'Type the question first.');
  const detail = str(body?.body && body?.title ? body.body : null, 2000);
  const audience = AUDIENCES.includes(body?.audience) ? body.audience : 'everyone';
  if (audience === 'host_only' && me.guestId) throw refuse(400, 'guest_private', 'A private question needs an Epic account — ask whoever shared the trip to add you.');
  const notice = Boolean(body?.notice) && me.isHost;
  const tag = tagFrom(body, ctx);
  await guardRate(me);
  let occurrence = null;
  if (ctx.type === 'offer' && !me.isHost) {
    const asked = str(body?.occurrence, 40);
    occurrence = asked && me.occurrences?.includes(asked) ? asked : (me.occurrences?.[0] ?? null);
  }
  const topic = await withTransaction(async (client) => {
    const t = await chat.insertTopic({
      contextType: ctx.type, contextId: ctx.id, tagKind: tag.kind, tagRef: tag.ref, tagLabel: tag.label,
      audience, occurrence, memberId: me.memberId, guestId: me.guestId, title, body: detail, state: notice ? 'notice' : 'open',
    }, client);
    await chat.follow(t.id, me, 'authored', client);
    return t;
  });
  await chat.markTopicRead(topic.id, me);
  // The same question, already answered for good: count it.
  if (ctx.type === 'offer') {
    for (const e of await chat.faqOf(ctx.id)) if (isNearDuplicate(title, e.question)) { await chat.bumpFaqAskCount(e.id); break; }
  }
  const mentions = mentionsIn(`${title} ${detail ?? ''}`, ctx.people);
  for (const m of mentions) await chat.follow(topic.id, m, 'mention');
  await notify(ctx, { kind: notice ? 'notice' : 'topic', topic, actor: { ...me, isHost: me.isHost }, mentions }).catch((err) => console.error('chat notify', err.message));
  return topic;
}

/** PATCH a topic: the asker edits the question, its tag and its audience; the host pins it. */
export async function editTopic(ctx, topicId, body) {
  const me = ctx.me;
  const t = await chat.topicById(topicId);
  if (!t || t.context_type !== ctx.type || t.context_id !== ctx.id) throw refuse(404, 'topic_not_found', 'That question is not here.');
  const mine = samePerson(authorOf(t), me);
  const patch = {};
  if (body?.pinned !== undefined) {
    if (!me?.isHost) throw refuse(403, 'not_host', 'Only the organiser can pin.');
    patch.pinned = Boolean(body.pinned);
  }
  if (body?.title !== undefined || body?.body !== undefined || body?.tag !== undefined || body?.audience !== undefined) {
    if (!mine) throw refuse(403, 'not_yours', 'Only whoever asked it can change it.');
    if (body.title !== undefined) { const title = str(body.title, 500); if (!title) throw refuse(400, 'empty', 'The question cannot be empty.'); patch.title = title; }
    if (body.body !== undefined) patch.body = str(body.body, 2000);
    if (body.tag !== undefined) { const tag = tagFrom(body, ctx); patch.tagKind = tag.kind; patch.tagRef = tag.ref; patch.tagLabel = tag.label; }
    if (body.audience !== undefined) {
      if (!AUDIENCES.includes(body.audience)) throw refuse(400, 'audience', 'Who can see it: everyone, or just the host.');
      if (body.audience === 'host_only' && me.guestId) throw refuse(400, 'guest_private', 'A private question needs an Epic account.');
      patch.audience = body.audience;
    }
  }
  return chat.updateTopic(t.id, patch);
}

/** POST a reply (E4, D1). Replying follows the topic. */
export async function createReply(ctx, topicId, body) {
  const me = ctx.me;
  if (!me) throw refuse(403, 'not_in', 'Say who you are first.');
  const t = await chat.topicById(topicId);
  if (!t || t.context_type !== ctx.type || t.context_id !== ctx.id || !visibleTopics([t], ctx).length) throw refuse(404, 'topic_not_found', 'That question is not here.');
  const text = str(body?.body, 2000);
  if (!text) throw refuse(400, 'empty', 'Type something first.');
  await guardRate(me);
  let quotes = null;
  if (body?.quotesReplyId) {
    const q = await chat.replyById(String(body.quotesReplyId));
    if (q && q.topic_id === t.id) quotes = q.id;
  }
  // The host may ask the asker whether a private answer can be published (D1). Never the other way round, never automatic.
  const wants = body?.publishRequest === 'faq' || body?.publishRequest === 'group' ? body.publishRequest : null;
  if (wants && (!me.isHost || t.audience !== 'host_only')) throw refuse(400, 'not_private', 'Only a private answer needs asking about.');
  if (wants === 'faq' && ctx.type !== 'offer') throw refuse(400, 'no_faq', 'A trip has no FAQ — ask to post it to the group instead.');
  if (wants === 'group' && ctx.type !== 'trip') throw refuse(400, 'no_group', 'On an offer the answer goes to the FAQ.');
  const reply = await withTransaction(async (client) => {
    const r = await chat.insertReply({ topicId: t.id, memberId: me.memberId, guestId: me.guestId, body: text, quotesReplyId: quotes }, client);
    await chat.follow(t.id, me, 'replied', client);
    if (wants) await chat.insertPublishRequest({ topicId: t.id, replyId: r.id, requestedBy: me.memberId, destination: wants }, client);
    return r;
  });
  await chat.markTopicRead(t.id, me);
  const mentions = mentionsIn(text, ctx.people);
  for (const m of mentions) await chat.follow(t.id, m, 'mention');
  await notify(ctx, { kind: 'reply', topic: t, reply, actor: { ...me }, mentions }).catch((err) => console.error('chat notify', err.message));
  if (wants) {
    const asker = ctx.people.find((p) => samePerson(p, authorOf(t)));
    if (asker) {
      const text2 = notificationText({ kind: 'publish_request', topic: t, actor: me }, { contextName: ctx.name });
      const settings = asker.memberId ? await chat.settingsOf(asker.memberId) : null;
      await tell(asker, { kind: 'publish_request', text: text2, topicId: t.id, replyId: reply.id, settings }).catch(() => {});
    }
  }
  return reply;
}

/**
 * POST the answer (C6, E2): the host or organiser marks one reply. On an
 * offer, `publish: 'faq'` also files a *public* question's answer in the FAQ.
 * A private one can only get there through the asker (D1/D2), so that is
 * refused here rather than quietly allowed.
 */
export async function markAnswer(ctx, topicId, body) {
  const me = ctx.me;
  if (!me?.isHost) throw refuse(403, 'not_host', ctx.type === 'offer' ? 'Only the host marks the answer.' : 'Only the organiser marks the answer.');
  const t = await chat.topicById(topicId);
  if (!t || t.context_type !== ctx.type || t.context_id !== ctx.id) throw refuse(404, 'topic_not_found', 'That question is not here.');
  if (t.state === 'notice') throw refuse(400, 'notice', 'A notice has no answer to mark.');
  const replyId = body?.replyId ? String(body.replyId) : null;
  if (replyId) {
    const r = await chat.replyById(replyId);
    if (!r || r.topic_id !== t.id) throw refuse(404, 'reply_not_found', 'That reply is not on this question.');
  }
  // Everything that can refuse does so before anything is written (Codex, 13 Sep 2026).
  const toFaq = Boolean(replyId && body?.publish === 'faq');
  if (toFaq) {
    if (ctx.type !== 'offer') throw refuse(400, 'no_faq', 'A trip has no FAQ.');
    if (t.audience === 'host_only') throw refuse(400, 'private', 'A private answer goes in the FAQ only if the asker says so — ask them from your reply.');
  }
  const updated = await chat.setAnswer(t.id, replyId);
  let faq = null;
  if (toFaq) {
    const r = await chat.replyById(replyId);
    const others = (await chat.topicsOf('offer', ctx.id)).map((x) => x.title);
    faq = await chat.insertFaq({
      offerId: ctx.id, question: normaliseQuestion(t.title), answer: r.body, askCount: askCount(t.title, others),
      sourceTopicId: t.id, sourceReplyId: r.id, attribution: 'anonymous',
    });
  }
  if (replyId) {
    const r = await chat.replyById(replyId);
    await notify(ctx, { kind: 'answer', topic: t, reply: r, actor: { ...me, isHost: true } }).catch((err) => console.error('chat notify', err.message));
  }
  return { topic: updated, faq };
}

/** POST /follow · DELETE /follow — per topic, never per reply. */
export async function setFollowing(ctx, topicId, on) {
  const me = ctx.me;
  if (!me) throw refuse(403, 'not_in', 'Say who you are first.');
  const t = await chat.topicById(topicId);
  if (!t || t.context_type !== ctx.type || t.context_id !== ctx.id || !visibleTopics([t], ctx).length) throw refuse(404, 'topic_not_found', 'That question is not here.');
  if (on) await chat.follow(t.id, me, 'manual'); else await chat.unfollow(t.id, me);
  return on;
}

/** POST /react — one row per person per emoji, toggled. Tells the author only. */
export async function react(ctx, topicId, body) {
  const me = ctx.me;
  if (!me) throw refuse(403, 'not_in', 'Say who you are first.');
  const t = await chat.topicById(topicId);
  if (!t || t.context_type !== ctx.type || t.context_id !== ctx.id || !visibleTopics([t], ctx).length) throw refuse(404, 'topic_not_found', 'That question is not here.');
  const emoji = str(body?.emoji, 16);
  if (!emoji || /[a-z0-9]/i.test(emoji)) throw refuse(400, 'emoji', 'Pick an emoji.');
  const targetType = body?.targetType === 'reply' ? 'reply' : 'topic';
  const targetId = targetType === 'reply' ? String(body?.targetId ?? '') : t.id;
  let target = t;
  if (targetType === 'reply') {
    target = await chat.replyById(targetId);
    if (!target || target.topic_id !== t.id) throw refuse(404, 'reply_not_found', 'That reply is not on this question.');
  }
  const on = await chat.toggleReaction({ targetType, targetId, emoji }, me);
  if (on) await notify(ctx, { kind: 'reaction', topic: t, reply: targetType === 'reply' ? target : null, actor: me, emoji }).catch(() => {});
  return on;
}

/** POST /requests/:id/decide — the asker's three answers (D2). */
export async function decidePublish(ctx, topicId, requestId, body) {
  const me = ctx.me;
  const t = await chat.topicById(topicId);
  if (!t || t.context_type !== ctx.type || t.context_id !== ctx.id) throw refuse(404, 'topic_not_found', 'That question is not here.');
  if (!samePerson(authorOf(t), me)) throw refuse(403, 'not_yours', 'Only whoever asked can decide this.');
  const req = await chat.publishRequestById(requestId);
  if (!req || req.topic_id !== t.id) throw refuse(404, 'request_not_found', 'Nothing to decide.');
  if (req.decision) throw refuse(409, 'decided', 'You have already answered this.');
  const decision = ['anonymous', 'named', 'declined'].includes(body?.decision) ? body.decision : null;
  if (!decision) throw refuse(400, 'decision', 'Yes anonymously, yes with your name, or no.');
  const reply = await chat.replyById(req.reply_id);
  const result = await withTransaction(async (client) => {
    await chat.decidePublishRequest(req.id, decision, client);
    if (decision === 'declined') return { published: null };
    const named = decision === 'named';
    if (req.destination === 'faq') {
      const others = (await chat.topicsOf('offer', ctx.id)).map((x) => x.title);
      const faq = await chat.insertFaq({
        offerId: ctx.id, question: normaliseQuestion(t.title), answer: reply.body, askCount: askCount(t.title, others),
        sourceTopicId: t.id, sourceReplyId: reply.id,
        consentMemberId: me.memberId, consentGuestId: me.guestId, consentAt: new Date(), attribution: decision, askedBy: named ? me.name : null,
      }, client);
      return { published: { faqId: faq.id } };
    }
    // A trip: the organiser posts the answer to the group, with the name removed unless they said otherwise.
    const posted = await chat.insertTopic({
      contextType: 'trip', contextId: ctx.id, tagKind: t.tag_kind, tagRef: t.tag_ref, tagLabel: t.tag_label, audience: 'everyone',
      memberId: req.requested_by_member_id, title: normaliseQuestion(t.title),
      body: named ? `Asked by ${me.name}.` : 'Asked privately by someone on the trip.', state: 'open',
    }, client);
    const answer = await chat.insertReply({ topicId: posted.id, memberId: req.requested_by_member_id, body: reply.body }, client);
    await chat.setAnswer(posted.id, answer.id, client);
    await chat.follow(posted.id, { memberId: req.requested_by_member_id }, 'authored', client);
    if (named) await chat.follow(posted.id, me, 'mention', client);
    return { published: { topicId: posted.id } };
  });
  const host = ctx.people.find((p) => p.isHost);
  if (host && decision !== 'declined') {
    const text = notificationText({ kind: 'published', topic: t, actor: me }, { contextName: ctx.name });
    await tell(host, { kind: 'published', text, topicId: t.id, settings: await chat.settingsOf(host.memberId) }).catch(() => {});
  }
  return { decision, ...result };
}

/** POST /report — a report is never lost, even before moderation is designed (README §14). */
export async function report(ctx, topicId, body) {
  const me = ctx.me;
  if (!me) throw refuse(403, 'not_in', 'Say who you are first.');
  const t = await chat.topicById(topicId);
  if (!t || t.context_type !== ctx.type || t.context_id !== ctx.id || !visibleTopics([t], ctx).length) throw refuse(404, 'topic_not_found', 'That question is not here.');
  await chat.insertReport({ topicId: t.id, replyId: body?.replyId ? String(body.replyId) : null, reason: str(body?.reason, 1000) }, me);
  return { ok: true, message: 'Thank you. Somebody at Epic reads every report.' };
}

// ---------------------------------------------------------------------------
// the household's router: /api/chat/…
// ---------------------------------------------------------------------------

const ctxOf = (req) => resolve(req.params.type, req.params.id);

router.get('/:type/:id', async (req, res, next) => {
  try { res.json(await listPayload(await ctxOf(req))); } catch (err) { next(err); }
});

router.post('/:type/:id/read', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    if (ctx.me) await chat.markContextRead(ctx.type, ctx.id, ctx.me);
    res.json({ unread: 0 });
  } catch (err) { next(err); }
});

router.post('/:type/:id/topics', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    const t = await createTopic(ctx, req.body);
    res.status(201).json(await topicPayload(ctx, t.id));
  } catch (err) { next(err); }
});

router.get('/:type/:id/topics/:topicId', async (req, res, next) => {
  try { res.json(await topicPayload(await ctxOf(req), req.params.topicId)); } catch (err) { next(err); }
});

router.patch('/:type/:id/topics/:topicId', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    await editTopic(ctx, req.params.topicId, req.body);
    res.json(await topicPayload(ctx, req.params.topicId));
  } catch (err) { next(err); }
});

router.post('/:type/:id/topics/:topicId/replies', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    await createReply(ctx, req.params.topicId, req.body);
    res.status(201).json(await topicPayload(ctx, req.params.topicId));
  } catch (err) { next(err); }
});

router.post('/:type/:id/topics/:topicId/answer', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    const { faq } = await markAnswer(ctx, req.params.topicId, req.body);
    res.json({ ...(await topicPayload(ctx, req.params.topicId)), faq: faq ? { id: faq.id } : null });
  } catch (err) { next(err); }
});

router.post('/:type/:id/topics/:topicId/follow', async (req, res, next) => {
  try { const ctx = await ctxOf(req); await setFollowing(ctx, req.params.topicId, true); res.json({ following: true }); } catch (err) { next(err); }
});
router.delete('/:type/:id/topics/:topicId/follow', async (req, res, next) => {
  try { const ctx = await ctxOf(req); await setFollowing(ctx, req.params.topicId, false); res.json({ following: false }); } catch (err) { next(err); }
});

router.post('/:type/:id/topics/:topicId/react', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    const on = await react(ctx, req.params.topicId, req.body);
    res.json({ on, ...(await topicPayload(ctx, req.params.topicId)) });
  } catch (err) { next(err); }
});

router.post('/:type/:id/topics/:topicId/requests/:requestId/decide', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    const r = await decidePublish(ctx, req.params.topicId, req.params.requestId, req.body);
    res.json({ ...r, ...(await topicPayload(ctx, req.params.topicId)) });
  } catch (err) { next(err); }
});

router.post('/:type/:id/topics/:topicId/report', async (req, res, next) => {
  try { res.status(201).json(await report(await ctxOf(req), req.params.topicId, req.body)); } catch (err) { next(err); }
});

// --- what you get told about, per context (C9) ------------------------------

router.get('/:type/:id/prefs', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    const p = ctx.me ? await chat.prefsOf(ctx.type, ctx.id, ctx.me) : null;
    const settings = ctx.me?.memberId ? await chat.settingsOf(ctx.me.memberId) : null;
    res.json({ context: publicContext(ctx), prefs: { ...DEFAULT_PREFS, ...(p ? pickPrefs(p) : {}) }, digestAt: String(settings?.digest_at ?? '18:00').slice(0, 5), anchorsOn: anchorsOn(ctx) });
  } catch (err) { next(err); }
});

router.put('/:type/:id/prefs', async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    if (!ctx.me) throw refuse(403, 'not_in', 'Say who you are first.');
    const b = req.body ?? {};
    const next = { ...DEFAULT_PREFS };
    for (const k of Object.keys(DEFAULT_PREFS)) if (b[k] !== undefined) next[k] = Boolean(b[k]);
    // Announcements from the host or organiser cannot be turned off for the day of; the switch is honoured on every other day.
    const p = await chat.upsertPrefs(ctx.type, ctx.id, ctx.me, next);
    res.json({ prefs: { ...DEFAULT_PREFS, ...(p ? pickPrefs(p) : next) } });
  } catch (err) { next(err); }
});

/** "Tagged Mon · Uffizi and Tue · cooking" — the anchors this person is on. */
function anchorsOn(ctx) {
  if (ctx.type === 'offer') {
    const occ = ctx.me?.occurrences ?? [];
    return occ.map((o) => fmtDate(o.slice(0, 10)) ?? o).filter(Boolean);
  }
  return ctx.anchors.days.slice(0, 3).map((d) => d.label);
}

// ---------------------------------------------------------------------------
// Settings → Notifications: every trip and hosted date in one list
// ---------------------------------------------------------------------------

async function contextsFor(household, member) {
  const me = { memberId: member?.id ?? null, guestId: null };
  const rows = await trips.tripsFor(household.id, {}).catch(() => []);
  const prefRows = member ? await chat.prefsForPerson(me) : [];
  const prefFor = (type, id) => { const p = prefRows.find((r) => r.context_type === type && r.context_id === id); return { ...DEFAULT_PREFS, ...(p ? pickPrefs(p) : {}) }; };
  const out = [];
  for (const t of rows) {
    out.push({ type: 'trip', id: t.id, name: t.title || t.place_label || t.locality || 'A trip', when: t.dates_fixed === false ? 'Date not fixed' : `${fmtDate(t.start_date)}${ymd(t.end_date) !== ymd(t.start_date) ? ` – ${fmtDate(t.end_date)}` : ''}`, prefs: prefFor('trip', t.id) });
  }
  const bookings = await hosting.bookingsOfHousehold(household.id).catch(() => []);
  const seen = new Set();
  for (const b of bookings) {
    if (b.state === 'cancelled' || seen.has(b.offer_id)) continue;
    seen.add(b.offer_id);
    out.push({ type: 'offer', id: b.offer_id, name: b.title ?? 'A hosted date', when: `${b.host_name ?? 'A host'} hosting${b.occurrence && b.occurrence !== 'whole' ? ` · ${fmtDate(b.occurrence.slice(0, 10))}` : ''}`, prefs: prefFor('offer', b.offer_id) });
  }
  const host = await hosting.hostByHousehold(household.id).catch(() => null);
  if (host) {
    for (const o of await hosting.offersOfHost(host.id)) {
      if (o.state === 'draft' || seen.has(o.id)) continue;
      seen.add(o.id);
      out.push({ type: 'offer', id: o.id, name: o.title ?? 'Your offer', when: 'You are hosting', prefs: prefFor('offer', o.id) });
    }
  }
  return out;
}

router.get('/settings', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const member = await currentMember();
    const settings = member ? await chat.settingsOf(member.id) : null;
    res.json({
      digestAt: String(settings?.digest_at ?? '18:00').slice(0, 5),
      quietFrom: settings?.quiet_from ? String(settings.quiet_from).slice(0, 5) : null,
      quietTo: settings?.quiet_to ? String(settings.quiet_to).slice(0, 5) : null,
      contexts: await contextsFor(household, member),
      defaults: DEFAULT_PREFS,
    });
  } catch (err) { next(err); }
});

const hhmm = (v) => (v && /^\d{2}:\d{2}$/.test(String(v)) ? String(v) : null);

router.put('/settings', async (req, res, next) => {
  try {
    const member = await currentMember();
    if (!member) throw refuse(403, 'no_member', 'No one to set this for.');
    const b = req.body ?? {};
    const current = await chat.settingsOf(member.id);
    const s = await chat.upsertSettings(member.id, {
      digestAt: hhmm(b.digestAt) ?? String(current?.digest_at ?? '18:00').slice(0, 5),
      quietFrom: b.quietFrom === null ? null : hhmm(b.quietFrom) ?? (current?.quiet_from ? String(current.quiet_from).slice(0, 5) : null),
      quietTo: b.quietTo === null ? null : hhmm(b.quietTo) ?? (current?.quiet_to ? String(current.quiet_to).slice(0, 5) : null),
    });
    res.json({ digestAt: String(s.digest_at).slice(0, 5), quietFrom: s.quiet_from ? String(s.quiet_from).slice(0, 5) : null, quietTo: s.quiet_to ? String(s.quiet_to).slice(0, 5) : null });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the host inbox (C5): every question across every offer, waiting first
// ---------------------------------------------------------------------------

router.get('/inbox', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const host = await hosting.hostByHousehold(household.id);
    if (!host) return res.json({ host: null, offers: [], counts: { waiting: 0, answered: 0, private: 0, all: 0 } });
    const offers = await chat.offersForInbox(host.id);
    const rows = await chat.topicsAcross('offer', offers.map((o) => o.id));
    const titlesByOffer = new Map();
    for (const t of rows) { const l = titlesByOffer.get(t.context_id) ?? []; l.push(t.title); titlesByOffer.set(t.context_id, l); }
    const member = await currentMember();
    const me = { memberId: member?.id ?? null, guestId: null, isHost: true, contextType: 'offer' };
    const items = rows.filter((t) => t.state !== 'notice').map((t) => {
      const asked = askCount(t.title, titlesByOffer.get(t.context_id) ?? []);
      return {
        id: t.id, offerId: t.context_id, title: t.title, tag: { kind: t.tag_kind, ref: t.tag_ref, label: t.tag_label },
        audience: t.audience, state: t.state, at: t.created_at, lastAt: t.last_at,
        author: { name: t.member_name ?? t.guest_name ?? 'Someone', initial: initialOf(t.member_name ?? t.guest_name) },
        askedTimes: asked, suggestPublish: asked >= SUGGEST_PUBLISH_AT && t.state === 'open',
        replyCount: t.reply_count ?? 0, seenBy: t.seen_by ?? 0,
        flags: { waiting: t.state === 'open', answered: t.state === 'answered', private: t.audience === 'host_only' },
      };
    });
    res.json({
      host: { id: host.id, name: host.name },
      offers: offers.map((o) => ({ id: o.id, title: o.title, shape: o.shape, state: o.state, startsOn: ymd(o.starts_on), topics: items.filter((i) => i.offerId === o.id) })).filter((o) => o.topics.length),
      counts: { waiting: items.filter((i) => i.flags.waiting).length, answered: items.filter((i) => i.flags.answered).length, private: items.filter((i) => i.flags.private).length, all: items.length },
      suggestPublishAt: SUGGEST_PUBLISH_AT, me,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the FAQ (C7): public, on the listing, before anyone books
// ---------------------------------------------------------------------------

const faqPayload = (e) => ({ id: e.id, question: e.question, answer: e.answer, askCount: e.ask_count, askedBy: e.attribution === 'named' ? e.asked_by : null, publishedAt: e.published_at });

publicRouter.get('/experiences/:id/faq', async (req, res, next) => {
  try {
    const o = await hosting.offerById(req.params.id);
    if (!o || o.state === 'draft' || o.state === 'in_review') return res.status(404).json({ error: 'not_found' });
    const h = await hosting.hostById(o.host_id);
    res.json({ faq: (await chat.faqOf(o.id)).map(faqPayload), hostName: h?.name ?? null });
  } catch (err) { next(err); }
});

/** Withdrawing consent unpublishes (README §9). The consenting person, or the host, may do it. */
router.post('/faq/:id/withdraw', async (req, res, next) => {
  try {
    const e = await chat.faqById(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    const household = await currentHousehold();
    const member = await currentMember();
    const host = await hosting.hostByHousehold(household.id);
    const offer = await hosting.offerById(e.offer_id);
    const isHost = Boolean(host && offer && offer.host_id === host.id);
    const consented = member && e.consent_member_id === member.id;
    if (!isHost && !consented) throw refuse(403, 'not_yours', 'Only whoever agreed to this, or the host, can take it out.');
    await chat.withdrawFaq(e.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
