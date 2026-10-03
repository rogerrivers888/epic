/**
 * The ledger, payouts and reconciliation (hosting v4 handover §5, §6).
 *
 * `hosting_payments` (migration 365) is the ledger: one row per money movement
 * — a charge, a hold, a refund, a payout, a tip, the private £10 or Pro — with
 * Stripe's reference. Migration 366 adds the booking value, the rate, Epic's
 * and the host's share, a refund's cause and whether Stripe's own record
 * matched it the last time it was checked.
 *
 * A session's payout is one `host_payouts` row, made once the session is over:
 * its share of every paid booking on it, less what was refunded. Weekly and
 * Course pay per session; a course booking's share is split evenly across the
 * sessions it covers. Tips not yet paid out go with the host's next payout.
 * A booking reaches a session through `booking_sessions` — the booking flow
 * (phase 4) writes one row per session it covers, drop-ins included.
 */

import { query, withTransaction } from '../db.js';

/** Write one movement. `client` joins the caller's transaction. Unique on (stripe_ref, kind): a replay is a no-op that returns the existing row. */
export async function record(m, client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const { rows: [row] } = await q(
    `insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, session_id, payout_id,
                                   amount_pence, epic_pence, host_pence, booking_value_pence, rate_pct,
                                   state, stripe_ref, mode, reason, cause)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (stripe_ref, kind) where stripe_ref is not null do nothing
     returning *`,
    [m.kind, m.bookingId ?? null, m.offerId ?? null, m.hostId ?? null, m.householdId ?? null, m.sessionId ?? null, m.payoutId ?? null,
      m.amountPence, m.epicPence ?? null, m.hostPence ?? null, m.bookingValuePence ?? null, m.ratePct ?? null,
      m.state ?? 'pending', m.stripeRef ?? null, m.mode ?? 'test', m.reason ?? null, m.cause ?? null],
  );
  if (row || !m.stripeRef) return row ?? null;
  const { rows: [existing] } = await q('select * from hosting_payments where stripe_ref = $1 and kind = $2', [m.stripeRef, m.kind]);
  return existing ?? null;
}

/**
 * The host's share of one booking that is still theirs: what they were due at
 * booking, scaled by what the guest has not had back. Epic's fee comes back in
 * the same proportion as the refund.
 */
export function bookingHostShare(b) {
  const charged = Number(b.charged_pence ?? 0);
  const host = Number(b.host_pence ?? 0);
  if (!charged || !host) return 0;
  const kept = Math.max(0, charged - Number(b.refunded_pence ?? 0));
  return Math.floor((host * kept) / charged);
}

/**
 * Split a booking's share across the sessions it covers, evenly, with any odd
 * pence on the last session so the parts add up to the whole.
 */
export function shareForSession(total, sessionIds, sessionId) {
  const ids = [...sessionIds].sort();
  const i = ids.indexOf(sessionId);
  if (i < 0 || !ids.length) return 0;
  const each = Math.floor(total / ids.length);
  return i === ids.length - 1 ? total - each * (ids.length - 1) : each;
}

/**
 * Sessions that have ended, on an offer paid through Epic, with no payout row
 * yet. The end is worked out in the offer's own time zone (UK by default).
 */
export async function sessionsEndedWithoutPayout({ now = new Date(), limit = 200 } = {}) {
  const { rows } = await query(
    `select s.id as session_id, s.offer_id, o.host_id, h.household_id,
            ((coalesce(s.ends_on, s.on_date) + coalesce(s.ends_at, s.starts_at, time '23:59'))
               at time zone coalesce(o.time_zone, 'Europe/London')) as ends_at
       from offer_sessions s
       join host_offers o on o.id = s.offer_id
       join hosts h on h.id = o.host_id
      where s.state in ('scheduled', 'done')
        and not exists (select 1 from host_payouts p where p.session_id = s.id)
        and ((coalesce(s.ends_on, s.on_date) + coalesce(s.ends_at, s.starts_at, time '23:59'))
               at time zone coalesce(o.time_zone, 'Europe/London')) <= $1
        and exists (select 1 from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                     where bs.session_id = s.id and bs.state in ('booked', 'forfeited') and b.payment_state in ('charged', 'partially_refunded')
                       and b.charge_model = 'destination')
      order by 5 limit $2`,
    [now, limit],
  );
  return rows;
}

/** The paid bookings on a session, each with every session it covers. */
export async function paidBookingsOfSession(sessionId, client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const { rows } = await q(
    `select b.id, b.charged_pence, b.refunded_pence, b.host_pence, b.confirmed_happened,
            array(select bs2.session_id::text from booking_sessions bs2 where bs2.booking_id = b.id and bs2.state in ('booked', 'forfeited')) as session_ids
       from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
      where bs.session_id = $1 and bs.state in ('booked', 'forfeited') and b.payment_state in ('charged', 'partially_refunded')
        -- Only money that reached the host's own balance (L1). A booking charged the old way, on Epic's balance,
        -- is never paid out from the host's: those rows wait to be voided (owner, 3 Oct 2026).
        and b.charge_model = 'destination'`,
    [sessionId],
  );
  return rows;
}

/**
 * Make the payout row for one ended session, once. Returns the row, or null if
 * another run made it first (the unique index on session_id) or there is
 * nothing to pay.
 */
export async function schedulePayout({ sessionId, offerId, hostId, endsAt, releaseHours }) {
  return withTransaction(async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`payouts:${hostId}`]);
    const bookings = await paidBookingsOfSession(sessionId, c);
    // Each booking's share still to be paid — its share now, less what earlier payouts already took — spread
    // over its sessions not yet paid out. A refund after one session was paid therefore reduces only what is
    // left, never claws back or overpays (Codex, 2 Oct 2026).
    const lines = [];
    for (const b of bookings) {
      const { rows: [done] } = await c.query(
        `select coalesce(sum((l->>'pence')::int), 0)::int as paid from host_payouts p, jsonb_array_elements(p.lines) l where l->>'bookingId' = $1`,
        [b.id],
      );
      const { rows: [{ paid_sessions: paidSessions }] } = await c.query(`select array(select session_id::text from host_payouts where session_id = any($1::uuid[])) as paid_sessions`, [b.session_ids]);
      const remaining = Math.max(0, bookingHostShare(b) - (done?.paid ?? 0));
      const open = b.session_ids.filter((id) => !paidSessions.includes(id));
      const pence = shareForSession(remaining, open, String(sessionId));
      if (pence > 0) lines.push({ bookingId: b.id, pence });
    }
    const amount = lines.reduce((n, l) => n + l.pence, 0);
    if (amount <= 0) return null;
    const releaseAt = releaseHours == null ? new Date(endsAt) : new Date(new Date(endsAt).getTime() + releaseHours * 3_600_000);
    const { rows: [row] } = await c.query(
      `insert into host_payouts (host_id, offer_id, session_id, amount_pence, release_at, state, lines)
       values ($1, $2, $3, $4, $5, 'scheduled', $6::jsonb)
       on conflict (session_id) where session_id is not null do nothing returning *`,
      [hostId, offerId, sessionId, amount, releaseAt, JSON.stringify(lines)],
    );
    return row ?? null;
  });
}

/** Payouts whose release time has come, or that are held and may have cleared. */
export async function payoutsDue({ now = new Date(), limit = 100 } = {}) {
  const { rows } = await query(
    `select p.*, h.household_id, h.stripe_account_id, h.payouts_state, h.tax_reference, h.paused, h.stripe_account_model, h.stripe_payouts_manual,
            ((coalesce(s.ends_on, s.on_date) + coalesce(s.ends_at, s.starts_at, time '23:59'))
               at time zone coalesce(o.time_zone, 'Europe/London')) as session_ends_at,
            exists (select 1 from hosting_complaints k where k.session_id = p.session_id and k.state = 'open') as complaint_open,
            exists (select 1 from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                     where bs.session_id = p.session_id and b.dispute_state = 'open') as dispute_open,
            exists (select 1 from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                     where bs.session_id = p.session_id and bs.state = 'booked' and b.confirmed_happened = 'yes') as guest_confirmed,
            exists (select 1 from booking_sessions bs join host_reviews r on r.booking_id = bs.booking_id
                     where bs.session_id = p.session_id and r.side = 'guest') as reviewed
       from host_payouts p
       join hosts h on h.id = p.host_id
       left join offer_sessions s on s.id = p.session_id
       left join host_offers o on o.id = p.offer_id
      where (p.state in ('scheduled', 'held') or (p.state = 'released' and p.updated_at < $1::timestamptz - interval '10 minutes'))
        and (p.state in ('held', 'released') or p.release_at <= $1
             or exists (select 1 from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
                         where bs.session_id = p.session_id and b.confirmed_happened = 'yes')
             or exists (select 1 from booking_sessions bs join host_reviews r on r.booking_id = bs.booking_id
                         where bs.session_id = p.session_id and r.side = 'guest'))
      order by p.release_at limit $2`,
    [now, limit],
  );
  return rows;
}

/**
 * Claim a payout to pay it: scheduled/held → released, in one update, so two
 * runs never transfer it twice. Tips waiting for this host ride along.
 */
export async function claimPayout(id, { by }) {
  return withTransaction(async (c) => {
    const { rows: [p] } = await c.query(
      `update host_payouts set state = 'released', released_by = $2, hold_reason = null, updated_at = now()
        where id = $1 and state in ('scheduled', 'held') returning *`,
      [id, by],
    );
    if (!p) return null;
    await c.query(`update booking_tips set payout_id = $1 where host_id = $2 and state = 'paid' and payout_id is null and charge_model = 'destination'`, [id, p.host_id]);
    // Every tip this payout carries, including any put on it when it was made.
    const { rows: [{ pence: tipsPence }] } = await c.query(`select coalesce(sum(amount_pence), 0)::int as pence from booking_tips where payout_id = $1`, [id]);
    const { rows: [withTips] } = await c.query('update host_payouts set tips_pence = $2 where id = $1 returning *', [id, tipsPence]);
    return withTips;
  });
}

export async function holdPayout(id, reason) {
  const { rows: [row] } = await query(
    // An owner's Release is one decision about one hold: held again, it is forgotten, so a later complaint holds it too (Codex, 3 Oct 2026).
    `update host_payouts set state = 'held', hold_reason = $2, released_by = null, updated_at = now()
      where id = $1 and state in ('scheduled', 'held', 'released') and (state = 'released' or hold_reason is distinct from $2) returning *`,
    [id, reason],
  );
  return row ?? null;
}

/** A released payout's outcome: 'paid' with Stripe's Payout id (made on the host's own account), or 'failed'. */
export async function finishPayout(id, { state, stripePayout = null, mode = 'test' }) {
  const { rows: [row] } = await query(
    `update host_payouts set state = $2, stripe_payout = coalesce($3, stripe_payout), mode = $4, updated_at = now(),
            attempt = attempt + case when $2 = 'failed' then 1 else 0 end
      where id = $1 and state = 'released' returning *`,
    [id, state, stripePayout, mode],
  );
  return row ?? null;
}

/**
 * Stripe's word on a payout after it was made (the Connect webhook): one that
 * bounced at the host's bank is failed, for a person to look at; one that
 * landed stays paid. Matched on the account as well as the id, so another
 * host's event can never touch it.
 */
export async function markPayoutOutcome({ stripePayout, accountId, paid, failure = null, payoutId = null }) {
  if (paid) return null;
  return withTransaction(async (c) => {
    // Matched by Stripe's Payout id once Epic has written it down — or, when Stripe's event outruns that write, by
    // Epic's own payout id from the Payout's metadata while the row is still released (Codex, 3 Oct 2026). Either
    // way only on the host's own account, so another host's event can never touch it.
    const { rows: [row] } = await c.query(
      `update host_payouts p set state = 'failed', hold_reason = $3, attempt = attempt + 1, stripe_payout = $1, updated_at = now()
         from hosts h
        where h.id = p.host_id and h.stripe_account_id = $2
          and ((p.stripe_payout = $1 and p.state = 'paid') or ($4::uuid is not null and p.id = $4::uuid and p.state = 'released'))
        returning p.*`,
      [stripePayout, accountId, failure ? `payout_failed:${String(failure).slice(0, 40)}` : 'payout_failed',
        /^[0-9a-f-]{36}$/i.test(String(payoutId ?? '')) ? payoutId : null],
    );
    // The ledger says so too, so no report or reconciliation goes on counting it as paid.
    if (row) await c.query(`update hosting_payments set state = 'failed', reason = $2, updated_at = now() where stripe_ref = $1 and kind = 'payout'`, [stripePayout, row.hold_reason]);
    return row ?? null;
  });
}

/** A chargeback opened or closed on a booking's payment. Open, the session's payout waits (L3). */
export async function markDispute({ paymentIntent, open, status = null }) {
  const state = open ? 'open' : status === 'won' ? 'won' : status === 'lost' ? 'lost' : null;
  if (!state) return null;
  const { rows: [row] } = await query('update experience_bookings set dispute_state = $2 where stripe_payment_intent = $1 returning id', [paymentIntent, state]);
  return row ?? null;
}

/** Ledger rows Stripe has a record of, from the last `days` days, to reconcile. */
export async function rowsToReconcile({ days = 3, limit = 500 } = {}) {
  const { rows } = await query(
    // A payout lives on the host's own account, so its account comes with it.
    `select p.id, p.kind, p.amount_pence, p.state, p.stripe_ref, p.household_id, p.stripe_match, h.stripe_account_id
       from hosting_payments p left join hosts h on h.id = p.host_id
      where p.stripe_ref is not null and p.mode = 'test' and p.voided_at is null and p.updated_at > now() - make_interval(days => $1)
      order by p.updated_at desc limit $2`,
    [days, limit],
  );
  return rows;
}

export async function markMatch(id, match) {
  await query('update hosting_payments set stripe_match = $2 where id = $1', [id, match]);
}

export async function saveReconciliation({ mode, checked, mismatched, details }) {
  const { rows: [row] } = await query(
    `insert into stripe_reconciliations (mode, checked, mismatched, details) values ($1, $2, $3, $4::jsonb) returning *`,
    [mode, checked, mismatched, JSON.stringify(details)],
  );
  return row;
}

export async function lastReconciliation() {
  const { rows: [row] } = await query('select * from stripe_reconciliations order by ran_at desc limit 1');
  return row ?? null;
}

/**
 * Tips that arrived after the host's last payout went, with nothing scheduled
 * to carry them: a payout of their own, so a tip is never left unpaid (Codex,
 * 2 Oct 2026). Waits the release window from the tip, as a session would.
 */
export async function scheduleTipPayouts({ now = new Date(), releaseHours = 72 } = {}) {
  const { rows } = await query(
    `select host_id, array_agg(id) as ids, sum(amount_pence)::int as pence, min(created_at) as first_at
       from booking_tips t
      where t.state = 'paid' and t.payout_id is null and t.charge_model = 'destination' and t.created_at <= $1::timestamptz - make_interval(hours => $2::int)
        and not exists (select 1 from host_payouts p where p.host_id = t.host_id and p.state in ('scheduled', 'held'))
      group by host_id`,
    [now, releaseHours],
  );
  let made = 0;
  for (const r of rows) {
    await withTransaction(async (c) => {
      // One run at a time per host, and the amount is only what this run actually claimed (Codex, 2 Oct 2026).
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`payouts:${r.host_id}`]);
      const { rows: [p] } = await c.query(
        `insert into host_payouts (host_id, amount_pence, tips_pence, release_at, state) values ($1, 0, 0, $2, 'scheduled') returning id`,
        // Its clock is the first tip's: the release window counts from when the money came, as a session's does from its end.
        [r.host_id, r.first_at],
      );
      const { rows: claimed } = await c.query(`update booking_tips set payout_id = $1 where id = any($2::uuid[]) and payout_id is null returning amount_pence`, [p.id, r.ids]);
      const pence = claimed.reduce((n, t) => n + t.amount_pence, 0);
      if (!pence) { await c.query('delete from host_payouts where id = $1', [p.id]); return; }
      await c.query('update host_payouts set tips_pence = $2 where id = $1', [p.id, pence]);
      made += 1;
    });
  }
  return made;
}

// ---------------------------------------------------------------------------
// voiding the old model (owner, 3 Oct 2026)
//
// Before register L, guests were charged on Epic's own balance and hosts' Stripe
// accounts were made without manual payouts. There are no real users, so those
// rows are voided rather than converted: kept, never deleted, marked so nothing
// pays, refunds or reconciles them again. Test mode only — a live row refuses
// the lot. The owner runs it himself, through an Approval (G7).
// ---------------------------------------------------------------------------

const OLD_HOSTS = `stripe_account_id is not null and stripe_account_model is null`;
const OLD_BOOKINGS = `charge_model is null and stripe_payment_intent is not null and money_voided_at is null`;
const OLD_TIPS = `charge_model is null and stripe_ref is not null and state in ('pending', 'paid') and payout_id is null`;
// A payout still to go for a host whose account is from before, or carrying a booking or tip charged the old way.
const OLD_PAYOUTS = `p.state in ('scheduled', 'held', 'released') and (
    exists (select 1 from hosts h where h.id = p.host_id and h.stripe_account_id is not null and h.stripe_account_model is null)
    or exists (select 1 from jsonb_array_elements(p.lines) l join experience_bookings b on b.id = (l->>'bookingId')::uuid where b.charge_model is null)
    or exists (select 1 from booking_tips t where t.payout_id = p.id and t.charge_model is null))`;

/** What voiding would touch, without touching it: the Approval's "affected" and the back office's preview. */
export async function oldModelCounts(client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const { rows: [r] } = await q(
    `select (select count(*) from hosts where ${OLD_HOSTS})::int as hosts,
            (select count(*) from experience_bookings where ${OLD_BOOKINGS})::int as bookings,
            (select count(*) from booking_tips where ${OLD_TIPS})::int as tips,
            (select count(*) from host_payouts p where ${OLD_PAYOUTS})::int as payouts,
            (select count(*) from hosting_payments m join experience_bookings b on b.id = m.booking_id
              where b.charge_model is null and b.stripe_payment_intent is not null and m.state = 'pending' and m.voided_at is null)::int as pending_lines,
            (select count(*) from hosting_payments where mode = 'live')::int as live_lines,
            (select count(*) from host_payouts where mode = 'live')::int as live_payouts`,
  );
  return r;
}

/**
 * Void them, in one transaction. Hosts lose the old account id (kept beside it,
 * as voided) so their next payouts step makes a new one the L1 way; bookings and
 * their pending refund lines are marked and left as they are; payouts and tips
 * not yet paid out become 'void'. Returns the counts it voided.
 */
export async function voidOldModel() {
  return withTransaction(async (c) => {
    const before = await oldModelCounts(c);
    if (before.live_lines || before.live_payouts) throw Object.assign(new Error('There is live-mode money on the ledger. Nothing was voided.'), { status: 409, code: 'live_rows' });
    const { rows: voidedPayouts } = await c.query(`update host_payouts p set state = 'void', hold_reason = 'old_model', updated_at = now() where ${OLD_PAYOUTS} returning id`);
    const payouts = voidedPayouts.length;
    // Old tips not yet attached to a payout, and those a payout being voided had already claimed (Codex, 3 Oct 2026).
    const { rowCount: tips } = await c.query(
      `update booking_tips set state = 'void'
        where (${OLD_TIPS}) or (charge_model is null and state = 'paid' and payout_id = any($1::uuid[]))`,
      [voidedPayouts.map((p) => p.id)],
    );
    const { rowCount: lines } = await c.query(
      `update hosting_payments m set voided_at = now(), updated_at = now() from experience_bookings b
        where b.id = m.booking_id and b.charge_model is null and b.stripe_payment_intent is not null and m.state = 'pending' and m.voided_at is null`,
    );
    const { rowCount: bookings } = await c.query(`update experience_bookings set money_voided_at = now() where ${OLD_BOOKINGS}`);
    const { rows: hosts } = await c.query(
      `update hosts set stripe_void_account_id = stripe_account_id, stripe_voided_at = now(), stripe_account_id = null,
                        payouts_state = 'none', stripe_charges_enabled = false, stripe_payouts_enabled = false, updated_at = now()
        where ${OLD_HOSTS} returning id`,
    );
    return { hosts: hosts.length, hostIds: hosts.map((h) => h.id), bookings, tips, payouts, pendingLines: lines };
  });
}
