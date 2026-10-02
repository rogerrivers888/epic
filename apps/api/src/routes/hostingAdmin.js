/**
 * The back office's Hosting tab (hosting v4, BO8a–BO8r; handover §3 and §5).
 * Mounted at /api/admin/hosting behind the admin door. Reads need
 * `view_hosting`; review and safety actions `manage_hosting`; anything that
 * spends, overrides a fee, removes a host or produces DAC7 needs the owner
 * personally signed in (G7/G11), so an agent is told to file it for approval.
 *
 * Corrections the handover makes to the design (§3): "Host type" is Kind
 * (One-off · Weekly · Course · On request); approving with Checked missing
 * makes the event "Approved · waiting on Checked", live only once Checked is
 * done; payouts go 72 hours after a session (the settings say so, not code);
 * Audit is Changes; reports break down by Kind.
 *
 * Every figure is a count or a sum of rows Epic holds; a judgement with
 * nothing behind it is null with a reason (CLAUDE.md, can't-speak).
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import * as repo from '../repositories/hosting.js';
import * as settingsRepo from '../repositories/hostingSettings.js';
import * as notifications from '../repositories/notifications.js';
import { logChange } from '../repositories/hostingSettings.js';
import { requires, requireOwnerSignedIn } from '../access.js';
import { currentAccount } from '../context.js';
import { checklist, laneBlockers, hostingConfig, localDay, localInstant, SEQ, ageOn } from '../domain/lanes.js';
import { ladderProgress, introState } from '../domain/money.js';
import { standingOf } from '../domain/hostDesk.js';
import { mediaRef } from './hosting.js';
import { stripeMode } from '../sources/stripe.js';

export const router = Router();

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const KINDS = ['oneoff', 'weekly', 'course', 'onrequest'];
const kindOf = (q) => (KINDS.includes(q) ? q : null);
const by = () => currentAccount()?.id ?? null;
const mask = (s) => (s ? `•••• ${String(s).slice(-3)}` : null);

async function hostRating(hostId) {
  const { rows: [r] } = await query(
    `select count(*)::int as reviews, round(avg(r.stars)::numeric, 2)::float as avg,
            count(distinct (r.offer_id, coalesce(b.session_id::text, b.occurrence, '')))::int as rated
       from host_reviews r left join experience_bookings b on b.id = r.booking_id
      where r.host_id = $1 and r.side = 'guest' and r.publish_on <= current_date and not coalesce(r.hidden, false)`,
    [hostId],
  );
  return { reviews: r?.reviews ?? 0, avg: r?.avg ?? null, ratedEvents: r?.rated ?? 0 };
}

// ---------------------------------------------------------------------------
// Review — BO8a, BO8b
// ---------------------------------------------------------------------------

function reviewRow(o, s) {
  const windowH = typeof s.review_window === 'number' ? s.review_window : null;
  const submitted = o.submitted_at ? new Date(o.submitted_at) : null;
  const leftH = windowH != null && submitted ? Math.round(((submitted.getTime() + windowH * 3_600_000) - Date.now()) / 360_000) / 10 : null;
  const ai = o.review_ai ?? null;
  return {
    offerId: o.id, title: o.title, host: o.host_name, hostId: o.host_id, kind: o.lane, visibility: o.visibility, state: o.state,
    submittedAt: o.submitted_at, hoursLeft: leftH,
    ai: !ai ? null : ai.state === 'done' ? { verdict: ai.needsPerson ? 'review' : 'clear', reasons: ai.reasons ?? [] } : ai.state === 'failed' ? { verdict: 'review', reasons: ['The check did not finish'] } : { verdict: ai.state, reasons: [] },
    changesRequested: o.changes_requested ?? null,
  };
}

router.get('/review', requires('view_hosting'), async (req, res, next) => {
  try {
    const s = await settingsRepo.current();
    const status = ['requires', 'waiting', 'all'].includes(req.query.status) ? req.query.status : 'requires';
    const kind = kindOf(req.query.kind);
    const states = status === 'requires' ? ['in_review'] : status === 'waiting' ? ['approved', 'draft'] : ['in_review', 'approved', 'draft'];
    const { rows } = await query(
      `select o.*, h.name as host_name from host_offers o join hosts h on h.id = o.host_id
        where o.lane is not null and o.state = any($1) and ($2::text is null or o.lane = $2)
          and (o.state <> 'draft' or o.changes_requested is not null)
        order by o.submitted_at asc nulls last limit 500`,
      [states, kind],
    );
    const { rows: [today] } = await query(
      `select count(*)::int as n from hosting_changes where subject_kind = 'event' and field = 'review' and at >= date_trunc('day', now()) and after->>'outcome' = 'live'`,
    );
    res.json({ rows: rows.map((o) => reviewRow(o, s)), wentLiveToday: today.n, reviewHours: s.review_window ?? null, capped: rows.length === 500 });
  } catch (err) { next(err); }
});

router.get('/review/:id', requires('view_hosting'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) throw refuse(404, 'not_found', 'No such event.');
    const o = await repo.offerById(req.params.id);
    if (!o || !o.lane) throw refuse(404, 'not_found', 'No such event.');
    const host = await repo.hostById(o.host_id);
    const s = await settingsRepo.current();
    const cfg = hostingConfig();
    const items = checklist(o, { host, account: { email: 'x', mobile: 'x' } }, cfg);
    const done = (k) => items.find((i) => i.key === k);
    const { rows: reasons } = await query('select label from review_change_reasons order by label');
    res.json({
      event: {
        ...reviewRow({ ...o, host_name: host?.name }, s),
        summary: o.summary, description: o.description, photo: mediaRef(o.photo_ids?.[0]), startsOn: ymd(o.starts_on), startsAt: hm(o.starts_at),
        pricePence: o.price_pence, priceMode: o.price_mode, ageMin: o.age_min, ageMax: o.age_max, parents: o.parents, venueArea: o.venue_area,
        video: o.video_id ? { url: mediaRef(o.video_id), transcript: o.transcript ?? null, flags: (o.review_ai?.reasons ?? []).map((r) => ({ at: o.review_ai?.at ?? null, reason: r })) } : null,
      },
      checklist: [
        { key: 'verified', label: 'Verified', state: done('verified') ? (done('verified').done ? 'done' : 'missing') : 'not_needed' },
        { key: 'checked', label: 'Checked', state: done('checked') ? (done('checked').done ? 'done' : 'missing') : 'not_needed' },
        { key: 'payouts', label: 'Payouts', state: done('payouts') ? (done('payouts').done ? 'done' : 'missing') : 'not_needed' },
        { key: 'profile', label: 'Profile', state: done('profile')?.done ? 'done' : 'missing' },
        { key: 'adult', label: '18+', state: host?.date_of_birth ? (ageOn(host.date_of_birth) >= cfg.hostMinAge ? 'done' : 'missing') : 'missing' },
      ],
      reasons: reasons.map((r) => r.label),
    });
  } catch (err) { next(err); }
});

/**
 * Approve. Never blocked by a missing Checked (BO8b): it records that the
 * reviewer has checked everything, and the event becomes "Approved · waiting
 * on Checked", live once Checked is done. A date already gone is the one thing
 * approval can't fix — that goes back to the host.
 */
router.post('/review/:id/approve', requires('manage_hosting'), async (req, res, next) => {
  try {
    const out = await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${req.params.id}`]);
      const { rows: [o] } = await c.query('select * from host_offers where id = $1 for update', [req.params.id]);
      if (!o || o.state !== 'in_review') throw refuse(404, 'not_in_review', 'That event isn’t waiting to be read.');
      const host = await repo.hostById(o.host_id, c);
      const blockers = laneBlockers(o, host, hostingConfig());
      const items = checklist(o, { host, account: { email: 'x', mobile: 'x' } }, hostingConfig());
      const checkedMissing = items.some((i) => i.key === 'checked' && !i.done);
      const gone = blockers.find((b) => /date has gone/.test(b));
      if (gone) throw refuse(409, 'date_gone', `${gone} Ask for changes instead.`);
      const outcome = checkedMissing ? 'approved' : 'live';
      await c.query(
        `update host_offers set state = $2, approved_at = now(), reviewed_at = now(), published_at = case when $2 = 'live' then now() else published_at end, changes_requested = null where id = $1`,
        [o.id, outcome],
      );
      await logChange({ subjectKind: 'event', subjectId: o.id, field: 'review', before: { state: 'in_review' }, after: { outcome }, why: checkedMissing ? 'Approved · waiting on Checked' : 'Approved', by: by(), byLabel: 'staff' }, c);
      return { outcome };
    });
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/review/:id/changes', requires('manage_hosting'), async (req, res, next) => {
  try {
    const reasons = Array.isArray(req.body?.reasons) ? req.body.reasons.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 12) : [];
    const added = typeof req.body?.addReason === 'string' ? req.body.addReason.trim().slice(0, 120) : '';
    if (added) reasons.push(added);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
    if (!reasons.length && !note) throw refuse(400, 'reasons', 'Tick a reason or write a note.');
    const o = await withTransaction(async (c) => {
      const { rows: [row] } = await c.query(`update host_offers set state = 'draft', changes_requested = $2::jsonb, review_note = $3, reviewed_at = now() where id = $1 and state = 'in_review' returning *`, [req.params.id, JSON.stringify({ reasons, note: note || null, at: new Date().toISOString() }), [reasons.join(' · '), note].filter(Boolean).join(' — ')]);
      if (!row) throw refuse(404, 'not_in_review', 'That event isn’t waiting to be read.');
      if (added) await c.query('insert into review_change_reasons (label) values ($1) on conflict (label) do nothing', [added]);
      await logChange({ subjectKind: 'event', subjectId: row.id, field: 'review', after: { outcome: 'changes', reasons, note }, by: by(), byLabel: 'staff' }, c);
      return row;
    });
    const host = await repo.hostById(o.host_id);
    await notifications.notify({ householdId: host.household_id, kind: 'review_changes_requested', title: `Changes requested: ${o.title ?? 'your event'}`, body: reasons.join(' · ') || note, link: `/host/offers/${o.id}/setup`, dedupeKey: `changes:${o.id}:${o.reviewed_at?.toISOString?.() ?? Date.now()}` }).catch(() => null);
    res.json({ sent: true });
  } catch (err) { next(err); }
});

router.post('/review/:id/decline', requires('manage_hosting'), async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (!reason) throw refuse(400, 'reason', 'Say why — the host sees it.');
    const { rows: [o] } = await query(`update host_offers set state = 'ended', review_note = $2, reviewed_at = now() where id = $1 and state = 'in_review' returning *`, [req.params.id, `Declined: ${reason}`]);
    if (!o) throw refuse(404, 'not_in_review', 'That event isn’t waiting to be read.');
    await logChange({ subjectKind: 'event', subjectId: o.id, field: 'review', after: { outcome: 'declined', reason }, by: by(), byLabel: 'staff' });
    const host = await repo.hostById(o.host_id);
    await notifications.notify({ householdId: host.household_id, kind: 'review_changes_requested', title: `Not approved: ${o.title ?? 'your event'}`, body: reason, link: '/host/events', dedupeKey: `declined:${o.id}` }).catch(() => null);
    res.json({ declined: true });
  } catch (err) { next(err); }
});

/** Approved and waiting on Checked: live as soon as Checked holds. Run by the hosting money loop. */
export async function releaseApproved() {
  const { rows } = await query(`select o.* from host_offers o where o.state = 'approved' and o.lane is not null`);
  let n = 0;
  for (const o of rows) {
    const host = await repo.hostById(o.host_id);
    const items = checklist(o, { host, account: { email: 'x', mobile: 'x' } }, hostingConfig());
    if (items.some((i) => i.key === 'checked' && !i.done)) continue;
    // Checked came after the date had gone: it stays out, for the host to pick a new date (Codex, 2 Oct 2026).
    if (laneBlockers(o, host, hostingConfig()).some((b) => /date has gone/.test(b))) continue;
    const { rowCount } = await query(`update host_offers set state = 'live', published_at = now() where id = $1 and state = 'approved'`, [o.id]);
    if (rowCount) { n += 1; await logChange({ subjectKind: 'event', subjectId: o.id, field: 'state', before: { state: 'approved' }, after: { state: 'live' }, why: 'Checked done', byLabel: 'epic' }); }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Hosts — BO8c, BO8d, BO8q, BO8r
// ---------------------------------------------------------------------------

router.get('/hosts', requires('view_hosting'), async (req, res, next) => {
  try {
    const s = await settingsRepo.current();
    const { rows } = await query(
      `select h.*,
              (select count(*) from host_offers o where o.host_id = h.id and o.state = 'live')::int as live,
              (select count(*) from host_offers o where o.host_id = h.id and o.state <> 'draft' and o.visibility = 'public')::int as public_events,
              (select count(*) from host_offers o where o.host_id = h.id and o.state <> 'draft')::int as events,
              (select array_agg(distinct o.lane) from host_offers o where o.host_id = h.id and o.lane is not null and o.state <> 'draft') as kinds,
              (select round(avg(r.stars)::numeric, 2)::float from host_reviews r where r.host_id = h.id and r.side = 'guest' and not coalesce(r.hidden, false) and r.publish_on <= current_date) as rating,
              (select count(*) from host_offers o where o.host_id = h.id and o.state = 'approved')::int as waiting_checked
         from hosts h order by h.created_at desc limit 1000`,
    );
    const kind = kindOf(req.query.kind);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const out = [];
    for (const h of rows) {
      if (kind && !(h.kinds ?? []).includes(kind)) continue;
      if (req.query.hosting === 'public' && !h.public_events) continue;
      if (req.query.hosting === 'private' && (h.public_events || !h.events)) continue;
      if (q && !`${h.name} ${h.location_label ?? ''}`.toLowerCase().includes(q)) continue;
      const status = h.stopped_at ? 'stopped' : h.paused ? 'paused' : h.live ? 'hosting' : 'not_live';
      if (req.query.status && req.query.status !== 'all' && req.query.status !== status) continue;
      const checkedNeeded = h.waiting_checked > 0;
      const taxMissing = !h.tax_reference && h.events > 0;
      if (req.query.flag === 'checked' && !checkedNeeded) continue;
      if (req.query.flag === 'tax' && !taxMissing) continue;
      if (req.query.flag === 'rating' && !(h.rating != null && h.rating < 4)) continue;
      const rating = await hostRating(h.id);
      const progress = ladderProgress(s.public_commission, { ratedEvents: rating.ratedEvents, avg: rating.avg });
      const { rows: [{ n: used }] } = await query('select count(*)::int as n from experience_bookings where host_id = $1 and intro_ordinal is not null', [h.id]);
      const intro = introState(s.intro_zero, { hostStartedAt: h.created_at, bookingsSoFar: used });
      out.push({
        id: h.id, name: h.name, town: h.location_label ?? null,
        hosting: h.public_events ? 'Public' : h.events ? 'Private only' : null, kinds: h.kinds ?? [],
        live: h.live, rating: h.rating, feeNow: h.fee_override_pct != null ? Number(h.fee_override_pct) : h.public_events ? (intro.active ? 0 : progress?.rate ?? null) : null,
        verified: h.identity_state === 'verified', checked: h.checked_state, payouts: h.payouts_state, tax: Boolean(h.tax_reference), status,
      });
    }
    res.json({ rows: out, capped: rows.length === 1000 });
  } catch (err) { next(err); }
});

router.get('/hosts/:id', requires('view_hosting'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) throw refuse(404, 'not_found', 'No such host.');
    const h = await repo.hostById(req.params.id);
    if (!h) throw refuse(404, 'not_found', 'No such host.');
    const s = await settingsRepo.current();
    const rating = await hostRating(h.id);
    const progress = ladderProgress(s.public_commission, { ratedEvents: rating.ratedEvents, avg: rating.avg });
    const { rows: [m] } = await query(
      `select coalesce(sum(case when kind = 'charge' and state = 'succeeded' then amount_pence end), 0)::int as taken,
              coalesce(sum(case when kind = 'charge' and state = 'succeeded' then epic_pence end), 0)::int as epic,
              coalesce(sum(case when kind = 'payout' and state = 'succeeded' then amount_pence end), 0)::int as paid_out
         from hosting_payments where host_id = $1`, [h.id],
    );
    const { rows: [nextPayout] } = await query(`select amount_pence + tips_pence as pence, release_at, state, hold_reason from host_payouts where host_id = $1 and state in ('scheduled', 'held') order by release_at limit 1`, [h.id]);
    const { rows: events } = await query(`select id, title, lane, state, visibility, starts_on from host_offers where host_id = $1 and lane is not null order by updated_at desc limit 100`, [h.id]);
    const { rows: [late] } = await query(`select count(*)::int as n from offer_sessions x join host_offers o on o.id = x.offer_id where o.host_id = $1 and x.late and x.created_at > now() - interval '90 days'`, [h.id]);
    const { rows: [{ n: introUsedN }] } = await query('select count(*)::int as n from experience_bookings where host_id = $1 and intro_ordinal is not null', [h.id]);
    const { rows: [open] } = await query(`select count(*)::int as n from hosting_complaints where host_id = $1 and state = 'open'`, [h.id]);
    const { rows: [outstanding] } = await query(
      `select (select count(*) from experience_bookings b where b.host_id = $1 and b.state in ('pending', 'confirmed'))::int as bookings,
              (select count(*) from host_payouts where host_id = $1 and state in ('scheduled', 'held', 'released'))::int as payouts`, [h.id],
    );
    res.json({
      host: { id: h.id, name: h.name, town: h.location_label, photo: mediaRef(h.photo_id), since: h.created_at, paused: Boolean(h.paused), stopped: Boolean(h.stopped_at), adult: h.date_of_birth ? ageOn(h.date_of_birth) >= 18 : null },
      trust: { verified: { state: h.identity_state, on: ymd(h.identity_verified_at) }, checked: { state: h.checked_state, level: h.checked_level ?? null, on: ymd(h.checked_on), submittedAt: h.checked_submitted_at ?? null }, insurance: { expires: ymd(h.insurance_expires) } },
      money: { stripe: h.payouts_state, tax: mask(h.tax_reference), takenPence: m.taken, epicPence: m.epic, paidOutPence: m.paid_out, nextPayout: nextPayout ? { pence: nextPayout.pence, on: ymd(nextPayout.release_at), state: nextPayout.state, holdReason: nextPayout.hold_reason } : null },
      fee: (() => {
        const intro = introState(s.intro_zero, { hostStartedAt: h.created_at, bookingsSoFar: introUsedN });
        const override = h.fee_override_pct != null ? Number(h.fee_override_pct) : null;
        return { override, progress, intro: intro.active ? { daysLeft: intro.daysLeft, bookingsLeft: intro.bookingsLeft } : null, now: override ?? (intro.active ? 0 : progress?.rate ?? null) };
      })(),
      ratings: rating,
      standing: standingOf({ thresholds: s.rating_escalation, avg: rating.avg, ratedEvents: rating.ratedEvents, lateChanges90d: late.n, openComplaints: open.n }),
      events: events.map((e) => ({ id: e.id, title: e.title, kind: e.lane, state: e.state, visibility: e.visibility, startsOn: ymd(e.starts_on) })),
      canRemove: !outstanding.bookings && !outstanding.payouts, outstanding,
    });
  } catch (err) { next(err); }
});

router.get('/hosts/:id/videos', requires('view_hosting'), async (req, res, next) => {
  try {
    const h = await repo.hostById(req.params.id);
    if (!h) throw refuse(404, 'not_found', 'No such host.');
    const { rows: offers } = await query(`select id, title, video_id, hello_video_id, review_ai, transcript, reviewed_at, state from host_offers where host_id = $1 and (video_id is not null or hello_video_id is not null)`, [h.id]);
    const ids = [h.intro_video_id, ...offers.flatMap((o) => [o.video_id, o.hello_video_id])].filter(Boolean);
    const { rows: media } = ids.length ? await query('select id, created_at, duration_s from host_media where id = any($1::uuid[])', [ids]) : { rows: [] };
    const meta = new Map(media.map((m) => [m.id, m]));
    const videos = [];
    if (h.intro_video_id) videos.push({ id: h.intro_video_id, where: 'Profile', url: mediaRef(h.intro_video_id), uploaded: meta.get(h.intro_video_id)?.created_at ?? null, seconds: meta.get(h.intro_video_id)?.duration_s ?? null, ai: null, transcript: null });
    for (const o of offers) {
      if (o.video_id) videos.push({ id: o.video_id, where: o.title, offerId: o.id, url: mediaRef(o.video_id), uploaded: meta.get(o.video_id)?.created_at ?? null, seconds: meta.get(o.video_id)?.duration_s ?? null, ai: o.review_ai?.state === 'done' ? (o.review_ai.needsPerson ? 'Requires review' : 'Clear') : null, reasons: o.review_ai?.reasons ?? [], approvedAt: o.state === 'live' ? o.reviewed_at : null, transcript: o.transcript ?? null });
      if (o.hello_video_id) videos.push({ id: o.hello_video_id, where: `${o.title} · hello`, offerId: o.id, url: mediaRef(o.hello_video_id), uploaded: meta.get(o.hello_video_id)?.created_at ?? null, seconds: meta.get(o.hello_video_id)?.duration_s ?? null, ai: null, transcript: null });
    }
    res.json({ profile: { name: h.name, town: h.location_label, photo: mediaRef(h.photo_id), line: h.intro_text ?? null }, videos });
  } catch (err) { next(err); }
});

router.get('/hosts/:id/reviews', requires('view_hosting'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `select r.id, r.created_at, r.stars, r.text, r.reply, r.hidden, o.title, o.id as offer_id, hh.name as household
         from host_reviews r join host_offers o on o.id = r.offer_id join households hh on hh.id = r.household_id
        where r.host_id = $1 and r.side = 'guest' order by r.created_at desc limit 500`,
      [req.params.id],
    );
    res.json({ rows: rows.map((r) => ({ id: r.id, date: ymd(r.created_at), event: r.title, offerId: r.offer_id, household: r.household, rating: r.stars, review: r.text, reply: r.reply, shown: !r.hidden })), capped: rows.length === 500 });
  } catch (err) { next(err); }
});

router.post('/reviews/:id/shown', requires('manage_hosting'), async (req, res, next) => {
  try {
    const shown = req.body?.shown !== false;
    const { rows: [r] } = await query('update host_reviews set hidden = $2 where id = $1 returning id', [req.params.id, !shown]);
    if (!r) throw refuse(404, 'not_found', 'No such review.');
    await logChange({ subjectKind: 'review', subjectId: r.id, field: 'shown', after: { shown }, by: by(), byLabel: 'staff' });
    res.json({ shown });
  } catch (err) { next(err); }
});

router.post('/hosts/:id/pause', requires('manage_hosting'), async (req, res, next) => {
  try {
    const paused = req.body?.paused === true;
    const { rows: [h] } = await query('update hosts set paused = $2, paused_at = case when $2 then now() else null end where id = $1 returning id', [req.params.id, paused]);
    if (!h) throw refuse(404, 'not_found', 'No such host.');
    await logChange({ subjectKind: 'host', subjectId: h.id, field: 'paused', after: { paused }, why: req.body?.why ?? null, by: by(), byLabel: 'staff' });
    res.json({ paused });
  } catch (err) { next(err); }
});

/** Override a host's fee: the owner, personally, with a reason. Bookings made after it only. */
router.post('/hosts/:id/fee-override', requireOwnerSignedIn('override a host’s fee'), async (req, res, next) => {
  try {
    const pct = req.body?.pct == null ? null : Number(req.body.pct);
    if (pct != null && !(Number.isFinite(pct) && pct >= 0 && pct <= 100)) throw refuse(400, 'pct', 'A percentage, 0 to 100, or none.');
    const why = typeof req.body?.why === 'string' ? req.body.why.trim().slice(0, 500) : '';
    if (!why) throw refuse(400, 'why', 'Say why.');
    const { rows: [before] } = await query('select fee_override_pct from hosts where id = $1', [req.params.id]);
    if (!before) throw refuse(404, 'not_found', 'No such host.');
    await query('update hosts set fee_override_pct = $2 where id = $1', [req.params.id, pct]);
    await logChange({ subjectKind: 'host', subjectId: req.params.id, field: 'fee_override_pct', before: { pct: before.fee_override_pct }, after: { pct }, why, by: by(), byLabel: 'staff', approvalId: UUID.test(String(req.body?.approvalId ?? '')) ? req.body.approvalId : null });
    res.json({ pct });
  } catch (err) { next(err); }
});

/** Remove a host: refused while any booking or payout is outstanding (handover §5). */
router.post('/hosts/:id/remove', requireOwnerSignedIn('remove a host'), async (req, res, next) => {
  try {
    const why = typeof req.body?.why === 'string' ? req.body.why.trim().slice(0, 500) : '';
    if (!why) throw refuse(400, 'why', 'Say why.');
    const out = await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-intro:${req.params.id}`]);
      const { rows: [o] } = await c.query(
        `select (select count(*) from experience_bookings where host_id = $1 and state in ('pending', 'confirmed'))::int as bookings,
                (select count(*) from host_payouts where host_id = $1 and state in ('scheduled', 'held', 'released'))::int as payouts`, [req.params.id],
      );
      if (o.bookings || o.payouts) return { refused: o };
      const { rowCount } = await c.query(`update hosts set stopped_at = now(), paused = true where id = $1`, [req.params.id]);
      if (!rowCount) throw refuse(404, 'not_found', 'No such host.');
      await c.query(`update host_offers set state = 'ended' where host_id = $1 and state in ('live', 'paused', 'approved', 'in_review')`, [req.params.id]);
      await logChange({ subjectKind: 'host', subjectId: req.params.id, field: 'removed', after: { removed: true }, why, by: by(), byLabel: 'staff' }, c);
      return { removed: true };
    });
    if (out.refused) throw refuse(409, 'outstanding', `Not while ${out.refused.bookings} bookings and ${out.refused.payouts} payouts are outstanding.`);
    res.json(out);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Events — BO8e, BO8f, BO8g
// ---------------------------------------------------------------------------

router.get('/events', requires('view_hosting'), async (req, res, next) => {
  try {
    const kind = kindOf(req.query.kind);
    const vis = req.query.visibility === 'public' ? 'public' : req.query.visibility === 'private' ? 'invite' : null;
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim().toLowerCase()}%` : null;
    const { rows } = await query(
      `select o.id, o.title, o.lane, o.state, o.visibility, o.min_count, o.max_count, o.price_mode, o.called_off_at, h.name as host,
              (select min(s.decides_at) from offer_sessions s where s.offer_id = o.id and s.state = 'scheduled' and s.decided_outcome is null) as decides_at,
              (select min(s.on_date) from offer_sessions s where s.offer_id = o.id and s.state = 'scheduled' and s.on_date >= current_date) as next_date,
              coalesce((select sum(b.heads) from experience_bookings b where b.offer_id = o.id and b.state in ('pending', 'confirmed')), 0)::int as booked
         from host_offers o join hosts h on h.id = o.host_id
        where o.lane is not null and o.state <> 'draft' and ($1::text is null or o.lane = $1) and ($2::text is null or o.visibility = $2)
          and ($3::text is null or lower(o.title || ' ' || h.name) like $3) and ($4::text is null or o.state = $4)
        order by decides_at asc nulls last, next_date asc nulls last limit 1000`,
      [kind, vis, q, typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null],
    );
    const { rows: drafts } = await query(`select lane, draft_step, count(*)::int as n from host_offers where state = 'draft' and lane is not null group by 1, 2`);
    const byStep = {};
    for (const k of KINDS) byStep[k] = (SEQ[k] ?? []).map((step) => ({ step, n: drafts.find((d) => d.lane === k && d.draft_step === step)?.n ?? 0 }));
    res.json({
      rows: rows.map((e) => ({ id: e.id, title: e.title, host: e.host, kind: e.visibility === 'public' ? e.lane : null, lane: e.lane, state: e.called_off_at ? 'called_off' : e.state, visibility: e.visibility === 'public' ? 'Public' : 'Private', booked: e.booked, min: e.min_count, max: e.max_count, decidesBy: ymd(e.decides_at), next: ymd(e.next_date), priceMode: e.price_mode })),
      draftsByStep: byStep, capped: rows.length === 1000,
    });
  } catch (err) { next(err); }
});

router.get('/events/:id', requires('view_hosting'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) throw refuse(404, 'not_found', 'No such event.');
    const o = await repo.offerById(req.params.id);
    if (!o || !o.lane) throw refuse(404, 'not_found', 'No such event.');
    const host = await repo.hostById(o.host_id);
    const s = await settingsRepo.current();
    const { rows: sessions } = await query(
      `select s.*, coalesce((select sum(b.heads) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id where bs.session_id = s.id and bs.state = 'booked' and b.state in ('pending', 'confirmed', 'attended')), 0)::int as booked,
              (select count(*) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id where bs.session_id = s.id and b.confirmed_happened = 'yes')::int as confirmed_by,
              (select p.state from host_payouts p where p.session_id = s.id) as payout_state
         from offer_sessions s where s.offer_id = $1 order by s.on_date, s.starts_at`, [o.id],
    );
    const { rows: refunds } = await query(
      `select p.amount_pence, p.cause, p.state, p.stripe_ref, p.stripe_match, p.created_at, hh.name as household, b.heads
         from hosting_payments p join experience_bookings b on b.id = p.booking_id join households hh on hh.id = b.household_id
        where p.offer_id = $1 and p.kind in ('refund', 'release') order by p.created_at`, [o.id],
    );
    const { rows: [money] } = await query(`select coalesce(sum(charged_pence), 0)::int as held, count(*)::int as bookings from experience_bookings where offer_id = $1 and payment_state in ('charged', 'partially_refunded')`, [o.id]);
    const numbers = o.price_mode === 'by_numbers' && o.total_pence && o.min_count
      ? (() => { const heads = sessions[0]?.booked ?? 0; const paidEach = Math.ceil(o.total_pence / o.min_count); const nowEach = Math.ceil(o.total_pence / Math.max(heads, o.min_count)); return { priceNowEach: nowEach, heldFromEach: paidEach, dueBackPence: (paidEach - nowEach) * heads }; })()
      : null;
    res.json({
      event: { id: o.id, title: o.title, host: host?.name, hostId: o.host_id, kind: o.lane, state: o.called_off_at ? 'called_off' : o.state, visibility: o.visibility, min: o.min_count, max: o.max_count, priceMode: o.price_mode, pricePence: o.price_pence, totalPence: o.total_pence, refundPolicy: o.refund_policy, heldPence: money.held, bookings: money.bookings },
      numbers,
      hostIsPaid: typeof s.payout_release === 'number' ? { hours: s.payout_release, earlyOnConfirm: s.payout_early_on_confirm === true } : null,
      sessions: sessions.map((x) => ({ id: x.id, n: x.n, date: ymd(x.on_date), time: hm(x.starts_at), booked: x.booked, state: x.state, decided: x.decided_outcome, decidesAt: x.decides_at, confirmedBy: x.confirmed_by, payout: x.payout_state ?? null, late: x.late })),
      refunds: refunds.map((r) => ({ household: r.household, heads: r.heads, pence: r.amount_pence, cause: r.cause, state: r.state, stripe: r.stripe_ref ? r.stripe_match : null, at: r.created_at })),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Money — BO8h, BO8i, BO8j
// ---------------------------------------------------------------------------

function periodOf(qry) {
  const month = /^\d{4}-\d{2}$/.test(String(qry.month ?? '')) ? qry.month : localDay(new Date()).slice(0, 7);
  if (qry.period === '30d') { const to = new Date(); return { from: new Date(to.getTime() - 30 * 86_400_000), to, label: 'Last 30 days' }; }
  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return { from, to, label: month };
}

router.get('/money/streams', requires('view_hosting'), async (req, res, next) => {
  try {
    const { from, to, label } = periodOf(req.query);
    const kind = kindOf(req.query.kind);
    const { rows: b } = await query(
      // Net of what has gone back: each booking less its refunds, Epic's and the host's parts as they were returned (Codex, 2 Oct 2026).
      `select b.fee_reason, o.visibility, count(*)::int as n,
              coalesce(sum(b.value_pence - coalesce(r.amount, 0)), 0)::int as value,
              coalesce(sum(b.fee_pence - coalesce(r.epic, 0)), 0)::int as epic,
              coalesce(sum(b.host_pence - coalesce(r.host, 0)), 0)::int as host
         from experience_bookings b join host_offers o on o.id = b.offer_id
         left join lateral (select sum(p.amount_pence)::int as amount, sum(coalesce(p.epic_pence, 0))::int as epic, sum(coalesce(p.host_pence, 0))::int as host
                              from hosting_payments p where p.booking_id = b.id and p.kind = 'refund' and p.state in ('pending', 'succeeded')) r on true
        where b.payment_state in ('charged', 'partially_refunded', 'refunded') and b.created_at >= $1 and b.created_at < $2 and ($3::text is null or o.lane = $3)
        group by 1, 2`,
      [from, to, kind],
    );
    const { rows: p } = await query(
      `select kind, count(*)::int as n, coalesce(sum(amount_pence), 0)::int as value, coalesce(sum(epic_pence), 0)::int as epic, coalesce(sum(host_pence), 0)::int as host
         from hosting_payments where state = 'succeeded' and kind in ('private_fee', 'pro', 'tip') and created_at >= $1 and created_at < $2 group by 1`,
      [from, to],
    );
    const pub = b.filter((x) => x.visibility === 'public');
    const sum = (rows, k) => rows.reduce((t, x) => t + x[k], 0);
    const pubValue = sum(pub, 'value');
    const row = (key, name, rows, rate) => ({ key, stream: name, bookingValuePence: rows.length ? sum(rows, 'value') : null, ratePct: rate, count: sum(rows, 'n'), epicPence: sum(rows, 'epic'), toHostsPence: sum(rows, 'host') });
    const streams = [
      row('public', 'Public commission', pub.filter((x) => ['standard', 'override', 'minimum'].includes(x.fee_reason)), pubValue ? Math.round((sum(pub, 'epic') / pubValue) * 1000) / 10 : null),
      row('host_link', 'Host-link bookings', pub.filter((x) => x.fee_reason === 'host_link'), typeof (await settingsRepo.current()).host_link_rate === 'number' ? (await settingsRepo.current()).host_link_rate : null),
      row('intro', 'Intro 0%', pub.filter((x) => x.fee_reason === 'intro'), 0),
      row('private_payment', 'Private payment fee', b.filter((x) => x.fee_reason === 'private_payment'), (await settingsRepo.current()).private_payment_fee ?? null),
      { key: 'private_fee', stream: 'Private event fee', bookingValuePence: null, ratePct: null, count: p.find((x) => x.kind === 'private_fee')?.n ?? 0, epicPence: p.find((x) => x.kind === 'private_fee')?.epic ?? 0, toHostsPence: 0 },
      { key: 'pro', stream: 'Pro', bookingValuePence: null, ratePct: null, count: p.find((x) => x.kind === 'pro')?.n ?? 0, epicPence: p.find((x) => x.kind === 'pro')?.value ?? 0, toHostsPence: 0 },
      { key: 'tips', stream: 'Tip admin fees', bookingValuePence: p.find((x) => x.kind === 'tip')?.value ?? null, ratePct: null, count: p.find((x) => x.kind === 'tip')?.n ?? 0, epicPence: p.find((x) => x.kind === 'tip')?.epic ?? 0, toHostsPence: p.find((x) => x.kind === 'tip')?.host ?? 0 },
    ];
    const total = { epicPence: streams.reduce((t, x) => t + x.epicPence, 0), toHostsPence: streams.reduce((t, x) => t + x.toHostsPence, 0), count: streams.reduce((t, x) => t + x.count, 0) };
    const s = await settingsRepo.current();
    const { rows: [rec] } = await query('select ran_at, checked, mismatched from stripe_reconciliations order by ran_at desc limit 1');
    res.json({ period: label, streams, total, guaranteePool: s.guarantee_pool == null ? null : { pence: s.guarantee_pool }, reconciliation: rec ? { ranAt: rec.ran_at, checked: rec.checked, mismatched: rec.mismatched } : null });
  } catch (err) { next(err); }
});

router.get('/money/ledger', requires('view_hosting'), async (req, res, next) => {
  try {
    const { from, to } = periodOf(req.query);
    const type = typeof req.query.type === 'string' && /^[a-z_]{2,20}$/.test(req.query.type) ? req.query.type : null;
    const { rows } = await query(
      `select p.*, o.title from hosting_payments p left join host_offers o on o.id = p.offer_id
        where p.created_at >= $1 and p.created_at < $2 and ($3::text is null or p.kind = $3)
        order by (p.stripe_match = 'mismatch') desc, p.created_at desc limit 1000`,
      [from, to, type],
    );
    res.json({
      rows: rows.map((r) => ({ id: r.id, when: r.created_at, type: r.kind, event: r.title, bookingId: r.booking_id, ratePct: r.rate_pct == null ? null : Number(r.rate_pct), epicPence: r.epic_pence, toHostPence: r.host_pence, amountPence: r.amount_pence, reason: r.cause ?? r.reason, state: r.state, stripe: r.stripe_ref ? r.stripe_match : null })),
      capped: rows.length === 1000,
    });
  } catch (err) { next(err); }
});

router.get('/money/payouts', requires('view_hosting'), async (_req, res, next) => {
  try {
    const { rows: payouts } = await query(
      `select p.*, h.name as host, o.title,
              exists (select 1 from booking_sessions bs join experience_bookings b on b.id = bs.booking_id where bs.session_id = p.session_id and b.confirmed_happened = 'yes') as confirmed
         from host_payouts p join hosts h on h.id = p.host_id left join host_offers o on o.id = p.offer_id
        where p.state in ('scheduled', 'held', 'failed') order by p.release_at limit 500`,
    );
    const { rows: refunds } = await query(`select cause, state, count(*)::int as n, coalesce(sum(amount_pence), 0)::int as pence from hosting_payments where kind = 'refund' and created_at > now() - interval '30 days' group by 1, 2 order by 1`);
    const { rows: holds } = await query(
      `select b.id, b.held_pence, b.respond_by, o.title, h.name as host, hh.name as household
         from experience_bookings b join host_offers o on o.id = b.offer_id join hosts h on h.id = b.host_id join households hh on hh.id = b.household_id
        where b.request_state = 'asked' and b.payment_state = 'held' order by b.respond_by`,
    );
    const pay = (p) => ({ id: p.id, host: p.host, event: p.title, pence: p.amount_pence + p.tips_pence, releaseAt: p.release_at, state: p.state, holdReason: p.hold_reason });
    res.json({
      waitingForConfirmation: payouts.filter((p) => p.state === 'scheduled' && !p.confirmed).map(pay),
      held: payouts.filter((p) => p.state === 'held').map(pay),
      failed: payouts.filter((p) => p.state === 'failed').map(pay),
      refundsByCause: refunds.map((r) => ({ cause: r.cause, state: r.state, count: r.n, pence: r.pence })),
      cardHolds: holds.map((h) => ({ bookingId: h.id, event: h.title, host: h.host, household: h.household, pence: h.held_pence, replyBy: h.respond_by })),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Safety — BO8k
// ---------------------------------------------------------------------------

router.get('/safety', requires('view_hosting'), async (_req, res, next) => {
  try {
    const s = await settingsRepo.current();
    const { rows: checked } = await query(
      `select h.id, h.name, h.checked_state, h.checked_on, h.insurance_expires,
              (select count(*) from host_offers o where o.host_id = h.id and o.parents = 'drop_off' and o.state in ('live', 'approved'))::int as drop_off_events
         from hosts h
        where exists (select 1 from host_offers o where o.host_id = h.id and o.state in ('live', 'approved', 'in_review') and (o.age_max < 18 or o.age_min is null))
          and (h.checked_state <> 'passed' or (h.insurance_expires is not null and h.insurance_expires < current_date + 30))`,
    );
    const t = s.rating_escalation;
    const ratings = [];
    if (t && typeof t.avgBelow === 'number') {
      const { rows } = await query(
        `select h.id, h.name, round(avg(r.stars)::numeric, 2)::float as avg, count(*)::int as n
           from host_reviews r join hosts h on h.id = r.host_id where r.side = 'guest' and not coalesce(r.hidden, false)
          group by h.id, h.name having avg(r.stars) < $1 and count(*) >= $2`, [t.avgBelow, t.minReviews ?? 1],
      );
      ratings.push(...rows);
    }
    const { rows: complaints } = await query(
      `select k.*, h.name as host, o.title, hh.name as household from hosting_complaints k left join hosts h on h.id = k.host_id
         left join host_offers o on o.id = k.offer_id left join households hh on hh.id = k.household_id
        where k.state = 'open' order by k.created_at`,
    );
    const { rows: incidents } = await query(
      `select i.*, h.name as host, o.title from session_incidents i left join hosts h on h.id = i.host_id left join host_offers o on o.id = i.offer_id order by i.created_at desc limit 200`,
    );
    res.json({
      checked: checked.map((h) => ({ hostId: h.id, host: h.name, state: h.checked_state, on: ymd(h.checked_on), insuranceExpires: ymd(h.insurance_expires), dropOffEvents: h.drop_off_events })),
      ratings: t ? ratings.map((r) => ({ hostId: r.id, host: r.name, avg: r.avg, reviews: r.n })) : null,
      ratingsReason: t ? null : 'Rating escalation thresholds are not set yet',
      complaints: complaints.filter((k) => k.kind !== 'host_no_show').map((k) => ({ id: k.id, kind: k.kind, host: k.host, event: k.title, household: k.household, reason: k.reason, at: k.created_at, autoPayLimit: s.claim_auto_pay_limit ?? null })),
      noShows: complaints.filter((k) => k.kind === 'host_no_show').map((k) => ({ id: k.id, host: k.host, event: k.title, household: k.household, at: k.created_at })),
      incidents: incidents.map((i) => ({ id: i.id, host: i.host, event: i.title, children: i.children ?? [], reporter: i.reporter, body: i.body, at: i.created_at })),
    });
  } catch (err) { next(err); }
});

router.post('/complaints/:id/resolve', requires('manage_hosting'), async (req, res, next) => {
  try {
    const state = ['resolved', 'declined'].includes(req.body?.state) ? req.body.state : null;
    if (!state) throw refuse(400, 'state', 'Resolved or declined.');
    const { rows: [k] } = await query(`update hosting_complaints set state = $2, resolved_at = now() where id = $1 and state = 'open' returning id`, [req.params.id, state]);
    if (!k) throw refuse(404, 'not_found', 'That complaint isn’t open.');
    await logChange({ subjectKind: 'complaint', subjectId: k.id, field: 'state', after: { state }, why: req.body?.why ?? null, by: by(), byLabel: 'staff' });
    res.json({ state });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Overview health — BO8m
// ---------------------------------------------------------------------------

router.get('/health', requires('view_hosting'), async (_req, res, next) => {
  try {
    const s = await settingsRepo.current();
    const windowH = typeof s.review_window === 'number' ? s.review_window : null;
    const { rows: [r] } = await query(
      `select (select count(*) from host_offers where state = 'in_review' and lane is not null)::int as in_review,
              (select count(*) from host_offers where state = 'in_review' and lane is not null and $1::int is not null and submitted_at < now() - make_interval(hours => $1::int))::int as overdue,
              (select count(*) from host_payouts where state = 'paid' and updated_at > now() - interval '30 days')::int as paid30,
              (select count(*) from host_payouts where state = 'paid' and updated_at > now() - interval '30 days' and updated_at <= release_at + interval '1 day')::int as on_time30,
              (select count(*) from hosting_payments where stripe_match = 'mismatch')::int as mismatches,
              (select count(*) from hosting_complaints where state = 'open')::int as complaints`,
      [windowH],
    );
    res.json({
      inReview: r.in_review, overdue: windowH == null ? null : r.overdue,
      payoutsOnTimePct: r.paid30 >= 5 ? Math.round((r.on_time30 / r.paid30) * 100) : null, payoutsOnTimeReason: r.paid30 >= 5 ? null : 'Fewer than five payouts in 30 days',
      stripeMismatches: r.mismatches, openComplaints: r.complaints,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Reports — BO8n, BO8o, BO8p
// ---------------------------------------------------------------------------

router.get('/reports/funnel', requires('view_hosting'), async (req, res, next) => {
  try {
    const vis = req.query.visibility === 'public' ? 'public' : req.query.visibility === 'private' ? 'invite' : null;
    const { rows } = await query(
      `select lane, coalesce(draft_source, 'typed') as route,
              count(*)::int as started,
              count(*) filter (where submitted_at is not null or state in ('live', 'approved', 'ended'))::int as sent,
              count(*) filter (where state in ('live', 'approved', 'ended') and published_at is not null)::int as live,
              count(*) filter (where exists (select 1 from experience_bookings b where b.offer_id = host_offers.id and b.state in ('confirmed', 'attended')))::int as booked
         from host_offers where lane is not null and ($1::text is null or visibility = $1)
          and ($2::date is null or created_at >= $2) and ($3::date is null or created_at < $3)
        group by 1, 2`,
      [vis, /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? '')) ? req.query.from : null, /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to ?? '')) ? req.query.to : null],
    );
    const sumBy = (key) => {
      const m = new Map();
      for (const r of rows) { const k = r[key]; const e = m.get(k) ?? { key: k, started: 0, sent: 0, live: 0, booked: 0 }; for (const f of ['started', 'sent', 'live', 'booked']) e[f] += r[f]; m.set(k, e); }
      return [...m.values()];
    };
    res.json({ byKind: sumBy('lane'), byRoute: sumBy('route') });
  } catch (err) { next(err); }
});

router.get('/reports/money', requires('view_hosting'), async (req, res, next) => {
  try {
    const kind = kindOf(req.query.kind);
    const { rows } = await query(
      `select to_char(date_trunc('month', b.created_at), 'YYYY-MM') as month, o.lane,
              coalesce(sum(b.value_pence), 0)::int as value, coalesce(sum(b.fee_pence), 0)::int as epic, coalesce(sum(b.host_pence), 0)::int as host, count(*)::int as n
         from experience_bookings b join host_offers o on o.id = b.offer_id
        where b.payment_state in ('charged', 'partially_refunded', 'refunded') and b.created_at > now() - interval '12 months' and ($1::text is null or o.lane = $1)
        group by 1, 2 order by 1`,
      [kind],
    );
    res.json({ rows });
  } catch (err) { next(err); }
});

/**
 * DAC7: per host, what guests paid (less refunds), Epic's fees and tips, for
 * a year. Masked on screen; producing the full file is the owner's,
 * personally (an Approval for anyone else), and is logged.
 */
async function dac7Rows(year) {
  const { rows } = await query(
    `select h.id, h.name, h.tax_reference, h.tax_address,
            coalesce(sum(case when p.kind = 'charge' then p.amount_pence when p.kind = 'refund' then -p.amount_pence end), 0)::int as consideration,
            coalesce(sum(case when p.kind = 'charge' then p.epic_pence when p.kind = 'refund' then -coalesce(p.epic_pence, 0) end), 0)::int as fees,
            coalesce(sum(case when p.kind = 'tip' then p.host_pence end), 0)::int as tips,
            count(*) filter (where p.kind = 'charge')::int as activities
       from hosting_payments p join hosts h on h.id = p.host_id
      where p.state = 'succeeded' and p.mode = $2 and p.created_at >= make_date($1, 1, 1) and p.created_at < make_date($1 + 1, 1, 1)
      group by h.id, h.name, h.tax_reference, h.tax_address order by h.name`,
    // The mode Stripe is in: test rows never count once Epic is live, and live rows never in test.
    [year, stripeMode() === 'live' ? 'live' : 'test'],
  );
  return rows;
}

router.get('/reports/dac7', requires('view_hosting'), async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const rows = await dac7Rows(year);
    res.json({ year, rows: rows.map((r) => ({ hostId: r.id, host: r.name, tax: mask(r.tax_reference), considerationPence: r.consideration, feesPence: r.fees, tipsPence: r.tips, activities: r.activities })) });
  } catch (err) { next(err); }
});

router.post('/reports/dac7', requireOwnerSignedIn('produce the DAC7 export'), async (req, res, next) => {
  try {
    const year = Number(req.body?.year);
    if (!Number.isInteger(year) || year < 2024 || year > 2100) throw refuse(400, 'year', 'Which year.');
    const rows = await dac7Rows(year);
    const cell = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [['Host', 'Tax reference', 'Address', 'Consideration (£)', 'Fees (£)', 'Tips (£)', 'Activities'].join(',')];
    for (const r of rows) lines.push([r.name, r.tax_reference, r.tax_address, (r.consideration / 100).toFixed(2), (r.fees / 100).toFixed(2), (r.tips / 100).toFixed(2), r.activities].map(cell).join(','));
    await logChange({ subjectKind: 'setting', subjectId: `dac7:${year}`, field: 'export', after: { year, hosts: rows.length }, why: 'DAC7 export produced', by: by(), byLabel: 'staff' });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="epic-dac7-${year}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

void localInstant;
export default router;
