/**
 * A group participant's door into the trip's conversation (owner, 13 Sep
 * 2026: everyone who accepted the invite is on the trip; some do some
 * activities and not others).
 *
 * The invite link is public and the participant's own token is the
 * credential, exactly as on `/api/join/:token` itself. A participant from the
 * household is that member in the chat; anyone else stands as a guest row of
 * their own (migration 089) and gets the guest treatment — `everyone` topics,
 * no private thread, no marking an answer — because there is no account to
 * hold a private thread against.
 *
 * What they are on — the days and activities they said in or paid for — is
 * read from the group's item states in `routes/chat.js tripContext`, so a
 * question about Monday's cooking reaches the people doing it.
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import * as groupsRepo from '../repositories/groups.js';
import * as trips from '../repositories/trips.js';
import * as tripChat from '../repositories/tripChat.js';
import * as households from '../repositories/households.js';
import * as topics from './chat.js';

const router = Router();

const refuse = (status, code, message) => { const e = new Error(message); e.status = status; e.code = code; return e; };

async function participantCtx(req, res) {
  const group = await groupsRepo.groupByInviteToken(req.params.token);
  if (!group) throw refuse(404, 'no_such_group', 'That link does not open anything.');
  const p = await groupsRepo.participantByToken(group.id, String(req.query.p ?? req.body?.participantToken ?? req.body?.p ?? ''));
  if (!p || !p.joined_at || p.withdrawn_at) { res.status(403).json({ error: 'not_in', message: 'Join the trip first.' }); return null; }
  const trip = await trips.tripById(group.trip_id);
  if (!trip) throw refuse(404, 'trip_not_found', 'Trip not found');
  let me;
  if (p.member_id) {
    const m = (await households.membersOf(trip.household_id)).find((x) => x.id === p.member_id);
    me = m ? { memberId: m.id, guestId: null, name: m.name, householdId: trip.household_id } : null;
  }
  if (!me) {
    const g = await tripChat.guestForParticipant(trip.id, p, crypto.randomBytes(18).toString('base64url'));
    me = { memberId: null, guestId: g.id, name: g.name, contact: g.contact, contactKind: g.contact_kind };
  }
  return topics.tripContext(trip, me);
}

router.get('/:token/chat', async (req, res, next) => {
  try {
    const ctx = await participantCtx(req, res);
    if (!ctx) return;
    res.json(await topics.withLegacy(ctx, await topics.listPayload(ctx)));
  } catch (err) { next(err); }
});

router.post('/:token/chat', async (req, res, next) => {
  try {
    const ctx = await participantCtx(req, res);
    if (!ctx) return;
    const b = req.body ?? {};
    if (b.topicId) {
      await topics.createReply(ctx, String(b.topicId), { body: b.body, quotesReplyId: b.quotesReplyId ?? null });
      return res.status(201).json(await topics.topicPayload(ctx, String(b.topicId)));
    }
    const tag = b.tag ?? { kind: 'trip', ref: 'trip' };
    // A household member may ask the organiser privately; a guest row cannot (routes/chat.js refuses it).
    const t = await topics.createTopic(ctx, { title: b.title ?? b.body, body: b.title ? b.body : null, tag, audience: ctx.me?.guestId ? 'everyone' : (b.audience ?? 'everyone') });
    res.status(201).json(await topics.topicPayload(ctx, t.id));
  } catch (err) { next(err); }
});

router.get('/:token/chat/:topicId', async (req, res, next) => {
  try { const ctx = await participantCtx(req, res); if (!ctx) return; res.json(await topics.topicPayload(ctx, req.params.topicId)); } catch (err) { next(err); }
});

router.post('/:token/chat/:topicId/react', async (req, res, next) => {
  try {
    const ctx = await participantCtx(req, res);
    if (!ctx) return;
    const on = await topics.react(ctx, req.params.topicId, req.body);
    res.json({ on, ...(await topics.topicPayload(ctx, req.params.topicId)) });
  } catch (err) { next(err); }
});

router.post('/:token/chat/:topicId/follow', async (req, res, next) => {
  try { const ctx = await participantCtx(req, res); if (!ctx) return; await topics.setFollowing(ctx, req.params.topicId, true); res.json({ following: true }); } catch (err) { next(err); }
});
router.delete('/:token/chat/:topicId/follow', async (req, res, next) => {
  try { const ctx = await participantCtx(req, res); if (!ctx) return; await topics.setFollowing(ctx, req.params.topicId, false); res.json({ following: false }); } catch (err) { next(err); }
});

router.post('/:token/chat/:topicId/report', async (req, res, next) => {
  try { const ctx = await participantCtx(req, res); if (!ctx) return; res.status(201).json(await topics.report(ctx, req.params.topicId, req.body)); } catch (err) { next(err); }
});

export { router };
