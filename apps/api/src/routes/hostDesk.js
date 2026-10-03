/**
 * The Host tab for hosts who already host (hosting v4 — "Existing hosts",
 * E1–E13). Everything here reads the host's own rows; nothing is invented to
 * fill a tile. A figure with nothing behind it is 0 when it is a count, and
 * null with a reason when it is a judgement (CLAUDE.md: every diagnostic has
 * a can't-speak state).
 *
 *   GET  /api/host/desk                       E1 home: state, tiles, next up, earnings, status
 *   GET  /api/host/desk/todo                  E5
 *   GET  /api/host/desk/at-risk               E6
 *   GET  /api/host/desk/events                E7: live · helping with · drafts · finished
 *   GET  /api/host/desk/events/:id            E8: the event, its sessions, guests, waiting list, money
 *   POST /api/host/desk/events/:id/attendance E8: In / Out for a finished session (never releases a payout)
 *   POST /api/host/desk/events/:id/waitlist   E8: the switch
 *   POST /api/host/desk/events/:id/minimum    E6: lower the minimum (never on Depends on numbers)
 *   GET  /api/host/desk/earnings              E9: overview · payouts · statements
 *   GET  /api/host/desk/statements/:period.csv  E9: a month (YYYY-MM) or a year (YYYY), with the DAC7 lines
 *   GET  /api/host/desk/fees                  E10
 *   GET  /api/host/desk/reviews               E11; POST reviews/:id/reply, reviews/:id/report
 *   GET  /api/host/desk/insights              E12
 *   GET  /api/host/desk/profile               E13; PATCH profile (goal, notifications), pause, stop,
 *                                             co-hosts, automatic messages, quick replies, incidents
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import * as repo from '../repositories/hosting.js';
import * as settingsRepo from '../repositories/hostingSettings.js';
import { logChange } from '../repositories/hostingSettings.js';
import { currentAccount } from '../context.js';
import { currentHousehold } from './household.js';
import {
  hostState, draftProgress, sessionChip, CHIP_WORDS, groupTodo, lastMonths, changePct, standingOf,
  responseMinutes, responseWords, movesBack, ladderLine, phoneVisible, paymentWords, cohostView, gbpWords, dayWords, monthName,
} from '../domain/hostDesk.js';
import { ladderProgress, feeWords, introState } from '../domain/money.js';
import { localInstant, localDay, SEQ } from '../domain/lanes.js';
import { bookingHostShare, shareForSession } from '../repositories/hostingLedger.js';
import { mediaRef } from './hosting.js';
import * as notifications from '../repositories/notifications.js';

export const router = Router();

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const tzOf = (o) => o?.time_zone ?? 'Europe/London';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const appUrl = () => (process.env.EPIC_APP_URL || process.env.APP_URL || 'https://epic.day').replace(/\/$/, '');

const startOf = (s, o) => localInstant(ymd(s.on_date), hm(s.starts_at) ?? '00:00', tzOf(o));
const endOf = (s, o) => localInstant(ymd(s.ends_on ?? s.on_date), hm(s.ends_at) ?? hm(s.starts_at) ?? '23:59', tzOf(o));

/** The signed-in household's host, or a 404 in plain words. */
async function me({ hostOptional = false } = {}) {
  const household = await currentHousehold();
  const host = await repo.hostByHousehold(household.id);
  // A co-host need not host anything of their own (Codex, 2 Oct 2026).
  if (!host && !hostOptional) throw refuse(404, 'not_a_host', 'You are not hosting yet.');
  return { household, host, account: currentAccount() };
}

/** The host's lane offers with their sessions and booked heads. */
async function offersWithSessions(hostId) {
  const { rows: offers } = await query(
    `select * from host_offers where host_id = $1 and lane is not null order by updated_at desc`, [hostId],
  );
  const ids = offers.map((o) => o.id);
  const { rows: sessions } = ids.length ? await query(
    `select s.*,
            coalesce((select sum(b.heads) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                       where bs.session_id = s.id and bs.state = 'booked' and b.state in ('pending', 'confirmed', 'attended')), 0)::int as booked
       from offer_sessions s where s.offer_id = any($1::uuid[]) order by s.on_date, s.starts_at nulls first`,
    [ids],
  ) : { rows: [] };
  const by = new Map(offers.map((o) => [o.id, []]));
  for (const s of sessions) by.get(s.offer_id)?.push(s);
  return offers.map((o) => ({ ...o, sessionsList: by.get(o.id) ?? [] }));
}

/** Events the host co-hosts for somebody else, by their account. */
async function helpingWith(accountId) {
  if (!accountId) return [];
  const { rows } = await query(
    `select o.*, c.sees_guests, c.can_message, c.can_see_money, c.role as cohost_role, h.name as owner_name
       from offer_cohosts c join host_offers o on o.id = c.offer_id join hosts h on h.id = o.host_id
      where c.account_id = $1 and c.accepted_at is not null and o.state <> 'draft'`,
    [accountId],
  );
  return rows;
}

const nextSessionOf = (o, now) => o.sessionsList.find((s) => s.state === 'scheduled' && endOf(s, o) > now) ?? null;

function sessionCard(o, s, now) {
  const chip = sessionChip({ offer: o, session: s, booked: s?.booked ?? 0, now, endsAt: s ? endOf(s, o) : null });
  return {
    offerId: o.id, sessionId: s?.id ?? null, title: o.title, lane: o.lane,
    date: s ? ymd(s.on_date) : null, time: s ? hm(s.starts_at) : null,
    booked: s?.booked ?? 0, max: s?.max_count ?? o.max_count ?? null, min: s?.min_count ?? o.min_count ?? null,
    underMin: Boolean((s?.min_count ?? o.min_count) && (s?.booked ?? 0) < (s?.min_count ?? o.min_count)),
    chip, chipWords: CHIP_WORDS[chip],
  };
}

// ---------------------------------------------------------------------------
// money, as the host sees it
// ---------------------------------------------------------------------------

/**
 * Every paid booking's host share, spread over the sessions it covers, each
 * with the session's date and whether it is ahead. What the host "earned" in
 * a month is the share of sessions held that month, plus tips paid that month.
 */
async function sharesOf(hostId) {
  const { rows } = await query(
    `select b.id, b.offer_id, b.charged_pence, b.refunded_pence, b.host_pence, b.fee_pence, b.fee_rate_pct, b.fee_reason, b.value_pence,
            b.via_host_link, b.source, b.created_at, b.household_id,
            o.title, o.time_zone,
            array(select bs.session_id::text from booking_sessions bs where bs.booking_id = b.id and bs.state in ('booked', 'forfeited')) as session_ids
       from experience_bookings b join host_offers o on o.id = b.offer_id
      where b.host_id = $1 and b.payment_state in ('charged', 'partially_refunded', 'refunded')`,
    [hostId],
  );
  const sessionIds = [...new Set(rows.flatMap((r) => r.session_ids))];
  const { rows: sessions } = sessionIds.length
    ? await query('select id, offer_id, on_date, starts_at, ends_at, ends_on from offer_sessions where id = any($1::uuid[])', [sessionIds])
    : { rows: [] };
  const sById = new Map(sessions.map((s) => [s.id, s]));
  const out = [];
  for (const b of rows) {
    const total = bookingHostShare(b);
    for (const sid of b.session_ids) {
      const s = sById.get(sid);
      if (!s) continue;
      out.push({ bookingId: b.id, offerId: b.offer_id, title: b.title, sessionId: sid, day: ymd(s.on_date), pence: shareForSession(total, b.session_ids, sid), endsAt: endOf(s, { time_zone: b.time_zone }) });
    }
  }
  return { shares: out, bookings: rows };
}

async function tipsOf(hostId) {
  const { rows } = await query(
    `select t.*, o.title from booking_tips t join host_offers o on o.id = t.offer_id where t.host_id = $1 and t.state = 'paid' order by t.created_at desc`, [hostId],
  );
  return rows;
}

const monthOf = (d, tz = 'Europe/London') => localDay(new Date(d), tz).slice(0, 7);

function earningsByMonth(shares, tips, months, now) {
  const by = Object.fromEntries(months.map((m) => [m, { bookings: 0, tips: 0 }]));
  for (const s of shares) {
    if (s.endsAt > now) continue;
    const m = s.day.slice(0, 7);
    if (by[m]) by[m].bookings += s.pence;
  }
  for (const t of tips) {
    const m = monthOf(t.created_at);
    if (by[m]) by[m].tips += t.amount_pence;
  }
  return months.map((m) => ({ month: m, bookingsPence: by[m].bookings, tipsPence: by[m].tips, pence: by[m].bookings + by[m].tips }));
}

// ---------------------------------------------------------------------------
// E1 · home
// ---------------------------------------------------------------------------

/** Topics on the host's events still waiting on them: the last word is not the host household's. */
async function waitingMessages(hostId, householdId) {
  const { rows: [r] } = await query(
    `select count(*)::int as n
       from chat_topics t join host_offers o on o.id = t.context_id and t.context_type = 'offer'
      where o.host_id = $1 and t.state <> 'notice'
        and coalesce(
              (select m.household_id from chat_replies r left join members m on m.id = r.author_member_id where r.topic_id = t.id order by r.created_at desc limit 1),
              (select m2.household_id from members m2 where m2.id = t.author_member_id)
            ) is distinct from $2`,
    [hostId, householdId],
  );
  return r?.n ?? 0;
}

async function ratingNow(hostId) {
  const [rating, rated] = await Promise.all([repo.ratingOf(hostId), repo.ratedEventsOf(hostId)]);
  return { avg: rating.rating, count: rating.count, ratedEvents: rated.ratedEvents, ratedAvg: rated.avg };
}

async function responseTime(hostId, householdId) {
  const { rows } = await query(
    `select extract(epoch from (min(r.created_at) - t.created_at)) / 60 as gap
       from chat_topics t join host_offers o on o.id = t.context_id and t.context_type = 'offer'
       join chat_replies r on r.topic_id = t.id join members m on m.id = r.author_member_id and m.household_id = $2
      where o.host_id = $1 and t.created_at > now() - interval '90 days'
      group by t.id, t.created_at`,
    [hostId, householdId],
  );
  return responseMinutes(rows.map((r) => Number(r.gap)));
}

async function standingFor(host, rating, s) {
  const { rows: [r] } = await query(
    `select (select count(*) from offer_sessions x join host_offers o on o.id = x.offer_id where o.host_id = $1 and x.late and x.created_at > now() - interval '90 days')::int as late,
            (select count(*) from hosting_complaints k where k.host_id = $1 and k.state = 'open')::int as complaints`,
    [host.id],
  );
  return standingOf({ thresholds: s.rating_escalation, avg: rating.ratedAvg, ratedEvents: rating.ratedEvents, lateChanges90d: r.late, openComplaints: r.complaints });
}

router.get('/host/desk', async (_req, res, next) => {
  try {
    const { household, host, account } = await me({ hostOptional: true });
    // A co-host who hosts nothing of their own gets 4e, with a way into the events they help with (Codex, 2 Oct 2026).
    if (!host) return res.json({ home: '4e', helping: (await helpingWith(account?.id)).length });
    const now = new Date();
    const s = await settingsRepo.current();
    const offers = await offersWithSessions(host.id);
    const helping = await helpingWith(account?.id);
    if (!offers.length && !helping.length) return res.json({ home: '4e' });
    const upcoming = offers.flatMap((o) => (o.state === 'draft' ? [] : o.sessionsList.filter((x) => x.state === 'scheduled' && endOf(x, o) > now).map((x) => ({ o, x }))))
      .sort((a, b) => startOf(a.x, a.o) - startOf(b.x, b.o));
    const state = hostState({ offers, upcomingSessions: upcoming.length });
    const rating = await ratingNow(host.id);
    const [messages, todo, atRisk] = await Promise.all([waitingMessages(host.id, household.id), todoItems(host, household, offers, now, s), atRiskEvents(offers, now)]);
    const { rows: [rev] } = await query(
      `select (select count(*) from host_reviews where host_id = $1 and side = 'guest' and not hidden and publish_on <= current_date and publish_on > current_date - 7)::int as new_reviews,
              (select count(*) from booking_tips where host_id = $1 and state = 'paid' and created_at > now() - interval '7 days')::int as new_tips`,
      [host.id],
    );
    const draft = offers.find((o) => o.state === 'draft');
    let party = null;
    if (state === 'private_free' || state === 'private_paid') {
      const p = upcoming.find((u) => u.o.visibility !== 'public');
      if (p) {
        const invites = await repo.invitesOf(p.o.id);
        party = {
          offerId: p.o.id, title: p.o.title, photo: mediaRef(p.o.photo_ids?.[0]), date: ymd(p.x.on_date), time: hm(p.x.starts_at),
          coming: invites.filter((i) => i.rsvp === 'yes').reduce((n, i) => n + (i.rsvp_heads ?? i.heads ?? 1), 0),
          cantCome: invites.filter((i) => i.rsvp === 'no').length,
          noReply: invites.filter((i) => !i.rsvp).length,
        };
      }
    }
    let earnings = null;
    if (state !== 'private_free') {
      const month = localDay(now).slice(0, 7);
      const months = lastMonths(month, 6);
      const { shares } = await sharesOf(host.id);
      const tips = await tipsOf(host.id);
      const bars = earningsByMonth(shares, tips, months, now);
      const cur = bars.at(-1).pence;
      const prev = bars.at(-2).pence;
      const { rows: [due] } = await query(
        `select amount_pence + tips_pence as pence, release_at from host_payouts where host_id = $1 and state in ('scheduled', 'held') order by release_at limit 1`, [host.id],
      );
      earnings = {
        month, pence: cur, changePct: changePct(cur, prev), prevMonth: months.at(-2), bars: bars.map((b) => ({ month: b.month, pence: b.pence })),
        goalPence: host.earnings_goal_pence ?? null,
        due: due ? { pence: due.pence, on: ymd(due.release_at) } : null,
        bookedAheadPence: shares.filter((x) => x.endsAt > now).reduce((n, x) => n + x.pence, 0),
      };
    }
    const progress = ladderProgress(s.public_commission, { ratedEvents: rating.ratedEvents, avg: rating.ratedAvg });
    const intro = introState(s.intro_zero, { hostStartedAt: host.created_at, bookingsSoFar: await introUsed(host.id), now });
    const status = state === 'busy' || state === 'quiet'
      ? { feePct: intro.active ? 0 : progress?.rate ?? null, intro: intro.active, line: intro.active ? `0% · intro, ${intro.bookingsLeft} ${intro.bookingsLeft === 1 ? 'booking' : 'bookings'} left` : ladderLine(progress), progress, rating: rating.avg, standing: await standingFor(host, rating, s) }
      : { private: true, eventPence: s.private_event_fee ?? null, proPence: s.pro_monthly ?? null, paymentFeePct: state === 'private_paid' ? s.private_payment_fee ?? null : null, rating: rating.avg, standing: await standingFor(host, rating, s) };
    res.json({
      home: 'desk', state,
      host: { id: host.id, name: host.name, photo: mediaRef(host.photo_id) },
      tiles: { messages, todo: todo.length, atRisk: atRisk.filter((a) => !a.calledOff).length, reviews: { avg: rating.avg, count: rating.count, newReviews: rev.new_reviews, newTips: rev.new_tips } },
      nextUp: upcoming.length ? { first: sessionCard(upcoming[0].o, upcoming[0].x, now), more: upcoming.slice(1, 4).map((u) => sessionCard(u.o, u.x, now)) } : null,
      draft: state === 'quiet' && draft ? { offerId: draft.id, title: draft.title, lane: draft.lane, ...draftProgress(draft) } : null,
      party, earnings, status,
    });
  } catch (err) { next(err); }
});

async function introUsed(hostId) {
  const { rows: [r] } = await query(`select count(*)::int as n from experience_bookings where host_id = $1 and (intro_ordinal is not null or (fee_reason = 'intro' and coalesce(cancel_cause, '') not in ('unpaid', 'payment_setup_failed', 'payment_failed')))`, [hostId]);
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// E5 · to do
// ---------------------------------------------------------------------------

async function todoItems(host, household, offers, now, s) {
  const items = [];
  const ids = offers.map((o) => o.id);
  const title = new Map(offers.map((o) => [o.id, o.title]));
  if (ids.length) {
    const { rows: asks } = await query(
      `select b.id, b.offer_id, b.respond_by, h.name as household from experience_bookings b join households h on h.id = b.household_id
        where b.offer_id = any($1::uuid[]) and b.request_state = 'asked' and b.state = 'pending'
          and (coalesce(b.value_pence, 0) = 0 or b.payment_state = 'held')`, [ids],
    );
    for (const a of asks) items.push({ kind: 'ask_to_book', title: 'Reply to ask to book', line: `${a.household} · ${title.get(a.offer_id)}`, due: a.respond_by, blocking: true, offerId: a.offer_id, ref: a.id });
    const { rows: qs } = await query(
      `select t.id, t.context_id, t.created_at, coalesce(m.name, 'Someone') as who
         from chat_topics t left join members m on m.id = t.author_member_id
        where t.context_type = 'offer' and t.context_id = any($1::uuid[]) and t.state = 'open'
          and not exists (select 1 from chat_replies r join members rm on rm.id = r.author_member_id where r.topic_id = t.id and rm.household_id = $2)`,
      [ids, household.id],
    );
    for (const q of qs) items.push({ kind: 'question', title: 'Answer a question', line: `${q.who} · ${title.get(q.context_id)}`, due: new Date(new Date(q.created_at).getTime() + 24 * 3_600_000), asked: q.created_at, offerId: q.context_id, ref: q.id });
  }
  for (const o of offers) {
    for (const x of o.sessionsList) {
      const end = endOf(x, o);
      if (end > now || now - end > 7 * 86_400_000 || !x.booked) continue;
      const { rows: [m] } = await query('select count(*)::int as n from session_attendance where session_id = $1', [x.id]);
      if (!m.n) items.push({ kind: 'attendance', title: 'Mark attendance', line: `${o.title} · ${dayWords(ymd(x.on_date))} · records no-shows`, due: new Date(end.getTime() + 2 * 86_400_000), offerId: o.id, ref: x.id });
    }
    if (o.state === 'draft' && o.review_note && o.submitted_at) items.push({ kind: 'changes', title: 'Changes requested', line: `${o.title} · ${String(o.review_note).slice(0, 80)}`, due: null, offerId: o.id });
    else if (o.state === 'draft') {
      const p = draftProgress(o);
      items.push({ kind: 'draft', title: 'Finish your draft', line: `${o.title ?? 'Untitled'} · ${p ? p.words.toLowerCase() : 'not started'}`, due: null, offerId: o.id });
    }
  }
  const paidThroughEpic = offers.some((o) => o.state !== 'draft' && o.price_mode && o.price_mode !== 'free' && (o.money ?? 'epic') === 'epic');
  if (paidThroughEpic && !host.tax_reference) items.push({ kind: 'tax', title: 'Add tax details', line: 'Payouts held until tax details are added', now: true, blocking: true });
  if (paidThroughEpic && host.payouts_state !== 'ready') items.push({ kind: 'payouts', title: 'Set up payouts', line: 'Payouts held until Stripe has what it needs', now: true, blocking: true });
  if (host.insurance_expires) {
    const exp = new Date(`${ymd(host.insurance_expires)}T12:00:00Z`);
    if (exp - now < 30 * 86_400_000) items.push({ kind: 'insurance', title: exp < now ? 'Insurance has ended' : 'Insurance ends', line: 'Events that need it pause if it lapses', due: exp, blocking: exp < now });
  }
  if (host.checked_on && typeof s.dbs_age === 'number') {
    const exp = new Date(`${ymd(host.checked_on)}T12:00:00Z`);
    exp.setUTCMonth(exp.getUTCMonth() + s.dbs_age);
    if (exp - now < 30 * 86_400_000) items.push({ kind: 'checked', title: 'Checked needs renewing', line: 'Events with children pause without it', due: exp, blocking: exp < now });
  }
  return items;
}

const todoPayload = (it) => ({ kind: it.kind, title: it.title, line: it.line, due: it.due ? new Date(it.due).toISOString() : null, asked: it.asked ? new Date(it.asked).toISOString() : null, now: Boolean(it.now), red: it.red, offerId: it.offerId ?? null, ref: it.ref ?? null });

router.get('/host/desk/todo', async (_req, res, next) => {
  try {
    const { household, host } = await me();
    const now = new Date();
    const s = await settingsRepo.current();
    const items = await todoItems(host, household, await offersWithSessions(host.id), now, s);
    const g = groupTodo(items, now);
    res.json({ today: g.today.map(todoPayload), week: g.week.map(todoPayload), soon: g.soon.map(todoPayload) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// E6 · at risk
// ---------------------------------------------------------------------------

async function atRiskEvents(offers, now, { days = 14 } = {}) {
  const out = [];
  for (const o of offers) {
    if (o.state === 'draft') continue;
    const groups = o.lane === 'weekly' ? o.sessionsList.map((x) => [x]) : [o.sessionsList];
    for (const g of groups) {
      const first = g.find((x) => x.state === 'scheduled' && !x.decided_outcome && x.decides_at);
      const min = Number(first?.min_count ?? o.min_count ?? 0);
      if (!first || !min) continue;
      const decides = new Date(first.decides_at);
      if (decides < now || decides - now > days * 86_400_000 || first.booked >= min) continue;
      const { rows: [paid] } = await query(
        `select coalesce(sum(b.charged_pence - b.refunded_pence), 0)::int as pence, count(*)::int as n
           from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
          where bs.session_id = $1 and bs.state = 'booked' and b.state in ('pending', 'confirmed') and b.payment_state in ('charged', 'partially_refunded')`,
        [first.id],
      );
      out.push({
        offerId: o.id, sessionId: first.id, title: o.title, lane: o.lane, booked: first.booked, min, max: first.max_count ?? o.max_count ?? null, decidesOn: ymd(localDay(decides, tzOf(o))),
        refundPence: paid.pence, bookings: paid.n, byNumbers: o.price_mode === 'by_numbers', calledOff: false,
        line: `Under ${min} on ${dayWords(localDay(decides, tzOf(o)))}: called off, and the ${first.booked} booked get ${gbpWords(paid.pence)} back in full`,
      });
    }
  }
  return out;
}

router.get('/host/desk/at-risk', async (_req, res, next) => {
  try {
    const { host } = await me();
    const now = new Date();
    const offers = await offersWithSessions(host.id);
    const risk = await atRiskEvents(offers, now);
    // Called off in the last 30 days, with the refunds made.
    const { rows: off } = await query(
      `select o.id, o.title, o.lane, s.called_off_at, s.id as session_id, coalesce(s.max_count, o.max_count) as max,
              (select coalesce(sum(b.heads), 0) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id where bs.session_id = s.id)::int as booked
         from offer_sessions s join host_offers o on o.id = s.offer_id
        where o.host_id = $1 and s.state = 'called_off' and s.called_off_at > now() - interval '30 days'
        order by s.called_off_at desc`,
      [host.id],
    );
    const calledOff = [];
    const seen = new Set();
    for (const r of off) {
      const key = r.lane === 'weekly' ? r.session_id : r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const { rows: refunds } = await query(
        `select p.amount_pence, p.state, p.created_at, h.name as household, b.heads
           from hosting_payments p join experience_bookings b on b.id = p.booking_id join households h on h.id = b.household_id
          where p.offer_id = $1 and p.kind = 'refund' and p.cause = 'called_off' ${r.lane === 'weekly' ? 'and p.booking_id in (select booking_id from booking_sessions where session_id = $2)' : ''}
          order by p.created_at`,
        r.lane === 'weekly' ? [r.id, r.session_id] : [r.id],
      );
      calledOff.push({ offerId: r.id, title: r.title, on: ymd(r.called_off_at), booked: r.booked, max: r.max ?? null, refunds: refunds.map((x) => ({ household: x.household, heads: x.heads, pence: x.amount_pence, state: x.state })), totalPence: refunds.reduce((n, x) => n + x.amount_pence, 0) });
    }
    res.json({ atRisk: risk, calledOff });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// E7 · all events, E8 · one event
// ---------------------------------------------------------------------------

function eventRow(o, now, { cohost = false } = {}) {
  const next = nextSessionOf(o, now);
  const last = [...o.sessionsList].reverse().find((x) => x.state !== 'cancelled');
  const finished = o.state === 'ended' || (o.lane !== 'onrequest' && o.sessionsList.length > 0 && !next && o.state !== 'draft');
  const chip = cohost ? 'cohost' : o.state === 'draft' ? 'draft' : finished ? (o.called_off_at ? 'called_off' : 'finished') : sessionChip({ offer: o, session: next, booked: next?.booked ?? 0, now });
  const progress = o.state === 'draft' ? draftProgress(o) : null;
  return {
    id: o.id, title: o.title, lane: o.lane, visibility: o.visibility, photo: mediaRef(o.photo_ids?.[0]),
    group: cohost ? 'helping' : o.state === 'draft' ? 'drafts' : finished ? 'finished' : 'live',
    next: next ? { date: ymd(next.on_date), time: hm(next.starts_at), booked: next.booked, max: next.max_count ?? o.max_count ?? null } : null,
    endedOn: finished && last ? ymd(last.on_date) : null,
    came: finished ? o.sessionsList.reduce((n, x) => n + (x.state === 'scheduled' || x.state === 'done' ? x.booked : 0), 0) : null,
    draft: progress, chip, chipWords: CHIP_WORDS[chip],
  };
}

router.get('/host/desk/events', async (_req, res, next) => {
  try {
    const { host, account } = await me({ hostOptional: true });
    const now = new Date();
    const own = host ? (await offersWithSessions(host.id)).map((o) => eventRow(o, now)) : [];
    const helping = [];
    for (const h of await helpingWith(account?.id)) {
      const [withS] = await offersWithSessionsOf([h.id]);
      if (withS) helping.push({ ...eventRow(withS, now, { cohost: true }), owner: h.owner_name });
    }
    const groups = { live: [], helping, drafts: [], finished: [] };
    for (const r of own) groups[r.group].push(r);
    res.json(groups);
  } catch (err) { next(err); }
});

async function offersWithSessionsOf(ids) {
  const { rows: offers } = await query('select * from host_offers where id = any($1::uuid[])', [ids]);
  const out = [];
  for (const o of offers) {
    const { rows } = await query(
      `select s.*, coalesce((select sum(b.heads) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                              where bs.session_id = s.id and bs.state = 'booked' and b.state in ('pending', 'confirmed', 'attended')), 0)::int as booked
         from offer_sessions s where s.offer_id = $1 order by s.on_date, s.starts_at nulls first`, [o.id],
    );
    out.push({ ...o, sessionsList: rows });
  }
  return out;
}

/** The event, if it is the host's own or one they co-host; with what they may see. */
async function eventFor(id) {
  if (!UUID.test(String(id))) throw refuse(404, 'offer_not_found', 'That is not one of your events.');
  const { host, account, household } = await me({ hostOptional: true });
  const [o] = await offersWithSessionsOf([id]);
  if (!o || !o.lane) throw refuse(404, 'offer_not_found', 'That is not one of your events.');
  if (host && o.host_id === host.id) return { host, account, household, offer: o, view: cohostView(null) };
  // A co-host sees the event only once they have accepted (Codex, 2 Oct 2026).
  const { rows: [c] } = account ? await query('select * from offer_cohosts where offer_id = $1 and account_id = $2 and accepted_at is not null', [id, account.id]) : { rows: [] };
  if (!c || o.state === 'draft') throw refuse(404, 'offer_not_found', 'That is not one of your events.');
  const { rows: [owner] } = await query('select name from hosts where id = $1', [o.host_id]);
  return { host, account, household, offer: o, view: { ...cohostView(c), ownerName: owner?.name ?? null } };
}

router.get('/host/desk/events/:id', async (req, res, next) => {
  try {
    const { offer: o, view } = await eventFor(req.params.id);
    const now = new Date();
    const sessionId = UUID.test(String(req.query.session ?? '')) ? req.query.session : (nextSessionOf(o, now) ?? o.sessionsList.at(-1))?.id ?? null;
    const session = o.sessionsList.find((x) => x.id === sessionId) ?? null;
    const sessions = o.sessionsList.map((x) => ({
      id: x.id, n: x.n, date: ymd(x.on_date), time: hm(x.starts_at), booked: x.booked, max: x.max_count ?? o.max_count ?? null, state: x.state,
      finished: endOf(x, o) <= now, changed: Boolean(x.changed_from),
    }));
    let guests = null;
    if (view.guests && session) {
      const { rows: bookings } = await query(
        `select b.*, h.name as household_name,
                (select a.mobile from accounts a where a.household_id = b.household_id and a.mobile is not null order by a.created_at limit 1) as mobile,
                (select a.name from accounts a where a.household_id = b.household_id order by a.created_at limit 1) as lead_name,
                (select present from session_attendance sa where sa.session_id = $1 and sa.booking_id = b.id) as present,
                (select bs.state from booking_sessions bs where bs.booking_id = b.id and bs.session_id = $1) as session_state
           from experience_bookings b join households h on h.id = b.household_id
          where exists (select 1 from booking_sessions bs where bs.booking_id = b.id and bs.session_id = $1)
          order by b.created_at`,
        [session.id],
      );
      const { rows: kids } = bookings.length ? await query('select * from booking_children where booking_id = any($1::uuid[]) order by created_at', [bookings.map((b) => b.id)]) : { rows: [] };
      const showPhone = phoneVisible({ sessionEndsAt: endOf(session, o), now });
      const dropOff = o.parents === 'drop_off';
      guests = bookings.map((b) => {
        const children = kids.filter((k) => k.booking_id === b.id);
        const live = b.session_state === 'booked' && ['pending', 'confirmed', 'attended'].includes(b.state);
        return {
          bookingId: b.id, name: b.lead_name ?? b.household_name, heads: b.heads,
          children: children.map((k) => ({ name: k.name, age: k.age ?? null, dob: null, ageFromDob: k.date_of_birth ? ageOn(k.date_of_birth, ymd(session.on_date)) : null, needs: k.needs ?? [], parentPhone: dropOff && live && showPhone ? (k.emergency_contact ?? b.mobile ?? null) : null })),
          answers: b.answers ?? {}, phone: live && showPhone ? b.mobile ?? null : null,
          status: b.session_state === 'cancelled' ? 'Refunded' : paymentWords(b), present: b.present,
        };
      });
    }
    let waitlist = null;
    if (view.guests) {
      const { rows } = await query(
        `select w.*, h.name as household from offer_waitlist w join households h on h.id = w.household_id
          where w.offer_id = $1 and w.state in ('waiting', 'offered') and ($2::uuid is null or w.session_id is null or w.session_id = $2) order by w.created_at`,
        [o.id, o.lane === 'weekly' ? sessionId : null],
      );
      waitlist = { on: o.waitlist_on === true, people: rows.map((w, i) => ({ position: i + 1, household: w.household, party: w.party, offered: w.state === 'offered', expiresAt: w.offer_expires_at })) };
    }
    let money = null;
    if (view.money) {
      const { rows: [m] } = await query(
        // "You get" booking by booking, each at its own rate (Codex, 2 Oct 2026).
        `select coalesce(sum(b.value_pence), 0)::int as booked, coalesce(sum(b.fee_pence), 0)::int as fee,
                coalesce(sum(b.refunded_pence), 0)::int as refunds, coalesce(sum(b.host_pence), 0)::int as host,
                coalesce(sum(floor(b.host_pence::numeric * greatest(0, b.charged_pence - b.refunded_pence) / nullif(b.charged_pence, 0))), 0)::int as you_get
           from experience_bookings b where b.offer_id = $1 and b.payment_state in ('charged', 'partially_refunded', 'refunded')`, [o.id],
      );
      const { rows: payouts } = await query(`select amount_pence, tips_pence, release_at, state from host_payouts where offer_id = $1 order by release_at`, [o.id]);
      money = o.visibility !== 'public'
        ? { private: true, eventFee: o.private_fee_state, ...m }
        : { ...m, youGetPence: m.you_get, payouts: payouts.map((p) => ({ pence: p.amount_pence + p.tips_pence, on: ymd(p.release_at), state: p.state })) };
    }
    const first = o.sessionsList.find((x) => x.state === 'scheduled') ?? o.sessionsList[0];
    res.json({
      event: {
        id: o.id, title: o.title, lane: o.lane, state: o.state, visibility: o.visibility, parents: o.parents ?? null, photo: mediaRef(o.photo_ids?.[0]),
        priceMode: o.price_mode, minCount: o.min_count, maxCount: o.max_count, waitlistOn: o.waitlist_on === true,
        date: first ? { date: ymd(first.on_date), time: hm(first.starts_at) } : null,
        booked: session?.booked ?? 0, decidesBy: o.lane === 'weekly' ? (o.min_count ? 'day_before' : null) : (first?.decides_at ? ymd(localDay(new Date(first.decides_at), tzOf(o))) : null),
        chip: eventRow(o, now).chip, link: `${appUrl()}/experiences/${o.id}${o.link_token ? `?l=${o.link_token}` : ''}`,
        lowerMinimum: o.price_mode !== 'by_numbers' && Boolean(o.min_count),
      },
      view, sessions, sessionId, guests, waitlist, money,
    });
  } catch (err) { next(err); }
});

function ageOn(dob, day) {
  const [y, m, d] = ymd(dob).split('-').map(Number);
  const [Y, M, D] = day.split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

router.post('/host/desk/events/:id/attendance', async (req, res, next) => {
  try {
    const { offer: o, view } = await eventFor(req.params.id);
    // Seeing the guest list is not changing it (Codex, 2 Oct 2026).
    if (!view.owner) throw refuse(403, 'not_yours', 'Only the host marks attendance.');
    const { sessionId, marks } = req.body ?? {};
    const s = o.sessionsList.find((x) => x.id === sessionId);
    if (!s) throw refuse(404, 'session_not_found', 'That session is not on this event.');
    if (endOf(s, o) > new Date()) throw refuse(409, 'not_finished', 'Attendance is marked once the session has finished.');
    if (!Array.isArray(marks) || marks.length > 500) throw refuse(400, 'bad_marks', 'Mark each guest in or out.');
    let inN = 0; let outN = 0;
    await withTransaction(async (c) => {
      for (const m of marks) {
        if (!UUID.test(String(m?.bookingId)) || typeof m.present !== 'boolean') continue;
        const { rowCount } = await c.query(
          `insert into session_attendance (session_id, booking_id, present)
           select $1, $2, $3 where exists (select 1 from booking_sessions where session_id = $1 and booking_id = $2)
           on conflict (session_id, booking_id) do update set present = excluded.present, marked_at = now()`,
          [s.id, m.bookingId, m.present],
        );
        if (rowCount) { if (m.present) inN += 1; else outN += 1; }
      }
    });
    // Recorded, never a release: the payout follows the guests' word and the clock (handover §5).
    res.json({ saved: true, in: inN, out: outN });
  } catch (err) { next(err); }
});

router.post('/host/desk/events/:id/waitlist', async (req, res, next) => {
  try {
    const { offer: o, view, account } = await eventFor(req.params.id);
    if (!view.owner) throw refuse(403, 'not_yours', 'Only the host changes this.');
    const on = req.body?.on === true;
    await repo.updateOffer(o.id, { waitlistOn: on });
    await logChange({ subjectKind: 'event', subjectId: o.id, field: 'waitlist_on', before: { on: o.waitlist_on === true }, after: { on }, by: account?.id ?? null, byLabel: 'host' });
    res.json({ on });
  } catch (err) { next(err); }
});

router.post('/host/desk/events/:id/minimum', async (req, res, next) => {
  try {
    const { offer: o, view, account } = await eventFor(req.params.id);
    if (!view.owner) throw refuse(403, 'not_yours', 'Only the host changes this.');
    // Lowering it on Depends on numbers would raise what guests have already paid (README E6).
    if (o.price_mode === 'by_numbers') throw refuse(409, 'by_numbers', 'The minimum can’t be lowered on a Depends-on-numbers event.');
    const n = Number(req.body?.minCount);
    if (!Number.isInteger(n) || n < 1) throw refuse(400, 'bad_minimum', 'The minimum is a whole number, 1 or more.');
    if (!o.min_count || n >= o.min_count) throw refuse(409, 'not_lower', 'The minimum can only be lowered here.');
    await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${o.id}`]);
      await c.query('update host_offers set min_count = $2 where id = $1', [o.id, n]);
      await c.query(`update offer_sessions set min_count = null where offer_id = $1 and state = 'scheduled' and decided_outcome is null`, [o.id]);
      await logChange({ subjectKind: 'event', subjectId: o.id, field: 'min_count', before: { min: o.min_count }, after: { min: n }, by: account?.id ?? null, byLabel: 'host' }, c);
    });
    res.json({ minCount: n });
  } catch (err) { next(err); }
});

/**
 * Edit, once people have booked (README E8): the description yes, and guests
 * are told; the most not below the number booked; the date only through
 * Change date, and the price never for people already booked.
 */
router.post('/host/desk/events/:id/edit', async (req, res, next) => {
  try {
    const { offer: o, view, account } = await eventFor(req.params.id);
    if (!view.owner) throw refuse(403, 'not_yours', 'Only the host edits this.');
    const b = req.body ?? {};
    const patch = {};
    if (b.description !== undefined) {
      const d = String(b.description ?? '').trim().slice(0, 4000);
      if (!d) throw refuse(400, 'empty', 'The description can’t be empty.');
      patch.description = d;
    }
    if (b.maxCount !== undefined) {
      const n = Number(b.maxCount);
      if (!Number.isInteger(n) || n < 1 || n > 100_000) throw refuse(400, 'bad_max', 'The most is a whole number.');
      const most = Math.max(0, ...o.sessionsList.filter((x) => x.state === 'scheduled').map((x) => x.booked));
      if (n < most) throw refuse(409, 'below_booked', `The most can’t go below the ${most} already booked.`);
      patch.maxCount = n;
    }
    if (!Object.keys(patch).length) throw refuse(400, 'nothing', 'Nothing to change.');
    await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-publish:${o.id}`]);
      // Counted again under the lock a booking takes, so a booking a moment ago is counted too (Codex, 2 Oct 2026).
      if (patch.maxCount != null) {
        const { rows: [{ most }] } = await c.query(
          `select coalesce(max(n), 0)::int as most from (select (select coalesce(sum(b.heads), 0) from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                    where bs.session_id = s.id and bs.state = 'booked' and b.state in ('pending', 'confirmed', 'attended')) as n
               from offer_sessions s where s.offer_id = $1 and s.state = 'scheduled') x`, [o.id],
        );
        if (patch.maxCount < most) throw refuse(409, 'below_booked', `The most can’t go below the ${most} already booked.`);
      }
      await repo.updateOffer(o.id, patch, c);
      await logChange({ subjectKind: 'event', subjectId: o.id, field: Object.keys(patch).join(','), before: { description: o.description, maxCount: o.max_count }, after: patch, by: account?.id ?? null, byLabel: 'host' }, c);
    });
    if (patch.description) {
      const { rows } = await query(
        `select distinct b.household_id from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
          join offer_sessions s on s.id = bs.session_id where s.offer_id = $1 and s.state = 'scheduled' and bs.state = 'booked' and b.state in ('pending', 'confirmed')`,
        [o.id],
      );
      const stamp = new Date().toISOString().slice(0, 16);
      for (const r of rows) await notifications.notify({ householdId: r.household_id, kind: 'event_changed', title: `${o.title ?? 'Your booking'}: the host updated the details`, link: '/trips', dedupeKey: `event_changed:${o.id}:${r.household_id}:${stamp}` }).catch(() => null);
    }
    res.json({ saved: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// E9 · earnings
// ---------------------------------------------------------------------------

router.get('/host/desk/earnings', async (req, res, next) => {
  try {
    const { host } = await me();
    const now = new Date();
    const thisMonth = localDay(now).slice(0, 7);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? '')) && req.query.month <= thisMonth ? req.query.month : thisMonth;
    const months = lastMonths(thisMonth, 6);
    const { shares, bookings } = await sharesOf(host.id);
    const tips = await tipsOf(host.id);
    const bars = earningsByMonth(shares, tips, months.includes(month) ? months : [...lastMonths(month, 6)], now);
    const cur = bars.find((b) => b.month === month) ?? { pence: 0, bookingsPence: 0, tipsPence: 0 };
    const i = bars.findIndex((b) => b.month === month);
    const prev = i > 0 ? bars[i - 1].pence : null;
    const byEvent = new Map();
    for (const s of shares) {
      if (s.day.slice(0, 7) !== month || s.endsAt > now) continue;
      const e = byEvent.get(s.offerId) ?? { offerId: s.offerId, title: s.title, sessions: new Set(), bookings: new Set(), pence: 0, tipsPence: 0 };
      e.sessions.add(s.sessionId); e.bookings.add(s.bookingId); e.pence += s.pence;
      byEvent.set(s.offerId, e);
    }
    for (const t of tips) {
      if (monthOf(t.created_at) !== month) continue;
      const e = byEvent.get(t.offer_id) ?? { offerId: t.offer_id, title: t.title, sessions: new Set(), bookings: new Set(), pence: 0, tipsPence: 0 };
      e.tipsPence += t.amount_pence;
      byEvent.set(t.offer_id, e);
    }
    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const events = [...byEvent.values()].map((e) => {
      const bs = [...e.bookings].map((id) => bookingById.get(id)).filter(Boolean);
      return {
        offerId: e.offerId, title: e.title, sessions: e.sessions.size, bookings: e.bookings.size, tipsPence: e.tipsPence, pence: e.pence + e.tipsPence,
        sheet: { collectedPence: bs.reduce((n, b) => n + (b.charged_pence ?? 0), 0), feePence: bs.reduce((n, b) => n + (b.fee_pence ?? 0), 0), refundsPence: bs.reduce((n, b) => n + (b.refunded_pence ?? 0), 0), tipsPence: e.tipsPence, paidToYouPence: e.pence + e.tipsPence },
      };
    }).sort((a, b) => b.pence - a.pence);
    // Booked ahead, against what the sessions ahead could hold at their price.
    const ahead = shares.filter((x) => x.endsAt > now).reduce((n, x) => n + x.pence, 0);
    const { rows: [cap] } = await query(
      `select coalesce(sum(coalesce(s.max_count, o.max_count) * coalesce(o.price_pence, o.drop_in_pence, 0)), 0)::bigint as gross
         from offer_sessions s join host_offers o on o.id = s.offer_id
        where o.host_id = $1 and o.state = 'live' and s.state = 'scheduled' and s.on_date >= current_date and coalesce(s.max_count, o.max_count) is not null`,
      [host.id],
    );
    const { rows: payouts } = await query(`select p.*, o.title from host_payouts p left join host_offers o on o.id = p.offer_id where p.host_id = $1 order by p.release_at desc limit 200`, [host.id]);
    const pay = (p) => ({ id: p.id, title: p.title, pence: p.amount_pence + p.tips_pence, tipsPence: p.tips_pence, on: ymd(p.release_at), state: p.state, holdReason: p.hold_reason });
    const statements = [];
    for (const m of lastMonths(thisMonth, 12)) statements.push({ period: m, kind: 'month', csv: `/api/host/desk/statements/${m}.csv` });
    const years = [...new Set([thisMonth.slice(0, 4), String(Number(thisMonth.slice(0, 4)) - 1)])];
    for (const y of years) statements.push({ period: y, kind: 'year', csv: `/api/host/desk/statements/${y}.csv`, dac7: true });
    res.json({
      month, pence: cur.pence, bookingsPence: cur.bookingsPence, tipsPence: cur.tipsPence, changePct: prev == null ? null : changePct(cur.pence, prev),
      bars: bars.map((b) => ({ month: b.month, pence: b.pence })), byEvent: events,
      bookedAhead: { pence: ahead, possiblePence: Number(cap.gross) || null },
      goal: host.earnings_goal_pence ? { pence: host.earnings_goal_pence, soFarPence: cur.pence } : null,
      payouts: {
        next: payouts.filter((p) => p.state === 'scheduled').map(pay).sort((a, b) => a.on.localeCompare(b.on))[0] ?? null,
        due: payouts.filter((p) => p.state === 'scheduled').map(pay), held: payouts.filter((p) => p.state === 'held').map(pay),
        paid: payouts.filter((p) => p.state === 'paid').map(pay), failed: payouts.filter((p) => p.state === 'failed').map(pay),
        stripe: { ready: host.payouts_state === 'ready', accountId: host.stripe_account_id ? `…${String(host.stripe_account_id).slice(-4)}` : null },
      },
      statements,
      privateOnly: false,
    });
  } catch (err) { next(err); }
});

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const pounds = (p) => (Number(p ?? 0) / 100).toFixed(2);

/**
 * A statement: every booking, refund, tip and payout in the period, then the
 * totals HMRC's DAC7 return asks of a platform — consideration paid, fees
 * withheld, tips — so the host holds the same figures Epic reports.
 */
router.get('/host/desk/statements/:period.csv', async (req, res, next) => {
  try {
    const { host } = await me();
    const period = String(req.params.period);
    if (!/^\d{4}(-\d{2})?$/.test(period)) throw refuse(400, 'bad_period', 'A month (YYYY-MM) or a year (YYYY).');
    const from = period.length === 4 ? `${period}-01-01` : `${period}-01`;
    const to = period.length === 4 ? `${Number(period) + 1}-01-01` : new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1)).toISOString().slice(0, 10);
    const { rows } = await query(
      `select p.created_at, p.kind, p.amount_pence, p.epic_pence, p.host_pence, p.rate_pct, p.cause, p.reason, p.state, o.title
         from hosting_payments p left join host_offers o on o.id = p.offer_id
        where p.host_id = $1 and p.state = 'succeeded' and p.kind <> 'tip' and p.created_at >= $2::date and p.created_at < $3::date
        order by p.created_at`,
      [host.id, from, to],
    );
    const { rows: tips } = await query(
      `select t.created_at, t.amount_pence, o.title from booking_tips t join host_offers o on o.id = t.offer_id
        where t.host_id = $1 and t.state = 'paid' and t.created_at >= $2::date and t.created_at < $3::date order by t.created_at`,
      [host.id, from, to],
    );
    const lines = [['Date', 'Event', 'What', 'Amount (£)', 'Epic fee (£)', 'To you (£)', 'Note'].join(',')];
    for (const r of rows) lines.push([ymd(r.created_at), r.title, r.kind, pounds(r.amount_pence), r.epic_pence == null ? '' : pounds(r.epic_pence), r.host_pence == null ? '' : pounds(r.host_pence), r.cause ?? ''].map(csvCell).join(','));
    for (const t of tips) lines.push([ymd(t.created_at), t.title, 'tip', pounds(t.amount_pence), '0.00', pounds(t.amount_pence), ''].map(csvCell).join(','));
    const charged = rows.filter((r) => r.kind === 'charge').reduce((n, r) => n + r.amount_pence, 0);
    const refunded = rows.filter((r) => r.kind === 'refund').reduce((n, r) => n + r.amount_pence, 0);
    // Epic's fees net of what went back with refunds, as the back office's DAC7 counts them (Codex, 2 Oct 2026).
    const fees = rows.reduce((n, r) => n + (r.kind === 'charge' ? (r.epic_pence ?? 0) : r.kind === 'refund' ? -(r.epic_pence ?? 0) : 0), 0);
    const paid = rows.filter((r) => r.kind === 'payout').reduce((n, r) => n + r.amount_pence, 0);
    const tipSum = tips.reduce((n, t) => n + t.amount_pence, 0);
    lines.push('');
    lines.push(['DAC7 summary', period].map(csvCell).join(','));
    lines.push(['Paid by guests, less refunds (£)', pounds(charged - refunded)].join(','));
    lines.push(["Epic's fees (£)", pounds(fees)].join(','));
    lines.push(['Tips (£)', pounds(tipSum)].join(','));
    lines.push(['Paid out to you (£)', pounds(paid)].join(','));
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="epic-statement-${period}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// E10 · fees
// ---------------------------------------------------------------------------

router.get('/host/desk/fees', async (_req, res, next) => {
  try {
    const { host } = await me();
    const s = await settingsRepo.current();
    const rating = await ratingNow(host.id);
    const progress = ladderProgress(s.public_commission, { ratedEvents: rating.ratedEvents, avg: rating.ratedAvg });
    const intro = introState(s.intro_zero, { hostStartedAt: host.created_at, bookingsSoFar: await introUsed(host.id) });
    const { rows } = await query(
      `select b.id, b.fee_rate_pct, b.fee_reason, b.fee_pence, b.created_at, o.title, h.name as household
         from experience_bookings b join host_offers o on o.id = b.offer_id join households h on h.id = b.household_id
        where b.host_id = $1 and b.fee_reason is not null order by b.created_at desc limit 100`,
      [host.id],
    );
    const { rows: [vis] } = await query(
      `select count(*) filter (where visibility = 'public')::int as pub, count(*)::int as all_out from host_offers where host_id = $1 and lane is not null and state <> 'draft'`, [host.id],
    );
    const REASON = { standard: 'Standard rate', host_link: 'Through your link', minimum: `Minimum ${s.minimum_fee == null ? '' : gbpWords(s.minimum_fee)}`.trim(), intro: 'Intro', override: 'Agreed rate', private_payment: 'Payment fee', free: 'Free' };
    res.json({
      ratePct: intro.active ? 0 : progress?.rate ?? null,
      why: intro.active ? `Intro · ${intro.bookingsLeft} ${intro.bookingsLeft === 1 ? 'booking' : 'bookings'} or ${intro.daysLeft} days left` : rating.ratedEvents ? `${rating.ratedEvents} rated ${rating.ratedEvents === 1 ? 'event' : 'events'} averaging ${rating.ratedAvg}` : 'No rated events yet',
      ladder: (s.public_commission ?? []).map((x, i) => ({ pct: x.pct, ratedEvents: x.ratedEvents ?? null, avgAtLeast: x.avgAtLeast ?? null, words: i === 0 ? 'To start' : `${x.ratedEvents} rated events · ${x.avgAtLeast} or more`, current: !intro.active && x.pct === progress?.rate })),
      progress: progress?.next ? { ratedEvents: rating.ratedEvents, of: progress.next.ratedEvents, avg: rating.ratedAvg, avgNeeded: progress.next.avgAtLeast } : null,
      movesBack: movesBack(s.public_commission, progress?.rate),
      bookings: rows.map((r) => ({ title: r.title, household: r.household, reason: r.fee_reason, reasonWords: REASON[r.fee_reason] ?? r.fee_reason, ratePct: r.fee_reason === 'minimum' ? null : Number(r.fee_rate_pct), feePence: r.fee_pence, words: feeWords({ ratePct: Number(r.fee_rate_pct), reason: r.fee_reason, feePence: r.fee_pence }) })),
      // The host's own token: bookings that arrive with it are charged the host-link rate (Codex, 2 Oct 2026).
      link: { url: `${appUrl()}/hosts/${host.id}?via=${host.link_token}`, ratePct: s.host_link_rate ?? null },
      privateOnly: vis.all_out > 0 && vis.pub === 0,
      private: { eventPence: s.private_event_fee ?? null, proPence: s.pro_monthly ?? null, paymentFeePct: s.private_payment_fee ?? null },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// E11 · reviews
// ---------------------------------------------------------------------------

router.get('/host/desk/reviews', async (_req, res, next) => {
  try {
    const { host } = await me();
    const { rows } = await query(
      `select r.*, o.title, coalesce(a.name, h.name) as who,
              (select t.amount_pence from booking_tips t where t.booking_id = r.booking_id and t.state = 'paid' order by t.created_at limit 1) as tip_pence,
              (select coalesce(s.on_date, o.starts_on) from experience_bookings b left join offer_sessions s on s.id = b.session_id where b.id = r.booking_id) as on_date
         from host_reviews r join host_offers o on o.id = r.offer_id join households h on h.id = r.household_id
         left join lateral (select name from accounts where household_id = r.household_id order by created_at limit 1) a on true
        where r.host_id = $1 and r.side = 'guest' and r.publish_on <= current_date and not r.hidden
        order by r.publish_on desc, r.created_at desc limit 300`,
      [host.id],
    );
    const { rows: loneTips } = await query(
      `select t.*, o.title, coalesce(a.name, h.name) as who from booking_tips t join host_offers o on o.id = t.offer_id
         left join households h on h.id = t.household_id
         left join lateral (select name from accounts where household_id = t.household_id order by created_at limit 1) a on true
        where t.host_id = $1 and t.state = 'paid' and not exists (select 1 from host_reviews r where r.booking_id = t.booking_id and r.side = 'guest')
        order by t.created_at desc limit 100`,
      [host.id],
    );
    const { rows: [tipSum] } = await query(`select count(*)::int as n, coalesce(sum(amount_pence), 0)::int as pence from booking_tips where host_id = $1 and state = 'paid'`, [host.id]);
    // The summary from every review, not only the latest the list shows (Codex, 2 Oct 2026).
    const SHOWN = `r.host_id = $1 and r.side = 'guest' and r.publish_on <= current_date and not r.hidden`;
    const { rows: [agg] } = await query(`select count(*)::int as n, round(avg(r.stars)::numeric, 1)::float as avg from host_reviews r where ${SHOWN}`, [host.id]);
    const { rows: byStars } = await query(`select r.stars, count(*)::int as n from host_reviews r where ${SHOWN} group by r.stars`, [host.id]);
    const count = agg.n;
    const avg = agg.avg;
    const stars = [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: byStars.find((x) => x.stars === n)?.n ?? 0 }));
    const months = lastMonths(localDay(new Date()).slice(0, 7), 6);
    const { rows: monthly } = await query(
      `select m.month,
              (select round(avg(r.stars)::numeric, 1)::float from host_reviews r where ${SHOWN} and to_char(r.publish_on, 'YYYY-MM') <= m.month) as avg,
              (select count(*)::int from host_reviews r where ${SHOWN} and to_char(r.publish_on, 'YYYY-MM') = m.month) as count
         from unnest($2::text[]) as m(month)`,
      [host.id, months],
    );
    const over = months.map((m) => { const x = monthly.find((y) => y.month === m); return { month: m, avg: x?.avg ?? null, count: x?.count ?? 0 }; });
    const { rows: chipRows } = await query(`select c as label, count(*)::int as n from host_reviews r, jsonb_array_elements_text(r.chips) c where ${SHOWN} group by c order by n desc limit 12`, [host.id]);
    const firstAvg = over.find((o) => o.avg != null)?.avg ?? null;
    const lastAvg = over.at(-1).avg;

    res.json({
      avg, count, tips: { count: tipSum.n, pence: tipSum.pence }, stars,
      overTime: { months: over, ratingLine: firstAvg != null && lastAvg != null && lastAvg !== firstAvg ? `${lastAvg > firstAvg ? 'Up' : 'Down'} ${Math.abs(Math.round((lastAvg - firstAvg) * 10) / 10)} since ${monthName(over.find((o) => o.avg != null).month)}` : null },
      mentions: chipRows.map((c) => ({ label: c.label, count: c.n })),
      reviews: [
        ...rows.map((r) => ({ id: r.id, kind: 'review', who: r.who, stars: r.stars, tipPence: r.tip_pence ?? null, title: r.title, on: ymd(r.on_date ?? r.publish_on), text: r.text, reply: r.reply ?? null, reported: Boolean(r.reported_at), byProxy: r.by_proxy })),
        ...loneTips.map((t) => ({ id: t.id, kind: 'tip', who: t.who, stars: null, tipPence: t.amount_pence, title: t.title, on: ymd(t.created_at), text: null, reply: null, reported: false, byProxy: false })),
      ].sort((a, b) => String(b.on).localeCompare(String(a.on))),
      needsReply: (await query(`select count(*)::int as n from host_reviews r where ${SHOWN} and r.reply is null and r.text is not null`, [host.id])).rows[0].n,
    });
  } catch (err) { next(err); }
});

router.post('/host/desk/reviews/:id/reply', async (req, res, next) => {
  try {
    const { host } = await me();
    const text = String(req.body?.text ?? '').trim().slice(0, 1000);
    if (!text) throw refuse(400, 'empty', 'Write your reply first.');
    // One public reply per review: it can be written once.
    const { rows: [r] } = await query(
      `update host_reviews set reply = $3, replied_at = now() where id = $1 and host_id = $2 and side = 'guest' and reply is null returning id`,
      [req.params.id, host.id, text],
    );
    if (!r) throw refuse(409, 'already_replied', 'You have replied to this one already.');
    res.json({ replied: true });
  } catch (err) { next(err); }
});

router.post('/host/desk/reviews/:id/report', async (req, res, next) => {
  try {
    const { host } = await me();
    const reason = String(req.body?.reason ?? '').trim().slice(0, 500);
    if (!reason) throw refuse(400, 'reason_required', 'Say what is wrong with it.');
    const { rows: [r] } = await query(
      `update host_reviews set reported_at = now(), report_reason = $3 where id = $1 and host_id = $2 and side = 'guest' and reported_at is null returning id`,
      [req.params.id, host.id, reason],
    );
    if (!r) throw refuse(409, 'already_reported', 'This one is with Epic already.');
    await logChange({ subjectKind: 'review', subjectId: req.params.id, field: 'reported', after: { reason }, byLabel: 'host', by: currentAccount()?.id ?? null });
    res.json({ reported: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// E12 · insights
// ---------------------------------------------------------------------------

router.get('/host/desk/insights', async (_req, res, next) => {
  try {
    const { host } = await me();
    const { rows: events } = await query(
      `select o.id, o.title,
              coalesce((select sum(v.views) from offer_views v where v.offer_id = o.id and v.day > current_date - 30), 0)::int as views,
              (select count(*) from experience_bookings b where b.offer_id = o.id and b.created_at > now() - interval '30 days' and b.state <> 'cancelled')::int as bookings,
              (select count(*) from experience_bookings b where b.offer_id = o.id and b.created_at > now() - interval '30 days' and b.state <> 'cancelled' and (b.via_host_link or b.source = 'link'))::int as by_link,
              (select count(*) from experience_bookings b where b.offer_id = o.id and b.created_at > now() - interval '30 days' and b.state <> 'cancelled' and b.source = 'invite')::int as by_invite
         from host_offers o where o.host_id = $1 and o.lane is not null and o.state in ('live', 'ended', 'paused') order by o.updated_at desc`,
      [host.id],
    );
    const { rows: [rep] } = await query(
      `select count(*)::int as households, count(*) filter (where n > 1)::int as repeat
         from (select household_id, count(distinct offer_id) + count(*) - count(distinct offer_id) as n from experience_bookings where host_id = $1 and state in ('confirmed', 'attended') group by household_id) x`,
      [host.id],
    );
    // How fast a session fills: from its first booking to the booking that filled it.
    const { rows: fills } = await query(
      `select o.id, o.title, extract(epoch from (max(b.created_at) - min(b.created_at))) / 86400 as days
         from offer_sessions s join host_offers o on o.id = s.offer_id
         join booking_sessions bs on bs.session_id = s.id join experience_bookings b on b.id = bs.booking_id
        where o.host_id = $1 and coalesce(s.max_count, o.max_count) is not null
        group by o.id, o.title, s.id, s.max_count, o.max_count
       having sum(b.heads) >= coalesce(s.max_count, o.max_count)`,
      [host.id],
    );
    const fastest = new Map();
    for (const f of fills) { const e = fastest.get(f.id) ?? { title: f.title, days: [] }; e.days.push(Number(f.days)); fastest.set(f.id, e); }
    const best = [...fastest.values()].map((e) => ({ title: e.title, days: Math.round((e.days.reduce((a, b) => a + b, 0) / e.days.length) * 10) / 10 })).sort((a, b) => a.days - b.days)[0] ?? null;
    res.json({
      events: events.map((e) => ({ offerId: e.id, title: e.title, views: e.views, bookings: e.bookings, conversionPct: e.views ? Math.round((e.bookings / e.views) * 1000) / 10 : null, sources: { search: Math.max(0, e.bookings - e.by_link - e.by_invite), link: e.by_link, invites: e.by_invite } })),
      repeat: rep.households >= 5 ? { pct: Math.round((rep.repeat / rep.households) * 100), came: rep.repeat, of: rep.households } : { pct: null, came: rep.repeat, of: rep.households, reason: 'Too few guests to say yet' },
      sellsOutFastest: best,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// E13 · profile and settings, E4 automatic messages, co-hosts, pause, help
// ---------------------------------------------------------------------------

export const AUTO_MESSAGES = Object.freeze([
  { kind: 'confirmed', title: 'Booking confirmed', when: 'As soon as they book', body: 'Thanks for booking. See you there.' },
  { kind: 'reminder', title: 'Reminder 24h before', when: 'The day before', body: 'See you tomorrow. Here is what to bring and where to meet.' },
  { kind: 'date_changed', title: 'Date changed', when: 'When you move a date', body: 'I have had to move the date. If the new one doesn’t work, you can cancel for a full refund.' },
  { kind: 'called_off', title: 'Called off', when: 'If it doesn’t go ahead', body: 'Sorry — this one isn’t going ahead. You get a full refund.' },
  { kind: 'thank_you', title: 'Thank you and review request', when: 'The morning after', body: 'Thank you for coming. If you have a minute, a review helps other people find this.' },
]);

router.get('/host/desk/profile', async (_req, res, next) => {
  try {
    const { household, host } = await me();
    const s = await settingsRepo.current();
    const rating = await ratingNow(host.id);
    const mins = await responseTime(host.id, household.id);
    const { rows: [tips] } = await query(`select count(*)::int as n, coalesce(sum(amount_pence), 0)::int as pence from booking_tips where host_id = $1 and state = 'paid'`, [host.id]);
    const { rows: cohosts } = await query(
      `select c.id, c.name, c.role, c.sees_guests, c.can_message, c.can_see_money, c.accepted_at, c.account_id, o.id as offer_id, o.title
         from offer_cohosts c join host_offers o on o.id = c.offer_id where o.host_id = $1 order by c.name, o.title`,
      [host.id],
    );
    const people = new Map();
    for (const c of cohosts) {
      const key = c.account_id ?? c.name.toLowerCase();
      const p = people.get(key) ?? { key, name: c.name, guests: c.sees_guests, messages: c.can_message, money: c.can_see_money, accepted: Boolean(c.accepted_at), events: [] };
      p.events.push({ offerId: c.offer_id, title: c.title, rowId: c.id });
      people.set(key, p);
    }
    const { rows: auto } = await query('select * from host_auto_messages where host_id = $1', [host.id]);
    const { rows: quick } = await query('select id, body from host_quick_replies where host_id = $1 order by position, created_at', [host.id]);
    const { rows: [out] } = await query(
      `select (select count(*) from experience_bookings b where b.host_id = $1 and (
                  (b.request_state = 'asked' and b.state = 'pending')
                  or exists (select 1 from booking_sessions bs join offer_sessions x on x.id = bs.session_id
                              join host_offers xo on xo.id = x.offer_id
                              where bs.booking_id = b.id and b.state in ('pending', 'confirmed', 'attended') and bs.state = 'booked' and x.state = 'scheduled'
                                -- only a session still to finish counts; one that has happened is done (Codex, 2 Oct 2026)
                                and ((coalesce(x.ends_on, x.on_date) + coalesce(x.ends_at, x.starts_at, time '23:59')) at time zone coalesce(xo.time_zone, 'Europe/London')) > now())))::int as bookings,
              (select count(*) from host_payouts where host_id = $1 and state in ('scheduled', 'held', 'released', 'failed'))::int as payouts`,
      [host.id],
    );
    res.json({
      host: { id: host.id, name: host.name, place: host.location_label ?? null, photo: mediaRef(host.photo_id), responseMinutes: mins, responseWords: mins == null ? null : `usually replies within ${responseWords(mins)}` },
      videos: [host.intro_video_id ? { kind: 'about', url: mediaRef(host.intro_video_id) } : null].filter(Boolean),
      ratings: { avg: rating.avg, count: rating.count, tips: { count: tips.n, pence: tips.pence }, standing: await standingFor(host, rating, s) },
      checks: {
        identity: { state: host.identity_state, on: ymd(host.identity_verified_at) },
        checked: { state: host.checked_state, level: host.checked_level ?? null, on: ymd(host.checked_on), renewBy: host.checked_on && typeof s.dbs_age === 'number' ? addMonths(host.checked_on, s.dbs_age) : null },
        insurance: { expires: ymd(host.insurance_expires) },
      },
      settings: {
        payouts: { ready: host.payouts_state === 'ready', tax: host.tax_reference ? `•••• ${String(host.tax_reference).slice(-3)}` : null },
        cohosts: [...people.values()].map(({ key, ...p }) => ({ ...p, id: key })),
        notifications: host.notification_prefs ?? {}, goalPence: host.earnings_goal_pence ?? null,
        paused: Boolean(host.paused), stopped: Boolean(host.stopped_at),
        canStop: !out.bookings && !out.payouts, outstanding: { bookings: out.bookings, payouts: out.payouts },
      },
      autoMessages: AUTO_MESSAGES.map((m) => { const r = auto.find((x) => x.kind === m.kind); return { kind: m.kind, title: m.title, when: m.when, on: r ? r.is_on : true, body: r?.body ?? m.body }; }),
      quickReplies: quick,
    });
  } catch (err) { next(err); }
});

function addMonths(d, n) {
  const x = new Date(`${ymd(d)}T12:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return ymd(x);
}

router.patch('/host/desk/profile', async (req, res, next) => {
  try {
    const { host, account } = await me();
    const b = req.body ?? {};
    const patch = {};
    if (b.goalPence !== undefined) {
      if (b.goalPence !== null && !(Number.isInteger(b.goalPence) && b.goalPence > 0 && b.goalPence <= 10_000_000)) throw refuse(400, 'bad_goal', 'A goal is a whole number of pounds.');
      patch.earnings_goal_pence = b.goalPence;
    }
    if (b.notifications !== undefined) {
      if (!b.notifications || typeof b.notifications !== 'object' || Array.isArray(b.notifications)) throw refuse(400, 'bad_prefs', 'Notifications are on or off.');
      patch.notification_prefs = Object.fromEntries(Object.entries(b.notifications).filter(([k, v]) => /^[a-z_]{2,40}$/.test(k) && typeof v === 'boolean').slice(0, 40));
    }
    if (!Object.keys(patch).length) throw refuse(400, 'nothing', 'Nothing to change.');
    const cols = Object.keys(patch);
    await query(`update hosts set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [host.id, ...cols.map((c) => (c === 'notification_prefs' ? JSON.stringify(patch[c]) : patch[c]))]);
    await logChange({ subjectKind: 'host', subjectId: host.id, field: cols.join(','), after: patch, by: account?.id ?? null, byLabel: 'host' });
    res.json({ saved: true });
  } catch (err) { next(err); }
});

/** Pause: new bookings stop; booked events go ahead and guests are not told anything. */
router.post('/host/desk/pause', async (req, res, next) => {
  try {
    const { host, account } = await me();
    const on = req.body?.paused === true;
    // The lock every booking takes: no booking slips in after the pause (Codex, 2 Oct 2026).
    await withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-intro:${host.id}`]);
      await c.query('update hosts set paused = $2, paused_at = case when $2 then now() else null end, updated_at = now() where id = $1', [host.id, on]);
    });
    await logChange({ subjectKind: 'host', subjectId: host.id, field: 'paused', before: { paused: Boolean(host.paused) }, after: { paused: on }, by: account?.id ?? null, byLabel: 'host' });
    res.json({ paused: on });
  } catch (err) { next(err); }
});

/** Stop hosting: refused while any booking or payout is outstanding (handover §5). */
router.post('/host/desk/stop', async (_req, res, next) => {
  try {
    const { host, account } = await me();
    const out = await withTransaction(async (c) => {
      // The same lock every new booking takes, so none can slip in between the count and the stop (Codex, 2 Oct 2026).
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`host-intro:${host.id}`]);
      const { rows: [o] } = await c.query(
        `select (select count(*) from experience_bookings b where b.host_id = $1 and (
                  (b.request_state = 'asked' and b.state = 'pending')
                  or exists (select 1 from booking_sessions bs join offer_sessions x on x.id = bs.session_id
                              join host_offers xo on xo.id = x.offer_id
                              where bs.booking_id = b.id and b.state in ('pending', 'confirmed', 'attended') and bs.state = 'booked' and x.state = 'scheduled'
                                -- only a session still to finish counts; one that has happened is done (Codex, 2 Oct 2026)
                                and ((coalesce(x.ends_on, x.on_date) + coalesce(x.ends_at, x.starts_at, time '23:59')) at time zone coalesce(xo.time_zone, 'Europe/London')) > now())))::int as bookings,
                (select count(*) from host_payouts where host_id = $1 and state in ('scheduled', 'held', 'released', 'failed'))::int as payouts`,
        [host.id],
      );
      if (o.bookings || o.payouts) return { refused: o };
      await c.query(`update hosts set stopped_at = now(), paused = true, updated_at = now() where id = $1`, [host.id]);
      await c.query(`update host_offers set state = 'ended' where host_id = $1 and state in ('live', 'paused', 'approved', 'in_review')`, [host.id]);
      await logChange({ subjectKind: 'host', subjectId: host.id, field: 'stopped', after: { stopped: true }, by: account?.id ?? null, byLabel: 'host' }, c);
      return { stopped: true };
    });
    if (out.refused) throw refuse(409, 'outstanding', `Not while ${out.refused.bookings ? `${out.refused.bookings} ${out.refused.bookings === 1 ? 'booking is' : 'bookings are'} still to happen` : `${out.refused.payouts} ${out.refused.payouts === 1 ? 'payout is' : 'payouts are'} still to be paid`}.`);
    res.json(out);
  } catch (err) { next(err); }
});

/**
 * Co-hosts: what each person may see — Guest list · Messages · Money — across
 * the events they help with. Payout splits are deferred (README E13).
 */
router.post('/host/desk/cohosts', async (req, res, next) => {
  try {
    const { host, account } = await me();
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim().slice(0, 80);
    const contact = String(b.contact ?? '').trim().slice(0, 120);
    if (!name || !contact) throw refuse(400, 'who', 'A name, and an email or phone.');
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    const isPhone = /^\+?[0-9 ]{9,16}$/.test(contact);
    if (!isEmail && !isPhone) throw refuse(400, 'contact', 'That is not an email or a phone number.');
    const offerIds = Array.isArray(b.offerIds) ? b.offerIds.filter((x) => UUID.test(String(x))).slice(0, 50) : null;
    const { rows: offers } = await query(
      `select id from host_offers where host_id = $1 and lane is not null and state <> 'ended' and ($2::uuid[] is null or id = any($2::uuid[]))`, [host.id, offerIds],
    );
    if (!offers.length) throw refuse(409, 'no_events', 'There is no event to add them to yet.');
    const { rows: [existing] } = await query(`select id from accounts where lower(email) = lower($1) or mobile = $1 limit 1`, [contact]);
    // The contact is kept, so somebody not on Epic yet can accept once they are — their address is how (Codex, 2 Oct 2026).
    const { household } = await me();
    const kept = await repo.rememberContact(household.id, { name, email: isEmail ? contact : null, mobile: isPhone ? contact : null }, { invited: true });
    await withTransaction(async (c) => {
      for (const o of offers) {
        await c.query(
          `insert into offer_cohosts (offer_id, account_id, contact_id, name, role, sees_guests, can_message, can_see_money)
           values ($1, $2, $3, $4, 'cohost', $5, $6, $7)`,
          [o.id, existing?.id ?? null, kept.id, name, b.guests === true, b.messages === true, b.money === true],
        );
      }
      await logChange({ subjectKind: 'host', subjectId: host.id, field: 'cohost_added', after: { name, events: offers.length, guests: b.guests === true, messages: b.messages === true, money: b.money === true }, by: account?.id ?? null, byLabel: 'host' }, c);
    });
    if (isEmail) {
      const { mailConfigured, sendMail } = await import('../sources/mail.js');
      if (mailConfigured()) await sendMail({ to: contact, subject: `${host.name} asked you to co-host on Epic`, text: `${host.name} asked you to co-host. Sign in to Epic with this address and accept it on the Host tab:\n\n${appUrl()}/host`, purpose: 'cohost_invite' }).catch(() => null);
    }
    res.status(201).json({ added: offers.length });
  } catch (err) { next(err); }
});

router.patch('/host/desk/cohosts/:key', async (req, res, next) => {
  try {
    const { host, account } = await me();
    const b = req.body ?? {};
    const sets = [];
    const vals = [];
    for (const [k, col] of [['guests', 'sees_guests'], ['messages', 'can_message'], ['money', 'can_see_money']]) {
      if (typeof b[k] === 'boolean') { vals.push(b[k]); sets.push(`${col} = $${vals.length + 2}`); }
    }
    if (!sets.length && b.remove !== true) throw refuse(400, 'nothing', 'Nothing to change.');
    const key = String(req.params.key);
    const byAccount = UUID.test(key);
    const where = `offer_id in (select id from host_offers where host_id = $1) and ${byAccount ? 'account_id = $2::uuid' : 'account_id is null and lower(name) = $2'}`;
    const { rowCount } = b.remove === true
      ? await query(`delete from offer_cohosts where ${where}`, [host.id, byAccount ? key : key.toLowerCase()])
      : await query(`update offer_cohosts set ${sets.join(', ')} where ${where}`, [host.id, byAccount ? key : key.toLowerCase(), ...vals]);
    if (!rowCount) throw refuse(404, 'not_found', 'That co-host is not on your events.');
    await logChange({ subjectKind: 'host', subjectId: host.id, field: b.remove === true ? 'cohost_removed' : 'cohost_changed', after: { key, ...b }, by: account?.id ?? null, byLabel: 'host' });
    res.json({ changed: rowCount });
  } catch (err) { next(err); }
});

router.put('/host/desk/auto-messages/:kind', async (req, res, next) => {
  try {
    const { host } = await me();
    const m = AUTO_MESSAGES.find((x) => x.kind === req.params.kind);
    if (!m) throw refuse(404, 'not_found', 'There is no such message.');
    const on = req.body?.on !== false;
    const body = req.body?.body == null ? null : String(req.body.body).trim().slice(0, 1000) || null;
    await query(
      `insert into host_auto_messages (host_id, kind, is_on, body) values ($1, $2, $3, $4)
       on conflict (host_id, kind) do update set is_on = excluded.is_on, body = coalesce(excluded.body, host_auto_messages.body), updated_at = now()`,
      [host.id, m.kind, on, body],
    );
    res.json({ saved: true });
  } catch (err) { next(err); }
});

router.post('/host/desk/quick-replies', async (req, res, next) => {
  try {
    const { host } = await me();
    const body = String(req.body?.body ?? '').trim().slice(0, 500);
    if (!body) throw refuse(400, 'empty', 'Write the reply first.');
    const { rows: [{ n }] } = await query('select count(*)::int as n from host_quick_replies where host_id = $1', [host.id]);
    if (n >= 20) throw refuse(409, 'too_many', 'Twenty quick replies is the most.');
    const { rows: [r] } = await query('insert into host_quick_replies (host_id, body, position) values ($1, $2, $3) returning id, body', [host.id, body, n]);
    res.status(201).json(r);
  } catch (err) { next(err); }
});

router.delete('/host/desk/quick-replies/:id', async (req, res, next) => {
  try {
    const { host } = await me();
    if (!UUID.test(String(req.params.id))) throw refuse(404, 'not_found', 'That reply is not yours.');
    const { rowCount } = await query('delete from host_quick_replies where id = $1 and host_id = $2', [req.params.id, host.id]);
    if (!rowCount) throw refuse(404, 'not_found', 'That reply is not yours.');
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/** Co-host invitations waiting for this account, and accepting one (Codex, 2 Oct 2026: nothing is shown before acceptance). */
router.get('/host/desk/cohost-invites', async (_req, res, next) => {
  try {
    const { account } = await me({ hostOptional: true });
    if (!account) return res.json({ invites: [] });
    const { rows } = await query(
      `select c.id, c.offer_id, o.title, h.name as host, c.sees_guests, c.can_message, c.can_see_money
         from offer_cohosts c join host_offers o on o.id = c.offer_id join hosts h on h.id = o.host_id
         left join host_contacts hc on hc.id = c.contact_id
        where c.accepted_at is null and o.state <> 'ended'
          and (c.account_id = $1 or (c.account_id is null and ((hc.email is not null and lower(hc.email) = lower($2)) or (hc.mobile is not null and hc.mobile = $3))))`,
      [account.id, account.email ?? '', account.mobile ?? ''],
    );
    res.json({ invites: rows.map((r) => ({ id: r.id, offerId: r.offer_id, title: r.title, host: r.host, guests: r.sees_guests, messages: r.can_message, money: r.can_see_money })) });
  } catch (err) { next(err); }
});

router.post('/host/desk/cohost-invites/:id/accept', async (req, res, next) => {
  try {
    const { account } = await me({ hostOptional: true });
    if (!account || !UUID.test(String(req.params.id))) throw refuse(404, 'not_found', 'That invitation isn’t yours.');
    const { rows: [r] } = await query(
      `update offer_cohosts c set accepted_at = now(), account_id = $2
         from (select c2.id from offer_cohosts c2 left join host_contacts hc on hc.id = c2.contact_id
                where c2.id = $1 and c2.accepted_at is null
                  and (c2.account_id = $2 or (c2.account_id is null and ((hc.email is not null and lower(hc.email) = lower($3)) or (hc.mobile is not null and hc.mobile = $4))))) ok
        where c.id = ok.id returning c.offer_id`,
      [req.params.id, account.id, account.email ?? '', account.mobile ?? ''],
    );
    if (!r) throw refuse(404, 'not_found', 'That invitation isn’t yours.');
    res.json({ accepted: true, offerId: r.offer_id });
  } catch (err) { next(err); }
});

/** Help › report an incident: straight to Safety, and it can't be deleted. */
router.post('/host/desk/incidents', async (req, res, next) => {
  try {
    const { host, account } = await me();
    const b = req.body ?? {};
    const body = String(b.body ?? '').trim().slice(0, 4000);
    if (!body) throw refuse(400, 'empty', 'Say what happened.');
    let sessionId = null; let offerId = null;
    if (b.sessionId != null) {
      if (!UUID.test(String(b.sessionId))) throw refuse(400, 'bad_session', 'Pick the session.');
      const { rows: [s] } = await query('select s.id, s.offer_id from offer_sessions s join host_offers o on o.id = s.offer_id where s.id = $1 and o.host_id = $2', [b.sessionId, host.id]);
      if (!s) throw refuse(404, 'session_not_found', 'That session is not one of yours.');
      sessionId = s.id; offerId = s.offer_id;
    }
    const children = Array.isArray(b.children) ? b.children.slice(0, 30).map((c) => String(c).slice(0, 80)) : [];
    const { rows: [i] } = await query(
      `insert into session_incidents (session_id, offer_id, host_id, children, reporter, reporter_account, body) values ($1, $2, $3, $4::jsonb, 'host', $5, $6) returning id, created_at`,
      [sessionId, offerId, host.id, JSON.stringify(children), account?.id ?? null, body],
    );
    res.status(201).json({ id: i.id, at: i.created_at });
  } catch (err) { next(err); }
});

export default router;
