/**
 * The content queue — what households have sent us, and whether it is fit to
 * publish.
 *
 * One queue with a filter, not a queue per kind. Forty beach photographs can be
 * approved together; **a person's review is never rejected in a batch.** The
 * rejection reasons are a closed list so the common one can be counted and
 * designed out, and the message the household receives is written next to the
 * button that sends it.
 */

import express from 'express';
import { requires } from '../access.js';
import * as queue from '../repositories/contentQueue.js';
import { writeAudit } from '../repositories/roles.js';

const router = express.Router();
const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });
const actor = (req) => ({ actorId: req.account?.id ?? null, actorLabel: req.account?.email ?? 'the owner (passcode)' });

/** BO5a — the queue, its counts, and the filter. */
router.get('/', requires('view_library'), async (req, res, next) => {
  try {
    const areaSlug = req.query.where ? String(req.query.where).toLowerCase() : null;
    const kind = req.query.kind && req.query.kind !== 'all' ? String(req.query.kind) : null;
    const state = queue.STATES.includes(String(req.query.state)) ? String(req.query.state) : 'waiting';
    // Cheap and idempotent, so the queue is never behind what households did.
    await queue.sync().catch(() => null);
    const rows = await queue.list({ kind, state, areaSlug });
    res.json({
      kinds: queue.KINDS, states: queue.STATES,
      counts: await queue.counts({ areaSlug }),
      state, kind: kind ?? 'all', where: areaSlug,
      rows: rows.map((r) => ({
        id: r.id, kind: r.kind, subjectType: r.subject_type, subjectId: r.subject_id,
        maker: r.maker_label, place: r.place_label, ref: r.venue_ref, area: r.area_slug,
        state: r.state, reported: r.reported, madeAt: r.made_at,
        reason: r.reason, told: r.told,
        // A photograph's own id, so a row can draw a thumbnail of the thing it
        // is asking about.
        imageId: r.kind === 'photo' && r.subject_type === 'image' ? r.subject_id : null,
        batchable: queue.KINDS.find((k) => k.key === r.kind)?.batch ?? false,
      })),
    });
  } catch (err) { next(err); }
});

/** One item, with everything needed to decide without leaving the queue. */
router.get('/:id', requires('view_library'), async (req, res, next) => {
  try {
    const item = await queue.one(String(req.params.id));
    if (!item) return res.status(404).json({ error: 'not_found', message: 'Nothing in the queue by that id.' });
    res.json({
      item: {
        id: item.id, kind: item.kind, subjectType: item.subject_type, subjectId: item.subject_id,
        maker: item.maker_label, place: item.place_label, ref: item.venue_ref, area: item.area_slug,
        state: item.state, reported: item.reported, reportReason: item.report_reason, madeAt: item.made_at,
        reason: item.reason, message: item.message, told: item.told,
      },
      detail: item.detail,
      // The photograph itself, not a description of it: a photo queue whose
      // photo cannot be seen cannot be worked (Codex, 17 Sep 2026).
      picture: item.picture ? { ...item.picture, imageId: item.picture.id } : null,
      // What this household has sent before and what it has earned, because a
      // decision about one photograph is a decision about a person.
      made: item.maker ? { name: item.maker.name, kept: item.maker.kept, points: item.maker.points } : null,
      // The reviewer is asked to apply the "somebody's face is in it" test, so
      // the screen has to say whether anything looked. Nothing does yet, and
      // saying "not looked for" is the honest answer rather than "none found".
      faces: 'not looked for',
      // The closed list, with the message each one sends.
      reasons: queue.REASONS[item.kind] ?? queue.REASONS.review,
      batchable: queue.KINDS.find((k) => k.key === item.kind)?.batch ?? false,
    });
  } catch (err) { next(err); }
});

/** Approve — one, or forty photographs together. */
router.post('/approve', requires('manage_library'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) throw bad('Nothing selected.');
    const done = await queue.approve(ids, actor(req).actorLabel);
    await writeAudit({ ...actor(req), action: 'queue.approve', subjectType: 'content', subjectId: ids.join(','), subjectLabel: `${done.length} approved`, after: { ids } });
    res.json({ approved: done.length, ids: done.map((d) => d.id) });
  } catch (err) { next(err); }
});

/**
 * Reject, with a reason from the closed list — and never in a batch.
 *
 * `tell` sends the household the message shown beside the button; what was sent
 * is stored, so it can be read back rather than reconstructed.
 */
router.post('/:id/reject', requires('manage_library'), async (req, res, next) => {
  try {
    const out = await queue.reject({
      id: String(req.params.id),
      reason: String(req.body?.reason ?? ''),
      message: req.body?.message ? String(req.body.message) : null,
      tell: req.body?.tell === true,
      who: actor(req).actorLabel,
    });
    if (!out) throw bad('That is not one of the reasons for this kind of thing.');
    await writeAudit({ ...actor(req), action: 'queue.reject', subjectType: 'content', subjectId: out.id, subjectLabel: out.reason, after: { reason: out.reason, told: out.told } });
    res.json({ ok: true, id: out.id, reason: out.reason, told: out.told, message: out.message });
  } catch (err) { next(err); }
});

/** Reported content jumps the queue: a different job on a different clock. */
router.post('/:id/report', requires('view_library'), async (req, res, next) => {
  try {
    const out = await queue.report({ id: String(req.params.id), reason: req.body?.reason ?? null, by: req.account?.id ?? null });
    if (!out) return res.status(404).json({ error: 'not_found', message: 'Nothing in the queue by that id.' });
    res.json({ ok: true, id: out.id });
  } catch (err) { next(err); }
});

/** Which reasons get used — so the common one can be designed out. */
router.get('/report/reasons', requires('view_library'), async (_req, res, next) => {
  try { res.json({ reasons: queue.REASONS, used: await queue.reasonCounts() }); } catch (err) { next(err); }
});

export default router;
