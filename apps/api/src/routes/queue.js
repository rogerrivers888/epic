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
import { query } from '../db.js';
import { requires } from '../access.js';
import * as queue from '../repositories/contentQueue.js';
import { writeAudit } from '../repositories/roles.js';
import { stampImage } from '../sources/photoLinks.js';

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
    // Grouped: forty photographs of one beach are one decision and one row
    // (BO5a, "Coral Beach, 12 of them"). Nothing a person wrote ever groups.
    const rows = queue.group(await queue.list({ kind, state, areaSlug }));
    res.json({
      kinds: queue.KINDS, states: queue.STATES,
      counts: await queue.counts({ areaSlug, state }),
      state, kind: kind ?? 'all', where: areaSlug,
      rows: rows.map((r) => ({
        id: r.id, kind: r.kind, subjectType: r.subject_type, subjectId: r.subject_id,
        maker: r.maker_label, place: r.place_label, ref: r.venue_ref, area: r.area_slug,
        state: r.state, reported: r.reported, madeAt: r.made_at,
        reason: r.reason, told: r.told,
        // The first words of it, and — for a flagged fact — which fact.
        preview: r.preview ? String(r.preview).replace(/\s+/g, ' ').trim() : null,
        field: r.field ?? null,
        // A photograph's own id, so a row can draw a thumbnail of the thing it
        // is asking about.
        imageId: r.kind === 'photo' && r.subject_type === 'image' ? r.subject_id : null,
        batchable: queue.KINDS.find((k) => k.key === r.kind)?.batch ?? false,
        // Every id this row stands for, so approving it approves the lot, and
        // who made them — "4 households" rather than one name.
        batch: r.batch ?? [r.id], of: r.of ?? 1, makers: r.makers ?? [],
      })),
    });
  } catch (err) { next(err); }
});

/** Which reasons get used — so the common one can be designed out. */
// Above `/:id` on purpose: Express matches in order, so a dynamic route
// declared first swallows `/report/reasons` and tries to read "report" as a
// uuid — which is why the screen could not load its reason counts at all
// (Codex, 17 Sep 2026).
router.get('/report/reasons', requires('view_library'), async (_req, res, next) => {
  try { res.json({ reasons: queue.REASONS, used: await queue.reasonCounts() }); } catch (err) { next(err); }
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
      //
      // A household's upload is served only on a signed link until somebody has
      // looked at it — which is this screen — so the link is stamped here. The
      // bare id 404s, which is the point: a pending photograph is not public
      // because it is sitting in a queue.
      picture: item.picture ? { ...stampImage(item.picture), imageId: item.picture.id } : null,
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
    // The rule the screen obeys, held at the door as well.
    //
    // Forty beach photographs are one decision; a person's review never is. The
    // screen only ever offers a batch of photographs, but the rule belongs on
    // the API too — a screen is not a permission (Codex, 17 Sep 2026).
    if (ids.length > 1) {
      const { rows } = await query(
        `select distinct kind from content_queue where id = any($1::uuid[])`, [ids]);
      const notBatchable = rows
        .map((r) => queue.KINDS.find((k) => k.key === r.kind))
        .filter((k) => k && !k.batch);
      if (notBatchable.length) {
        throw bad(`A ${notBatchable[0].said ?? notBatchable[0].label.toLowerCase()} is decided on its own, never in a batch.`);
      }
    }
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
    // `told` is what actually happened, not what was asked for; `why` says so
    // in one sentence where nothing went out.
    res.json({ ok: true, id: out.id, reason: out.reason, told: out.told, message: out.message, why: out.why ?? null });
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

export default router;
